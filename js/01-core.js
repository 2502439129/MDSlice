/* core.js —— 核心：DOM 引用、全局状态、通用工具。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- DOM 引用 ---- */
  var content    = document.getElementById('content');
  var shell      = document.getElementById('shell');
  var navPanes   = document.getElementById('navPanes');
  var tocAside   = document.getElementById('tocAside');
  var tocPanes   = document.getElementById('tocPanes');
  var tabbar     = document.getElementById('tabbar');
  var sidebar    = document.getElementById('sidebar');
  var resizer    = document.getElementById('resizer');

  /* ---- 全局状态 ---- */
  /* 一个标签页 = 一组容器（正文 .pane / 左栏 .nav-tree / 右栏 .toc-list）+ 解析结果 + 视图状态。
     未激活的容器保持 display:none，滚动位置与折叠状态随容器留在 DOM 里。 */
  var tabs = [];                 // 按标签条顺序排列
  var activeTab = null;
  var tabSeq = 0;
  var dragTabId = null;
  var scrollRaf = 0;

  var usedIds = Object.create(null);   // 单份文档内 id 去重（每次渲染前重置）
  var uid = 0;                         // 全局递增：多标签页并存时 DOM id 不冲突
  var sections = [];                   // 以下三个是 activeTab 的快捷引用，见 setActiveTabRefs()
  var sectionById = Object.create(null);
  var childrenById = Object.create(null);

  /* ---- 通用工具 ---- */
  /** HTML 转义：拼接 HTML 字符串时对文本与属性值统一转义。 */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
        : c === '"' ? '&quot;' : '&#39;';
    });
  }

  /** 把文本中命中 keyword 的片段包进 <mark>，其余部分转义。 */
  function markHtml(text, keyword) {
    var t = String(text);
    if (!keyword) return esc(t);
    var i = t.toLowerCase().indexOf(keyword);
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + keyword.length)) + '</mark>' +
      esc(t.slice(i + keyword.length));
  }

  /** 把标题文本折成锚点 id 片段（去掉标记符号，其余非字母数字/汉字折成连字符）。 */
  function slug(text) {
    return String(text).trim().toLowerCase()
      .replace(/[`*_~\[\]()#]/g, '')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sec';
  }

  /** 在单份文档内生成不重复的章节 id（同名标题依次得到 -2、-3 …）。 */
  function uniqueId(text) {
    var base = slug(text);
    var id = base, n = 2;
    while (usedIds[id]) id = base + '-' + (n++);
    usedIds[id] = true;
    return id;
  }

  /** 当前页面滚动位置。 */
  function scrollY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }
