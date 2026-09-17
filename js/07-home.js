/* home.js —— 首页界面：目录列表、文件树渲染与交互（过滤、键盘、展开折叠、打开文件）。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 渲染与交互 ---- */
  function refreshHomeNow() {
    var t = homeTab();
    if (!t) return;
    var y = (t === activeTab) ? (window.pageYOffset || document.documentElement.scrollTop || 0) : 0;
    // 重建会丢掉过滤框焦点：记下来，重建后还原（否则目录加载完成时打字会被打断）
    var ae = document.activeElement;
    var focusFilter = t === activeTab && ae && ae.id === 'homeFilter';
    var caret = focusFilter ? ae.selectionStart : 0;
    renderTab(t);                                         // 走 renderTab 的 home 分支
    if (t === activeTab) {
      scrollToY(y);
      if (focusFilter) {
        var inp = t.dom.pane.querySelector('#homeFilter');
        if (inp) {
          inp.focus();
          try { inp.setSelectionRange(caret, caret); } catch (err) { /* 忽略 */ }
        }
      }
    }
  }
  function markHomeDirty() {
    var t = homeTab();
    if (!t) return;
    t.rendered = false;
    // 首页正显示着（例如在首页里点了「关闭」）：立刻重建，否则「已打开」标记会停在旧状态
    if (t === activeTab) refreshHomeNow();
  }
  function openTabByKey(key) {
    var hit = null;
    tabs.forEach(function (t) { if (!hit && t.kind !== 'home' && t.key === key) hit = t; });
    return hit;
  }
  function renderHome(tab) {
    tab.sections = [];
    tab.sectionById = Object.create(null);
    tab.childrenById = Object.create(null);
    tab.empty = true;                    // 复用「无章节」分支：隐藏右栏、不进 showSection
    tab.firstId = null;
    tab.activeId = null;
    tab.dom.nav.innerHTML = '';
    tab.dom.toc.innerHTML = '';
    tab.dom.pane.innerHTML = homeHtml();
    tab.rendered = true;
    bindHome(tab);
  }
  function homeHtml() {
    var docs = tabs.filter(function (t) { return t.kind !== 'home'; });
    var h = '<div class="home">' +
      '<div class="home__head"><h2>首页</h2>' +
      '<span class="home__hint">已打开 ' + docs.length + ' 个文件 · ' + homeDirs.length + ' 个目录</span>' +
      '<button class="tbtn" data-act="add-dir">添加目录</button></div>';

    if (homeNotice) h += '<div class="home__notice">' + homeNotice + '</div>';

    h += '<h3 class="home__sec">已打开的文件</h3>';
    if (!docs.length) {
      h += '<p class="home__none">还没有打开任何文档，下面点一个文件即可打开新标签页。</p>';
    } else {
      h += '<ul class="home__list">';
      docs.forEach(function (t) {
        h += '<li class="home__row' + (t === activeTab ? ' is-active' : '') + '" data-act="tab" data-id="' + esc(t.id) + '">' +
          '<span class="home__name">' + esc(t.label) + '</span>' +
          '<span class="home__path">' + esc(t.dir ? t.dir + '/' + t.name : t.name) + '</span>' +
          '<button class="tbtn home__btn" data-act="close" data-id="' + esc(t.id) + '">关闭</button></li>';
      });
      h += '</ul>';
    }

    h += '<h3 class="home__sec">目录</h3>';
    if (homeDirs.length) {                                  // 过滤 + 展开/折叠全部（参考实现的卡片工具条）
      h += '<div class="home__bar"><div class="search"><span class="search__icon">🔍</span>' +
        '<input id="homeFilter" type="search" placeholder="过滤文件或目录…" autocomplete="off" value="' +
        esc(homeFilterRaw) + '">' +
        '<button class="search__clear" data-act="clear-filter"' + (homeFilterRaw ? '' : ' hidden') + '>✕</button>' +
        '</div><button class="tbtn" data-act="expand-all">展开全部</button>' +
        '<button class="tbtn" data-act="collapse-all">折叠全部</button></div>';
    }
    if (!homeDirs.length) h += '<p class="home__none">' + EMPTY_TIP + '</p>';
    homeDirs.forEach(function (d) {
      h += '<div class="home__dir"><div class="home__dirhead">' +
        '<span class="home__dirname">' + esc(d.name) + '/</span>' +
        '<span class="home__path">' + (d.source === 'server' ? '静态服务器 · 自动列出同目录'
          : (d.source === 'dropped' ? '拖入的文件夹' : '选择的文件夹')) + '</span>' +
        (d.source === 'server'
          ? '<button class="tbtn home__btn" data-act="reload" data-id="' + nodeId(d) + '">刷新</button>' : '') +
        '<button class="tbtn home__btn" data-act="rmdir" data-id="' + nodeId(d) + '">移除</button>' +
        '</div>';
      if (d.loading) h += '<div class="home__err">读取中…</div>';
      else if (d.error === 'shadow') h += '<div class="home__err">服务器返回的是同目录的 <code>index.html</code> 页面，' +
        '不是目录列表，所以看不到文件。静态服务器都优先用 index.html 当目录首页，浏览器无法绕过。想自动列出，任选其一：<br>' +
        '① 让该目录里没有 <code>index.html</code>——入口文件名别叫 index.html（本仓库用的是 <code>MDSlice.html</code>）；<br>' +
        '② 换用强制目录索引的服务器（nginx <code>autoindex on</code>；Apache <code>DirectoryIndex disabled</code> + ' +
        '<code>Options +Indexes</code>）；<br>③ 直接点「添加目录」选本地文件夹。</div>';
      else if (d.error === 'fail') h += '<div class="home__err">服务器没有返回目录列表（可能未开启目录索引）。</div>';
      else if (!visibleChildren(d).length) h += '<div class="home__err">' +
        (d.error === 'empty'
          ? '服务器返回的内容里没有可识别的 markdown 或子目录（目录索引被关闭时请用「添加目录」）。'
          : '这个目录（含所有子目录）里没有 markdown 文件。') + '</div>';
      else h += '<div class="ftree" tabindex="0">' + treeHtml(d) + '</div>';
      h += '</div>';
    });

    return h + '</div>';
  }
  /* 结构移植自 file-tree.html 参考实现：
     .ftree__node > (.ftree__row + .ftree__children)
     行内固定顺序：[折叠箭头 17px][图标 16px][名字][数量胶囊][meta] */
  function treeHtml(node) {
    var h = '';
    visibleChildren(node).forEach(function (c) {          // 空目录（递归不含 markdown）不渲染
      var isDir = c.type === 'dir';
      var vkids = isDir ? visibleChildren(c) : [];
      var opened = !isDir && !!openTabByKey(keyOfNode(c));
      h += '<div class="ftree__node"><div class="ftree__row' + (c.id === homeSel ? ' is-selected' : '') +
        '" data-act="' + (isDir ? 'folder' : 'open') + '" data-id="' + nodeId(c) + '">';
      if (isDir) {
        h += '<button class="tree-toggle' + (c.loading ? ' is-loading' : '') + '" type="button" aria-expanded="' +
          (c.expanded ? 'true' : 'false') + '">' +
          '<svg class="chev" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><use href="#i-chev"/></svg>' +
          '</button>';
      } else {
        h += '<span class="tree-toggle tree-toggle--leaf"></span>';           // 占位，保持名字对齐
      }
      h += ftIcon(isDir, c.expanded, c.name) + '<span class="ftree__name">' + markName(c.name) + '</span>';
      if (isDir && c.loaded && vkids.length) {
        h += '<span class="tree-count">' + vkids.length + '</span>';
      }
      if (opened) h += '<span class="ftree__meta">已打开</span>';
      h += '</div>';
      if (isDir) {
        var inner;
        if (c.loading) inner = '<div class="ftree__empty">读取中…</div>';
        else if (c.error === 'fail') inner = '<div class="ftree__empty">无法读取（服务器未开启目录索引）</div>';
        else if (c.error === 'shadow') inner = '<div class="ftree__empty">这里也有 index.html，服务器返回的是页面而不是目录列表</div>';
        else if (vkids.length) inner = treeHtml(c);
        else inner = '<div class="ftree__empty">(空目录)</div>';
        h += '<div class="ftree__children"' + (c.expanded ? '' : ' hidden') + '>' + inner + '</div>';
      }
      h += '</div>';
    });
    return h;
  }
  function bindHome(tab) {
    if (tab.homeBound) return;                            // 只绑一次（pane 元素长期存在）
    tab.homeBound = true;
    tab.dom.pane.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      var act = el.getAttribute('data-act');
      var id = el.getAttribute('data-id');
      if (act === 'add-dir') { dirInput.click(); return; }
      if (act === 'tab') { activateTab(id); return; }
      if (act === 'close') { closeTab(id); return; }
      if (act === 'clear-filter') { clearFilter(); return; }
      if (act === 'expand-all') { setAllExpanded(true); return; }
      if (act === 'collapse-all') { setAllExpanded(false); return; }
      if (act === 'folder' || act === 'open') {
        var row = el.classList.contains('ftree__row') ? el
          : (el.closest ? el.closest('.ftree__row') : null);
        if (row) selectRow(row);                     // 先选中：键盘导航的锚点
        if (act === 'folder') toggleFolder(id); else openHomeFile(id);
        return;
      }
      if (act === 'reload') { var d = homeNodes[id]; if (d) loadServerDir(d); return; }
      if (act === 'rmdir') { removeDir(id); return; }
    });
    tab.dom.pane.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'homeFilter') applyFilter(e.target.value);
    });
    tab.dom.pane.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'homeFilter') {
        if (e.key === 'Escape') { e.target.value = ''; applyFilter(''); }
        return;                                       // 过滤框里不接管方向键
      }
      onTreeKey(e);
    });
  }

  /** 选中某一行（键盘导航的锚点；样式见 .ftree__row.is-selected） */
  function selectRow(row) {
    var t = homeTab();
    if (!t || !row) return;
    t.dom.pane.querySelectorAll('.ftree__row.is-selected').forEach(function (r) { r.classList.remove('is-selected'); });
    row.classList.add('is-selected');
    homeSel = row.getAttribute('data-id');
  }
  function childWrap(nodeEl) {
    for (var i = 0; i < nodeEl.children.length; i++) {
      if (nodeEl.children[i].classList.contains('ftree__children')) return nodeEl.children[i];
    }
    return null;
  }
  /** 展开/折叠全部。
      折叠：纯状态操作，立即生效。
      展开：递归展开每个目录；遇到尚未加载的服务器子目录就按需加载后再展开其子级
      （与参考实现的 expandAll 一致，请求数 = 目录数，由用户主动触发）。
      注意：homeDirs 里的根节点没有 type 字段，只能用 children 判断是不是目录。 */
  function setAllExpanded(open) {
    if (!open) {
      homeDirs.forEach(function collapse(d) {
        if (!d.children) return;
        d.expanded = false;
        d.children.forEach(collapse);
      });
      refreshHomeNow();
      return;
    }
    function kids(d) { return Promise.all((d.children || []).map(step)); }
    function step(d) {
      if (!d.children) return Promise.resolve();
      d.expanded = true;
      if (d.url && !d.loaded && !d.loading) return loadServerDir(d).then(function () { return kids(d); });
      return kids(d);
    }
    Promise.all(homeDirs.map(step)).then(function () { refreshHomeNow(); });
  }
  /** 过滤：直接改已渲染的 DOM（不重建，输入框焦点与光标不丢） */
  function applyFilter(kw) {
    var t = homeTab();
    if (!t) return;
    var root = t.dom.pane.querySelector('.home');
    if (!root) return;
    homeFilterRaw = kw;
    homeFilter = String(kw || '').trim().toLowerCase();
    var clearBtn = t.dom.pane.querySelector('[data-act="clear-filter"]');
    if (clearBtn) clearBtn.hidden = !homeFilterRaw;

    root.querySelectorAll('.ftree__name').forEach(function (el) {      // 还原名字、清掉高亮
      if (el.dataset.raw != null) { el.textContent = el.dataset.raw; delete el.dataset.raw; }
    });
    if (!homeFilter) {
      root.querySelectorAll('.ftree__node').forEach(function (n) { n.style.display = ''; });
      return;
    }
    root.querySelectorAll('.ftree__node').forEach(function (n) { n.style.display = 'none'; });
    root.querySelectorAll('.ftree__row').forEach(function (row) {
      var nm = row.querySelector('.ftree__name');
      if (!nm) return;
      var name = nm.textContent, i = name.toLowerCase().indexOf(homeFilter);
      if (i < 0) return;
      nm.dataset.raw = name;
      nm.innerHTML = esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + homeFilter.length)) + '</mark>' +
        esc(name.slice(i + homeFilter.length));
      for (var node = row.parentElement; node; node = node.parentElement) {
        if (!node.classList || !node.classList.contains('ftree__node')) continue;
        node.style.display = '';                            // 露出命中项及其祖先
        var cw = childWrap(node);
        if (cw) {
          cw.hidden = false;                                // 展开祖先
          var rid = node.querySelector('.ftree__row');
          var dn = rid ? homeNodes[rid.getAttribute('data-id')] : null;
          if (dn) dn.expanded = true;                       // 同步到数据，重建后仍展开
        }
      }
    });
  }
  function clearFilter() {
    var t = homeTab();
    if (!t) return;
    var inp = t.dom.pane.querySelector('#homeFilter');
    if (inp) inp.value = '';
    applyFilter('');
    if (inp) inp.focus();
  }
  /** 行是否可见（祖先容器没被折叠、也没被过滤隐藏） */
  function rowVisible(row) {
    for (var el = row.parentElement; el; el = el.parentElement) {
      if (!el.classList) continue;
      if (el.classList.contains('ftree__children') && el.hidden) return false;
      if (el.classList.contains('ftree__node') && el.style.display === 'none') return false;
    }
    return true;
  }
  /** 键盘导航：↑↓ 移动，←→ 折叠/展开，Enter 打开 */
  function onTreeKey(e) {
    var treeEl = e.target && e.target.closest ? e.target.closest('.ftree') : null;
    if (!treeEl) return;
    var rows = [].slice.call(treeEl.querySelectorAll('.ftree__row')).filter(rowVisible);
    if (!rows.length) return;
    var cur = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].classList.contains('is-selected')) { cur = i; break; } }
    var sel = cur >= 0 ? homeNodes[rows[cur].getAttribute('data-id')] : null;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var at = cur < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      selectRow(rows[at]);
      rows[at].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowRight') { if (sel && sel.type === 'dir' && !sel.expanded) { e.preventDefault(); toggleFolder(sel.id); } return; }
    if (e.key === 'ArrowLeft') { if (sel && sel.type === 'dir' && sel.expanded) { e.preventDefault(); toggleFolder(sel.id); } return; }
    if (e.key === 'Enter' || e.key === ' ') {
      if (!sel) return;
      e.preventDefault();
      if (sel.type === 'dir') toggleFolder(sel.id); else openHomeFile(sel.id);
    }
  }
  function toggleFolder(id) {
    var n = homeNodes[id];
    if (!n || n.type !== 'dir') return;
    if (n.expanded) { n.expanded = false; refreshHomeNow(); return; }
    n.expanded = true;
    if (n.url && !n.loaded && !n.loading) { refreshHomeNow(); loadServerDir(n); return; }
    refreshHomeNow();
  }
  function openHomeFile(id) {
    var n = homeNodes[id];
    if (!n || n.type !== 'file') return;
    var key = keyOfNode(n), dir = dirOfNode(n);
    var open = openTabByKey(key);
    if (open) { activateTab(open.id); return; }            // 同一份文件已打开 → 切过去，不重读
    if (n.file) {                                          // 本地目录：读「选择目录那一刻」拿到的 File 引用
      n.file.text().then(function (text) { openTab(n.name, text, key, dir); },
        function () {                                      // 该文件之后被改写/删除/移动，引用会失效（浏览器报 file could not be read）
          homeNotice = '读取 <code>' + esc(n.name) + '</code> 失败：它在加入目录之后被改动或移走了。' +
            '重新点一次「添加目录」刷新即可。';
          refreshHomeNow();
        });
      return;
    }
    if (!n.url) return;
    fetch(n.url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) { openTab(n.name, text, key, dir); })
      .catch(function () {
        homeNotice = '读取 <code>' + esc(n.name) + '</code> 失败：文件被移动，或服务器拒绝访问。';
        refreshHomeNow();
      });
  }
  function removeDir(id) {
    var d = homeNodes[id];
    if (!d) return;
    var at = homeDirs.indexOf(d);
    if (at >= 0) homeDirs.splice(at, 1);
    delete homeNodes[id];
    refreshHomeNow();
  }
