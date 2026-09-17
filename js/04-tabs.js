/* tabs.js —— 标签页模型：新建 / 激活 / 关闭 / 拖拽排序 / 标签条渲染 / 文档容器装配。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* =========================================================
     9. 标签页：装载 / 切换 / 关闭 / 拖拽排序
     ========================================================= */
  var DOC_EXT = /\.(md|markdown|txt)$/i;

  function tabLabel(name) {
    return String(name || '').replace(DOC_EXT, '') || '未命名';
  }

  /** 标签条上的显示名：只显示文件名（重名也不加路径前缀，避免标签被拉长）。
      区分同名文件靠悬停提示（完整路径，见 renderTabBar 里的 el.title）与首页「已打开的文件」列表；
      文件身份（去重、已打开判断）见 keyOfNode()，与显示名无关。 */
  function refreshTabLabels() {
    tabs.forEach(function (t) {
      if (t.kind === 'home') return;
      t.label = tabLabel(t.name);
    });
  }

  function findTab(id) {
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].id === id) return tabs[i]; }
    return null;
  }

  /** 新建标签页（连带它自己的三个容器），并加入标签条。kind='home' 是首页（非文档） */
  function createTab(name, src, kind) {
    var id = 'tab' + (++tabSeq);

    var pane = document.createElement('div');
    pane.className = 'pane';
    pane.dataset.tab = id;
    content.appendChild(pane);

    var nav = document.createElement('ul');
    nav.className = 'nav-tree';
    nav.dataset.tab = id;
    navPanes.appendChild(nav);

    var toc = document.createElement('div');
    toc.className = 'toc-list';
    toc.dataset.tab = id;
    tocPanes.appendChild(toc);

    var tab = {
      id: id, name: name, label: tabLabel(name), src: src, kind: kind || 'doc',
      key: 'file:' + name, dir: '',                      // 身份键与所在目录，见 openTab()
      sections: [], sectionById: Object.create(null), childrenById: Object.create(null),
      activeId: null, firstId: null, scrollY: 0,
      rendered: false, empty: false,
      dom: { pane: pane, nav: nav, toc: toc }
    };

    tabs.push(tab);
    return tab;
  }

  /** 首页标签：固定第一个位置，不可关闭（kind='home'，内容由 renderHome 自建） */
  function createHomeTab() {
    var tab = createTab(HOME_NAME, '', 'home');
    tab.label = '首页';
    var at = tabs.indexOf(tab);
    if (at > 0) { tabs.splice(at, 1); tabs.unshift(tab); }
    return tab;
  }

  /** 把全局快捷引用指向某个标签页（渲染与交互都基于它） */
  function useTab(tab) {
    activeTab = tab;
    sections = tab ? tab.sections : [];
    sectionById = tab ? tab.sectionById : Object.create(null);
    childrenById = tab ? tab.childrenById : Object.create(null);
  }

  /** 渲染标签页内容（首次激活时调用；重复打开同名文件时会重新渲染）
      注意：这里刻意不改 activeTab —— 滚动位置等视图状态依赖「谁在激活状态」来判断，
      由 activateTab() 统一负责切换快捷引用。 */
  function renderTab(tab) {
    usedIds = Object.create(null);

    if (tab.kind === 'home') { renderHome(tab); return; }   // 首页内容自建，不走 markdown 管线

    var list = splitSections(tab.src);
    tab.sectionById = Object.create(null);
    list.forEach(function (sec) { tab.sectionById[sec.id] = sec; });
    tab.sections = list;
    tab.empty = !list.length;

    if (tab.empty) {
      tab.dom.pane.innerHTML = '<div class="empty">该文件没有可显示的内容</div>';
      tab.dom.nav.innerHTML = '';
      tab.dom.toc.innerHTML = '';
      tab.rendered = true;
      return;
    }

    tab.dom.pane.innerHTML = list.map(function (sec, i) {
      return '<div class="section' + (i ? '' : ' active') + '" id="sec-' + sec.id + '">' +
             renderSection(sec, i === 0) + '</div>';
    }).join('');

    var tree = buildTree(list);
    tab.childrenById = collectChildren(tree);

    tab.dom.nav.innerHTML = '';
    renderNavNodes(tree, tab.dom.nav);

    bindTabs(tab.dom.pane);
    bindTree(tab.dom.pane);
    highlightCode(tab.dom.pane);

    tab.rendered = true;
    tab.firstId = list[0].id;
    tab.activeId = null;
  }

  /** 切换标签页：换显隐 → 恢复视图状态 → 同步标题与右栏 */
  function activateTab(id) {
    var tab = findTab(id);
    if (!tab) return;

    if (activeTab && activeTab !== tab) {
      activeTab.scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    tabs.forEach(function (t) {
      var on = t === tab;
      t.dom.pane.classList.toggle('is-active', on);
      t.dom.nav.classList.toggle('is-active', on);
      t.dom.toc.classList.toggle('is-active', on);
    });
    emptyState.hidden = true;

    useTab(tab);
    if (!tab.rendered) renderTab(tab);

    // 首页没有目录树，收起左侧栏与 ☰（与空状态同一套样式）
    document.body.classList.toggle('is-home', tab.kind === 'home');

    document.title = tab.kind === 'home'
      ? 'MDSlice'
      : ((tab.sections[0] && (tab.sections[0].meta.title || tab.sections[0].title)) || tab.label);

    if (tab.empty) {
      tocAside.hidden = true;
      shell.classList.add('no-toc');
    } else {
      showSection(tab.activeId || tab.firstId);
      scrollToY(tab.scrollY);
      // 布局刚切换完，下一帧再校一次，避免被"章节显隐导致的高度变化"截断；
      // 重新激活时先取消上一次的补偿，避免过期回调把位置改回去
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
      if (tab.scrollY) {
        scrollRaf = requestAnimationFrame(function () {
          scrollRaf = 0;
          if (activeTab === tab) scrollToY(tab.scrollY);
        });
      }
    }

    renderTabBar();
    document.getElementById('sidebar').classList.remove('open');
  }

  /** 打开文件：同一「身份键」的标签页会被关闭后重新打开（占原位置）。
      key 省略时用文件名（直接上传的文件：文件名即身份）；
      从目录打开的文件传「目录名/相对路径」，于是 B1/index.md 与 B2/index.md 互不冲突。 */
  function openTab(name, src, key, dir) {
    key = key || ('file:' + name);
    var dup = null;
    tabs.forEach(function (t) { if (!dup && t.kind !== 'home' && t.key === key) dup = t; });
    var at = dup ? tabs.indexOf(dup) : -1;

    if (dup) {
      if (dup === activeTab) { activeTab = null; useTab(null); }   // 原标签正被替换：无需保存它的状态
      detachTab(dup);                                              // 注意：必须从 tabs 数组里一并摘除，否则会留下点不开的幽灵标签
    }

    var tab = createTab(name, src);
    tab.key = key;
    tab.dir = dir || '';
    if (at >= 0) {
      tabs.splice(tabs.indexOf(tab), 1);
      tabs.splice(at, 0, tab);                                     // 占回原位置，避免标签条跳动
    }

    renderTab(tab);
    activateTab(tab.id);
    return tab;
  }

  /** 从集合与 DOM 中摘除标签页（不处理激活切换） */
  function detachTab(tab) {
    var at = tabs.indexOf(tab);
    if (at >= 0) tabs.splice(at, 1);
    tab.dom.pane.remove();
    tab.dom.nav.remove();
    tab.dom.toc.remove();
  }

  /** 关闭标签页：激活邻居（右优先，否则左）。首页不可关闭 */
  function closeTab(id) {
    var tab = findTab(id);
    if (!tab || tab.kind === 'home') return;

    var at = tabs.indexOf(tab);
    var wasActive = tab === activeTab;
    var next = tabs[at + 1] || tabs[at - 1] || null;

    detachTab(tab);
    if (wasActive) {
      activeTab = null;
      useTab(null);
      if (next) activateTab(next.id);
      else showEmpty();
    } else {
      renderTabBar();
    }
  }

  /** 没有标签页时的空状态（tip 省略时用默认提示）。所有进入空状态的路径都必须走这里，
      否则 body.is-empty / no-toc 不会被设置，窄屏会露出无意义的 ☰ 与侧栏。 */
  function showEmpty(tip) {
    emptyState.innerHTML = tip || EMPTY_TIP;
    emptyState.hidden = false;
    tocAside.hidden = true;
    shell.classList.add('no-toc');
    document.title = 'MDSlice';
    renderTabBar();
  }

  /** 标签条：按 tabs 顺序重建（数量少，直接重建比增量维护更简单） */
  function renderTabBar() {
    refreshTabLabels();   // 标签文字只显示文件名（同名文件靠 el.title 的完整路径区分）
    tabbar.innerHTML = '';

    // 没有任何标签页时进入「空状态」：收起目录栏与 ☰ 按钮（相关样式见 index.css）
    document.body.classList.toggle('is-empty', !tabs.length);

    markHomeDirty();   // 标签增删后，首页的「已打开的文件」需要重建（下次切回时）

    tabs.forEach(function (tab) {
      var isHome = tab.kind === 'home';
      var el = document.createElement('div');
      el.className = 'tab' + (isHome ? ' tab--home' : '') + (tab === activeTab ? ' is-active' : '');
      el.dataset.id = tab.id;
      el.title = isHome ? '首页（不可关闭）' : (tab.dir ? tab.dir + '/' + tab.name : tab.name);
      el.draggable = !isHome;                    // 首页固定在第一位，不参与拖拽排序

      if (isHome) el.appendChild(homeIcon());     // 首页用 SVG 图标（定义见 MDSlice.html 的 #i-home）
      var label = document.createElement('span');
      label.className = 'tab__name';
      label.textContent = isHome ? '首页' : tab.label;
      el.appendChild(label);

      var closeEl = null;
      if (!isHome) {                             // 首页不可关闭，不渲染 ×
        closeEl = document.createElement('button');
        closeEl.type = 'button';
        closeEl.className = 'tab__close';
        closeEl.title = '关闭此标签页';
        closeEl.textContent = '×';
        el.appendChild(closeEl);
      }

      el.addEventListener('click', function (e) {
        if (closeEl && closeEl.contains(e.target)) { closeTab(tab.id); return; }
        if (tab !== activeTab) activateTab(tab.id);
      });

      el.addEventListener('dragstart', function (e) {
        dragTabId = tab.id;
        el.classList.add('is-drag');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.id);
        }
      });
      el.addEventListener('dragend', function () {
        dragTabId = null;
        clearDragMarks();
      });

      tabbar.appendChild(el);
    });
  }

  /** 首页标签的图标：引用 MDSlice.html 里定义的 SVG 精灵（fill=currentColor，跟随标签颜色） */
  function homeIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tab__icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-home');
    svg.appendChild(use);
    return svg;
  }

  function clearDragMarks() {
    Array.prototype.forEach.call(tabbar.children, function (el) {
      el.classList.remove('is-over', 'is-over-end');
    });
  }

  /** 拖拽排序：按被拖标签的落点重排 tabs，再重建标签条 */
  function moveTab(fromId, overId, after) {
    var from = findTab(fromId), over = findTab(overId);
    if (!from || !over || from === over || from.kind === 'home') return;   // 首页不可被拖动

    tabs.splice(tabs.indexOf(from), 1);
    // 落在首页上 → 排到首页右边（第一个文档标签的位置）
    var at = over.kind === 'home' ? 1 : tabs.indexOf(over) + (after ? 1 : 0);
    tabs.splice(at, 0, from);
    renderTabBar();
  }

  /** 在当前标签页的容器内按 id 精确查找（避免多标签页之间的 id 干扰） */
  function findInActivePane(id) {
    if (!activeTab) return null;
    var list = activeTab.dom.pane.querySelectorAll('[id]');
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }
