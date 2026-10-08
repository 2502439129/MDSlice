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
 *   /__mdslice/              阅读器页面（MDSlice.html 与 css/、js/ 直接从包目录取，引用不用改写）
 *   /__mdslice/api/config    写回 mdslice-config.json（POST，只给设置面板用）
 *   /                        被浏览目录的内容：目录一律返回索引页，文件按静态服务返回（支持 Range）
 *   其他                     404
 *
 * 三个刻意的设计：
 *   1. 阅读器页面与「被浏览的目录」分居两个地址：首页既要显示目录、又要按目录读列表
 *      （js/08-boot.js 用页面地址推断来源，js/06-dirs.js 再拿那个地址去 fetch 目录列表），
 *      页面地址一旦就是内容根，这两件事会抢同一个 URL。分开放，各自都直白。
 *   2. 目录名与内容根地址由服务注入 window.MDSLICE（见 serveEntry），boot 有配置就用配置、
 *      没有就退回按页面地址推断 —— 所以普通静态服务器与 file:// 直开的用法一字未改。
 *      同一份注入里还带着可见性配置（mdslice-config.json）的原文与项目绝对路径：
 *      页面按路径挑出本项目那一段再决定树里显示什么，服务端不参与配置语义。
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
const CONFIG_FILE = 'mdslice-config.json';            // 可见性配置：服务端只负责把原文交给页面
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
/** 入口页注入来源信息：目录名照原样显示，内容根是 '/'，外加可见性配置的原文。
    地址必须是完整的绝对 URL —— 前端拿它当 new URL() 的基地址解析子目录（js/06-dirs.js），
    而端口可能因占用递增过，所以只能取启动时定下来的那个（state.port）。

    配置只把「文件原文 + 这是哪个项目」交给页面，由页面自己解析合并（js/00-config.js）：
    服务端因此不需要认识配置语义，也就不会出现两份合并逻辑。每次请求都读一次文件，
    改完配置刷新页面即生效（入口页与配置都不缓存）。 */
async function serveEntry(res, state) {
  let html;
  try { html = await fsp.readFile(path.join(APP_HOME, ENTRY), 'utf8'); }
  catch (e) { return send(res, 500, '缺少阅读器入口 ' + ENTRY + '（在 ' + APP_HOME + ' 下没找到）'); }
  const root = 'http://127.0.0.1:' + state.port + '/';
  let configText = '';
  try { configText = await fsp.readFile(path.join(APP_HOME, CONFIG_FILE), 'utf8'); }
  catch (e) { /* 没有配置文件：注入空串，页面按内置默认跑 */ }
  // < 转义掉：目录名里出现 </script 时不会把这段脚本截断（名字来自本地目录，防的是手滑不是攻击）
  const cfg = '<script>window.MDSLICE=' + JSON.stringify({
    name: state.name, url: root,
    configFile: path.join(APP_HOME, CONFIG_FILE), configPath: state.root, configText: configText,
  }).replace(/</g, '\\u003c') + ';</script>';
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

/* ---- 路由 3：写回配置（设置面板的「保存」） ----
   只做「把这一段写进那个键」，不认识配置语义（有哪些字段、该是什么类型，判断都在页面侧，
   见 js/00-config.js 的 CONFIG_FIELDS）—— 语义只留一处，才不会两边漂移。
   两条防呆：请求头必须带 application/json（非简单请求，别的站点发不出这一手，因此不必再加 CORS 头）；
   文件本身解析不了就直接拒绝 —— 绝不覆盖一份自己没读懂的文件（那多半是手写改到一半）。 */
const sendJson = (res, code, obj) =>
  send(res, code, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** 项目路径归一化成 projects 段的键：与 js/00-config.js 的 configKey 同一口径（只此一处需要它）。 */
const configKeyOf = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

/** 读请求体（带上限，别让一个坏请求把内存撑住）。 */
async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function saveConfig(req, res) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    return sendJson(res, 415, { ok: false, error: '需要 Content-Type: application/json' });
  }
  let data;
  try { data = JSON.parse(await readBody(req, 64 * 1024)); }
  catch (e) { return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON：' + e.message }); }

  const section = isPlainObject(data) ? data.cfg : null;
  const scope = isPlainObject(data) ? data.scope : '';
  if (!isPlainObject(section)) return sendJson(res, 400, { ok: false, error: '缺少 cfg（应当是一个配置对象）' });
  if (scope !== 'default' && scope !== 'project') {
    return sendJson(res, 400, { ok: false, error: 'scope 只能是 default 或 project' });
  }

  const file = path.join(APP_HOME, CONFIG_FILE);
  let doc = null;
  try {
    const text = await fsp.readFile(file, 'utf8');
    if (text.trim() !== '') {
      try { doc = JSON.parse(text); }
      catch (e) {
        return sendJson(res, 409, { ok: false, error:
          '配置文件现在解析不了，已拒绝写入（先把它修好或删掉）：' + e.message });
      }
    }
  } catch (e) { /* 文件还不存在：下面新建 */ }
  if (!isPlainObject(doc)) doc = {};        // 内容不是对象（或被删空）：当新文件重建，但只动这两个键

  if (scope === 'default') {
    doc.default = Object.assign(isPlainObject(doc.default) ? doc.default : {}, section);
  } else {
    const key = configKeyOf(data.projectPath);
    if (!key) return sendJson(res, 400, { ok: false, error: '写本项目段需要 projectPath（命令行启动时带着的那个目录）' });
    if (!isPlainObject(doc.projects)) doc.projects = {};
    // 已经存在的键可能写作别的形式（大小写、反斜杠）：按归一化找到它，免得同一个项目出现两条
    let hit = null;
    Object.keys(doc.projects).forEach((k) => { if (configKeyOf(k) === key) hit = k; });
    const useKey = hit || key;
    doc.projects[useKey] = Object.assign(isPlainObject(doc.projects[useKey]) ? doc.projects[useKey] : {}, section);
  }
  // 同名字段覆盖、其余字段保留：schema 与注释性的额外字段都不动（schema 缺失时也不补，
  // 页面侧对"没有 schema"是宽容的，服务端不必替它记一个版本号）

  const out = JSON.stringify(doc, null, 2) + '\n';
  try { await fsp.writeFile(file, out, 'utf8'); }
  catch (e) { return sendJson(res, 500, { ok: false, error: '写入失败：' + e.message }); }
  sendJson(res, 200, { ok: true, file: file, scope: scope, text: out });   // 交回新原文：页面立刻按它跑
}

/* ---- 主处理 ---- */
function makeHandler(ROOT, state) {
  return async function handle(req, res) {
    const raw = (req.url || '/').split('#')[0];
    const q = raw.indexOf('?');
    const rawPath = q >= 0 ? raw.slice(0, q) : raw;
    const decoded = safeDecode(rawPath);
    if (decoded === null) return send(res, 400, '路径编码有误');

    if (decoded === ASSET_PREFIX + '/api/config') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只接受 POST' });
      return saveConfig(req, res);
    }
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
  const state = { name: name, port: port, root: root };   // port 会在真正监听成功后回填
  listen(makeHandler(root, state), port, root, state, 0);
}
