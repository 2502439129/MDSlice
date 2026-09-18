/* render.js —— 渲染装配：章节切分、元数据卡、目录树、左栏导航、右栏本节目录、章节切换、交互绑定，
   以及挂载后处理（代码高亮、公式排版）。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 章节切分 ---- */
  /** 摘出紧随标题的元数据块（--- 包裹，且每行都是 key: value）；不是元数据就原样返回。 */
  function takeMeta(sec) {
    var L = sec.lines, i = 0;
    while (i < L.length && !L[i].trim()) i++;
    if (i >= L.length || !/^-{3,}\s*$/.test(L[i].trim())) return L;

    var j = i + 1, body = [];
    while (j < L.length && !/^-{3,}\s*$/.test(L[j].trim())) { body.push(L[j]); j++; }
    if (j >= L.length) return L;                       // 没有闭合标记 → 当作普通内容

    var meta = {}, count = 0;
    for (var k = 0; k < body.length; k++) {
      var line = body[k].trim();
      if (!line) continue;
      var kv = line.match(/^([A-Za-z\u4e00-\u9fa5_][\w\u4e00-\u9fa5-]*)\s*:\s*(.*)$/);
      if (!kv) return L;                               // 有一行不是 key: value → 不是元数据
      meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
      count++;
    }
    if (!count) return L;

    sec.meta = meta;
    return L.slice(0, i).concat(L.slice(j + 1));
  }

  /** 按标题把源码切成章节：H1/H2/H3 各成一块，代码围栏内的 # 不算标题；
      首个标题前的内容并入第一章，整篇无标题时作为单章「全文」。 */
  function splitSections(src) {
    var lines = src.split(/\r?\n/);
    var list = [], cur = null, preamble = [];
    var inFence = false;

    lines.forEach(function (line) {
      var t = line.trim();

      if (inFence) {
        if (/^```+\s*$/.test(t)) inFence = false;
      } else if (RE.fence.test(t)) {
        inFence = true;
      } else {
        var m = t.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
          cur = { level: m[1].length, title: m[2].replace(/\s+#+\s*$/, '').trim(), meta: {}, lines: [] };
          list.push(cur);
          return;
        }
      }

      (cur ? cur.lines : preamble).push(line);
    });

    var hasText = preamble.some(function (l) { return l.trim(); });
    if (list.length && hasText) list[0].lines = preamble.concat(list[0].lines);
    if (!list.length && hasText) list.push({ level: 1, title: '全文', meta: {}, lines: preamble });

    list.forEach(function (sec) {
      sec.lines = takeMeta(sec);
      sec.id = uniqueId(sec.title);
    });
    return list;
  }

  /** 章节 id → 直接子章节 id 列表（H1/H2 页要连同后代一起显示）。 */
  function collectChildIds(nodes, map) {
    map = map || Object.create(null);
    nodes.forEach(function (node) {
      if (node.children.length) {
        map[node.sec.id] = node.children.map(function (c) { return c.sec.id; });
      }
      collectChildIds(node.children, map);
    });
    return map;
  }

  /** 按标题级别把章节列表组织成树（级别不递增时向上回溯）。 */
  function buildTree(list) {
    var roots = [], stack = [];
    list.forEach(function (sec) {
      var node = { sec: sec, children: [] };
      while (stack.length && stack[stack.length - 1].sec.level >= sec.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    });
    return roots;
  }

  /* ---- 元数据 ---- */
  /** operationType 的内置配色。 */
  var OP_TYPE = {
    add: 'success', update: 'warning', get: 'info',
    delete: 'danger', auth: 'muted', other: 'muted'
  };

  /** 元数据值是否表示真（true / yes / 1）。 */
  function isTruthyMeta(v) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }

  /** 渲染一个元数据值：operationType 上配色徽章、deprecated 上弃用徽章，其余写成 [x] 即为徽章。 */
  function metaValue(key, value) {
    var v = String(value === undefined || value === null ? '' : value);

    if (key === 'operationType') {
      var op = v.replace(/^\[|\]$/g, '').trim().toLowerCase();
      return '<span class="badge badge--' + (OP_TYPE[op] || 'muted') + '">' + esc(op || v) + '</span>';
    }
    if (key === 'deprecated') {
      return isTruthyMeta(v) ? '<span class="badge badge--deprecated">弃用</span>' : esc(v);
    }

    var m = v.match(/^\[(.+)\]$/);
    if (m) return '<span class="badge badge--info">' + esc(m[1].trim()) + '</span>';

    return esc(v);
  }

  /** 元数据卡片；首章排除 title，避免与页面标题重复。 */
  function renderMetaCard(sec, isFirst) {
    var meta = sec.meta;
    var keys = Object.keys(meta).filter(function (k) { return !(isFirst && k === 'title'); });
    if (!keys.length) return '';
    return '<dl class="meta-card">' + keys.map(function (k) {
      return '<div><dt>' + esc(k) + '</dt><dd>' + metaValue(k, meta[k]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /** 弃用提示横幅（页顶）；替代接口取自元数据 replacement / replacedBy。 */
  function deprecationBanner(sec) {
    var alt = sec.meta.replacement || sec.meta.replacedBy || '';
    return calloutHtml('danger', '该接口已弃用', '<p>' + (alt
      ? '替代接口：<code>' + esc(alt) + '</code>，请勿在新逻辑中调用。'
      : '请勿在新逻辑中调用，替代方案见下方说明。') + '</p>');
  }

  /** 渲染一个章节块：标题（含锚点与弃用徽章）+ 内容（弃用横幅、元数据卡、正文）。 */
  function renderSection(sec, isFirst) {
    var lv = sec.level, id = sec.id;
    var deprecated = isTruthyMeta(sec.meta.deprecated);
    return '<h' + lv + ' id="' + id + '">' + inline(sec.title) +
           (deprecated ? '<span class="badge badge--deprecated">弃用</span>' : '') +
           '<a class="anchor" href="#' + id + '">#</a></h' + lv + '>' +
           '<div class="h-body">' +
           (deprecated ? deprecationBanner(sec) : '') +
           renderMetaCard(sec, isFirst) +
           parseBlocks(sec.lines, true) +
           '</div>';
  }

  /* ---- 左栏目录树 ---- */
  /** 建一个目录行：折叠箭头（叶子项只留占位以对齐）+ 标题 + 弃用标记。 */
  function createRow(sec, hasChildren) {
    var row = document.createElement('div');
    row.className = 'toc-row lv' + Math.min(sec.level, 3);
    row.dataset.id = sec.id;

    var caret = document.createElement('span');
    caret.className = 'caret' + (hasChildren ? '' : ' caret--empty');
    caret.textContent = hasChildren ? '▾' : '';
    row.appendChild(caret);

    var label = document.createElement('span');
    label.className = 'toc-label';
    label.textContent = sec.title;
    row.appendChild(label);

    if (isTruthyMeta(sec.meta.deprecated)) {
      var tag = document.createElement('span');
      tag.className = 'badge badge--deprecated';
      tag.textContent = '弃用';
      row.appendChild(tag);
    }

    row.addEventListener('click', function () { showSection(sec.id); });
    return row;
  }

  /** 递归渲染目录树节点（有子级的包一层 .toc-sub，箭头控制其折叠）。 */
  function renderNavNodes(nodes, container) {
    nodes.forEach(function (node) {
      var li = document.createElement('li');
      var hasChildren = node.children.length > 0;
      var row = createRow(node.sec, hasChildren);
      li.appendChild(row);

      if (hasChildren) {
        var sub = document.createElement('ul');
        sub.className = 'toc-sub';
        renderNavNodes(node.children, sub);

        var caret = row.querySelector('.caret');
        caret.addEventListener('click', function (e) {
          e.stopPropagation();
          var collapsed = sub.classList.toggle('collapsed');
          caret.classList.toggle('collapsed', collapsed);
        });

        li.appendChild(sub);
      }
      container.appendChild(li);
    });
  }

  /* ---- 右栏「本章目录」 ---- */
  /** 渲染右栏：仅 H3 页生成，列出该页的 H4/H5/H6 锚点；没有小节时整栏隐藏。 */
  function renderRightToc(secId) {
    var sec = sectionById[secId];
    var anchors = [];
    var pane = activeTab ? activeTab.dom.pane : null;
    var list = activeTab ? activeTab.dom.toc : null;

    if (sec && sec.level === 3 && pane) {
      var root = null;                                     // 只查当前标签页，避免同名 id 互相干扰
      Array.prototype.forEach.call(pane.children, function (el) {
        if (el.id === 'sec-' + secId) root = el;
      });
      if (root) {
        Array.prototype.forEach.call(root.querySelectorAll('h4[id],h5[id],h6[id]'), function (h) {
          anchors.push({
            id: h.id,
            el: h,
            level: +h.tagName.charAt(1) - 3,               // h4 → 1 / h5 → 2 / h6 → 3
            text: h.textContent.replace(/#$/, '').trim()
          });
        });
      }
    }

    if (list) {
      list.innerHTML = anchors.map(function (a) {
        return '<a href="#' + a.id + '" class="lv' + Math.min(a.level, 3) + '">' + esc(a.text) + '</a>';
      }).join('');
    }

    var show = anchors.length > 0;
    tocAside.hidden = !show;
    shell.classList.toggle('no-toc', !show);

    bindTocScrollSpy(anchors, list);
  }

  var tocSpy = null;                                       // 右栏滚动高亮的 IntersectionObserver

  /** 用 IntersectionObserver 给右栏做滚动高亮（视口内最靠上的小节高亮）。 */
  function bindTocScrollSpy(anchors, list) {
    if (tocSpy) { tocSpy.disconnect(); tocSpy = null; }
    if (!anchors.length || !list || typeof IntersectionObserver === 'undefined') return;

    var links = Array.prototype.slice.call(list.querySelectorAll('a'));
    if (!links.length) return;

    tocSpy = new IntersectionObserver(function (entries) {
      var vis = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; })[0];
      if (!vis) return;
      var href = '#' + vis.target.id;
      links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === href); });
    }, { rootMargin: '-90px 0px -72% 0px', threshold: 0 });

    anchors.forEach(function (a) { tocSpy.observe(a.el); });
  }

  /** 高亮左栏当前章节，并逐级展开它的祖先。 */
  function setActiveRow(id) {
    var navRoot = activeTab ? activeTab.dom.nav : null;
    if (!navRoot) return;

    var activeRow = null;
    Array.prototype.forEach.call(navRoot.querySelectorAll('.toc-row'), function (el) {
      var on = el.dataset.id === id;
      el.classList.toggle('active', on);
      if (on) activeRow = el;
    });

    if (activeRow) {
      var node = activeRow.parentElement;
      while (node && node !== navRoot) {
        if (node.classList && node.classList.contains('toc-sub')) {
          node.classList.remove('collapsed');
          var caret = node.parentElement.querySelector('.caret');
          if (caret) caret.classList.remove('collapsed');
        }
        node = node.parentElement;
      }
    }
  }

  /** 切到某个章节：H1/H2 页连同全部后代一起激活（章节在前序排列，激活块在文档流里连续）。 */
  function showSection(id) {
    if (!activeTab) return;
    var show = Object.create(null);

    (function mark(secId) {
      if (show[secId]) return;
      show[secId] = true;
      (childrenById[secId] || []).forEach(mark);
    })(id);

    Array.prototype.forEach.call(activeTab.dom.pane.children, function (el) {
      el.classList.toggle('active', !!show[el.id.slice(4)]);   // 'sec-' 前缀长度
    });
    activeTab.activeId = id;

    setActiveRow(id);
    renderRightToc(id);
    scrollToY(0);
  }

  /** 瞬时滚动到指定位置（绕开 html{scroll-behavior:smooth}，切章节/切标签页都不做动画）。 */
  function scrollToY(y) {
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }

  /* ---- 正文链接：页内锚点 / 文档间链接 ---- */
  /** 片段 → 章节 id：依次尝试原样、slug 化、去短横线、唯一前缀匹配；都不中返回 null。 */
  function findSectionId(fragment) {
    var raw = fragment;
    try { raw = decodeURIComponent(fragment); } catch (e) { /* 非合法编码时按原样 */ }
    raw = raw.trim();
    if (!raw) return null;

    var i;
    for (i = 0; i < sections.length; i++) if (sections[i].id === raw) return sections[i].id;

    var dashed = slug(raw);
    var compact = dashed.replace(/-/g, '');
    for (i = 0; i < sections.length; i++) if (sections[i].id === dashed) return sections[i].id;
    for (i = 0; i < sections.length; i++) if (sections[i].id.replace(/-/g, '') === compact) return sections[i].id;

    var hits = sections.filter(function (s) {                 // 兜底：唯一的前缀命中
      return s.id.replace(/-/g, '').indexOf(compact) === 0;
    });
    return hits.length === 1 ? hits[0].id : null;
  }

  /** 切到片段对应的章节（供「打开文档后定位」与锚点链接共用）。 */
  function jumpToFragment(fragment) {
    if (!fragment) return;
    var id = findSectionId(fragment);
    if (id) showSection(id);
  }

  /** 可在应用内打开的文档后缀（与「打开 MD」的 accept 一致）。 */
  var DOC_EXT = /\.(md|markdown|txt)$/i;

  /** 以 base 目录为起点解析相对路径（支持 . 与 ..），越出起点返回 null。 */
  function resolvePath(base, rel) {
    var seg = String(base || '').split('/').filter(Boolean);
    var parts = String(rel || '').split('/');
    for (var i = 0; i < parts.length; i++) {
      var p;
      try { p = decodeURIComponent(parts[i]); } catch (e) { p = parts[i]; }
      if (!p || p === '.') continue;
      if (p === '..') { if (!seg.length) return null; seg.pop(); continue; }
      seg.push(p);
    }
    return seg.join('/');
  }

  /** 在目录树里按身份键找「带 File 引用」的文件节点。 */
  function nodeByKey(node, key) {
    if (node.type === 'file' && node.file && keyOfNode(node) === key) return node;
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var hit = nodeByKey(kids[i], key);
      if (hit) return hit;
    }
    return null;
  }

  /** 在已添加的目录（本地 / 拖入 / 服务器）里按身份键找节点。 */
  function nodeByKeyAnywhere(key) {
    for (var i = 0; i < homeDirs.length; i++) {
      var hit = nodeByKey(homeDirs[i], key);
      if (hit) return hit;
    }
    return null;
  }

  /** 目录树节点 → 打开文档需要的信息。 */
  function docOf(node) {
    return { name: node.name, key: keyOfNode(node), dir: dirOfNode(node),
             url: node.url || '', file: node.file || null };
  }

  /** 在子树里按 url 找节点（服务器文件节点的 url 就是它的绝对地址）。 */
  function nodeByUrl(node, href) {
    if (node.url === href) return node;
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var hit = nodeByUrl(kids[i], href);
      if (hit) return hit;
    }
    return null;
  }

  /** 同源的服务器地址 → 打开信息：优先复用首页树里已加载的节点（身份键与之完全一致），
      该子目录还没加载时按服务器根的 URL 前缀现算，得到的仍是同一个身份键。 */
  function docFromUrl(url) {
    var href = url.href.split('#')[0];
    var path;
    try { path = decodeURIComponent(url.pathname); } catch (e) { path = url.pathname; }
    var name = path.split('/').pop() || '未命名';

    for (var i = 0; i < homeDirs.length; i++) {
      if (homeDirs[i].source !== 'server') continue;
      var root = homeDirs[i];
      var found = nodeByUrl(root, href);
      if (found) return docOf(found);

      var base = root.url.split('#')[0];
      if (href.indexOf(base) === 0) {
        var seg = href.slice(base.length).split('?')[0].split('/').filter(Boolean);
        seg.pop();
        return { name: name, url: href, file: null,
                 key: root.name + '/' + seg.concat(name).join('/'),
                 dir: seg.length ? root.name + '/' + seg.join('/') : root.name };
      }
    }

    return { name: name, url: href, file: null,             // 不在已知的服务器根下：整条路径当身份
             key: path, dir: path.replace(/\/[^/]*$/, '') };
  }

  /** 链接 → { doc } 可在应用内打开 / { blocked, message } 是文档但无法定位 / null 交回浏览器。 */
  function docLinkTarget(href) {
    var path = href.split('#')[0].split('?')[0];
    var plain = path;
    try { plain = decodeURIComponent(path); } catch (e) { /* 保持原样 */ }
    if (!DOC_EXT.test(plain)) return null;
    var cut = href.indexOf('#');
    var fragment = cut >= 0 ? href.slice(cut + 1) : '';

    if (activeTab.sourceUrl) {                              // 从服务器打开的文档：同源才接管
      var url;
      try { url = new URL(href, activeTab.sourceUrl); } catch (e) { return null; }
      if (url.origin !== location.origin) return null;
      return { doc: docFromUrl(url), fragment: fragment };
    }

    var key = resolvePath(activeTab.dir, plain);             // 本地文档：按身份键找同名文件
    var node = key ? nodeByKeyAnywhere(key) : null;
    if (node) return { doc: docOf(node), fragment: fragment };
    return { blocked: true, message: '这个链接指向 <code>' + esc(plain) + '</code>，' +
      '但当前文档不是从服务器打开的，无法按相对路径定位。用「添加目录」把所在文件夹加进来，' +
      '或用本地服务器打开即可。' };
  }

  /** 正文链接的点击：`#锚点` 走章节内跳转；同源的 md / markdown / txt 在应用内打开；
      其余（外链、跨源、图片、带修饰键或 download 的点击）保持浏览器默认行为。 */
  content.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';

    if (href.charAt(0) === '#') {                           // ① 页内锚点
      var frag = href.slice(1);
      var target = null;
      try { target = findInActivePane(decodeURIComponent(frag)); }
      catch (err) { target = findInActivePane(frag); }

      if (target) {
        var owner = target.closest ? target.closest('.section') : null;
        if (owner && owner.classList.contains('active')) return;   // 本页内锚点：浏览器自己滚
        if (owner) {                                              // 别的章节：先切章
          e.preventDefault();
          showSection(owner.id.replace(/^sec-/, ''));
          target.scrollIntoView({ block: 'start' });
          return;
        }
      }

      var id = findSectionId(frag);
      if (!id) return;
      e.preventDefault();
      showSection(id);
      return;
    }

    /* ② 文档间链接：只接管文档标签页内的普通左键点击 */
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (link.hasAttribute('download')) return;
    if (!activeTab || activeTab.kind === 'home' || !activeTab.dom.pane.contains(link)) return;

    var info = docLinkTarget(href);
    if (!info) return;
    e.preventDefault();

    if (info.blocked) { showPaneNotice(info.message); return; }
    openDocNode(info.doc, info.fragment).catch(function () {
      showPaneNotice('读取 <code>' + esc(info.doc.name) + '</code> 失败：' +
        '文件被移动、被改动，或服务器拒绝访问。');
    });
  });

  /* ---- 文档内 tabs 与复制按钮 ---- */
  /** 绑定章节内的 `:::tabs` 切换与代码块复制按钮。 */
  function bindTabs(scope) {
    scope.querySelectorAll('.tabs').forEach(function (g) {
      var btns = [].slice.call(g.querySelectorAll('.tabs__btn'));
      var panels = [].slice.call(g.querySelectorAll('.tabs__panel'));
      btns.forEach(function (b, idx) {
        b.addEventListener('click', function () {
          btns.forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
          b.setAttribute('aria-selected', 'true');
          panels.forEach(function (p, i) { p.hidden = i !== idx; });
        });
      });
    });

    scope.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.closest('.codeblock').querySelector('code').innerText;
        var done = function () {
          btn.textContent = '已复制'; btn.classList.add('done');
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done'); }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code); done(); });
        } else {
          fallbackCopy(code); done();
        }
      });
    });
  }

  /** 剪贴板 API 不可用时的兜底复制（临时 textarea + execCommand）。 */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  /* ---- 表格树形折叠 ---- */
  /** 绑定折叠表格的父行按钮与「全部折叠 / 全部展开」。 */
  function bindTree(scope) {
    scope.querySelectorAll('.table-block').forEach(function (blk) {
      var table = blk.querySelector('table');
      if (!table) return;

      var apply = function (gid, hide) {
        table.querySelectorAll('tr[data-anc~="' + gid + '"]').forEach(function (r) {
          r.classList.toggle('is-hidden', hide);
        });
        var btn = blk.querySelector('.tree-toggle[data-target="' + gid + '"]');
        if (btn) btn.setAttribute('aria-expanded', String(!hide));
      };

      blk.querySelectorAll('.tree-toggle[data-target]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          apply(btn.dataset.target, btn.getAttribute('aria-expanded') === 'true');
        });
      });

      var setAll = function (hide) {
        blk.querySelectorAll('.tree-toggle[data-target]').forEach(function (b) { apply(b.dataset.target, hide); });
      };
      var bc = blk.querySelector('[data-action="collapse"]');
      var be = blk.querySelector('[data-action="expand"]');
      if (bc) bc.addEventListener('click', function () { setAll(true); });
      if (be) be.addEventListener('click', function () { setAll(false); });
    });
  }

  /** 对作用域内的代码块调用 highlight.js（单个失败不影响其余）。 */
  function highlightCode(scope) {
    if (!window.hljs) return;
    Array.prototype.forEach.call(scope.querySelectorAll('pre code'), function (block) {
      try { window.hljs.highlightElement(block); }
      catch (e) { /* 忽略 */ }
    });
  }

  /** 对作用域内的公式占位元素（[data-tex]）调用 MathJax 排版：
      先按 data-tex 生成公式节点，再跑一次 MathJax 的文档排版流程 —— 每个字形的 CSS 与样式表
      都由那一步按用到的字符注册进文档，少了它字形会没有内容（公式看着是空的）。
      库尚未就绪时等它加载完再排；单个公式出错就保留 $…$ 原文。 */
  function renderMath(scope) {
    var MJ = window.MathJax;                    // MDSlice.html 里的内联配置先建立该对象
    if (!MJ || !MJ.startup || !MJ.startup.promise || !MJ.tex2chtml) return;
    MJ.startup.promise.then(function () {
      Array.prototype.forEach.call(scope.querySelectorAll('[data-tex]'), function (el) {
        var node;
        try {
          node = MJ.tex2chtml(el.getAttribute('data-tex'), {
            display: el.classList.contains('math-block')
          });
        } catch (e) { return; }
        el.innerHTML = '';
        el.appendChild(node);
      });
      return MJ.typesetPromise ? MJ.typesetPromise([scope]) : null;
    }).catch(function () { /* 忽略：排版失败时页面显示的就是 $…$ 原文 */ });
  }
