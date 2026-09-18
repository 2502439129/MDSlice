/* markdown.js —— Markdown 解析与渲染：行内解析、块级解析、表格（含 └ 折叠树）、Alert、容器与数学公式。
   公式在这里只做识别与标记（data-tex + $$/$ 原文），排版交给挂载后的 renderMath；
   代码高亮同样只输出 language-* 类，交给 highlightCode（两者见 03-render.js）。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 行内解析 ---- */
  var PH_CODE = '\u0000', PH_ESC = '\u0001', PH_MATH = '\u0002';   // 行内代码 / 转义字符 / 行内公式的占位符

  /** 行内公式：`$` 前后必须紧邻空白、行首行尾，或下列强调标记之一（写长标记在前，避免只吃掉一个字符）；
      内容两端不能是空白，内部不含换行与 `$`。
      收紧到这一步才能挡掉 `$5 万和 $10 万` 这类金额——第二处 `$` 前是空格，不构成闭合。
      标记能被识别为边界，是因为公式先被摘成占位符：随后强调规则看到的紧贴字符是占位符而不是空白。 */
  var INLINE_MATH = /(^|\s|\*\*|\*|__|_|==|~~)\$(?![\s$])([^\n$]*[^\s$])\$(?=[\s]|$|\*\*|\*|__|_|==|~~)/g;

  /** `[[必填]]` / `[[选填]]` / 其他文字 → 徽章。 */
  function renderBadge(text) {
    var cls = text === '必填' ? 'required' : (text === '选填' ? 'optional' : 'default');
    return '<span class="badge badge--' + cls + '">' + text + '</span>';
  }

  /** 行内解析：行内公式 → 转义 → 行内代码 → 徽章 → 图片 → 链接 → 删除线 / 强调 → 粗斜体 → 下划线强调 → 放行 <br>。
      行内公式、行内代码与转义字符先用占位符摘下，避免后续规则改到它们的内容；
      图片要排在链接之前，删除线与 == 强调排在粗斜体之前（因此可以嵌在粗体、斜体里面）。 */
  function inline(text) {
    var codes = [], escs = [], maths = [];

    // 公式必须最先摘：此刻还是原文，TeX 里的 _ * [ ] < > 才不会被转义或强调规则改掉
    text = String(text).replace(INLINE_MATH, function (_, pre, tex) {
      return pre + PH_MATH + (maths.push(tex) - 1) + PH_MATH;
    });

    var s = esc(text);

    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~>=$])/g, function (_, c) {   // \X → 字面字符
      return PH_ESC + (escs.push(c) - 1) + PH_ESC;
    });
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      // 行内代码里的公式保持原样：把先前摘走的行内公式还原成 $…$ 文本（与代码块一致，代码内不排版）
      if (maths.length) {
        c = c.replace(new RegExp(PH_MATH + '(\\d+)' + PH_MATH, 'g'), function (__, i) {
          return '$' + esc(maths[+i]) + '$';
        });
      }
      return PH_CODE + (codes.push('<code>' + c + '</code>') - 1) + PH_CODE;
    });
    s = s.replace(/\[\[([^\]]+)\]\]/g, function (_, w) { return renderBadge(w.trim()); });
    // 此处文本已过 esc()，所以 title 的引号是 &quot;；图片必须排在链接之前
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, function (_, alt, src, title) {
      return '<img src="' + src + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, function (_, text, href, title) {
      return '<a href="' + href + '"' + (title ? ' title="' + title + '"' : '') + '>' + text + '</a>';
    });
    // 定界符两侧不能是空白或同类字符（否则落单的 ~~ 会与后面另一对跨距配对）
    s = s.replace(/(^|[^~])~~(?=[^\s~])([^~]*[^\s~])~~(?=[^~]|$)/g, '$1<del>$2</del>');
    s = s.replace(/(^|[^=])==(?=[^\s=])([^=]*[^\s=])==(?=[^=]|$)/g, '$1<mark>$2</mark>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    // 下划线强调：定界符两侧不能是字母 / 数字 / 下划线，否则 data_loaders 这类标识符会被误判
    s = s.replace(/(^|[^\w])__(?=\S)([^_]*\S)__(?![\w])/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^\w])_(?=\S)([^_]*\S)_(?![\w])/g, '$1<em>$2</em>');
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');                       // 只放行 <br>，其余 HTML 保持转义
    s = s.replace(new RegExp(PH_MATH + '(\\d+)' + PH_MATH, 'g'), function (_, i) {
      var tex = esc(maths[+i]);                                        // data-tex 是原文，供 renderMath 排版
      return '<span class="math-inline" data-tex="' + tex + '">$' + tex + '$</span>';
    });
    s = s.replace(new RegExp(PH_CODE + '(\\d+)' + PH_CODE, 'g'), function (_, i) { return codes[+i]; });
    s = s.replace(new RegExp(PH_ESC + '(\\d+)' + PH_ESC, 'g'), function (_, i) { return escs[+i]; });
    return s;
  }

  /* ---- 块级解析 ---- */
  var RE = {
    h:       /^(#{1,6})\s+(.*)$/,
    fence:   /^```+\s*([\w+-]*)\s*(.*)$/,
    cont:    /^:::([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)\s*(.*)$/,
    contEnd: /^:::\s*$/,
    quote:   /^>\s?(.*)$/,
    hr:      /^(?:---|\*\*\*|___)\s*$/,
    li:      /^\s*(?:[-*+]|\d+[.)])\s+/,
    tr:      /^\s*\|(.+)\|\s*$/,
    sep:     /^\s*\|?[\s:|-]+\|[\s:|-]*$/
  };

  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var TASK_RE = /^\[([ xX])\]\s*(.*)$/;

  /** 找 `:::` 容器的闭合行（支持同名嵌套，按深度配对）；找不到时返回末行。 */
  function findContainerEnd(L, start) {
    var depth = 0;
    for (var i = start; i < L.length; i++) {
      var t = L[i].trim();
      if (RE.contEnd.test(t)) { depth--; if (depth === 0) return i; }
      else if (RE.cont.test(t)) depth++;
    }
    return L.length - 1;
  }

  /** 该行是否由块级结构开头（用于判断段落是否结束）。 */
  function isBlockLine(t) {
    return RE.h.test(t) || RE.quote.test(t) || RE.cont.test(t) || RE.contEnd.test(t) ||
           RE.fence.test(t) || RE.hr.test(t) || RE.li.test(t);
  }

  /* ---- 列表 ---- */
  /** 生成一个列表项：`[x]` / `[ ]` 开头视为任务项。 */
  function makeItem(text) {
    var tm = text.match(TASK_RE);
    if (tm) {
      return {
        task: true,
        html: '<input type="checkbox" disabled' + (tm[1].toLowerCase() === 'x' ? ' checked' : '') + '> ' + inline(tm[2])
      };
    }
    return { task: false, html: inline(text) };
  }

  /** 把同级节点渲染成 ul / ol（含任务列表类名），子级递归渲染。 */
  function renderList(nodes) {
    var html = '', i = 0;
    while (i < nodes.length) {
      var ordered = nodes[i].row.ordered;
      var group = [];
      while (i < nodes.length && nodes[i].row.ordered === ordered) group.push(nodes[i++]);

      var hasTask = group.some(function (g) { return g.row.item.task; });
      html += '<' + (ordered ? 'ol' : 'ul') + (hasTask ? ' class="tasklist"' : '') + '>';
      group.forEach(function (g) {
        var it = g.row.item;
        html += '<li' + (it.task ? ' class="task"' : '') + '>' + it.html +
                (g.children.length ? renderList(g.children) : '') + '</li>';
      });
      html += '</' + (ordered ? 'ol' : 'ul') + '>';
    }
    return html;
  }

  /** 从 L[start] 起解析一个列表，返回 {html, next}；缩进决定层级，续行并入上一项。 */
  function parseList(L, start) {
    var rows = [], i = start;

    while (i < L.length) {
      var raw = L[i];
      var m = raw.match(LIST_RE);
      if (m) {
        rows.push({
          indent: m[1].replace(/\t/g, '  ').length,
          ordered: /\d/.test(m[2]),
          item: makeItem(m[3])
        });
        i++;
        continue;
      }
      if (rows.length && raw.trim() && /^\s+\S/.test(raw) && !isBlockLine(raw.trim())) {
        rows[rows.length - 1].item.html += ' ' + inline(raw.trim());
        i++;
        continue;
      }
      break;
    }

    var root = { children: [] };                           // 缩进 → 层级（栈：弹出缩进 ≥ 当前项的位置）
    var stack = [{ indent: -1, node: root }];
    rows.forEach(function (r) {
      while (stack.length > 1 && r.indent <= stack[stack.length - 1].indent) stack.pop();
      var node = { row: r, children: [] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent: r.indent, node: node });
    });

    return { html: renderList(root.children), next: i };
  }

  /** 块级解析，返回 HTML。
      nest=true（章节正文）时把每个标题之后的内容包进 .h-body：标题不缩进、其下内容缩进一级，
      嵌套标题再开一层，由 CSS 的 padding-left 累加出层级；
      nest=false（容器内部）不嵌套，避免面板里出现多余缩进。 */
  function parseBlocks(L, nest) {
    var html = '', i = 0;
    var opens = [];                 // 已打开的 .h-body 对应的标题级别

    function closeTo(level) {
      while (opens.length && opens[opens.length - 1] >= level) {
        html += '</div>';
        opens.pop();
      }
    }

    while (i < L.length) {
      var line = L[i], t = line.trim();

      if (!t) { i++; continue; }

      var m;
      /* 标题 */
      if ((m = t.match(RE.h))) {
        var lv = m[1].length, raw = m[2].replace(/\s+#+\s*$/, '');
        var id = uniqueId(raw);
        closeTo(lv);
        html += '<h' + lv + ' id="' + id + '">' + inline(raw) +
                '<a class="anchor" href="#' + id + '">#</a></h' + lv + '>';
        if (nest) { html += '<div class="h-body">'; opens.push(lv); }
        i++; continue;
      }

      /* 围栏代码：```语言 title="标题" */
      if ((m = t.match(RE.fence))) {
        var lang = (m[1] || '').toLowerCase();
        var meta = m[2] || '';
        var tm = meta.match(/title="([^"]+)"/);
        var title = tm ? tm[1] : '';
        var buf = [];
        i++;
        while (i < L.length && !/^```+\s*$/.test(L[i].trim())) { buf.push(L[i]); i++; }
        i++;
        html += '<div class="codeblock"><div class="codeblock__bar">' +
          (lang ? '<span class="codeblock__lang">' + esc(lang) + '</span>' : '') +
          (title ? '<span class="codeblock__title">' + esc(title) + '</span>' : '') +
          '<span class="spacer"></span><button class="copy-btn">复制</button></div>' +
          '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' +
          esc(buf.join('\n')) + '</code></pre></div>';
        continue;
      }

      /* 块级公式：单行 $$…$$，或起止两行各一个 $$（中间内容原样保留） */
      if (/^\$\$/.test(t)) {
        var tex, buf = [], one = t.match(/^\$\$(.*?)\$\$\s*$/);
        if (one && one[1].trim()) {
          tex = one[1].trim();
          i++;
        } else {
          if (t.length > 2) buf.push(t.slice(2));            // 开行还有内容：$$x^2
          i++;
          while (i < L.length && !/^\$\$\s*$/.test(L[i].trim())) { buf.push(L[i]); i++; }
          if (i < L.length) i++;                             // 跳过收尾的 $$
          // 空行在数学模式里是语法错误、且对排版无意义 → 丢掉
          tex = buf.filter(function (s) { return s.trim(); }).join('\n');
        }
        if (!tex) continue;                                  // 空的 $$ 对不输出任何东西
        // 同时给出 data-tex（排版用）与 $$ 原文（库不可用时显示的就是它）
        html += '<div class="math-block" data-tex="' + esc(tex) + '">$$' + esc(tex) + '$$</div>';
        continue;
      }

      /* ::: 容器 */
      if ((m = t.match(RE.cont))) {
        var end = findContainerEnd(L, i);
        html += renderContainer(m[1], (m[2] || '').trim(), L.slice(i + 1, end));
        i = end + 1; continue;
      }

      /* 引用与 GFM Alert */
      if (RE.quote.test(t)) {
        var buf2 = [];
        while (i < L.length && RE.quote.test(L[i].trim())) {
          buf2.push(L[i].trim().replace(/^>\s?/, ''));
          i++;
        }

        var lines = buf2.slice();
        var type = null, qtitle = '';
        var am = (lines[0] || '').trim().match(/^\[!\s*([A-Za-z]+)\s*\]\s*(.*)$/);

        if (am) {
          type = ALERT[am[1].toUpperCase()] || 'info';
          var rest = am[2].trim();
          lines = rest ? [rest].concat(lines.slice(1)) : lines.slice(1);
          while (lines.length && !lines[0].trim()) lines.shift();
          var ttm = lines.length && lines[0].trim().match(/^\*\*([^*]+)\*\*$/);
          if (ttm) { qtitle = ttm[1]; lines.shift(); }
        } else {
          type = 'note';
        }

        html += calloutHtml(type, qtitle, parseBlocks(lines));
        continue;
      }

      if (RE.hr.test(t)) { html += '<hr>'; i++; continue; }

      /* 表格 */
      if (RE.tr.test(t) && i + 1 < L.length && RE.sep.test(L[i + 1])) {
        var head = splitRow(L[i]);
        var aligns = colAligns(splitRow(L[i + 1]));          // 分隔行里的冒号决定列对齐
        i += 2;
        var rows = [];
        while (i < L.length && RE.tr.test(L[i])) { rows.push(splitRow(L[i])); i++; }
        html += renderTable(head, rows, aligns);
        continue;
      }

      /* 列表 */
      if (RE.li.test(t)) {
        var r = parseList(L, i);
        html += r.html;
        i = r.next;
        continue;
      }

      /* 段落 */
      var pbuf = [];
      while (i < L.length && L[i].trim() && !isBlockLine(L[i].trim()) &&
             !(RE.tr.test(L[i]) && i + 1 < L.length && RE.sep.test(L[i + 1]))) {
        pbuf.push(L[i].trim());
        i++;
      }
      if (pbuf.length) html += '<p>' + inline(pbuf.join(' ')) + '</p>';
      else i++;
    }
    closeTo(1);                     // 收尾：关掉所有未闭合的 .h-body
    return html;
  }

  /* ---- 表格（└ 折叠树 / [[必填]] 徽章 / 单元格自动分类） ---- */
  /** 表头命中这些列名时，单元格才做自动分类。 */
  var SMART_HEADS = ['字段', '类型', '必填', '示例值', '说明', '默认值', '参数', '名称'];

  /** 按未转义的 | 拆一行表格，`\|` 还原成字面竖线。 */
  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);

    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '|') { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /** 由分隔行的单元格推断每列对齐：`:---` 左、`:---:` 居中、`---:` 右，没写冒号则不设置。 */
  function colAligns(sepRow) {
    return (sepRow || []).map(function (c) {
      var s = String(c).trim();
      var left = s.charAt(0) === ':';
      var right = s.charAt(s.length - 1) === ':';
      return left && right ? 'center' : (right ? 'right' : (left ? 'left' : ''));
    });
  }

  /** 单元格的对齐属性（该列没设对齐时返回空串）。 */
  function alignAttr(aligns, k) {
    var a = aligns && aligns[k];
    return a ? ' style="text-align:' + a + '"' : '';
  }

  var TREE_CHARS = /[└├│┌┬─]/g;                          // 首列树形前缀字符，每个计一层

  /** 拆出首列的树形前缀，返回 {level 层数, text 去掉前缀的文字}。 */
  function splitTree(raw) {
    var m = String(raw).match(/^[\s\u3000]*((?:[└├│┌┬─][\s\u3000]*)*)/);
    var prefix = m ? m[0] : '';
    return { level: (prefix.match(TREE_CHARS) || []).length, text: String(raw).slice(prefix.length) };
  }

  /** 渲染一个单元格：smart 且整格是行内代码时按列名分类（徽章 / 等宽 / 橙色字面量）。 */
  function cell(raw, label, smart) {
    var txt = raw === undefined || raw === null ? '' : String(raw);
    var codeOnly = txt.match(/^`([^`]+)`$/);
    if (!smart || !codeOnly) return inline(txt);

    var v = codeOnly[1];                                 // 纯文本：\| 已在 splitRow 还原
    if (label === '必填') return '<span class="badge badge--required">必填</span>';
    if (label === '类型') return '<span class="type">' + esc(v) + '</span>';

    if (label === '示例值' || label === '默认值') {
      return /^(\[.*\]|".*"|'.*'|true|false|null|-?\d+(\.\d+)?)$/.test(v)
        ? '<span class="ex">' + esc(v) + '</span>'
        : '<span class="field">' + esc(v) + '</span>';
    }

    return '<span class="field">' + esc(v) + '</span>';
  }

  /** 渲染表格：首列用树形前缀表达层级，带子项的父行可单独折叠（工具条可全折 / 全展）；
      列对齐由 aligns（来自分隔行的冒号）决定。 */
  function renderTable(head, rows, aligns) {
    var smart = head.some(function (h) { return SMART_HEADS.indexOf(String(h).trim()) >= 0; });

    /* 1) 解析首列层级 */
    var meta = rows.map(function (r) {
      var t = splitTree(r[0] === undefined ? '' : r[0]);
      return { level: t.level, html: cell(t.text, head[0], smart) };
    });

    /* 2) 建立父子关系 */
    var parentOf = new Array(rows.length).fill(-1);
    var stack = [];
    meta.forEach(function (m, i) {
      while (stack.length && meta[stack[stack.length - 1]].level >= m.level) stack.pop();
      parentOf[i] = stack.length ? stack[stack.length - 1] : -1;
      stack.push(i);
    });
    var childrenOf = meta.map(function () { return []; });
    parentOf.forEach(function (p, i) { if (p >= 0) childrenOf[p].push(i); });

    var hasTree = meta.some(function (m) { return m.level > 0; });

    /* 3) 组 id 与祖先链 */
    var gidOf = new Array(rows.length).fill('');
    meta.forEach(function (m, i) { if (childrenOf[i].length) gidOf[i] = 'tg' + (++uid); });

    var ancOf = rows.map(function (_, i) {
      var a = [];
      for (var p = parentOf[i]; p >= 0; p = parentOf[p]) if (gidOf[p]) a.push(gidOf[p]);
      return a.join(' ');
    });

    var descendants = function (i) {
      return childrenOf[i].reduce(function (n, c) { return n + 1 + descendants(c); }, 0);
    };

    /* 4) 渲染 */
    var h = hasTree
      ? '<div class="table-block"><div class="table-bar">' +
        '<span>共 ' + meta.filter(function (m) { return m.level > 0; }).length + ' 个嵌套字段</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" data-action="collapse">全部折叠</button>' +
        '<button type="button" data-action="expand">全部展开</button>' +
        '</div>'
      : '';

    h += '<div class="table-wrap"><table><thead><tr>';
    head.forEach(function (c, k) { h += '<th' + alignAttr(aligns, k) + '>' + inline(c) + '</th>'; });
    h += '</tr></thead><tbody>';

    rows.forEach(function (r, idx) {
      var m = meta[idx];
      var kids = childrenOf[idx];
      var gid = gidOf[idx];
      var anc = ancOf[idx];

      h += '<tr' + (gid ? ' class="row-parent" data-own="' + gid + '"' : '') +
           (anc ? ' data-anc="' + anc + '"' : '') + '>';

      for (var k = 0; k < head.length; k++) {
        if (k === 0) {
          var inner = '';
          if (kids.length) {
            inner = '<button class="tree-toggle" type="button" aria-expanded="true"' +
                    ' aria-controls="' + gid + '" data-target="' + gid + '"' +
                    ' title="折叠 / 展开 ' + descendants(idx) + ' 个子字段">' +
                    '<span class="chev">▼</span></button>';
          } else if (m.level > 0) {
            inner = '<span class="tree-mark">└</span>';
          }
          inner += m.html;
          if (kids.length) inner += '<span class="tree-count">' + descendants(idx) + '</span>';
          h += '<td class="tree" data-level="' + m.level + '" data-label="' + esc(head[0]) + '"' +
               alignAttr(aligns, 0) + '>' + inner + '</td>';
        } else {
          h += '<td data-label="' + esc(head[k]) + '"' + alignAttr(aligns, k) + '>' +
               cell(r[k], head[k], smart) + '</td>';
        }
      }
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return hasTree ? h + '</div>' : h;
  }

  /* ---- Alert 与 ::: 容器 ---- */
  var ALERT = {
    NOTE: 'note', TIP: 'tip', INFO: 'info', IMPORTANT: 'info', SUCCESS: 'tip',
    WARNING: 'warning', CAUTION: 'warning', ATTENTION: 'warning',
    DANGER: 'danger', ERROR: 'danger', FAILURE: 'danger', BUG: 'danger'
  };
  var ALERT_ICON = { tip: 'i-tip', info: 'i-info', warning: 'i-warning', danger: 'i-danger' };
  var CALLOUT = { info: 'info', note: 'note', tip: 'tip', warning: 'warning', danger: 'danger', caution: 'danger' };

  /** 组装一个 Callout：type 决定配色与图标，bodyHtml 为已渲染的 HTML。
      图标取自 MDSlice.html 的精灵（四种同为 24×24 填充风格，尺寸统一）。
      普通引用（note）不带图标，以便和带图标的四种 Alert 区分。 */
  function calloutHtml(type, title, bodyHtml) {
    var icon = type === 'note' ? '' :
      '<div class="callout__icon"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<use href="#' + (ALERT_ICON[type] || 'i-info') + '"/></svg></div>';
    return '<div class="callout callout--' + type + '">' + icon +
      '<div class="callout__body">' +
      (title ? '<p class="callout__title">' + inline(title) + '</p>' : '') +
      bodyHtml + '</div></div>';
  }

  /** 收集容器内部指定名字的子容器（tabs 的 tab、duo 的 col），返回 {title, html} 列表。 */
  function collectChildren(inner, names) {
    var out = [], i = 0;
    while (i < inner.length) {
      var m = inner[i].trim().match(RE.cont);
      if (m && names.indexOf(m[1].toLowerCase()) >= 0) {
        var end = findContainerEnd(inner, i);
        out.push({ title: m[2] || '', html: parseBlocks(inner.slice(i + 1, end)) });
        i = end + 1;
      } else i++;
    }
    return out;
  }

  /** 渲染 `:::name arg` 容器：tabs / duo / details / callout，未知名字包一层双栏列。 */
  function renderContainer(name, arg, inner) {
    var n = name.toLowerCase();

    if (n === 'tabs') {
      var panels = collectChildren(inner, ['tab', 'col']);
      if (!panels.length) return '';
      return '<div class="tabs"><div class="tabs__bar">' +
        panels.map(function (p, idx) {
          return '<button class="tabs__btn" role="tab" aria-selected="' + (idx === 0) + '">' + esc(p.title || 'Tab') + '</button>';
        }).join('') +
        '</div>' + panels.map(function (p, idx) {
          return '<div class="tabs__panel"' + (idx ? ' hidden' : '') + '>' + p.html + '</div>';
        }).join('') +
        '</div>';
    }

    if (n === 'duo' || n === 'cols' || n === 'columns') {
      var cols = collectChildren(inner, ['col', 'column']);
      return '<div class="duo">' + cols.map(function (c) {
        return '<div class="duo__col">' + (c.title ? '<div class="duo__label">' + inline(c.title) + '</div>' : '') +
               c.html + '</div>';
      }).join('') + '</div>';
    }

    if (n === 'details' || n === 'detail') {
      return '<details><summary>' + inline(arg || '展开查看') + '</summary>' + parseBlocks(inner) + '</details>';
    }

    if (CALLOUT[n]) {
      var type = ALERT[n.toUpperCase()] || CALLOUT[n];
      return calloutHtml(type, arg, parseBlocks(inner));
    }

    return '<div class="duo__col">' + parseBlocks(inner) + '</div>';
  }
