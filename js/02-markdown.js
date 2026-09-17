/* markdown.js —— Markdown 解析与渲染：行内解析、块级解析、表格（含 └ 折叠树）、Alert 容器。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* =========================================================
     2. 行内解析
     ========================================================= */
  var PH_CODE = '\u0000', PH_ESC = '\u0001';

  function badge(text) {
    var cls = text === '必填' ? 'required' : (text === '选填' ? 'optional' : 'default');
    return '<span class="badge badge--' + cls + '">' + text + '</span>';
  }

  function inline(text) {
    var codes = [], escs = [];
    var s = esc(text);

    // 反斜杠转义：\X 原样输出（表格里的 \| 等），先摘出来占位
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, function (_, c) {
      return PH_ESC + (escs.push(c) - 1) + PH_ESC;
    });
    // 行内代码
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      return PH_CODE + (codes.push('<code>' + c + '</code>') - 1) + PH_CODE;
    });
    // 徽章 [[必填]] / [[选填]]
    s = s.replace(/\[\[([^\]]+)\]\]/g, function (_, w) { return badge(w.trim()); });
    // 链接
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // 粗体 / 斜体
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    // 只放行 <br>，其余 HTML 保持转义状态
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    // 还原占位
    s = s.replace(new RegExp(PH_CODE + '(\\d+)' + PH_CODE, 'g'), function (_, i) { return codes[+i]; });
    s = s.replace(new RegExp(PH_ESC + '(\\d+)' + PH_ESC, 'g'), function (_, i) { return escs[+i]; });
    return s;
  }

  /* =========================================================
     3. 块级解析（代码高亮交给 highlight.js，见 MDSlice.html）
     ========================================================= */
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

  function findContainerEnd(L, start) {
    var depth = 0;
    for (var i = start; i < L.length; i++) {
      var t = L[i].trim();
      if (RE.contEnd.test(t)) { depth--; if (depth === 0) return i; }
      else if (RE.cont.test(t)) depth++;
    }
    return L.length - 1;
  }

  function isBlockLine(t) {
    return RE.h.test(t) || RE.quote.test(t) || RE.cont.test(t) || RE.contEnd.test(t) ||
           RE.fence.test(t) || RE.hr.test(t) || RE.li.test(t);
  }

  /* ---- 列表（支持嵌套与任务列表） ---- */
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

  /** 从 L[start] 起解析一个列表，返回 {html, next} */
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
      // 续行：缩进、非空、且不是新块 → 并入上一项
      if (rows.length && raw.trim() && /^\s+\S/.test(raw) && !isBlockLine(raw.trim())) {
        rows[rows.length - 1].item.html += ' ' + inline(raw.trim());
        i++;
        continue;
      }
      break;
    }

    // 缩进 → 层级（栈：弹出缩进 >= 当前项的位置）
    var root = { children: [] };
    var stack = [{ indent: -1, node: root }];
    rows.forEach(function (r) {
      while (stack.length > 1 && r.indent <= stack[stack.length - 1].indent) stack.pop();
      var node = { row: r, children: [] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent: r.indent, node: node });
    });

    return { html: renderList(root.children), next: i };
  }

  /**
   * 块级解析。
   * nest = true（章节正文）时，把每个标题之后的内容包进 .h-body：
   * 标题本身不缩进、其下内容缩进一级，嵌套标题再开一层，由 CSS 的
   * padding-left 累加出层级。容器内部（tabs / callout / details）不嵌套，
   * 避免面板里再出现多余缩进。
   */
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

      /* 围栏代码（```js title="..."） */
      if ((m = t.match(RE.fence))) {
        var lang = (m[1] || '').toLowerCase();
        var meta = m[2] || '';
        var tm = meta.match(/title="([^"]+)"/);
        var title = tm ? tm[1] : '';
        var buf = [];
        i++;
        while (i < L.length && !/^```+\s*$/.test(L[i].trim())) { buf.push(L[i]); i++; }
        i++;
        // 只输出纯文本 + language-* 类，具体高亮由 highlight.js 在挂载后处理
        html += '<div class="codeblock"><div class="codeblock__bar">' +
          (lang ? '<span class="codeblock__lang">' + esc(lang) + '</span>' : '') +
          (title ? '<span class="codeblock__title">' + esc(title) + '</span>' : '') +
          '<span class="spacer"></span><button class="copy-btn">复制</button></div>' +
          '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' +
          esc(buf.join('\n')) + '</code></pre></div>';
        continue;
      }

      /* ::: 容器 */
      if ((m = t.match(RE.cont))) {
        var end = findContainerEnd(L, i);
        html += renderContainer(m[1], (m[2] || '').trim(), L.slice(i + 1, end));
        i = end + 1; continue;
      }

      /* 引用 / GFM Alert */
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

        // 普通引用（note）不带图标，用来和带图标的三种 Alert 区分
        var icon = type === 'note' ? '' :
          '<div class="callout__icon">' + (ALERT_ICON[type] || 'i') + '</div>';

        html += '<div class="callout callout--' + type + '">' + icon +
          '<div class="callout__body">' +
          (qtitle ? '<p class="callout__title">' + inline(qtitle) + '</p>' : '') +
          parseBlocks(lines) + '</div></div>';
        continue;
      }

      if (RE.hr.test(t)) { html += '<hr>'; i++; continue; }

      /* 表格 */
      if (RE.tr.test(t) && i + 1 < L.length && RE.sep.test(L[i + 1])) {
        var head = splitRow(L[i]);
        i += 2;
        var rows = [];
        while (i < L.length && RE.tr.test(L[i])) { rows.push(splitRow(L[i])); i++; }
        html += renderTable(head, rows);
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

  /* =========================================================
     5. 表格（含 └ 折叠树 / [[必填]] 徽章 / 单元格自动分类）
     ========================================================= */
  /** 只有表头命中已知列名时才启用单元格自动分类，避免误伤普通表格 */
  var SMART_HEADS = ['字段', '类型', '必填', '示例值', '说明', '默认值', '参数', '名称'];

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);

    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      // 表格里的 \| 由表格层还原成字面竖线（与 GitHub 的表格行为一致）
      if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '|') { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /* 首列树形前缀：└ ├ │ ┌ ┬ ─ 每个计一层，用于表达嵌套与折叠 */
  var TREE_CHARS = /[└├│┌┬─]/g;

  function splitTree(raw) {
    var m = String(raw).match(/^[\s\u3000]*((?:[└├│┌┬─][\s\u3000]*)*)/);
    var prefix = m ? m[0] : '';
    return { level: (prefix.match(TREE_CHARS) || []).length, text: String(raw).slice(prefix.length) };
  }

  function cell(raw, label, smart) {
    var txt = raw === undefined || raw === null ? '' : String(raw);
    var codeOnly = txt.match(/^`([^`]+)`$/);
    if (!smart || !codeOnly) return inline(txt);

    // 这里直接输出纯文本、不经过 inline()；\| 已在 splitRow 还原，其余反斜杠按字面保留
    var v = codeOnly[1];
    if (label === '必填') return '<span class="badge badge--required">必填</span>';
    if (label === '类型') return '<span class="type">' + esc(v) + '</span>';

    // 橙色「字面量」样式只给 示例值 / 默认值 两列，避免误染其他列
    if (label === '示例值' || label === '默认值') {
      return /^(\[.*\]|".*"|'.*'|true|false|null|-?\d+(\.\d+)?)$/.test(v)
        ? '<span class="ex">' + esc(v) + '</span>'
        : '<span class="field">' + esc(v) + '</span>';
    }

    return '<span class="field">' + esc(v) + '</span>';
  }

  function renderTable(head, rows) {
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
    head.forEach(function (c) { h += '<th>' + inline(c) + '</th>'; });
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
          h += '<td class="tree" data-level="' + m.level + '" data-label="' + esc(head[0]) + '">' + inner + '</td>';
        } else {
          h += '<td data-label="' + esc(head[k]) + '">' + cell(r[k], head[k], smart) + '</td>';
        }
      }
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return hasTree ? h + '</div>' : h;
  }

  /* =========================================================
     6. Alert / 容器
     ========================================================= */
  var ALERT = {
    NOTE: 'note', TIP: 'tip', INFO: 'info', IMPORTANT: 'info', SUCCESS: 'tip',
    WARNING: 'warning', CAUTION: 'warning', ATTENTION: 'warning',
    DANGER: 'danger', ERROR: 'danger', FAILURE: 'danger', BUG: 'danger'
  };
  var ALERT_ICON = { note: 'i', tip: '★', info: 'i', warning: '!', danger: '✕' };
  var CALLOUT = { info: 'info', note: 'note', tip: 'tip', warning: 'warning', danger: 'danger', caution: 'danger' };

  function renderContainer(name, arg, inner) {
    var n = name.toLowerCase();

    /* tabs */
    if (n === 'tabs') {
      var panels = [], i = 0;
      while (i < inner.length) {
        var t = inner[i].trim();
        var m = t.match(RE.cont);
        if (m && (m[1].toLowerCase() === 'tab' || m[1].toLowerCase() === 'col')) {
          var end = findContainerEnd(inner, i);
          panels.push({ title: m[2] || 'Tab', html: parseBlocks(inner.slice(i + 1, end)) });
          i = end + 1;
        } else i++;
      }
      if (!panels.length) return '';
      return '<div class="tabs"><div class="tabs__bar">' +
        panels.map(function (p, idx) {
          return '<button class="tabs__btn" role="tab" aria-selected="' + (idx === 0) + '">' + esc(p.title) + '</button>';
        }).join('') +
        '</div>' + panels.map(function (p, idx) {
          return '<div class="tabs__panel"' + (idx ? ' hidden' : '') + '>' + p.html + '</div>';
        }).join('') +
        '</div>';
    }

    /* duo / cols 双栏 */
    if (n === 'duo' || n === 'cols' || n === 'columns') {
      var cols = [], j = 0;
      while (j < inner.length) {
        var t2 = inner[j].trim();
        var m2 = t2.match(RE.cont);
        if (m2 && (m2[1].toLowerCase() === 'col' || m2[1].toLowerCase() === 'column')) {
          var end2 = findContainerEnd(inner, j);
          cols.push({ title: m2[2] || '', html: parseBlocks(inner.slice(j + 1, end2)) });
          j = end2 + 1;
        } else j++;
      }
      return '<div class="duo">' + cols.map(function (c) {
        return '<div class="duo__col">' + (c.title ? '<div class="duo__label">' + inline(c.title) + '</div>' : '') +
               c.html + '</div>';
      }).join('') + '</div>';
    }

    /* details / detail */
    if (n === 'details' || n === 'detail') {
      return '<details><summary>' + inline(arg || '展开查看') + '</summary>' + parseBlocks(inner) + '</details>';
    }

    /* callout */
    if (CALLOUT[n]) {
      var type = ALERT[n.toUpperCase()] || CALLOUT[n];
      return '<div class="callout callout--' + type + '"><div class="callout__icon">' +
             (ALERT_ICON[type] || 'i') + '</div><div class="callout__body">' +
             (arg ? '<p class="callout__title">' + inline(arg) + '</p>' : '') +
             parseBlocks(inner) + '</div></div>';
    }

    /* 未知容器：包一层 */
    return '<div class="duo__col">' + parseBlocks(inner) + '</div>';
  }
