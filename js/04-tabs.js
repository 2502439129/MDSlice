/* tabs.js —— 标签页模型：新建 / 激活 / 关闭 / 拖拽排序 / 双击刷新 / 标签条渲染 / 文档容器装配。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 标签页模型 ---- */
  var DOC_EXT = /\.(md|markdown|txt)$/i;

  /** 标签上显示的名字：去掉文档后缀，空名兜底为「未命名」。 */
  function tabLabel(name) {
    return String(name || '').replace(DOC_EXT, '') || '未命名';
  }

  /** 刷新各标签页的显示名（只显示文件名，重名不加路径前缀）。
      区分同名文件靠标签悬停提示与首页「已打开的文件」列表；身份判定见 openTabByKey()。 */
  function refreshTabLabels() {
    tabs.forEach(function (t) {
      if (t.kind === 'home') return;
      t.label = tabLabel(t.name);
    });
  }

  /** 按 id 取标签页，找不到返回 null。 */
  function findTab(id) {
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].id === id) return tabs[i]; }
    return null;
  }

  /** 取常驻首页标签（按 kind 判断，不能用名字）。 */
  function homeTab() {
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].kind === 'home') return tabs[i]; }
    return null;
  }

  /** 按身份键找文档标签页；首页不参与。 */
  function openTabByKey(key) {
    var hit = null;
    tabs.forEach(function (t) { if (!hit && t.kind !== 'home' && t.key === key) hit = t; });
    return hit;
  }

  /** 新建标签页（连带它自己的三个容器），并加入标签条；kind='home' 表示首页；
      sourceUrl 是该文档自己的地址，用于把正文里的相对链接解析成绝对地址。 */
  function createTab(name, src, kind, sourceUrl) {
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
      sourceUrl: sourceUrl || '',                        // 文档自身的地址（本地打开或直接上传的为空）
      source: null,                                      // 重新读取该文档所需的信息，见 refreshTab()
      busy: false,                                       // 刷新进行中（标签上的 × 变成 ↻），见 setTabBusy()
      sections: [], sectionById: Object.create(null), childrenById: Object.create(null),
      activeId: null, firstId: null, scrollY: 0,
      rendered: false, empty: false,
      dom: { pane: pane, nav: nav, toc: toc }
    };

    tabs.push(tab);
    return tab;
  }

  /** 把全局快捷引用（sections / sectionById / childrenById）指向某个标签页。 */
  function setActiveTabRefs(tab) {
    activeTab = tab;
    sections = tab ? tab.sections : [];
    sectionById = tab ? tab.sectionById : Object.create(null);
    childrenById = tab ? tab.childrenById : Object.create(null);
  }

  /** 渲染标签页内容：章节切分、左栏目录、右栏小节与正文容器（不切换激活状态）。 */
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
    tab.childrenById = collectChildIds(tree);

    tab.dom.nav.innerHTML = '';
    renderNavNodes(tree, tab.dom.nav);

    bindTabs(tab.dom.pane);
    bindTree(tab.dom.pane);
    highlightCode(tab.dom.pane);
    renderMath(tab.dom.pane);

    tab.rendered = true;
    tab.firstId = list[0].id;
    tab.activeId = null;
  }

  /** 切换标签页：换容器显隐 → 恢复视图状态 → 同步页面标题、右栏与标签条。 */
  function activateTab(id) {
    var tab = findTab(id);
    if (!tab) return;

    if (activeTab && activeTab !== tab) {
      activeTab.scrollY = scrollY();                       // 离开前记下当前滚动位置
    }

    tabs.forEach(function (t) {
      var on = t === tab;
      t.dom.pane.classList.toggle('is-active', on);
      t.dom.nav.classList.toggle('is-active', on);
      t.dom.toc.classList.toggle('is-active', on);
    });

    setActiveTabRefs(tab);
    if (!tab.rendered) renderTab(tab);

    document.body.classList.toggle('is-home', tab.kind === 'home');    // 首页无目录树，收起侧栏与 ☰

    document.title = tab.kind === 'home'
      ? 'MDSlice'
      : ((tab.sections[0] && (tab.sections[0].meta.title || tab.sections[0].title)) || tab.label);

    if (tab.empty) {
      tocAside.hidden = true;
      shell.classList.add('no-toc');
    } else {
      showSection(tab.activeId || tab.firstId);
      scrollToY(tab.scrollY);
      // 章节显隐会改变页面高度，下一帧再校一次滚动位置；重新激活时先取消上一次的补偿
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
      if (tab.scrollY) {
        scrollRaf = requestAnimationFrame(function () {
          scrollRaf = 0;
          if (activeTab === tab) scrollToY(tab.scrollY);
        });
      }
    }

    renderTabBar();
    sidebar.classList.remove('open');
  }

  /** 打开文件：同一「身份键」的标签页先关闭，再在原位置重开。
      key 省略时用文件名（直接上传的文件以文件名作身份）；从目录打开的文件传
      「顶层目录名/相对路径」，所以 B1/index.md 与 B2/index.md 是两份文件。 */
  function openTab(name, src, key, dir, sourceUrl) {
    key = key || ('file:' + name);
    var dup = openTabByKey(key);
    var at = dup ? tabs.indexOf(dup) : -1;

    if (dup) {
      if (dup === activeTab) { activeTab = null; setActiveTabRefs(null); }   // 被替换的标签无需保存状态
      detachTab(dup);
    }

    var tab = createTab(name, src, 'doc', sourceUrl);
    tab.key = key;
    tab.dir = dir || '';
    if (at >= 0) {
      tabs.splice(tabs.indexOf(tab), 1);
      tabs.splice(at, 0, tab);                             // 占回原位置
    }

    renderTab(tab);
    activateTab(tab.id);
    return tab;
  }

  /** 打开一份文档：本地用句柄 / File 引用、服务器用 fetch，读完按 openTab 的流程开标签
      （同一身份会原地重开）；fragment 非空时打开后定位到该小节。
      读取失败时返回被拒的 Promise，由调用方决定提示什么。 */
  function openDocNode(doc, fragment) {
    var read = (doc.handle || doc.file)
      ? readLocalDoc(doc)
      : fetch(doc.url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        });
    return read.then(function (text) {
      var tab = openTab(doc.name, text, doc.key, doc.dir, doc.url || '');
      tab.source = sourceOfDoc(doc);                       // 记下来源，供双击标签页刷新
      jumpToFragment(fragment);
      return true;
    });
  }

  /** 打开一份本地文档：句柄（每次现读，可真正刷新）或 File 快照，二选一。 */
  function openLocalSource(src, fragment) {
    return openDocNode({ name: src.name, file: src.file || null, handle: src.handle || null }, fragment);
  }

  /** 读一份本地文档：有句柄就现取一次（拿得到磁盘上的最新内容），否则读 File 快照。 */
  function readLocalDoc(src) {
    if (src.handle) return src.handle.getFile().then(function (f) { return f.text(); });
    return src.file.text();
  }

  /** 文档节点 / 描述对象 → 重新读取它所需的最少信息（双击标签页刷新用）。 */
  function sourceOfDoc(doc) {
    return { name: doc.name, key: doc.key || ('file:' + doc.name), dir: doc.dir || '',
             url: doc.url || '', file: doc.file || null, handle: doc.handle || null };
  }

  /** 刷新期间在标签上显示「进行中」：× 变成转动的 ↻（复用同一个按钮，不引入图标资源）。
      状态记在 tab.busy 上，标签条重建后仍能保持；结束时还原。 */
  function setTabBusy(tab, on) {
    tab.busy = !!on;
    var btn = tabbar.querySelector('.tab[data-id="' + tab.id + '"] .tab__close');
    if (!btn) return;
    btn.classList.toggle('is-busy', !!on);
    btn.textContent = on ? '↻' : '×';
    btn.title = on ? '正在重新读取…' : '关闭此标签页';
  }

  /** 双击标签页：重新读取并重排这份文档，尽量停在原来那一节与滚动位置。
      服务器文档（有 url）与带句柄的本地文件都是真的重新读取，前者绕过缓存；
      只有 File 快照时内容不会变，此时只重排。读取期间标签被关掉的话不再重开。
      结果用底部轻提示给出；读取失败只提示，不动原来的标签页。 */
  function refreshTab(tab) {
    if (!tab || tab.kind === 'home') return;
    var src = tab.source;
    if (!src) { showToast('这个标签页没有可重新读取的来源。'); return; }

    var local = !!(src.handle || src.file);                // 本地来源：句柄或 File
    var snapshot = !src.handle && !!src.file;              // 其中只有 File 快照时内容不会变，只能重排
    var keepId = tab.activeId;
    var keepY = tab === activeTab ? scrollY() : tab.scrollY;

    var read = local
      ? readLocalDoc(src)
      : fetch(src.url, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        });

    var name = '<code>' + esc(src.name) + '</code>';
    setTabBusy(tab, true);
    return read.then(function (text) {
      if (tabs.indexOf(tab) < 0) return false;             // 读取期间标签被关掉了：不再把它重开
      var t = openTab(src.name, text, src.key, src.dir, src.url);
      t.source = src;
      t.activeId = t.sectionById[keepId] ? keepId : null;   // 原小节还在就停在那里
      t.scrollY = keepY;
      activateTab(t.id);                                    // 由 activateTab 去应用小节与滚动位置
      showToast(snapshot
        ? '已重新排版 ' + name + '。这次用的是浏览器给的快照，内容不会跟着变；' +
          '要真正刷新，请重新拖入它或它所在的文件夹，或点「添加目录」。'
        : '已重新读取 ' + name + '。', snapshot ? 6500 : 2600);
      return true;
    }).catch(function () {
      showToast('重新读取 ' + name + ' 失败：文件被移动、改写，或服务器拒绝访问。' +
        (local ? '请重新打开这份文件，或点「添加目录」重新选择。' : ''), 7000);
    }).then(function (v) {
      setTabBusy(tab, false);     // 成功时标签已被重开、按钮是新的，这一步不会改动它
      return v;
    });
  }

  /** 从集合与 DOM 中摘除标签页（不处理激活切换）。 */
  function detachTab(tab) {
    var at = tabs.indexOf(tab);
    if (at >= 0) tabs.splice(at, 1);
    tab.dom.pane.remove();
    tab.dom.nav.remove();
    tab.dom.toc.remove();
  }

  /** 关闭标签页：激活邻居（右优先，否则左）；首页不可关闭。 */
  function closeTab(id) {
    var tab = findTab(id);
    if (!tab || tab.kind === 'home') return;

    var at = tabs.indexOf(tab);
    var wasActive = tab === activeTab;
    var next = tabs[at + 1] || tabs[at - 1] || null;

    detachTab(tab);
    if (wasActive) {
      activeTab = null;
      setActiveTabRefs(null);
      var fallback = next || homeTab();                    // 首页常驻，没有邻居时落在首页
      if (fallback) activateTab(fallback.id);
      else renderTabBar();
    } else {
      renderTabBar();
    }
  }

  /** 重建标签条（按 tabs 顺序）。 */
  function renderTabBar() {
    refreshTabLabels();
    tabbar.innerHTML = '';
    markHomeDirty();                                       // 标签增删后首页的「已打开的文件」需重建

    tabs.forEach(function (tab) {
      var isHome = tab.kind === 'home';
      var el = document.createElement('div');
      el.className = 'tab' + (isHome ? ' tab--home' : '') + (tab === activeTab ? ' is-active' : '');
      el.dataset.id = tab.id;
      el.title = isHome
        ? '首页（不可关闭）'
        : (tab.dir ? tab.dir + '/' + tab.name : tab.name) + '\n双击：重新读取并刷新';
      el.draggable = !isHome;                              // 首页固定在第一位，不参与拖拽排序

      if (isHome) {                                        // 首页图标取自 MDSlice.html 的 #i-home 精灵
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'tab__icon');
        svg.setAttribute('aria-hidden', 'true');
        var use = document.createElementNS(NS, 'use');
        use.setAttribute('href', '#i-home');
        svg.appendChild(use);
        el.appendChild(svg);
      }

      var label = document.createElement('span');
      label.className = 'tab__name';
      label.textContent = isHome ? '首页' : tab.label;
      el.appendChild(label);

      var closeEl = null;
      if (!isHome) {                                       // 首页不可关闭，不渲染 ×
        closeEl = document.createElement('button');
        closeEl.type = 'button';
        closeEl.className = 'tab__close' + (tab.busy ? ' is-busy' : '');
        closeEl.title = tab.busy ? '正在重新读取…' : '关闭此标签页';   // 刷新中沿用「进行中」状态
        closeEl.textContent = tab.busy ? '↻' : '×';
        el.appendChild(closeEl);
      }

      el.addEventListener('click', function (e) {
        if (closeEl && closeEl.contains(e.target)) { closeTab(tab.id); return; }
        if (tab !== activeTab) activateTab(tab.id);
      });

      el.addEventListener('dblclick', function (e) {     // 双击标签页：重读并重排本页文档
        if (closeEl && closeEl.contains(e.target)) return;
        refreshTab(tab);
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

  /** 清掉标签条上的拖拽落点标记。 */
  function clearDragMarks() {
    Array.prototype.forEach.call(tabbar.children, function (el) {
      el.classList.remove('is-over', 'is-over-end');
    });
  }

  /** 拖拽排序：把被拖标签插到落点标签的前/后，再重建标签条；首页不可被拖动。 */
  function moveTab(fromId, overId, after) {
    var from = findTab(fromId), over = findTab(overId);
    if (!from || !over || from === over || from.kind === 'home') return;

    tabs.splice(tabs.indexOf(from), 1);
    var at = over.kind === 'home' ? 1 : tabs.indexOf(over) + (after ? 1 : 0);   // 落在首页上 → 排首页之后
    tabs.splice(at, 0, from);
    renderTabBar();
  }

  /** 在当前标签页的容器内按 id 查找元素（避免多标签页之间的 id 干扰）。 */
  function findInActivePane(id) {
    if (!activeTab) return null;
    var list = activeTab.dom.pane.querySelectorAll('[id]');
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }
