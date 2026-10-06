/* preview.js —— 正文链接的悬浮预览：停在同源的 md / txt 链接上时，浮层里显示目标文件对应章节的内容。
   只对「从服务器打开」的文档生效（有 sourceUrl 才有可读取的地址），file:// 与跨源链接不参与；
   判定条件直接复用文档间链接那一套（见 03-render.js 的 docLinkTarget），不另写一份。
   两个要点：
   1) 解析目标文件时先把全局的 id 去重状态与递增号存起来、用完还原 —— 预览的渲染会消耗 uniqueId，
      不隔离就会把主文档的 id 序号顶掉（同一标题在预览后变成 xx-2），片段也随之查不到；
   2) 插进浮层前去掉产物里的 id 与标题锚点 —— 浮层里若留着 id，主文档就出现重复 id，
      页内锚点查找与浏览器的 #片段 导航都可能落到浮层里的那个副本上。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 常量与状态 ---- */
  var PV_DELAY = 220;                    // 停多久才去取内容：掠过一排链接时不触发
  var PV_GRACE = 160;                    // 从链接移向浮层的途中的宽限，避免刚移出就关掉
  var PV_MIN_H = 140;                    // 浮层被视口压矮时的下限（再矮就不值得显示了）

  var pvEl = null;                       // 单例浮层（与底部轻提示同一套路：全局只留一个元素）
  var pvTimer = 0;
  var pvToken = 0;                       // 递增令牌：丢弃「已经移开才回来」的结果
  var pvLink = null;                     // 当前浮层对应的链接（点头部即点它）
  var pvPending = null;                  // 正在等待弹出的链接
  var pvPageY = 0;                       // 浮层出现时的页面滚动位置（滚动监听据此判断有没有真的滚）
  var pvCache = Object.create(null);     // 身份键 → { sections, subs }

  /* ---- 解析目标文件：全部复用真实解析器，不另写一套规则 ---- */
  /** 在一个章节的正文行里扫出页内小节（H4~H6）。id 用与渲染同序的 uniqueId 算，
      所以结果与真实渲染出来的 id 一致；围栏代码里的 # 不算标题，这一点同 parseBlocks。 */
  function pvScanSubs(lines, sectionId, out) {
    var inFence = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (RE.fence.test(t)) { inFence = !inFence; continue; }
      if (inFence) continue;
      var m = t.match(RE.h);
      if (!m || m[1].length < 4) continue;
      var title = m[2].replace(/\s+#+\s*$/, '');
      out.push({ id: uniqueId(title), level: m[1].length, title: title,
                 sectionId: sectionId, start: i });
    }
  }

  /** 小节的结束行：下一个同级或更高级的标题（章节内部最高 H4，所以到章末也是常态）。 */
  function pvSubEnd(lines, start, level) {
    var inFence = false;
    for (var i = start + 1; i < lines.length; i++) {
      var t = lines[i].trim();
      if (RE.fence.test(t)) { inFence = !inFence; continue; }
      if (inFence) continue;
      var m = t.match(RE.h);
      if (m && m[1].length <= level) return i;
    }
    return lines.length;
  }

  /** 解析一份文档：切章（含元数据）+ 扫出页内小节。全程在临时的 id 作用域里做，结束即还原。 */
  function pvBuildIndex(text) {
    var savedIds = usedIds, savedUid = uid;
    usedIds = Object.create(null);
    try {
      var sections = splitSections(text);
      var subs = [];
      sections.forEach(function (sec) { pvScanSubs(sec.lines, sec.id, subs); });
      return { sections: sections, subs: subs };
    } finally {
      usedIds = savedIds;
      uid = savedUid;
    }
  }

  /** 取目标文档的解析结果：已开着的标签页用现成文本（省一次请求），其次命中缓存，最后才 fetch。
      缓存键就是文档的身份键，与首页树 / 标签页同一套算法，所以同一文件不会存两份；
      双击标签页刷新会重读该文件，这里优先取标签页的文本，缓存自然跟着更新。 */
  function pvIndex(doc) {
    var tab = openTabByKey(doc.key);
    if (tab && typeof tab.src === 'string') return Promise.resolve(pvBuildIndex(tab.src));
    if (pvCache[doc.key]) return Promise.resolve(pvCache[doc.key]);
    if (!doc.url) return Promise.reject(new Error('没有可读取的地址'));
    return fetch(doc.url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var idx = pvBuildIndex(text);
      pvCache[doc.key] = idx;
      return idx;
    });
  }

  /** 章节块的作用范围终点（不含）：章节表是前序排列的，紧随其后的**级别更深**的连续块就是它的后代
      —— 与 buildTree 按级别回溯认父的结果一致（见 03-render.js），所以「本节 + 这段」正好等于
      正文里点这一章会亮起的那些块（showSection 连后代一起激活）。
      只用于章节；页内小节的终点另有 pvSubEnd（H4 起不再切章，规则不同）。 */
  function pvBlockEnd(sections, at) {
    var lv = sections[at].level, j = at + 1;
    while (j < sections.length && sections[j].level > lv) j++;
    return j;
  }

  /** 片段 → 预览单元：先按章节 id 匹配（与打开文件后的定位同一套四级降级），
      不中再按页内小节的 id 匹配。sec 始终是所属章节（小节单元要用它的 lines），
      blocks 只有章节单元才有。两种单元的内容范围不同：
      - 命中页内小节（sub 非空）：只预览该小节，到下一个同级或更高级标题为止；
      - 命中章节（sub 为 null）：预览 blocks = 该章节**连同全部后代章节块** —— 与正文里点这一章
        看到的范围一致。只渲染本节是不够的：内容全写在子标题里的章节（H1 全由 H2 组成、
        H2 全由 H3 组成）会预览出一个「只有标题、正文区空空」的盒子。 */
  function pvUnitOf(idx, fragment) {
    if (!fragment) return null;
    var i;
    var secId = findSectionIdIn(idx.sections, fragment);
    if (secId) {
      for (i = 0; i < idx.sections.length; i++) {
        if (idx.sections[i].id === secId) {
          return { sec: idx.sections[i], sub: null,
                   blocks: idx.sections.slice(i, pvBlockEnd(idx.sections, i)),
                   title: idx.sections[i].title, level: idx.sections[i].level };
        }
      }
    }
    var subId = findSectionIdIn(idx.subs, fragment);
    if (!subId) return null;
    var sub = null, sec = null;
    for (i = 0; i < idx.subs.length; i++) if (idx.subs[i].id === subId) sub = idx.subs[i];
    for (i = 0; i < idx.sections.length; i++) if (idx.sections[i].id === sub.sectionId) sec = idx.sections[i];
    if (!sec) return null;
    return { sec: sec, sub: sub, title: sub.title, level: sub.level };
  }

  /** 预览单元 → HTML：章节按 blocks 逐个 renderSection（本节 + 全部后代块，与正文同样的块序列），
      页内小节用它的行区间走 parseBlocks；两边都在临时 id 作用域里渲染，产物最后统一去掉 id 与标题锚点。
      blocks 里的每个块都会走一遍 renderSection，于是产出的 id 更多——临时作用域与 pvClean
      这两道隔离在这里更要紧（见文件头两条要点）。 */
  function pvRender(unit) {
    var savedIds = usedIds, savedUid = uid;
    usedIds = Object.create(null);
    var html;
    try {
      if (unit.sub) {
        var end = pvSubEnd(unit.sec.lines, unit.sub.start, unit.sub.level);
        html = parseBlocks(unit.sec.lines.slice(unit.sub.start, end), true);
      } else {
        html = unit.blocks.map(function (sec) { return renderSection(sec, false); }).join('');
      }
    } finally {
      usedIds = savedIds;
      uid = savedUid;
    }
    return pvClean(html);
  }

  /** 去掉 id 与标题锚点：浮层里不需要锚点，留着会与主文档撞 id（见文件头说明）。 */
  function pvClean(html) {
    return html.replace(/\s+id="[^"]*"/g, '')
               .replace(/<a class="anchor"[^>]*>#<\/a>/g, '');
  }

  /** 不带片段（或片段认不出来）时的摘要：章节名列表，按层级缩进；超出部分由浮层的滚动承载。 */
  function pvSummaryHTML(idx) {
    if (!idx.sections.length) return '<p class="preview__empty">这份文档没有可显示的章节。</p>';
    return '<div class="preview__outline">' + idx.sections.map(function (s) {
      return '<div class="preview__row lv' + Math.min(s.level, 3) + '">' + esc(s.title) + '</div>';
    }).join('') + '</div>';
  }

  /* ---- 浮层 ---- */
  /** 建浮层（单例）：悬停其上不关、点头部即打开这一篇、移出即准备关闭。
      正文区可滚动：滚动事件不冒泡，所以用捕获阶段的监听同步滚动状态。 */
  function pvEnsure() {
    if (pvEl) return pvEl;
    pvEl = document.createElement('div');
    pvEl.className = 'preview';
    pvEl.setAttribute('role', 'tooltip');
    pvEl.addEventListener('mouseenter', function () { clearTimeout(pvTimer); });
    pvEl.addEventListener('mouseleave', pvScheduleHide);
    pvEl.addEventListener('scroll', pvSyncScroll, true);
    pvEl.addEventListener('click', function (e) {
      e.preventDefault();                // 浮层在正文容器之外：不拦默认行为，正文里的链接会把整页导航走
      var head = e.target.closest ? e.target.closest('.preview__head') : null;
      if (!head) {
        // 正文区里的控件（标签页 / 折叠树）会改变内容高度：等控件自己的处理跑完再重算渐隐状态，
        // 否则会出现「已经到底了还压着渐隐」或「下面明明还有内容却不渐隐」。
        setTimeout(pvSyncScroll, 0);
        return;
      }
      if (pvLink) pvLink.click();        // 走链接自己的点击流程：打开、并定位到片段
      pvHide();
    });
    document.body.appendChild(pvEl);
    return pvEl;
  }

  /** 取内容 → 填进浮层。请求回来时若已经移开（令牌变了）就丢弃。 */
  function pvOpen(link, doc, fragment) {
    var token = ++pvToken;
    pvIndex(doc).then(function (idx) {
      if (token !== pvToken) return;
      var unit = pvUnitOf(idx, fragment);
      pvFill(link, {
        file: doc.name,
        title: unit ? unit.title : '章节摘要',
        kind: unit ? (unit.sub ? 'H' + unit.sub.level + ' 小节' : 'H' + unit.level + ' 章节') : '整篇目录',
        html: unit ? pvRender(unit) : pvSummaryHTML(idx)
      });
    }).catch(function () {
      if (token === pvToken) pvHide();   // 读不到（404 / 跨目录）：静默不展示
    });
  }

  /** 填内容并摆位置：先在视口外量尺寸（免得在错的位置闪一下），再贴到链接附近。 */
  function pvFill(link, data) {
    var el = pvEnsure();
    pvLink = link;
    pvPending = null;
    el.innerHTML =
      '<div class="preview__head">' +
        '<span class="preview__file">' + esc(data.file) + '</span>' +
        '<span class="preview__title">' + esc(data.title) + '</span>' +
        '<span class="preview__kind">' + esc(data.kind) + '</span>' +
      '</div>' +
      '<div class="preview__body">' + data.html + '</div>';
    // 预览里的标签页 / 复制按钮 / 折叠树都要绑上，否则是「看得见点不动」的死控件。
    // 两个绑定函数本来就按作用域取参数，传浮层即可；浮层在正文容器之外，与正文里的同名控件互不干扰
    // （每次填充都是新节点，旧的监听随 innerHTML 一起丢掉，不会堆积）。
    bindTabs(el);
    bindTree(el);
    el.style.left = '-9999px';
    el.style.top = '0';
    el.classList.add('is-on');
    pvPageY = scrollY();                 // 记下此刻的页面位置：滚动监听据此判断"是不是真的滚了"
    pvPlace(link);
    pvSyncScroll();
  }

  /** 摆位：优先在链接下方；下方放不下就翻到上方；上下都放不下整块时，把浮层压到较富余那一侧的
      高度 —— 宁可少显示一点，也不要把链接本身盖住（视口很矮时这一条尤其明显）。左右再夹回视口内。 */
  function pvPlace(link) {
    var r = link.getBoundingClientRect();
    var gap = 10, m = 12;
    pvEl.style.maxHeight = '';                                  // 先按内容量一次自然高度
    var natural = pvEl.offsetHeight;
    var below = window.innerHeight - r.bottom - gap - m;
    var above = r.top - gap - m;
    var down = natural <= below || (natural > above && below >= above);

    var avail = down ? below : above;
    var h = natural;
    if (h > avail) {                                            // 这一侧放不下：压到能放下的高度
      h = Math.max(PV_MIN_H, avail);
      pvEl.style.maxHeight = Math.round(h) + 'px';
      h = pvEl.offsetHeight;
    }

    var top = down ? r.bottom + gap : r.top - h - gap;
    top = Math.max(m, Math.min(top, window.innerHeight - h - m));
    var w = pvEl.offsetWidth;
    var left = Math.min(Math.max(m, r.left), Math.max(m, window.innerWidth - w - m));
    pvEl.style.left = Math.round(left) + 'px';
    pvEl.style.top = Math.round(top) + 'px';
  }

  /** 同步正文区的滚动状态：下面还有内容就压一层底部渐隐，已经滚上去了再压一层顶部渐隐
      —— 光靠系统滚动条，浮层里「还能看多少」并不明显。
      调用点有三处：填充后、正文区滚动时（捕获监听）、以及浮层内点击之后（控件会改变内容高度）。 */
  function pvSyncScroll() {
    var body = pvEl.querySelector('.preview__body');
    if (!body) return;
    var left = body.scrollHeight - body.clientHeight - Math.round(body.scrollTop);
    pvEl.classList.toggle('is-more', left > 4);       // 4px 容差：滚动位置可能是亚像素
    pvEl.classList.toggle('is-scrolled', body.scrollTop > 4);
  }

  /** 收起浮层，并让在途的请求作废。 */
  function pvHide() {
    pvToken++;
    pvPending = null;
    clearTimeout(pvTimer);
    pvTimer = 0;
    if (pvEl) {
      pvEl.classList.remove('is-on', 'is-more', 'is-scrolled');
      pvEl.innerHTML = '';
    }
    pvLink = null;
  }

  /** 延迟收起：留出从链接移到浮层上的时间。 */
  function pvScheduleHide() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(pvHide, PV_GRACE);
  }

  /* ---- 悬停：只认从服务器打开的文档里的 md / txt 链接 ---- */
  content.addEventListener('mouseover', function (e) {
    if (!activeTab || !activeTab.sourceUrl) return;        // 仅服务器来源：file:// 没有可读取的地址
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link || !activeTab.dom.pane.contains(link)) return;
    if (link === pvLink || link === pvPending) return;     // 已经在这条链接上（或在等它）：不动

    var href = link.getAttribute('href') || '';
    var info = href.charAt(0) === '#' ? null : docLinkTarget(href);   // 与点击同一套判定
    if (!info || info.blocked) { pvHide(); return; }       // 页内锚点 / 外链 / 跨源 / 其他后缀：不预览

    pvHide();                                              // 换链接：先收起旧的，免得旧内容停在新链接上
    pvPending = link;
    pvTimer = setTimeout(function () {
      pvTimer = 0;
      if (pvPending !== link || !link.isConnected) return;
      pvOpen(link, info.doc, info.fragment);
    }, PV_DELAY);
  });

  content.addEventListener('mouseout', function (e) {
    if (!pvEl || !pvEl.classList.contains('is-on')) return;
    var to = e.relatedTarget;
    if (to && (pvEl.contains(to) || (pvLink && pvLink.contains(to)))) return;
    pvScheduleHide();
  });

  /* ---- 其余关闭时机：滚动、改窗口大小、点别处 ---- */
  window.addEventListener('scroll', function () {
    if (!pvEl || !pvEl.classList.contains('is-on')) return;
    if (scrollY() === pvPageY) return;     // 位置没变（迟到的滚动事件、滚动锚定微调）：别无故收起
    pvHide();
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (pvEl && pvEl.classList.contains('is-on')) pvHide();
  });
  document.addEventListener('click', function (e) {
    if (pvEl && pvEl.classList.contains('is-on') && !pvEl.contains(e.target)) pvHide();
  }, true);
