/* dirs.js —— 目录来源与文件树数据：本地文件夹（优先目录句柄，退回 webkitdirectory）、拖入的文件夹、
   静态服务器目录索引（懒加载 + 空目录剪枝）。只收子文件夹与 markdown，跳过常见构建/缓存目录。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 首页目录区的数据模型 ---- */
  var MAX_DEPTH = 8;                                    // 目录递归深度上限
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
  var FILE_PROTOCOL_NOTICE = '当前是 <code>file://</code> 直接打开，浏览器会拦截本地读取，无法自动列出同目录文件。' +
    '<br><br>点「添加目录」选择本地文件夹，或把文件夹 / <code>.md</code> 直接拖到页面中；' +
    '也可以在本地服务器下打开本页（那时才会自动列出同目录的 md）。注意：同目录里不能有 <code>index.html</code>，' +
    '否则服务器返回的是页面本身、不是目录列表：<br><br><code>python3 -m http.server 8000</code>';

  var dirInput = document.getElementById('dirInput');
  dirInput.addEventListener('change', function () {
    addLocalFromFileList(dirInput.files);
    dirInput.value = '';                 // 清空才能再次选择同一个目录
  });

  /** 是否为本应用可打开的文档（后缀见 DOC_EXT）。 */
  function isDocName(name) { return DOC_EXT.test(name); }
  /** 取小写扩展名（不含点）。 */
  function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase(); }
  /** 树里的图标：目录区分开合，文件按后缀着色（图标定义见 MDSlice.html 的精灵）。 */
  function fileTreeIcon(isDir, expanded, name) {
    var href = isDir ? (expanded ? '#i-folder-open' : '#i-folder') : '#i-file';
    var color = isDir ? '' : (FT_FILE_COLOR[extOf(name)] ? ' style="color:' + FT_FILE_COLOR[extOf(name)] + '"' : '');
    return '<span class="ftree__icon' + (isDir ? ' is-dir' : '') + '"' + color + '>' +
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><use href="' + href + '"/></svg></span>';
  }
  /** 过滤时给命中的片段套 <mark>（关键字为首页过滤框内容）。 */
  function markName(name) { return markHtml(name, homeFilter); }
  /** 是否为需要忽略的目录名（点开头，或常见构建/缓存目录）。 */
  function isIgnoredDir(name) { return name.charAt(0) === '.' || !!IGNORE_DIRS[name]; }
  /** 取节点 id，没有就分配一个并登记进 homeNodes（幂等）。 */
  function ensureNodeId(node) {
    if (!node.id) { node.id = 'hn' + (++homeSeq); homeNodes[node.id] = node; }
    return node.id;
  }

  /* ---- 节点的路径与身份 ----
     从目录打开的文件以「顶层目录名/相对路径」为身份，所以 B1/index.md 与 B2/index.md 是两份文件；
     直接上传的文件仍以文件名作身份（见 openTab 的默认 key）。 */
  /** 节点在所在目录内的相对路径（含自身名字）。 */
  function relOf(node) {
    var parts = [];
    for (var c = node; c && c.parent; c = c.parent) parts.unshift(c.name);
    return parts.join('/');
  }
  /** 节点所属的顶层目录节点（卡片根）。 */
  function rootOf(node) {
    var c = node;
    while (c && c.parent) c = c.parent;
    return c;
  }
  /** 节点对应的标签页身份键：顶层目录名 + 相对路径。 */
  function keyOfNode(node) {
    var root = rootOf(node);
    return (root ? root.name : '') + '/' + relOf(node);
  }
  /** 显示用的所在目录：顶层目录名 + 相对路径（去掉文件名）。
      必须带顶层目录名，否则两个文件夹里「相同子路径 + 同名文件」无法区分。 */
  function dirOfNode(node) {
    var root = rootOf(node);
    var seg = relOf(node).split('/');
    seg.pop();
    if (root && root.name) seg.unshift(root.name);
    return seg.join('/');
  }

  /* ---- 本地文件 → 目录树（用 webkitRelativePath 还原层级） ---- */
  /** 把一个文件源插入树中（rel 首段是所选文件夹名，会去掉；非 markdown 整条丢弃）。
      file 与 handle 二选一：有 handle 时每次打开都现读一次，因此能拿到磁盘上的最新内容。 */
  function insertFile(root, rel, file, handle) {
    var parts = String(rel).split('/').filter(Boolean);
    parts.shift();
    if (!parts.length) return;
    var leaf = parts.pop();
    if (!isDocName(leaf)) return;
    var node = root;
    for (var i = 0; i < parts.length; i++) {
      if (i >= MAX_DEPTH || isIgnoredDir(parts[i])) return;
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
    node.children.push({ name: leaf, type: 'file', file: file || null, handle: handle || null, parent: node });
  }
  /** 递归排序：目录在前、同类按名称（中文按拼音）排。 */
  function sortTree(node) {
    node.children.sort(function (a, b) {
      if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });
    node.children.forEach(function (c) { if (c.type === 'dir') sortTree(c); });
  }
  /** 把一批本地文件按顶层目录名加进首页（同名本地目录会替换旧的）。
      entries 形如 { rel, file } 或 { rel, handle }：句柄来源的项每次打开都现读。 */
  function addLocalDir(name, entries) {
    var dir = { name: name, source: 'local', children: [], expanded: true };
    entries.forEach(function (e) { insertFile(dir, e.rel, e.file, e.handle); });
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
    ensureNodeId(dir);
    homeDirs.push(dir);
    refreshHomeNow();
  }

  /* ---- 本地目录的两种取法 ----
     句柄（FileSystemDirectoryHandle）：里面的文档之后每次打开都现读，所以本地文件也能真正刷新；
     File 快照（webkitdirectory / entry.file()）：拿不到句柄时的退路，内容停在加入的那一刻。 */

  /** 遍历目录句柄：entries() 是异步迭代器，逐个读。
      容错与 entry 路线一致：单个条目读不动就跳过它，不让整次扫描失败。 */
  function collectDirHandle(dirHandle, prefix, acc, depth) {
    if (depth > MAX_DEPTH) return Promise.resolve();
    var it = dirHandle.entries();
    var step = function () {
      return it.next().then(function (r) {
        if (r.done) return;
        return handleEntry(r.value[0], r.value[1], prefix, acc, depth + 1).then(step, step);
      }, function () { /* 迭代中断：这一段就到此为止 */ });
    };
    return step();
  }
  /** 目录里的一个条目：文档收进 acc，子目录继续递归。
      depth 是条目自身所在的层数，所以根目录不参与忽略规则（与 entry 路线一致，见 collectEntries）。 */
  function handleEntry(name, h, prefix, acc, depth) {
    if (h.kind === 'file') {
      if (isDocName(name)) acc.push({ rel: prefix + name, handle: h });
      return Promise.resolve();
    }
    if (isIgnoredDir(name)) return Promise.resolve();     // 跳过构建 / 缓存目录
    return collectDirHandle(h, prefix + name + '/', acc, depth);
  }

  /** 把一个本地目录源（{ handle } 或 { entry }）收集完毕并加进首页（见 addLocalDir）。 */
  function addLocalDirFromSource(src) {
    var acc = [];
    var walk = src.handle
      ? collectDirHandle(src.handle, src.name + '/', acc, 0)
      : collectEntries(src.entry, src.name + '/', acc, 0);
    return walk.then(function () { addLocalDir(src.name, acc); })
      .catch(function () {
        homeNotice = '读取「' + esc(src.name) + '」失败：目录被移动或被拒绝访问。';
        refreshHomeNow();
      });
  }

  /** 「添加目录」：优先用目录选择器取句柄（本地文件因此也可刷新），
      没有该 API 的浏览器（Firefox / Safari）退回 webkitdirectory 的 File 快照。 */
  function pickLocalDir() {
    if (typeof window.showDirectoryPicker !== 'function') { dirInput.click(); return; }
    window.showDirectoryPicker().then(function (h) {
      addLocalDirFromSource({ handle: h, name: h.name });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;             // 用户取消：什么都不做
      showToast('无法读取这个目录：浏览器拒绝了这次访问。', 6000);
    });
  }
  /** 处理「添加目录」的选择结果（老浏览器没有 webkitdirectory 时退化为选单个文件）。 */
  function addLocalFromFileList(fileList) {
    var list = [].slice.call(fileList || []);
    if (!list.length) return;
    if (!list[0].webkitRelativePath) {
      homeNotice = '当前浏览器不支持选择文件夹，请改用「打开 MD」选文件，或把文件夹直接拖进页面。';
      refreshHomeNow();
      return;
    }
    var entries = list.map(function (f) { return { rel: f.webkitRelativePath || f.name, file: f }; });
    var rootName = (list[0].webkitRelativePath || '').split('/')[0] || '未命名目录';
    addLocalDir(rootName, entries);
  }

  /* ---- 静态服务器目录索引 → 目录树（子目录懒加载） ---- */
  /** 还原列表 href 的两种写法：HTML 实体转义（serve 把 / 写成 &#47;）与 Windows 反斜杠。 */
  function decodeHref(href) {
    return String(href)
      .replace(/&amp;/g, '&')                                       // 先还原 &amp;，避免 &amp;#47; 被漏掉
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&quot;/g, '"').replace(/&apos;|&#0?39;/g, "'")
      .replace(/\\/g, '/');
  }
  /** 条目是否收进树：忽略目录名与 . / .. 之类，文件只留 markdown，同名去重。 */
  function acceptEntry(name, isDir, seen) {
    if (!name || name === '.' || name === '..' || seen[name]) return false;
    return isDir ? !isIgnoredDir(name) : isDocName(name);
  }
  /** 解析 HTTP 目录索引 HTML，只取当前目录同层的子目录与 markdown 条目。 */
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
      if (path.indexOf('./') === 0) path = path.slice(2);                     // ./a.md
      var isDir = /\/$/.test(path);
      var raw = path.replace(/\/+$/, '');
      if (!raw || raw.indexOf('/') >= 0) continue;                            // 只看同层
      var name;
      try { name = decodeURIComponent(raw); } catch (e) { continue; }
      if (!acceptEntry(name, isDir, seen)) continue;
      seen[name] = 1;
      out.push({ name: name, type: isDir ? 'dir' : 'file', href: href });
    }
    return out;
  }
  /** 兜底解析纯文本目录列表（每行一个名字）；至少认出一个 markdown 才采信，避免误判。 */
  function parsePlainListing(text) {
    var out = [], seen = Object.create(null), hit = 0;
    String(text).split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === '.') return;
      var isDir = /\/$/.test(line);
      var raw = line.replace(/\/+$/, '');
      if (!raw || raw.indexOf('/') >= 0) return;
      if (!acceptEntry(raw, isDir, seen)) return;
      if (!isDir) hit++;
      seen[raw] = 1;
      out.push({ name: raw, type: isDir ? 'dir' : 'file', href: line });
    });
    return hit ? out : [];
  }

  /* ---- 空目录剪枝 ----
     服务器列表会列出所有子目录，不含 markdown 的（如只放 css/js 的）不该显示。子目录里有没有 md
     要再请求一次才知道，所以加载完一层就顺手探测它的子目录：每目录一次请求并写回节点（之后展开
     是瞬时的），深度与请求数有上限，超限或读取失败一律保留。本地目录不需要：insertFile() 只沿
     markdown 路径建节点。 */
  var PRUNE_LEVELS = 3;                                   // 最多往下探 3 层
  var PRUNE_BUDGET = 40;                                  // 单次加载最多额外请求 40 次
  var pruneLeft = PRUNE_BUDGET;

  /** 节点距根卡片的层数。 */
  function dirDepth(node) {
    var n = 0;
    for (var c = node; c && c.parent; c = c.parent) n++;
    return n;
  }
  /** 节点自己带 markdown 文件、或有任一子目录被判定保留 → 内容非空。 */
  function hasVisible(node) {
    return (node.children || []).some(function (c) { return c.type === 'file' || c.keep === true; });
  }
  /** 需要渲染的子节点：判定为空目录（递归不含 markdown）的不返回。 */
  function visibleChildren(node) {
    return (node.children || []).filter(function (c) { return !(c.type === 'dir' && c.keep === false); });
  }
  /** 判定 node 子树里有没有 markdown，据此给它的子目录打 keep 标记（无内容则 keep=false）。 */
  function markKeepState(node, level) {
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
        if (c.error === 'fail' || c.error === 'shadow') return true;   // 读不出来 → 保留
        return markKeepState(c, level + 1);
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
  /** 取一个服务器目录的列表并写入节点，随后异步识别其中的空目录。
      返回 Promise（展开全部会串联它）：内容就位后即可渲染，剪枝结果稍后补上。 */
  function loadServerDir(node) {
    node.loading = true;
    node.error = '';
    if (!node.parent) pruneLeft = PRUNE_BUDGET;                // 根卡片的这次加载：重置探测预算
    return fetch(node.url, { headers: { Accept: 'text/html,application/xhtml+xml,text/plain' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        // 服务器优先返回同目录的 index.html（入口若叫 index.html 就是本应用自己）而不是目录列表，
        // 客户端无法绕过：单独报 'shadow'，由首页给出解释与可行做法（见 07-home.js）
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
        if (node.loaded && node.children.length) {           // 空目录识别异步进行，不阻塞首屏
          return markKeepState(node, dirDepth(node) + 1).then(function () { refreshHomeNow(); });
        }
      });
  }
  /** 由页面地址推断服务器目录的展示名（末段是文件名时用上一级，都没有则「当前目录」）。 */
  function autoDirName() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1])) parts.pop();
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '当前目录';
  }

  /* ---- 拖入的文件夹与文件 ----
     优先 DataTransferItem.getAsFileSystemHandle()（Chromium）：拿到目录句柄后，里面的文档每次打开
     都现读，于是「拖入」与「添加目录」表现一致；不支持时退回 webkitGetAsEntry 的 File 快照。
     两个 API 都必须在 drop 事件里同步调用 —— 事件结束后条目就失效了。 */
  /** 从拖放数据里收下「源」：{ handle: Promise } 或 { entry }，由 handleDrop 判断是目录还是文档。 */
  function droppedSources(dt) {
    var out = [];
    if (!dt || !dt.items) return out;
    [].forEach.call(dt.items, function (it) {
      if (it.kind !== 'file') return;
      if (typeof it.getAsFileSystemHandle === 'function') {
        try { out.push({ handle: it.getAsFileSystemHandle() }); return; } catch (e) { /* 退回 entry */ }
      }
      var en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (en) out.push({ entry: en });
    });
    return out;
  }
  /** 递归收集 entry 下的 markdown 文件（顶层目录不按忽略名单过滤，因为用户是主动拖的）。 */
  function collectEntries(entry, prefix, acc, depth) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        if (!isDocName(entry.name)) { resolve(); return; }
        entry.file(function (f) { acc.push({ rel: prefix + f.name, file: f }); resolve(); },
                   function () { resolve(); });
        return;
      }
      if (!entry.isDirectory || depth > MAX_DEPTH) { resolve(); return; }
      if (depth > 0 && isIgnoredDir(entry.name)) { resolve(); return; }
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
  /** 拖放分流：目录加进首页，文档直接打开；句柄与 entry 两条路在这里统一收口。 */
  function handleDrop(dt) {
    if (!dt) return;
    var sources = droppedSources(dt);
    var files = [].slice.call(dt.files || []);             // FileList 同样只在事件内有效，先拷出来

    Promise.all(sources.map(function (s) {
      if (s.entry) {                                       // 老浏览器的 entry 路径
        var en = s.entry;
        if (en.isDirectory) return Promise.resolve({ kind: 'dir', entry: en, name: en.name });
        if (!isDocName(en.name)) return Promise.resolve(null);
        return new Promise(function (res) {
          en.file(function (f) { res({ kind: 'doc', file: f, name: f.name }); },
                  function () { res(null); });
        });
      }
      return s.handle.then(function (h) {                  // 句柄路径：目录句柄可让文档真正刷新
        if (!h) return null;
        if (h.kind === 'directory') return { kind: 'dir', handle: h, name: h.name };
        return isDocName(h.name) ? { kind: 'doc', handle: h, name: h.name } : null;
      }, function () { return null; });
    })).then(function (list) {
      list = list.filter(Boolean);
      var dirs = list.filter(function (s) { return s.kind === 'dir'; });
      if (dirs.length) { dirs.forEach(addLocalDirFromSource); return; }
      var doc = list.filter(function (s) { return s.kind === 'doc'; })[0];
      if (doc) { openLocalSource(doc, null); return; }
      if (files[0]) openPickedFile(files[0]);              // 兜底：句柄与 entry 都拿不到
    });
  }
