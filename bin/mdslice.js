#!/usr/bin/env node
/**
 * mdslice —— MDSlice 的本地服务入口（零依赖，装到全局后在任意项目目录里跑）
 *
 * 用法：
 *   mdslice                    在当前目录启动，默认端口 8787，端口占用自动递增
 *   mdslice <目录>             指定要浏览的目录
 *   mdslice -p 9000            指定端口（也可 --port=9000）
 *   mdslice --no-open          不自动打开浏览器
 *   mdslice -h / -v            帮助 / 版本
 *
 * 路由：
 *   /__mdslice/          阅读器页面（MDSlice.html 与 css/、js/ 直接从包目录取，引用不用改写）
 *   /                    被浏览目录的内容：目录一律返回索引页，文件按静态服务返回（支持 Range）
 *   其他                 404
 *
 * 三个刻意的设计：
 *   1. 阅读器页面与「被浏览的目录」分居两个地址：首页既要显示目录、又要按目录读列表
 *      （js/08-boot.js 用页面地址推断来源，js/06-dirs.js 再拿那个地址去 fetch 目录列表），
 *      页面地址一旦就是内容根，这两件事会抢同一个 URL。分开放，各自都直白。
 *   2. 目录名与内容根地址由服务注入 window.MDSLICE（见 serveEntry），boot 有配置就用配置、
 *      没有就退回按页面地址推断 —— 所以普通静态服务器与 file:// 直开的用法一字未改。
 *   3. 目录一律给索引页，即使里面有 index.html：静态服务器用 index.html 顶掉目录列表，
 *      正是「同目录有 index.html 就列不出文件」的老问题（js/07-home.js 的 shadow 分支）。
 *      索引页只放 <a href>，正好是 js/06-dirs.js 的 parseListing 认得的最小形式。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_HOME = path.resolve(__dirname, '..');       // 包根：MDSlice.html 与 css/、js/ 在这一级
const ENTRY = 'MDSlice.html';
const ASSET_DIRS = ['css', 'js'];
const ASSET_PREFIX = '/__mdslice';
const DEFAULT_PORT = 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/* ---- 命令行 ---- */
/** 极简参数解析：`-p 9000` 与 `--port=9000` 两种写法都认；位置参数是目录。
    选项写残了（`-p` 后面没跟值）就报错退出：静默退回默认端口会让人以为端口没生效却查不出原因。 */
function parseArgv(list) {
  const out = { positional: [], port: '', open: true, help: false, version: false, err: '' };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '-p' || a === '--port') {
      if (list[i + 1] === undefined) { out.err = a + ' 后面要跟端口号'; break; }
      out.port = list[++i];
      continue;
    }
    if (a.indexOf('--port=') === 0) {
      out.port = a.slice(7);
      if (out.port === '') { out.err = '--port= 后面要跟端口号'; break; }
      continue;
    }
    if (a === '--no-open' || a === '-s') { out.open = false; continue; }
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a === '-v' || a === '--version') { out.version = true; continue; }
    if (a.length > 1 && a.charAt(0) === '-') { out.err = '未知选项：' + a; break; }
    out.positional.push(a);
  }
  return out;
}

function helpText() {
  return [
    '用法: mdslice [目录] [-p 端口] [--no-open]',
    '',
    '  [目录]        要浏览的目录，默认当前目录；浏览器里按该目录的 md 层级浏览',
    '  -p, --port    端口，默认 ' + DEFAULT_PORT + '（占用时自动 +1 重试）',
    '  --no-open     不自动打开浏览器',
    '  -v, --version 版本号',
    '',
    '例: mdslice ../某个项目/docs -p 9000',
  ].join('\n');
}

function packageVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(APP_HOME, 'package.json'), 'utf8')).version; }
  catch (e) { return '未知'; }
}

/* ---- 通用 HTTP 工具 ---- */
const send = (res, code, body, headers) => {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
};
const redirect = (res, code, location) => send(res, code, '', { Location: location });
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return null; } }

/** 绝对路径是否落在 base 之内（base 自身也算）。 */
function inside(abs, base) { return abs === base || abs.indexOf(base + path.sep) === 0; }

/** 静态文件：支持 Range（图片、pdf、视频拖动都要用），不缓存以便改完刷新即见。 */
async function serveFile(res, abs, range) {
  let stat;
  try { stat = await fsp.stat(abs); } catch (e) { return send(res, 404, 'Not Found'); }
  if (stat.isDirectory()) return send(res, 404, 'Not Found');       // 目录走索引页，不到这里
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  if (range && stat.size > 0) {
    // 只认 `bytes=起点-终点` 与 `bytes=起点-` 两种：后缀式（bytes=-N）与多段（逗号）不解析，
    // 按 RFC 允许的那样忽略 Range 返回整体 —— 与其发一个对不上的 Content-Range，不如不发。
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(range).trim());
    if (m) {
      const start = parseInt(m[1], 10);
      // 终点要夹到文件末尾：客户端可以要一个远超文件大小的范围，照抄会让 Content-Length /
      // Content-Range 与实际发出的字节数对不上，响应直接坏掉（浏览器一直等剩下的字节）。
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (start < stat.size && end >= start) {
        res.writeHead(206, {
          'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Content-Length': end - start + 1,
        });
        return fs.createReadStream(abs, { start: start, end: end }).pipe(res);
      }
    }
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(abs).pipe(res);
}

/* ---- 路由 1：阅读器页面与自身资源 ---- */
/** 入口页注入来源信息：目录名照原样显示，内容根是 '/'。
    地址必须是完整的绝对 URL —— 前端拿它当 new URL() 的基地址解析子目录（js/06-dirs.js），
    而端口可能因占用递增过，所以只能取启动时定下来的那个（state.port）。 */
async function serveEntry(res, state) {
  let html;
  try { html = await fsp.readFile(path.join(APP_HOME, ENTRY), 'utf8'); }
  catch (e) { return send(res, 500, '缺少阅读器入口 ' + ENTRY + '（在 ' + APP_HOME + ' 下没找到）'); }
  const root = 'http://127.0.0.1:' + state.port + '/';
  // < 转义掉：目录名里出现 </script 时不会把这段脚本截断（名字来自本地目录，防的是手滑不是攻击）
  const cfg = '<script>window.MDSLICE=' +
    JSON.stringify({ name: state.name, url: root }).replace(/</g, '\\u003c') + ';</script>';
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, cfg + '</head>');
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + cfg);
  else html = cfg + html;
  send(res, 200, html, { 'Content-Type': MIME['.html'] });
}

/** 只放行 css/、js/ 两个目录（入口页由主处理单独给出），避免把包里的 bin/、package.json 也暴露出去。 */
function assetAllowed(rel) {
  if (rel.indexOf('..') >= 0) return false;
  return ASSET_DIRS.some((d) => rel.indexOf(d + '/') === 0);
}

async function serveAsset(res, rel) {
  const abs = path.join(APP_HOME, rel);
  if (!assetAllowed(rel) || !inside(abs, APP_HOME)) return send(res, 403, 'Forbidden');
  try {
    const buf = await fsp.readFile(abs);
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  } catch (e) {
    send(res, 404, 'reader asset not found: ' + rel);
  }
}

/* ---- 路由 2：目录索引页 ----
   只放 <a href> 这一个信息：js/06-dirs.js 的 parseListing 就是这么读的（相对地址 + 目录带尾斜杠），
   于是前端不用为「服务端列表」多写一条路径。显示文本做 HTML 转义，href 用 encodeURIComponent，
   含 & " # 之类的文件名也安全。 */
async function serveListing(res, abs, dirPath) {
  let entries;
  try { entries = await fsp.readdir(abs, { withFileTypes: true }); }
  catch (e) { return send(res, 403, '无法读取该目录'); }

  const rows = [];
  for (const e of entries) {
    let isDir = e.isDirectory();
    if (!isDir && !e.isFile()) {                       // 符号链接等：跟随一次再判
      try { isDir = (await fsp.stat(path.join(abs, e.name))).isDirectory(); } catch (err) { continue; }
    }
    rows.push('<li><a href="' + encodeURIComponent(e.name) + (isDir ? '/' : '') + '">' +
      escHtml(e.name + (isDir ? '/' : '')) + '</a></li>');
  }
  const head = 'Index of ' + escHtml(dirPath);
  send(res, 200, '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>' + head + '</title></head>\n<body>\n<h1>' + head + '</h1>\n<ul>\n' +
    rows.join('\n') + '\n</ul>\n</body></html>\n', { 'Content-Type': MIME['.html'] });
}

/* ---- 主处理 ---- */
function makeHandler(ROOT, state) {
  return async function handle(req, res) {
    const raw = (req.url || '/').split('#')[0];
    const q = raw.indexOf('?');
    const rawPath = q >= 0 ? raw.slice(0, q) : raw;
    const decoded = safeDecode(rawPath);
    if (decoded === null) return send(res, 400, '路径编码有误');

    if (decoded === ASSET_PREFIX) return redirect(res, 301, ASSET_PREFIX + '/');
    if (decoded.indexOf(ASSET_PREFIX + '/') === 0) {
      const rel = decoded.slice(ASSET_PREFIX.length + 1);
      if (rel === '' || rel === ENTRY) return serveEntry(res, state);
      return serveAsset(res, rel);
    }

    const abs = path.resolve(ROOT, decoded.replace(/^\/+/, ''));
    if (!inside(abs, ROOT)) return send(res, 403, 'Forbidden');

    let stat;
    try { stat = await fsp.stat(abs); } catch (e) { return send(res, 404, 'Not Found'); }
    if (stat.isDirectory()) {
      // 目录地址不带尾斜杠时补上：索引页里是相对地址，基地址得是「目录/」才对
      if (rawPath.charAt(rawPath.length - 1) !== '/') {
        return redirect(res, 301, rawPath + '/');
      }
      return serveListing(res, abs, decoded);
    }
    return serveFile(res, abs, req.headers.range);
  };
}

/* ---- 启动 ---- */
function openBrowser(url) {
  const p = process.platform;
  const cmd = p === 'darwin' ? ['open', [url]]
    : p === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* 打不开就算了 */ }
}

function listen(handle, port, root, state, tried) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy();
      send(res, 500, String((err && err.stack) || err));
    });
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tried < 20) {
      return listen(handle, port + 1, root, state, tried + 1);
    }
    console.error('启动失败：' + e.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    state.port = port;                                  // 注入页要靠它拼绝对地址，必须等真正监听到
    const at = 'http://127.0.0.1:' + port + ASSET_PREFIX + '/';
    console.log('\n  MDSlice 已启动  ' + at);
    console.log('  浏览目录：' + root + '（目录列表在 http://127.0.0.1:' + port + '/）');
    console.log('  阅读器：  ' + APP_HOME + '\n');
    if (startOpen) openBrowser(at);
  });
}

/* ---- 入口 ---- */
const args = parseArgv(process.argv.slice(2));
let startOpen = args.open;

if (args.help) {
  console.log(helpText());
} else if (args.version) {
  console.log(packageVersion());
} else if (args.err) {
  console.error(args.err + '\n\n' + helpText());
  process.exit(1);
} else {
  const root = path.resolve(process.cwd(), args.positional[0] || '.');
  let stat = null;
  try { stat = fs.statSync(root); } catch (e) { /* 下面统一报错 */ }
  if (!stat || !stat.isDirectory()) {
    console.error('目录不存在或不是目录：' + root);
    process.exit(1);
  }
  // 只认十进制数字：parseInt('80x') 会得到 80，静默接受一个打错的端口比直接报错更难查
  const port = args.port === '' ? DEFAULT_PORT : (/^\d+$/.test(args.port) ? Number(args.port) : NaN);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('端口不合法：' + args.port);
    process.exit(1);
  }
  const name = path.basename(root) || 'root';       // 盘符根目录（basename 为空）也得有个名字
  const state = { name: name, port: port };         // port 会在真正监听成功后回填
  listen(makeHandler(root, state), port, root, state, 0);
}
