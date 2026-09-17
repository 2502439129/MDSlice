/* core.js —— 核心：DOM 引用、全局状态、通用工具
   注意：拆分后各文件共享全局作用域，靠 MDSlice.html 里的加载顺序保证依赖就绪。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  var content  = document.getElementById('content');
  var shell    = document.getElementById('shell');
  var navPanes = document.getElementById('navPanes');
  var tocAside = document.getElementById('tocAside');
  var tocPanes = document.getElementById('tocPanes');
  var tabbar   = document.getElementById('tabbar');
  var emptyState = document.getElementById('emptyState');

  /* =========================================================
     0. 标签页模型
     一个标签页 = 一组容器（正文 .pane / 左栏 .nav-tree / 右栏 .toc-list）
     + 解析结果 + 视图状态。未激活的容器保持 display:none，所以滚动位置、
     目录折叠、标签页与折叠块的展开态都留在各自 DOM 里，切回来即原样恢复。
     ========================================================= */
  var tabs = [];                 // 按标签条顺序排列
  var activeTab = null;
  var tabSeq = 0;
  var dragTabId = null;
  var scrollRaf = 0;
  var EMPTY_TIP = '点击右上角「打开 MD」选择文件，或把 <code>.md</code> 拖到页面任意位置。';

  var usedIds = Object.create(null);   // 单份文档内 id 去重（每次渲染前重置）
  var uid = 0;                         // 全局递增：多标签页并存时 DOM id 不冲突
  var sections = [];                   // 以下三个是 activeTab 的快捷引用，见 useTab()
  var sectionById = Object.create(null);
  var childrenById = Object.create(null);

  /* =========================================================
     1. 基础工具
     ========================================================= */
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  function slug(t) {
    return String(t).trim().toLowerCase()
      .replace(/[`*_~\[\]()#]/g, '')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sec';
  }

  function uniqueId(text) {
    var base = slug(text);
    var id = base, n = 2;
    while (usedIds[id]) id = base + '-' + (n++);
    usedIds[id] = true;
    return id;
  }
