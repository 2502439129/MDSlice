/* shell.js —— 外壳：主题切换、顶栏按钮、侧栏宽度拖动、打开文件（选择器与拖拽上传）。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* =========================================================
     10. 主题 / 顶栏 / 文件
     ========================================================= */
  var root = document.documentElement;
  var themeBtn = document.getElementById('themeBtn');
  var savedTh = null;
  try { savedTh = localStorage.getItem('md-theme'); } catch (e) { /* 隐私模式 */ }
  root.dataset.theme = savedTh || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  var hljsLight = document.getElementById('hljs-theme-light');
  var hljsDark = document.getElementById('hljs-theme-dark');

  function applyTheme() {
    var dark = root.dataset.theme === 'dark';

    themeBtn.textContent = dark ? '◐ 亮色' : '◐ 暗色';

    // hljs 的两套主题靠 link 的 media 属性互斥，这里接管为跟随手动切换
    if (hljsLight) hljsLight.media = dark ? 'not all' : 'all';
    if (hljsDark) hljsDark.media = dark ? 'all' : 'not all';
  }
  applyTheme();

  themeBtn.addEventListener('click', function () {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('md-theme', next); } catch (e) { /* 忽略 */ }
    applyTheme();
  });

  var sidebar = document.getElementById('sidebar');
  document.getElementById('menuBtn').addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  /* 目录：全部折叠 / 全部展开（只作用于当前标签页的目录树） */
  function setNavCollapsed(collapsed) {
    var navRoot = activeTab ? activeTab.dom.nav : null;
    if (!navRoot) return;
    Array.prototype.forEach.call(navRoot.querySelectorAll('.toc-sub'), function (ul) {
      ul.classList.toggle('collapsed', collapsed);
    });
    Array.prototype.forEach.call(navRoot.querySelectorAll('.caret:not(.caret--empty)'), function (c) {
      c.classList.toggle('collapsed', collapsed);
    });
  }

  var navCollapseBtn = sidebar.querySelector('[data-action="collapse"]');
  var navExpandBtn = sidebar.querySelector('[data-action="expand"]');
  if (navCollapseBtn) navCollapseBtn.addEventListener('click', function () { setNavCollapsed(true); });
  if (navExpandBtn) navExpandBtn.addEventListener('click', function () { setNavCollapsed(false); });

  /* ---- 侧栏宽度可拖动（存 localStorage，键 md-sidebar-w） ---- */
  var resizer = document.getElementById('resizer');
  var SIDE_KEY = 'md-sidebar-w';
  var SIDE_MIN = 160, SIDE_MAX = 480;

  function clampSide(w) {
    return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(w)));
  }

  function setSideWidth(w, persist) {
    w = clampSide(w);
    root.style.setProperty('--sidebar-w', w + 'px');
    if (persist) {
      try { localStorage.setItem(SIDE_KEY, String(w)); } catch (e) { /* 忽略 */ }
    }
    return w;
  }

  (function initSideWidth() {
    var saved = NaN;
    try { saved = parseFloat(localStorage.getItem(SIDE_KEY)); } catch (e) { /* 隐私模式 */ }
    if (!isNaN(saved)) root.style.setProperty('--sidebar-w', clampSide(saved) + 'px');
  })();

  resizer.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;          // 只响应左键
    e.preventDefault();
    var startX = e.clientX;
    var startW = sidebar.getBoundingClientRect().width;
    var width = startW;

    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onMove(ev) {
      width = setSideWidth(startW + ev.clientX - startX, false);
    }
    function onUp() {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setSideWidth(width, true);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  var fileInput = document.getElementById('fileInput');
  document.getElementById('fileBtn').addEventListener('click', function () { fileInput.click(); });

  /* 一次选择/拖入 = 打开一个新标签页（同名文件按约定关闭后重开） */
  function mountFile(file) {
    if (!file) return;
    // 直接上传的文件：文件名即身份（同名会替换已有标签）
    file.text().then(function (text) { openTab(file.name, text, 'file:' + file.name, ''); });
  }

  fileInput.addEventListener('change', function (e) {
    mountFile(e.target.files && e.target.files[0]);
    fileInput.value = '';                 // 同一个文件再次选择也能触发 change
  });

  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev !== 'drop') return;
      var dirs = droppedDirs(e.dataTransfer);        // 必须在事件内同步取 entry，事件结束后会失效
      if (dirs.length) { dirs.forEach(addDroppedDir); return; }
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) mountFile(files[0]);
    });
  });

  /* ---- 标签条：拖拽排序（拖标签本身，而不是拖文件） ---- */
  tabbar.addEventListener('dragover', function (e) {
    if (!dragTabId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    var over = e.target.closest ? e.target.closest('.tab') : null;
    clearDragMarks();
    if (!over || over.dataset.id === dragTabId) return;

    var r = over.getBoundingClientRect();
    over.classList.add(e.clientX > r.left + r.width / 2 ? 'is-over-end' : 'is-over');
  });

  tabbar.addEventListener('drop', function (e) {
    if (!dragTabId) return;
    e.preventDefault();
    e.stopPropagation();                 // 不要把这次拖拽当成「拖入文件」

    var over = e.target.closest ? e.target.closest('.tab') : null;
    var after = !!(over && over.classList.contains('is-over-end'));
    var fromId = dragTabId;
    clearDragMarks();
    dragTabId = null;

    if (over) moveTab(fromId, over.dataset.id, after);
  });
