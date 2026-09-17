/* render.js —— 渲染装配：章节切分、目录树、左栏导航、右栏本节目录、章节切换。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';


  /* =========================================================
     7. 章节切分 + 标题项下的元数据
     ========================================================= */
  /** 摘出紧随标题的元数据块（--- 包裹，且内部每行都是 key: value） */
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

  function splitSections(src) {
    var lines = src.split(/\r?\n/);
    var list = [], cur = null, preamble = [];
    var inFence = false;

    lines.forEach(function (line) {
      var t = line.trim();

      // 代码围栏内的 # 不是标题（bash 注释、围栏里演示的 Markdown 都属此列）
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

    // 首个标题前的内容并入第一章；整篇无标题则作为单章
    var hasText = preamble.some(function (l) { return l.trim(); });
    if (list.length && hasText) list[0].lines = preamble.concat(list[0].lines);
    if (!list.length && hasText) list.push({ level: 1, title: '全文', meta: {}, lines: preamble });

    list.forEach(function (sec) {
      sec.lines = takeMeta(sec);
      sec.id = uniqueId(sec.title);
    });
    return list;
  }

  /** 章节 id → 直接子章节 id 列表（供"章节页展示全部内容"展开用） */
  function collectChildren(nodes, map) {
    map = map || Object.create(null);
    nodes.forEach(function (node) {
      if (node.children.length) {
        map[node.sec.id] = node.children.map(function (c) { return c.sec.id; });
      }
      collectChildren(node.children, map);
    });
    return map;
  }

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

  /* =========================================================
     8. 渲染装配
     ========================================================= */

  /** operationType 内置配色 */
  var OP_TYPE = {
    add: 'success', update: 'warning', get: 'info',
    delete: 'danger', auth: 'muted', other: 'muted'
  };

  function metaTrue(v) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }

  /** 元数据值：operationType / deprecated 有内置语义，其余值写成 [x] 即为徽章 */
  function metaValue(key, value) {
    var v = String(value === undefined || value === null ? '' : value);

    if (key === 'operationType') {
      var op = v.replace(/^\[|\]$/g, '').trim().toLowerCase();
      return '<span class="badge badge--' + (OP_TYPE[op] || 'muted') + '">' + esc(op || v) + '</span>';
    }
    if (key === 'deprecated') {
      return metaTrue(v) ? '<span class="badge badge--deprecated">弃用</span>' : esc(v);
    }

    var m = v.match(/^\[(.+)\]$/);
    if (m) return '<span class="badge badge--info">' + esc(m[1].trim()) + '</span>';

    return esc(v);
  }

  /** 元数据卡片；只有文档首章排除 title（它已经是顶栏品牌名） */
  function renderMetaCard(sec, isFirst) {
    var meta = sec.meta;
    var keys = Object.keys(meta).filter(function (k) { return !(isFirst && k === 'title'); });
    if (!keys.length) return '';
    return '<dl class="meta-card">' + keys.map(function (k) {
      return '<div><dt>' + esc(k) + '</dt><dd>' + metaValue(k, meta[k]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /** 弃用接口在页顶自动提示，不依赖作者手写 Callout */
  function deprecationBanner(sec) {
    var alt = sec.meta.replacement || sec.meta.replacedBy || '';
    return '<div class="callout callout--danger">' +
           '<div class="callout__icon">✕</div>' +
           '<div class="callout__body">' +
           '<p class="callout__title">该接口已弃用</p>' +
           '<p>' + (alt
             ? '替代接口：<code>' + esc(alt) + '</code>，请勿在新逻辑中调用。'
             : '请勿在新逻辑中调用，替代方案见下方说明。') + '</p>' +
           '</div></div>';
  }

  function renderSection(sec, isFirst) {
    var lv = sec.level, id = sec.id;
    var deprecated = metaTrue(sec.meta.deprecated);
    return '<h' + lv + ' id="' + id + '">' + inline(sec.title) +
           (deprecated ? '<span class="badge badge--deprecated">弃用</span>' : '') +
           '<a class="anchor" href="#' + id + '">#</a></h' + lv + '>' +
           '<div class="h-body">' +
           (deprecated ? deprecationBanner(sec) : '') +
           renderMetaCard(sec, isFirst) +
           parseBlocks(sec.lines, true) +
           '</div>';
  }

  function createRow(sec, hasChildren) {
    var row = document.createElement('div');
    row.className = 'toc-row lv' + Math.min(sec.level, 3);
    row.dataset.id = sec.id;

    // 有子章节才有折叠按钮；叶子项只留同样宽度的占位，保证同层标签左对齐
    var caret = document.createElement('span');
    caret.className = 'caret' + (hasChildren ? '' : ' caret--empty');
    caret.textContent = hasChildren ? '▾' : '';
    row.appendChild(caret);

    var label = document.createElement('span');
    label.className = 'toc-label';
    label.textContent = sec.title;
    row.appendChild(label);

    // 弃用接口在目录里也带标记
    if (metaTrue(sec.meta.deprecated)) {
      var tag = document.createElement('span');
      tag.className = 'badge badge--deprecated';
      tag.textContent = '弃用';
      row.appendChild(tag);
    }

    row.addEventListener('click', function () { showSection(sec.id); });
    return row;
  }

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

  /** 右栏：只在 H3 页生成，列本页的 H4/H5/H6 锚点；没有则整栏隐藏 */
  function renderRightToc(secId) {
    var sec = sectionById[secId];
    var anchors = [];
    var pane = activeTab ? activeTab.dom.pane : null;
    var list = activeTab ? activeTab.dom.toc : null;

    if (sec && sec.level === 3 && pane) {
      // 在所属标签页的容器内查找，避免不同标签页出现同名 id 时互相干扰
      var root = null;
      Array.prototype.forEach.call(pane.children, function (el) {
        if (el.id === 'sec-' + secId) root = el;
      });
      if (root) {
        Array.prototype.forEach.call(root.querySelectorAll('h4[id],h5[id],h6[id]'), function (h) {
          anchors.push({
            id: h.id,
            el: h,
            level: +h.tagName.charAt(1) - 3,          // h4 → 1 / h5 → 2 / h6 → 3
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

    bindSpy(anchors, list);
  }

  /* ---- 右栏滚动高亮：视口内正在阅读的页内小节 ---- */
  var spy = null;

  function bindSpy(anchors, list) {
    if (spy) { spy.disconnect(); spy = null; }
    if (!anchors.length || !list || typeof IntersectionObserver === 'undefined') return;

    var links = Array.prototype.slice.call(list.querySelectorAll('a'));
    if (!links.length) return;

    spy = new IntersectionObserver(function (entries) {
      var vis = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; })[0];
      if (!vis) return;
      var href = '#' + vis.target.id;
      links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === href); });
    }, { rootMargin: '-90px 0px -72% 0px', threshold: 0 });

    anchors.forEach(function (a) { spy.observe(a.el); });
  }

  function setActiveRow(id) {
    var navRoot = activeTab ? activeTab.dom.nav : null;
    if (!navRoot) return;

    var activeRow = null;
    Array.prototype.forEach.call(navRoot.querySelectorAll('.toc-row'), function (el) {
      var on = el.dataset.id === id;
      el.classList.toggle('active', on);
      if (on) activeRow = el;
    });

    // 选中子级时逐级展开祖先
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

  function showSection(id) {
    // 章节页展示"本章全部内容"：H1/H2 页会连同所有后代章节一起激活。
    // 章节在 DOM 中按前序排列，因此激活的块在文档流里是连续的一段。
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
    resetScroll();
  }

  /** 瞬时滚动到指定位置（绕开 html{scroll-behavior:smooth}，切章节/切标签页都不做动画） */
  function scrollToY(y) {
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }

  function resetScroll() {
    scrollToY(0);
  }

  /* ---- 文档内锚点：命中章节就切章节，否则交给浏览器 ---- */
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

    // 兜底：唯一的「前缀命中」（文档锚点与标题不完全一致时）
    var hits = sections.filter(function (s) {
      return s.id.replace(/-/g, '').indexOf(compact) === 0;
    });
    return hits.length === 1 ? hits[0].id : null;
  }

  content.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#"]');
    if (!link) return;

    var frag = link.getAttribute('href').slice(1);
    var target = null;
    try { target = findInActivePane(decodeURIComponent(frag)); }
    catch (err) { target = findInActivePane(frag); }

    if (target) {
      var owner = target.closest ? target.closest('.section') : null;
      // 本页内的锚点（右栏 H4/H5、正文小节）交给浏览器滚动，
      // 避免被 findSectionId 的前缀兜底误判成"切到别的章节"
      if (owner && owner.classList.contains('active')) return;
      if (owner) {                                   // 锚点在别的章节：先切章再定位
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
  });

  /* ---- tabs / 复制按钮 ---- */
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

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  /* ---- 表格树形折叠 ---- */
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

  /* ---- 代码高亮（highlight.js，脚本在 MDSlice.html 引入） ---- */
  function highlightCode(scope) {
    if (!window.hljs) return;
    Array.prototype.forEach.call(scope.querySelectorAll('pre code'), function (block) {
      try { window.hljs.highlightElement(block); }
      catch (e) { /* 单个代码块高亮失败不影响阅读 */ }
    });
  }
