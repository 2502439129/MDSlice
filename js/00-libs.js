/* libs.js —— 外部库加载：多源竞速（谁先到用谁），到达后补一次增强。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */

/* 为什么独立成模块、且排在最前：
   它不依赖其它模块，而 05-shell.js 会**同步**取两个高亮主题元素 —— 那两个 <link> 留在
   MDSlice.html 里，这里只负责后来填 href（元素存在即可，改 href 照样生效）。

   为什么竞速：同一份 MathJax 实测差异极大（elemecdn 0.4s / unpkg 2.8s / staticfile 4.4s），
   而 jsdelivr 在部分网络下完全不通。竞速让**每种网络各自选中最快的源**，任一家挂掉也不影响。

   为什么错峰而非一齐发：候选按 500ms 间隔依次补发，通常第一源就命中 —— 既不重复下载
   1MB 级的 MathJax，也避免两个源同时执行同一个库（MathJax 重复执行会重新初始化）。 */
'use strict';

/* 每个资源的候选源（按实测速度排，不表示优先级 —— 最终由响应速度决定）。
   highlight.js 11.9.0 的浏览器构建约 119KB；MathJax 的 tex-chtml.js 约 1.1MB。
   注意 MathJax 的数学字体由它自己按所在路径取 output/chtml/fonts/woff-v2/，
   所以字体来源 = 胜出的那个源，候选表里各源都得是完整包（上面三个都是）。 */
var LIB_SOURCES = {
  hljs: [
    'https://cdn.staticfile.org/highlight.js/11.9.0/highlight.min.js',
    'https://unpkg.com/@highlightjs/cdn-assets@11.9.0/highlight.min.js',
    'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js'
  ],
  mathjax: [
    'https://npm.elemecdn.com/mathjax@3.2.2/es5/tex-chtml.js',
    'https://unpkg.com/mathjax@3.2.2/es5/tex-chtml.js',
    'https://cdn.staticfile.org/mathjax/3.2.2/es5/tex-chtml.js'
  ]
};

/* 代码高亮的两套主题：元素与 id 由 MDSlice.html 提供（05-shell.js 按当前主题改写它们的 media） */
var LIB_STYLES = {
  'hljs-theme-light': [
    'https://cdn.staticfile.org/highlight.js/11.9.0/styles/github.min.css',
    'https://unpkg.com/@highlightjs/cdn-assets@11.9.0/styles/github.min.css',
    'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github.min.css'
  ],
  'hljs-theme-dark': [
    'https://cdn.staticfile.org/highlight.js/11.9.0/styles/github-dark.min.css',
    'https://unpkg.com/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css',
    'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css'
  ]
};

var LIB_RACE_STEP = 500;      // 补发下一个候选的间隔：够第一源命中，又不让兜底等太久

/** 错峰竞速加载一个脚本：先发第一个候选，LIB_RACE_STEP 内没有结果就补发下一个；
    某个候选报错则立刻换下一个；第一个 onload 的胜出，此后不再补发。
    全部失败时什么都不做 —— 页面保持"库未就绪"的降级（代码不着色、公式显示 $…$ 原文）。 */
function loadRace(urls, onReady) {
  var i = 0, done = false, timer = 0, pendings = [];    // 已发出、还没定胜负的候选元素

  /** 撤掉全部候选（赢家已定）：未下载完的会被浏览器中断。
      必须用数组记住每一个 —— 错峰补发时会有多个候选同时在飞，只记最后一个的话，
      先到的赢了、后发的那个仍会下载完并**执行第二次**（MathJax 重复执行会重新初始化）。 */
  function dropAll() {
    clearTimeout(timer);
    pendings.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    pendings = [];
  }

  function attempt() {
    if (done || i >= urls.length) return;
    var el = document.createElement('script');
    el.async = true;
    el.src = urls[i++];
    el.onload = function () {
      if (done) return;
      done = true;
      dropAll();                                       // 赢家已执行，其余候选撤掉（含自己，无害）
      onReady();
    };
    el.onerror = function () {
      if (done) return;
      if (el.parentNode) el.parentNode.removeChild(el); // 失败的自己撤掉，再换下一个
      attempt();
    };
    pendings.push(el);
    document.head.appendChild(el);
    timer = setTimeout(function () { if (!done) attempt(); }, LIB_RACE_STEP);
  }
  attempt();
}

/** 样式竞速：用 fetch 探出最快的源，再把地址交给 <link>（media 已由 05-shell.js 按主题写成
    all / not all，填上 href 就会加载）。
    为什么不用 `<link>` 的 onload 探测：media 不匹配时浏览器**根本不发起加载**，事件永远不来；
    而 fetch 的 promise 语义明确，某个源不可达也能立刻排除。候选里可达的三家（staticfile /
    unpkg / elemecdn）都回了 `Access-Control-Allow-Origin: *`，读文本没有跨域问题。 */
function loadRaceStyle(el, urls) {
  var ctrls = [];
  var tries = urls.map(function (url, k) {
    var c = new AbortController();
    ctrls.push(c);
    return fetch(url, { signal: c.signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function () {
      ctrls.forEach(function (o, j) { if (j !== k) o.abort(); });      // 赢家已定，撤掉其余
      return url;
    });
  });
  Promise.any(tries).then(function (url) {
    el.href = url;
  }).catch(function () { /* 全部失败：保持"代码不着色"的降级 */ });
}

/* 就绪后补一次增强：首屏不再等库，代价是"库到之前那段内容"的代码高亮与公式会稍后补上。
   highlightCode / renderMath 定义在 03-render.js；库的 onload 必然晚于所有同步脚本，
   那时它们已经就位（typeof 检查只是为了容忍将来有人改加载顺序）。 */
loadRace(LIB_SOURCES.hljs, function () {
  if (typeof highlightCode === 'function') highlightCode(document);
});
loadRace(LIB_SOURCES.mathjax, function () {
  if (typeof renderMath === 'function') renderMath(document);
});
Object.keys(LIB_STYLES).forEach(function (id) {
  var el = document.getElementById(id);
  if (el) loadRaceStyle(el, LIB_STYLES[id]);
});
