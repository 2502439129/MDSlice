/* dirs.js —— 目录来源与文件树数据：本地文件夹（webkitRelativePath）、拖入文件夹、静态服务器目录索引与懒加载。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* =========================================================
     11. 首页（文件与目录管理）
     常驻第一个标签页、不可关闭。静态服务器（http/https）下自动列出同目录的
     markdown；「添加目录」用 webkitdirectory 选文件夹，也支持把文件夹拖进页面。
     规则：只保留子文件夹与 markdown，其他文件全部忽略；跳过常见构建/缓存目录。
     ========================================================= */
  var HOME_NAME = '__home__';
  var MAX_DEPTH = 8;
  var IGNORE_DIRS = {
    node_modules: 1, bower_components: 1, vendor: 1, dist: 1, build: 1, out: 1, target: 1,
    coverage: 1, __pycache__: 1
  };
  var homeDirs = [];                    // 首页「目录」区，数组顺序即展示顺序
  var homeNodes = Object.create(null);  // 节点 id → 节点，供事件委托反查
  var homeSeq = 0;
  var homeNotice = '';
  var homeFilterRaw = '';               // 过滤框原文（重建时回填）
  var homeFilter = '';                  // 过滤关键字（小写）
  var homeSel = null;                   // 键盘/点击选中的节点 id
  var FT_FILE_COLOR = { md: '#4493f8', markdown: '#4493f8', txt: '#8c959f' };
  var FILE_TIP = '当前是 <code>file://</code> 直接打开，浏览器会拦截本地读取，无法自动列出同目录文件。' +
    '<br><br>点「添加目录」选择本地文件夹，或把文件夹 / <code>.md</code> 直接拖到页面中；' +
    '也可以在本地服务器下打开本页（那时才会自动列出同目录的 md）。注意：同目录里不能有 <code>index.html</code>，' +
    '否则服务器返回的是页面本身、不是目录列表：<br><br><code>python3 -m http.server 8000</code>';

  var dirInput = document.getElementById('dirInput');
  dirInput.addEventListener('change', function () {
    addLocalFromFileList(dirInput.files);
    dirInput.value = '';                 // 同一个目录再次选择也能触发 change
  });

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function isDocName(name) { return DOC_EXT.test(name); }
  function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase(); }
  /** 树里的图标：目录区分开合，文件按后缀着色（图标定义见 MDSlice.html 的精灵） */
  function ftIcon(isDir, expanded, name) {
    var href = isDir ? (expanded ? '#i-folder-open' : '#i-folder') : '#i-file';
    var color = isDir ? '' : (FT_FILE_COLOR[extOf(name)] ? ' style="color:' + FT_FILE_COLOR[extOf(name)] + '"' : '');
    return '<span class="ftree__icon' + (isDir ? ' is-dir' : '') + '"' + color + '>' +
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><use href="' + href + '"/></svg></span>';
  }
  /** 过滤时给命中的片段套 <mark> */
  function markName(name) {
    if (!homeFilter) return esc(name);
    var i = name.toLowerCase().indexOf(homeFilter);
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + homeFilter.length)) + '</mark>' +
      esc(name.slice(i + homeFilter.length));
  }
  function isIgnoredDir(name) { return name.charAt(0) === '.' || !!IGNORE_DIRS[name]; }
  function nodeId(node) {
    if (!node.id) { node.id = 'hn' + (++homeSeq); homeNodes[node.id] = node; }
    return node.id;
  }
  function homeTab() {                                    // 注意：首页的 tab.id 是 tabN，不能按名字查
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].kind === 'home') return tabs[i]; }
    return null;
  }

  /* ---- 节点的路径与身份 ----------------------------------------------
     从目录打开的文件用「目录名/相对路径」作为身份，于是 B1/index.md 与 B2/index.md
     是两份文件；直接上传的文件仍以文件名作身份（见 openTab 的默认 key）。 */
  function relOf(node) {
    var parts = [];
    for (var c = node; c && c.parent; c = c.parent) parts.unshift(c.name);
    return parts.join('/');
  }
  function rootOf(node) {
    var c = node;
    while (c && c.parent) c = c.parent;
    return c;
  }
  function keyOfNode(node) {
    var root = rootOf(node);
    return (root ? root.name : '') + '/' + relOf(node);
  }
  /** 显示用的所在目录：**顶层目录名** + 相对路径（去掉文件名）。
      顶层目录名必须带上：两个不同文件夹里「相同子路径 + 同名文件」时，
      只靠相对路径永远撞车（可用路径段里没有区分项）。带上之后 labelAt()
      的最短唯一后缀会自动决定要不要露出它，例如：
      普通重名 → B1/index、B2/index；跨顶层目录重名 → Documents/Documents/新建、另一个顶层名/Documents/新建 */
  function dirOfNode(node) {
    var root = rootOf(node);
    var seg = relOf(node).split('/');
    seg.pop();
    if (root && root.name) seg.unshift(root.name);
    return seg.join('/');
  }

  /* ---- 本地文件 → 目录树（用 webkitRelativePath 还原层级） ---- */
  function insertFile(root, rel, file) {
    var parts = String(rel).split('/').filter(Boolean);
    parts.shift();                                        // 首段是所选文件夹名，去掉
    if (!parts.length) return;
    var leaf = parts.pop();
    if (!isDocName(leaf)) return;                         // 只留 markdown
    var node = root;
    for (var i = 0; i < parts.length; i++) {
      if (i >= MAX_DEPTH || isIgnoredDir(parts[i])) return;   // 落在忽略目录里 → 整条丢弃
      var next = null;
      for (var j = 0; j < node.children.length; j++) {
        if (node.children[j].type === 'dir' && node.children[j].name === parts[i]) { next = node.children[j]; break; }
      }
      if (!next) {
        next = { name: parts[i], type: 'dir', children: [], expanded: true, parent: node };
        node.children.push(next);
      }
      node = next;
    }
    node.children.push({ name: leaf, type: 'file', file: file, parent: node });
  }
  function sortTree(node) {
    node.children.sort(function (a, b) {
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });
    node.children.forEach(function (c) { if (c.type === 'dir') sortTree(c); });
  }
  function addLocalDir(name, entries) {
    var dir = { name: name, source: 'local', children: [], expanded: true };
    entries.forEach(function (e) { insertFile(dir, e.rel, e.file); });
    sortTree(dir);
    if (!dir.children.length) {
      homeNotice = '「' + esc(name) + '」里没有找到 markdown 文件（也可能都在被忽略的目录里）。';
      refreshHomeNow();
      return;
    }
    for (var i = homeDirs.length - 1; i >= 0; i--) {      // 同名本地目录：替换旧的
      if (homeDirs[i].source !== 'server' && homeDirs[i].name === name) homeDirs.splice(i, 1);
    }
    homeNotice = '';
    nodeId(dir);
    homeDirs.push(dir);
    refreshHomeNow();
  }
  function addLocalFromFileList(fileList) {
    var list = [].slice.call(fileList || []);
    if (!list.length) return;
    if (!list[0].webkitRelativePath) {
      // 老浏览器没有 webkitdirectory：这里会退化成「选单个文件」
      homeNotice = '当前浏览器不支持选择文件夹，请改用「打开 MD」选文件，或把文件夹直接拖进页面。';
      refreshHomeNow();
      return;
    }
    var entries = list.map(function (f) { return { rel: f.webkitRelativePath || f.name, file: f }; });
    var rootName = (list[0].webkitRelativePath || '').split('/')[0] || '未命名目录';
    addLocalDir(rootName, entries);
  }

  /* ---- 静态服务器目录索引 → 目录树（子目录懒加载） ----
     各家服务器的链接写法不一致：python 用 doc.md、serve 用 /dir/doc.md、有些用 ./doc.md。
     统一按「当前目录」归一化，只保留同层条目。 */
  /** 列表里的 href 有两种常见"变形"，必须先还原，否则条目会被丢掉或整条路径被误当成文件名：
      ① HTML 实体转义：serve 把斜杠写成 &#47;（如 /dir&#47;sub&#47;、/dir&#47;a.md）
      ② Windows 反斜杠：serve 在 Windows 上输出 \dir\a.md（底层 path.relative 的产物） */
  function decodeHref(href) {
    return String(href)
      .replace(/&amp;/g, '&')                                       // 先还原 &amp;，避免 &amp;#47; 被漏掉
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&quot;/g, '"').replace(/&apos;|&#0?39;/g, "'")
      .replace(/\\/g, '/');                                         // ② 反斜杠 → 正斜杠
  }
  function parseListing(html, baseUrl) {
    var out = [], seen = Object.create(null);
    var basePath = new URL(baseUrl).pathname;                               // 形如 /dir/
    var re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = decodeHref((m[1] != null ? m[1] : m[2]) || '');
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;              // mailto: / http(s): 等
      if (href.charAt(0) === '#' || href.charAt(0) === '?') continue;        // 锚点、排序参数
      var path = href.split('#')[0].split('?')[0];
      if (path.charAt(0) === '/') {                                          // 绝对路径：必须是当前目录下的
        if (path.indexOf(basePath) !== 0) continue;
        path = path.slice(basePath.length);
      }
      if (path.indexOf('./') === 0) path = path.slice(2);                     // ./doc.md
      var isDir = /\/$/.test(path);
      var raw = path.replace(/\/+$/, '');
      if (!raw || raw === '.' || raw === '..' || raw.indexOf('/') >= 0) continue;   // 只看同层
      var name;
      try { name = decodeURIComponent(raw); } catch (e) { continue; }
      if (seen[name]) continue;
      if (isDir) { if (isIgnoredDir(name)) continue; }
      else if (!isDocName(name)) continue;                                    // 非 markdown 忽略
      seen[name] = 1;
      out.push({ name: name, type: isDir ? 'dir' : 'file', href: href });
    }
    return out;
  }
  /** 兜底：纯文本目录列表（每行一个名字）。至少认出一个 markdown 才采信，避免误判。 */
  function parsePlainListing(text) {
    var out = [], seen = Object.create(null), hit = 0;
    String(text).split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === '.') return;
      var isDir = /\/$/.test(line);
      var raw = line.replace(/\/+$/, '');
      if (!raw || raw.indexOf('/') >= 0) return;
      if (isDir) { if (isIgnoredDir(raw)) return; }
      else if (!isDocName(raw)) return;
      else hit++;
      if (seen[raw]) return;
      seen[raw] = 1;
      out.push({ name: raw, type: isDir ? 'dir' : 'file', href: line });
    });
    return hit ? out : [];
  }
  /* ---- 空目录剪枝 --------------------------------------------------------
     服务器列表会把所有子目录都列出来，其中不含 markdown 的（如只放 css/js 的目录）不该显示。
     一个子目录里有没有 md，必须再请求一次它的列表才知道，所以加载完一层就顺手「探测」它的子目录：
       · 每目录一次请求，结果直接写回节点 → 之后手动展开是瞬时的，不会重复请求
       · 深度（PRUNE_LEVELS）与请求数（PRUNE_BUDGET）都有上限
       · 超限、读取失败、页面被 index.html 影子 → 一律保留（宁可多显示，也不要漏内容）
     本地目录不需要这套：insertFile() 只沿 markdown 路径建节点，本来就不会有空目录。 */
  var PRUNE_LEVELS = 3;                                   // 最多往下探 3 层
  var PRUNE_BUDGET = 40;                                  // 单次加载最多额外请求 40 次
  var pruneLeft = PRUNE_BUDGET;

  function dirDepth(node) {                               // 距根卡片的层数
    var n = 0;
    for (var c = node; c && c.parent; c = c.parent) n++;
    return n;
  }
  /** 自己带 markdown 文件、或有任一子目录被判定保留 → 内容非空 */
  function hasVisible(node) {
    return (node.children || []).some(function (c) { return c.type === 'file' || c.keep === true; });
  }
  /** 服务器目录里「可见」的子节点：空目录（递归不含 markdown）不显示，见 visibleChildren 的调用处 */
  function visibleChildren(node) {
    return (node.children || []).filter(function (c) { return !(c.type === 'dir' && c.keep === false); });
  }
  /** 判定 node 子树里有没有 markdown，据此给它的子目录打 keep 标记 */
  function scanServerDir(node, level) {
    var kids = (node.children || []).filter(function (c) { return c.type === 'dir' && !c.scanned; });
    if (!kids.length) {
      node.scanned = true;
      node.keep = hasVisible(node);
      return Promise.resolve(node.keep);
    }
    if (level > PRUNE_LEVELS || pruneLeft <= 0) {          // 到深度 / 次数上限：保守保留
      node.scanned = true;
      node.keep = true;
      return Promise.resolve(true);
    }
    return Promise.all(kids.map(function (c) {
      pruneLeft--;
      return loadServerDir(c).then(function () {
        // 读不出来（未开索引 / 被 index.html 影子）→ 保留，交给用户自己判断
        if (c.error === 'fail' || c.error === 'shadow') return true;
        return scanServerDir(c, level + 1);
      }).then(function (keep) {
        c.scanned = true;
        c.keep = keep;
        return keep;
      }, function () {
        c.scanned = true;
        c.keep = true;
        return true;
      });
    })).then(function () {
      node.scanned = true;
      node.keep = hasVisible(node);
      return node.keep;
    });
  }
  function loadServerDir(node) {
    node.loading = true;
    node.error = '';
    if (!node.parent) pruneLeft = PRUNE_BUDGET;                // 根卡片的一次加载：重置探测预算
    // 必须 return：展开全部会串联这个 Promise（漏掉 return 会让 .then 抛 TypeError，整条链中断）
    return fetch(node.url, { headers: { Accept: 'text/html,application/xhtml+xml,text/plain' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        // 服务器优先返回同目录的 index.html（入口若叫 index.html，返回的就是 MDSlice 自己）而不是目录列表。
        // 这是所有静态服务器的默认行为（python/serve/http-server/nginx 皆然），客户端无法绕过，
        // 所以单独报 'shadow'，由首页给出准确解释与可行做法（见 07-home.js）。
        if (text.indexOf('id="tabbar"') >= 0 || text.indexOf('js/08-boot.js') >= 0) {
          node.loaded = true;
          node.children = [];
          node.error = 'shadow';
          return;
        }
        var items = parseListing(text, node.url);
        if (!items.length) items = parsePlainListing(text);                 // 再试纯文本列表

        node.loaded = true;
        node.children = items.map(function (it) {
          if (it.type === 'file') {
            return { name: it.name, type: 'file', url: new URL(it.href, node.url).href, parent: node };
          }
          return { name: it.name, type: 'dir', url: new URL(it.href, node.url).href,
                   children: [], expanded: false, parent: node };
        });
        sortTree(node);
        if (!items.length) node.error = 'empty';
      })
      .catch(function () { node.error = 'fail'; node.loaded = false; })
      .then(function () {
        node.loading = false;
        refreshHomeNow();
        if (node.loaded && node.children.length) {           // 内容就位后异步识别空目录（不阻塞首屏）
          return scanServerDir(node, dirDepth(node) + 1).then(function () { refreshHomeNow(); });
        }
      });
  }
  function autoDirName() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1])) parts.pop();   // 去掉 index.html
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '当前目录';
  }

  /* ---- 拖入文件夹（webkitGetAsEntry 递归；readEntries 每批最多 100 条，需读到空） ---- */
  function droppedDirs(dt) {
    var out = [];
    if (!dt || !dt.items) return out;
    [].forEach.call(dt.items, function (it) {
      if (it.kind !== 'file' || !it.webkitGetAsEntry) return;
      var en = it.webkitGetAsEntry();
      if (en && en.isDirectory) out.push(en);
    });
    return out;
  }
  function collectEntries(entry, prefix, acc, depth) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        if (!isDocName(entry.name)) { resolve(); return; }
        entry.file(function (f) { acc.push({ rel: prefix + f.name, file: f }); resolve(); },
                   function () { resolve(); });
        return;
      }
      if (!entry.isDirectory || depth > MAX_DEPTH) { resolve(); return; }
      if (depth > 0 && isIgnoredDir(entry.name)) { resolve(); return; }    // 顶层目录不忽略（用户主动拖的）
      var reader = entry.createReader(), batch = [];
      (function read() {
        reader.readEntries(function (list) {
          if (list.length) { batch = batch.concat([].slice.call(list)); read(); return; }
          Promise.all(batch.map(function (ch) {
            return collectEntries(ch, prefix + entry.name + '/', acc, depth + 1);
          })).then(resolve, resolve);
        }, function () { resolve(); });
      })();
    });
  }
  function addDroppedDir(entry) {
    var acc = [];
    collectEntries(entry, entry.name + '/', acc, 0).then(function () {
      if (!acc.length) {
        homeNotice = '「' + esc(entry.name) + '」里没有找到 markdown 文件。';
        refreshHomeNow();
        return;
      }
      addLocalDir(entry.name, acc);
    });
  }
