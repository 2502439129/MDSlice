/* shell.js —— 外壳：主题切换、顶栏按钮、侧栏（抽屉与宽度拖动）、打开文件（选择器与拖拽）。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 主题 ---- */
  var root = document.documentElement;
  var themeBtn = document.getElementById('themeBtn');
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('md-theme'); } catch (e) { /* 隐私模式禁用存储 */ }
  root.dataset.theme = savedTheme ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  var hljsLight = document.getElementById('hljs-theme-light');
  var hljsDark = document.getElementById('hljs-theme-dark');

  /** 应用当前主题：更新切换按钮文案，并切换两套高亮主题的 media。 */
  function applyTheme() {
    var dark = root.dataset.theme === 'dark';
    themeBtn.textContent = dark ? '◐ 亮色' : '◐ 暗色';
    if (hljsLight) hljsLight.media = dark ? 'not all' : 'all';   // 两套主题靠 media 互斥，跟随手动切换
    if (hljsDark) hljsDark.media = dark ? 'all' : 'not all';
  }
  applyTheme();

  themeBtn.addEventListener('click', function () {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('md-theme', next); } catch (e) { /* 忽略 */ }
    applyTheme();
  });

  /* ---- 顶栏按钮 ---- */
  document.getElementById('menuBtn').addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  /** 折叠或展开当前标签页目录树里的全部子级（只作用于 activeTab）。 */
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

  /* ---- 侧栏宽度（拖动调整，存入 localStorage 的 md-sidebar-w） ---- */
  var SIDE_KEY = 'md-sidebar-w';
  var SIDE_MIN = 160, SIDE_MAX = 480;

  /** 把侧栏宽度限制在允许区间内。 */
  function clampSide(width) {
    return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(width)));
  }

  /** 设置侧栏宽度；persist 为真时写入 localStorage，返回实际生效的宽度。 */
  function setSideWidth(width, persist) {
    width = clampSide(width);
    root.style.setProperty('--sidebar-w', width + 'px');
    if (persist) {
      try { localStorage.setItem(SIDE_KEY, String(width)); } catch (e) { /* 忽略 */ }
    }
    return width;
  }

  /** 启动时恢复上次拖动的侧栏宽度。 */
  (function initSideWidth() {
    var saved = NaN;
    try { saved = parseFloat(localStorage.getItem(SIDE_KEY)); } catch (e) { /* 隐私模式禁用存储 */ }
    if (!isNaN(saved)) root.style.setProperty('--sidebar-w', clampSide(saved) + 'px');
  })();

  resizer.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;                            // 只响应左键
    e.preventDefault();
    var startX = e.clientX;
    var startW = sidebar.getBoundingClientRect().width;
    var width = startW;

    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onMove(ev) {
      width = setSideWidth(startW + ev.clientX - startX, false);   // 拖动过程只改样式，不写存储
    }
    function onUp() {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setSideWidth(width, true);                           // 松手时才落盘
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  /* ---- 打开本地文件 ---- */
  var fileInput = document.getElementById('fileInput');
  document.getElementById('fileBtn').addEventListener('click', function () { fileInput.click(); });

  /** 把本地文件读成新标签页（身份键用文件名，同名会替换已有标签）。 */
  function openPickedFile(file) {
    if (!file) return;
    file.text().then(function (text) { openTab(file.name, text, 'file:' + file.name, ''); });
  }

  fileInput.addEventListener('change', function (e) {
    openPickedFile(e.target.files && e.target.files[0]);
    fileInput.value = '';                                  // 清空才能再次选择同一个文件
  });

  /** 页面级拖放：文件夹交给首页，单个 .md 直接打开。 */
  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev !== 'drop') return;
      var dirs = droppedDirs(e.dataTransfer);              // entry 必须在事件内同步取，事件结束后会失效
      if (dirs.length) { dirs.forEach(addDroppedDir); return; }
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) openPickedFile(files[0]);
    });
  });

  /* ---- 标签条拖拽排序（拖的是标签，不是文件） ---- */
  tabbar.addEventListener('dragover', function (e) {
    if (!dragTabId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    var over = e.target.closest ? e.target.closest('.tab') : null;
    clearDragMarks();
    if (!over || over.dataset.id === dragTabId) return;

    var r = over.getBoundingClientRect();                  // 落在左半还是右半，决定插在前面还是后面
    over.classList.add(e.clientX > r.left + r.width / 2 ? 'is-over-end' : 'is-over');
  });

  tabbar.addEventListener('drop', function (e) {
    if (!dragTabId) return;
    e.preventDefault();
    e.stopPropagation();                                   // 别把这次拖拽当成「拖入文件」

    var over = e.target.closest ? e.target.closest('.tab') : null;
    var after = !!(over && over.classList.contains('is-over-end'));
    var fromId = dragTabId;
    clearDragMarks();
    dragTabId = null;

    if (over) moveTab(fromId, over.dataset.id, after);
  });
