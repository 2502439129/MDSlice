/* settings.js —— 「忽略与显示规则」抽屉浮层：顶栏齿轮打开，右侧滑出。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。

   三条数据线各有唯一出处，这里只负责"显示 + 改副本"：
     1. 两档配置 → js/00-config.js（configScopeCfg / configInnerIgnore / configBuiltinCfg / configProjectPath）
     2. 目录清单 → 「扫一层目录」（js/06-dirs.js 的 scanServerRoot），异步；扫的是首页那张服务器来源的卡片
     3. 保存     → POST /__mdslice/api/config，由 bin/mdslice.js 写回 mdslice-config.json
   能保存到什么程度按打开方式分三档（见 SETTINGS_MODE）：命令行写文件、静态服务器只能复制 JSON、
   file:// 连配置都读不到 —— 那种模式下整个面板只作展示（控件一律禁用），免得改了却留不下。 */
'use strict';

  /** 打开方式：命令行能写回文件；静态服务器只能复制；file:// 连配置都读不到。 */
  var SETTINGS_MODE = (window.MDSLICE && typeof window.MDSLICE.configText === 'string') ? 'cli'
    : (location.protocol === 'file:' ? 'file' : 'static');
  var SETTINGS_API = '/__mdslice/api/config';            // 写回接口（只有本地服务提供）

  /** 两个作用域：cfg 是打开面板时读来的可编辑副本，saved 是"打开时的样子"（判断有无未保存改动）。 */
  var settingsScopes = {
    project: { label: '本项目', cfg: null, saved: '' },
    'default': { label: '全局默认', cfg: null, saved: '' }
  };
  var settingsScope = SETTINGS_MODE === 'cli' ? 'project' : 'default';   // 非命令行模式没有"本项目"可言
  var settingsSaving = false;

  /** file:// 下改不动：读不到配置文件、也存不下去，控件一律禁用（面板只作展示）。 */
  function settingsReadonly() { return SETTINGS_MODE === 'file'; }

  /* ---- 「扫一层目录」：打开面板时扫一次，结果只用于展示 ---- */
  var settingsScan = { state: 'idle', dirs: [], reason: '' };

  /** 首页里"服务器来源"的那张卡片（面板扫的就是它）；本地来源 / file:// 下没有。 */
  function settingsServerRoot() {
    for (var i = 0; i < homeDirs.length; i++) {
      if (homeDirs[i].source === 'server') return homeDirs[i];
    }
    return null;
  }
  /** 重新扫一遍：打开面板时、保存成功后各一次（异步，先渲染"正在扫…"）。 */
  function settingsScanStart() {
    var root = settingsServerRoot();
    if (!root) {
      settingsScan = { state: 'fail', dirs: [], reason:
        '当前来源不是服务器目录，扫不出这一层有什么 —— 本地文件夹的树是选进来时一次走完的。' +
        '规则改动仍然生效，重新选一次目录即可看到结果。' };
      return;
    }
    settingsScan = { state: 'loading', dirs: [], reason: '' };
    scanServerRoot(root.url).then(function (res) {
      settingsScan = res.error
        ? { state: 'fail', dirs: [], reason: res.error }
        : { state: 'ready', dirs: res.dirs, reason: '' };
      renderSettings();
    });
  }

  /** 把两档配置从配置内核读进来（打开面板时读一次；保存成功后重读，外部改过文件也能跟上）。 */
  function settingsLoadScopes() {
    ['default', 'project'].forEach(function (k) {
      var cfg = configScopeCfg(k);
      settingsScopes[k].cfg = cfg;
      settingsScopes[k].saved = JSON.stringify(cfg);
    });
  }

  /** 一份出厂配置（"恢复默认"用它，字段与内置默认同源，没有第二份常量）。 */
  function settingsFreshCfg() { return configBuiltinCfg(); }
  function settingsCfg() { return settingsScopes[settingsScope].cfg; }

  /** 面板每个控件改动后都走这里：改状态 + 重画（重画是为了让「当前目录可见性」那几行
      与底部的"未保存"标记即时跟上）。 */
  function settingsChange(fn) {
    if (settingsReadonly()) return;          // file:// 下改不了：控件已禁用，这里再兜一道
    fn(settingsCfg());
    renderSettings();
  }

  /** 一个目录在当前配置下会怎样：显示 / 忽略 / 剪掉。口径与 js/00-config.js 的判定一致
      （白名单 > 忽略名单 > 点号规则，最后才是空目录剪枝），所以这里看到的和首页树上的一致。 */
  function settingsStateOf(cfg, cand) {
    if (cfg.allowDirs.indexOf(cand.name) >= 0) return '显示';
    if ((cfg.ignoreDotDirs && cand.name.charAt(0) === '.') || cfg.ignoreDirs.indexOf(cand.name) >= 0) return '忽略';
    if (cfg.pruneEmpty && !cand.hasDoc) return '剪掉';
    return '显示';
  }
  /** 把一个名字放进白名单：与排除名单互斥（同名同时出现在两处，界面上就会自相矛盾）。 */
  function settingsAllow(cfg, name) {
    if (cfg.allowDirs.indexOf(name) < 0) cfg.allowDirs.push(name);
    var at = cfg.ignoreDirs.indexOf(name);
    if (at >= 0) cfg.ignoreDirs.splice(at, 1);
  }
  /** 把一个名字移出白名单。若它本来就在内置排除名单里，就把默认排除还回去 ——
      这样"放行→取消放行"能回到原样，与上面那排开关的语义对称（否则它会变成"既不排除也没放行"，说不清）。 */
  function settingsUnallow(cfg, name) {
    var at = cfg.allowDirs.indexOf(name);
    if (at >= 0) cfg.allowDirs.splice(at, 1);
    if (configInnerIgnore().indexOf(name) >= 0 && cfg.ignoreDirs.indexOf(name) < 0) cfg.ignoreDirs.push(name);
  }
  /** 把一个名字加进黑名单（= 自定义排除）：与白名单互斥。
      内置名单里已有的名字不用加 —— 那批由上面「默认排除目录」的开关管，两处管同一件事只会打架；
      这种名字返回 false，由调用方给一句提示。 */
  function settingsDeny(cfg, name) {
    if (configInnerIgnore().indexOf(name) >= 0) return false;
    var ai = cfg.allowDirs.indexOf(name);
    if (ai >= 0) cfg.allowDirs.splice(ai, 1);
    if (cfg.ignoreDirs.indexOf(name) < 0) cfg.ignoreDirs.push(name);
    return true;
  }
  /** 把一个名字移出黑名单：之后它就按原本的规则走（该显示就显示）。 */
  function settingsUnDeny(cfg, name) {
    var at = cfg.ignoreDirs.indexOf(name);
    if (at >= 0) cfg.ignoreDirs.splice(at, 1);
  }
  /** 切换"排除某个目录"：打开排除时与白名单互斥（以最后动的那个开关为准）。
      这里不调 settingsUnallow：它会把内置名字重新塞回排除名单，叠在这里会插进两条重复项。 */
  function settingsToggleIgnore(name) {
    settingsChange(function (cfg) {
      var at = cfg.ignoreDirs.indexOf(name);
      if (at >= 0) {
        cfg.ignoreDirs.splice(at, 1);
        return;
      }
      var ai = cfg.allowDirs.indexOf(name);
      if (ai >= 0) cfg.allowDirs.splice(ai, 1);
      cfg.ignoreDirs.push(name);
    });
  }

  /** 有未保存改动吗（与"已保存快照"比 JSON）。 */
  function settingsDirty() {
    return JSON.stringify(settingsCfg()) !== settingsScopes[settingsScope].saved;
  }

  /* ---- 渲染 ---- */
  /** 作用域那一行：命令行模式给两个选项，其余模式只有"全局默认"并说明原因。 */
  function settingsScopeHtml() {
    if (SETTINGS_MODE !== 'cli') {
      return '<div class="settings__row"><span class="settings__label">作用域</span>' +
        '<span class="settings__hint">全局默认（当前打开方式没有"本项目"）</span></div>';
    }
    return '<div class="settings__row"><span class="settings__label">作用域</span>' +
      '<span class="seg">' +
      ['project', 'default'].map(function (k) {
        return '<button type="button" class="seg__btn' + (settingsScope === k ? ' is-on' : '') +
          '" data-act="scope" data-scope="' + k + '" aria-pressed="' + (settingsScope === k) + '">' +
          settingsScopes[k].label + '</button>';
      }).join('') +
      '</span></div>';
  }

  /** 写入域：一行说清这次改动会落到配置文件里的哪一段（配置文件位置放到面板底部）。
      本项目那一档只显示目录名（完整路径放 title），免得一行被长路径撑开；
      取名字交给 00-config.js（路径分隔符只该在一个地方懂）。 */
  function settingsWriteToHtml() {
    var full = configProjectPath() || '本项目路径';
    var where = settingsScope === 'default' ? 'default'
      : 'projects["' + (configProjectName() || full) + '"]';
    return '<div class="settings__row"><span class="settings__label">写入域</span>' +
      '<code class="settings__to" title="' + esc(settingsScope === 'default' ? 'default 段：对所有项目生效' : full) +
      '">' + esc(where) + '</code></div>';
  }

  /** 底部那行：配置文件在哪 + 这个模式下它能被怎么处理（标题里说全）。 */
  function settingsPathHtml() {
    var p = configFilePath();
    var note = SETTINGS_MODE === 'cli' ? '保存就写这个文件'
      : (SETTINGS_MODE === 'static' ? '浏览器写不了磁盘：改动只在本次会话生效，可用「复制 JSON」贴进去'
        : 'file:// 下读不到它，规则一律用内置默认');
    return '<div class="settings__path"><span class="settings__path-label">配置文件</span>' +
      '<code title="' + esc(p + '（' + note + '）') + '">' + esc(p) + '</code></div>';
  }

  /** 自绘开关按钮：项目里没有原生 checkbox 的样式，原生控件在深浅两套下观感也不一致。
      排除开关与目录规则开关只差承载体属性，所以只写这一个构造器。
      file:// 下配置读不到也存不下，统一在这里落 disabled（按钮 disabled 后点击事件根本不派发）。 */
  function swHtml(act, attr, val, on, label) {
    return '<button type="button" class="sw" role="switch" aria-checked="' + on + '" data-act="' + act + '" ' +
      attr + '="' + esc(val) + '" aria-label="' + esc(label) + '"' +
      (settingsReadonly() ? ' disabled' : '') + '><span class="sw__knob"></span></button>';
  }

  /** 列表行：名字（左）+ 可选标注 + 右侧说明 + 行末控件。
      三处列表共用这一套行结构，各自只传用得到的部分：
      mod 是行的修饰类（可见性区用它表达"这一行不显示"），why 靠右对齐、紧贴控件。 */
  function rowHtml(name, extra) {
    extra = extra || {};
    return '<div class="row' + (extra.mod ? ' ' + extra.mod : '') + '">' +
      '<span class="row__name">' + name + '</span>' +
      (extra.tag ? '<span class="tag">' + extra.tag + '</span>' : '') +
      (extra.why ? '<span class="row__why">' + extra.why + '</span>' : '') +
      (extra.control || '') + '</div>';
  }

  /** 默认排除目录：先是"点号规则"这一条通用规则，再是内置那批名字 —— 逐个用开关列出。
      关掉某个开关 = 它不再被排除。自己加的排除项不在这里，归下面的「黑名单」管。 */
  function settingsDefaultIgnoreHtml(cfg) {
    var rule = rowHtml('以 <code>.</code> 开头的目录',
      { why: '.git、.vscode 这类',
        control: swHtml('toggle', 'data-field', 'ignoreDotDirs', cfg.ignoreDotDirs, '忽略以 . 开头的目录') });
    /* 状态只有两个字：开=不显示、关=显示。靠右对齐成一列，扫一眼就知道哪个开关关着 */
    var rows = configInnerIgnore().map(function (n) {
      var on = cfg.ignoreDirs.indexOf(n) >= 0;
      return rowHtml(esc(n), {
        why: on ? '不显示' : '显示',
        control: swHtml('ignore', 'data-name', n, on, '排除 ' + n)
      });
    }).join('');
    return '<div class="list">' + rule + '<div class="list__gap"></div>' + rows + '</div>';
  }

  /** 黑名单：自定义排除的目录。它与「默认排除目录」写的是同一个 ignoreDirs，只是名字不在内置名单里
      （所以没有新字段、引擎也不认识"黑名单"这个词），编辑形态与白名单一致：列表 + 输入行。 */
  function settingsBlacklistHtml(cfg) {
    var ro = settingsReadonly();
    var builtin = configInnerIgnore();
    var rows = cfg.ignoreDirs.filter(function (n) { return builtin.indexOf(n) < 0; }).map(function (n) {
      return rowHtml(esc(n), { control:
        '<button type="button" class="row__del" data-act="deny-del" data-name="' + esc(n) +
        '" title="移出黑名单" aria-label="移出黑名单"' + (ro ? ' disabled' : '') + '>移除</button>' });
    }).join('');
    return '<div class="list">' +
      (rows || '<div class="row row--empty">还没有自定义排除的目录</div>') +
      '<div class="row row--add"><span class="row__plus">＋</span>' +
      '<input type="text" id="settingsDenyInput" class="row__input" aria-label="要排除的目录名" placeholder="' +
      (ro ? '无法保存改动' : '输入目录名后回车') + '"' + (ro ? ' disabled' : '') +
      ' autocomplete="off" spellcheck="false"></div></div>';
  }

  /** 白名单：列表形态（一行一个，行末可移除），最后一行是输入框。 */
  function settingsAllowlistHtml(cfg) {
    var ro = settingsReadonly();
    var rows = cfg.allowDirs.map(function (n) {
      return rowHtml(esc(n), { control:
        '<button type="button" class="row__del" data-act="allow-del" data-name="' + esc(n) +
        '" title="移出白名单" aria-label="移出白名单"' + (ro ? ' disabled' : '') + '>移除</button>' });
    }).join('');
    return '<div class="list">' +
      (rows || '<div class="row row--empty">还没有放行任何目录</div>') +
      '<div class="row row--add"><span class="row__plus">＋</span>' +
      '<input type="text" id="settingsAllowInput" class="row__input" aria-label="要放行的目录名" placeholder="' +
      (ro ? '无法保存改动' : '输入目录名后回车') + '"' + (ro ? ' disabled' : '') +
      ' autocomplete="off" spellcheck="false"></div></div>' +
      '<p class="settings__hint">白名单里的目录一定显示，也不会因为"里面没有 md"被剪掉。</p>';
  }

  /** 目录规则里的开关行（标题 + 开关 + 可选说明）。 */
  function settingsSwitchHtml(field, label, hint, on) {
    var row = '<div class="settings__row"><span class="settings__label">' + label + '</span>' +
      swHtml('toggle', 'data-field', field, on, label.replace(/<[^>]+>/g, '')) + '</div>';
    return row + (hint ? '<p class="settings__hint">' + hint + '</p>' : '');
  }

  /** 深度：滑块 + 数字读数（数字用等宽字，跟面板里的目录名一致）。
      上限跟着配置走：文件里若写了比 12 更大的值，滑块要能停在那儿，否则读数会当场说谎。 */
  function settingsDepthHtml(cfg) {
    return '<div class="settings__row"><span class="settings__label">递归深度</span>' +
      '<input type="range" id="settingsDepth" class="range" min="1" max="' + Math.max(12, cfg.maxDepth) +
      '" step="1" value="' + cfg.maxDepth + '"' + (settingsReadonly() ? ' disabled' : '') + '>' +
      '<span class="range__val">' + cfg.maxDepth + ' 层</span></div>' +
      '<p class="settings__hint">目录最多嵌套几层（服务端目录与本地文件夹同一口径）。</p>';
  }

  /** 不可见的那一行在行末说明原因（普通文字，不是胶囊）：
      点号规则与内置名单里的名字都算「默认排除」，自己加进黑名单的算「黑名单排除」，
      递归里没有 md 被剪掉的算「空目录」。 */
  function settingsHideReason(cfg, d) {
    if (d.name.charAt(0) === '.' && cfg.ignoreDotDirs) return '默认排除';
    if (configInnerIgnore().indexOf(d.name) >= 0) return '默认排除';
    if (cfg.ignoreDirs.indexOf(d.name) >= 0) return '黑名单排除';
    return '空目录';
  }

  /** 当前目录可见性：只做展示、不可切换（要放行就去上面的白名单加名字）。
      数据是「扫一层目录」的结果：没扫完显示进行中，扫不出来就说明原因。
      能显示的目录排在上面、用正常样式；不显示的沉到下面、整行压暗（底色 + 文字色），原因写在行末。
      状态口径与 js/00-config.js 的判定一致，所以这里看到的就是首页树上会发生的事。 */
  function settingsVisibleHtml(cfg) {
    if (settingsScan.state === 'loading') return '<div class="row row--empty">正在扫这一层目录…</div>';
    if (settingsScan.state !== 'ready') {
      return '<div class="row row--empty">' + esc(settingsScan.reason || '还没扫过这一层。') + '</div>';
    }
    var builtin = configInnerIgnore();
    var items = settingsScan.dirs.map(function (d) {
      var shown = settingsStateOf(cfg, d) === '显示';
      return {
        shown: shown,                                     // 只用来分组排序，不参与渲染
        html: rowHtml(esc(d.name), {
          mod: shown ? 'is-shown' : 'is-hidden',
          /* 不可见的行不再挂「内置名单」标注（原因已经写成"默认排除"）；
             可见的行若本来在内置名单里（= 被白名单放行的），留着这个标注才说得通 */
          tag: shown && builtin.indexOf(d.name) >= 0 ? '内置名单' : '',
          why: shown ? '<span class="dot"></span>显示' : settingsHideReason(cfg, d)
        })
      };
    });
    /* 可见的排前面：先看"我实际能看到什么"，被规则挡住的沉到下面。
       sort 是稳定的，所以两组内部保持扫描给的顺序（按名字）。 */
    items.sort(function (a, b) { return a.shown === b.shown ? 0 : (a.shown ? -1 : 1); });
    return items.map(function (it) { return it.html; }).join('') ||
      '<div class="row row--empty">这一层没有子目录。</div>';
  }

  /** 模式提示：不是命令行打开时，改动落不到磁盘上，得说清楚。 */
  function settingsModeNoteHtml() {
    if (SETTINGS_MODE === 'cli') return '';
    var what = SETTINGS_MODE === 'file'
      ? '当前是双击打开（file://）：浏览器读不到配置文件，规则一律用内置默认 —— 所以这个面板只作展示，' +
        '控件都是禁用的。要改配置请用命令行（mdslice）或在本地服务器下打开。'
      : '当前是静态服务器打开：配置能读到（同目录的 mdslice-config.json），但浏览器写不了磁盘，' +
        '改动只在本次会话生效；要保存请用命令行打开。';
    return '<p class="settings__note">' + what +
      (SETTINGS_MODE === 'static' ? ' 也可以用底部「复制 JSON」手工贴进配置文件。' : '') + '</p>';
  }

  /** 面板整块 HTML。区块自上而下：作用域 → 写入域 → 默认排除目录 → 白名单 → 黑名单 → 目录规则 →
      当前目录可见性（只看不改）→ 底部配置路径 → 操作栏。 */
  function settingsHtml() {
    var cfg = settingsCfg();
    var dirty = settingsDirty();
    return '' +
      '<div class="settings__head">' +
        '<span class="settings__title">忽略与显示规则</span>' +
        '<span class="settings__spacer"></span>' +
        '<button type="button" class="settings__close" data-act="close" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="settings__body">' +
        settingsModeNoteHtml() +
        settingsScopeHtml() +
        settingsWriteToHtml() +

        '<h4 class="settings__sec">默认排除目录</h4>' +
        settingsDefaultIgnoreHtml(cfg) +

        '<h4 class="settings__sec">白名单</h4>' +
        settingsAllowlistHtml(cfg) +

        '<h4 class="settings__sec">黑名单</h4>' +
        settingsBlacklistHtml(cfg) +

        '<h4 class="settings__sec">目录规则</h4>' +
        settingsDepthHtml(cfg) +
        settingsSwitchHtml('pruneEmpty', '空目录剪枝',
          '关掉后递归里不含 md 的目录也会显示；此时不再预探测子目录，展开时才去读。', cfg.pruneEmpty) +

        '<h4 class="settings__sec">当前目录可见性</h4>' +
        '<div class="list">' + settingsVisibleHtml(cfg) + '</div>' +
      '</div>' +
      settingsPathHtml() +
      '<div class="settings__foot">' +
        '<span class="settings__dirty' + (dirty ? ' is-on' : '') + '">' + (dirty ? '有未保存的改动' : '') + '</span>' +
        '<button type="button" class="tbtn" data-act="reset">恢复默认</button>' +
        '<button type="button" class="tbtn tbtn--primary" data-act="copy">复制 JSON</button>' +
        (SETTINGS_MODE === 'cli'
          ? '<button type="button" class="tbtn tbtn--primary" data-act="save"' +
            (dirty && !settingsSaving ? '' : ' disabled') + '>' + (settingsSaving ? '写入中…' : '保存') + '</button>'
          : '') +
      '</div>';
  }

  /** 只更新底部那条"未保存"状态与保存按钮（滑块拖动时用它，避免整块重画）。
      disabled 要把"正在写入"一起算上：写入途中用户还能拖滑块，否则按钮会显示成可点。 */
  function settingsSyncFoot() {
    var dirty = document.querySelector('#settingsPanel .settings__dirty');
    var on = settingsDirty();
    if (dirty) {
      dirty.classList.toggle('is-on', on);
      dirty.textContent = on ? '有未保存的改动' : '';
    }
    var save = document.querySelector('#settingsPanel [data-act="save"]');
    if (save) save.disabled = !on || settingsSaving;
  }

  /** 重画面板（保留滚动位置，避免点一下开关就跳回顶部）。 */
  function renderSettings() {
    var el = document.getElementById('settingsPanel');
    if (!el) return;
    var body = el.querySelector('.settings__body');
    var top = body ? body.scrollTop : 0;
    el.innerHTML = settingsHtml();
    body = el.querySelector('.settings__body');
    if (body) body.scrollTop = top;
  }

  /* ---- 打开 / 关闭 ---- */
  function settingsIsOpen() {
    var el = document.getElementById('settingsMask');
    return !!(el && el.classList.contains('is-on'));
  }
  function openSettings() {
    var mask = document.getElementById('settingsMask');
    var panel = document.getElementById('settingsPanel');
    if (!mask || !panel) return;
    settingsLoadScopes();          // 每次打开都重读一遍配置（保存过 / 页面刷新过都能跟上）
    settingsScanStart();           // 目录清单异步扫，先渲染"正在扫…"
    renderSettings();
    mask.classList.add('is-on');
    panel.classList.add('is-on');
    var btn = panel.querySelector('[data-act="close"]');
    if (btn) btn.focus();
  }
  function closeSettings() {
    var mask = document.getElementById('settingsMask');
    var panel = document.getElementById('settingsPanel');
    if (mask) mask.classList.remove('is-on');
    if (panel) panel.classList.remove('is-on');
    var gear = document.getElementById('rulesBtn');
    if (gear) gear.focus();
  }

  /* ---- 底部三件事 ---- */
  /** 当前作用域那一段的配置文本（「复制 JSON」复制的是它；写回走接口，发的是同一份对象）。 */
  function settingsJson() {
    return JSON.stringify(settingsCfg(), null, 2) + '\n';
  }
  function settingsCopy() {
    var text = settingsJson();
    var where = settingsScope === 'default' ? 'default 段' : 'projects 段里本项目那一段';
    var done = function () { showToast('已复制' + where + '，可贴进 <code>mdslice-config.json</code>'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function settingsReset() {
    settingsChange(function () {
      var fresh = settingsFreshCfg();                        // 出厂配置（内置默认）
      var cfg = settingsCfg();
      Object.keys(fresh).forEach(function (k) { cfg[k] = fresh[k]; });
    });
  }
  /** 保存：把当前作用域那一段交给本地服务写回配置文件。
      成功后立刻用上新配置（不必刷新页面），并按新规则重排服务器来源的目录树、重扫可见性区。 */
  function settingsSave() {
    if (SETTINGS_MODE !== 'cli' || settingsSaving) return;
    var scope = settingsScope;
    settingsSaving = true;
    renderSettings();                                        // 按钮切成"写入中…"并禁用，防重复提交
    fetch(SETTINGS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },        // 非简单请求：别的站点发不出这一手
      body: JSON.stringify({ scope: scope, projectPath: configProjectPath(), cfg: settingsCfg() })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; },
        function () { throw new Error('HTTP ' + r.status); });
    }).then(function (res) {
      settingsSaving = false;
      if (!res.ok || !res.body || !res.body.ok) {
        throw new Error((res.body && res.body.error) || '服务端拒绝了这次写入');
      }
      if (res.body.text) configApplyText(res.body.text, configProjectPath());   // 规则判定立刻跟上
      settingsLoadScopes();                                                     // 基线跟着更新，脏标记清掉
      settingsScanStart();
      reloadAutoDirs();                                                         // 目录树按新规则重排
      renderSettings();
      var localLeft = homeDirs.some(function (d) { return d.source !== 'server'; });
      showToast('已写入 <code>' + esc(res.body.file || configFilePath()) + '</code> 的 ' +
        (scope === 'default' ? 'default 段' : '本项目段') +
        '，目录树已按新规则重排' + (localLeft ? '（本地文件夹来源要重新选一次目录）' : ''), 4500);
    }).catch(function (e) {
      settingsSaving = false;
      renderSettings();
      showToast('保存失败：' + esc((e && e.message) || e), 5000);
    });
  }

  /** 键盘与遮罩：Esc 关闭、点遮罩关闭（面板本身不关）。 */
  function bindSettingsOnce() {
    var mask = document.getElementById('settingsMask');
    var panel = document.getElementById('settingsPanel');
    var gear = document.getElementById('rulesBtn');
    if (!mask || !panel) return;
    if (gear) gear.addEventListener('click', function () { if (settingsIsOpen()) closeSettings(); else openSettings(); });
    mask.addEventListener('click', closeSettings);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && settingsIsOpen()) closeSettings();
    });

    panel.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'close') { closeSettings(); return; }
      /* 只认这两档：别直接把属性值赋给 settingsScope —— 取到原型键（constructor 之类）会当场读崩 */
      if (act === 'scope') {
        var k = el.getAttribute('data-scope');
        if (k === 'project' || k === 'default') settingsScope = k;
        renderSettings();
        return;
      }
      if (act === 'ignore') { settingsToggleIgnore(el.getAttribute('data-name')); return; }
      if (act === 'toggle') {
        var field = el.getAttribute('data-field');
        settingsChange(function (cfg) { cfg[field] = !cfg[field]; });
        return;
      }
      if (act === 'allow-del') {
        var del = el.getAttribute('data-name');
        settingsChange(function (cfg) { settingsUnallow(cfg, del); });
        return;
      }
      if (act === 'deny-del') {
        var ddel = el.getAttribute('data-name');
        settingsChange(function (cfg) { settingsUnDeny(cfg, ddel); });
        return;
      }
      if (act === 'reset') { settingsReset(); return; }
      if (act === 'copy') { settingsCopy(); return; }
      if (act === 'save') { settingsSave(); return; }
    });

    /* 滑块是唯一"拖动中不能重画"的控件：重画会把它松开。所以拖动过程只改数据、
       就地更新读数与底部的未保存标记，其余控件仍走 settingsChange（整体重画）。 */
    panel.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'settingsDepth') return;
      var v = parseInt(e.target.value, 10);
      settingsCfg().maxDepth = v;
      var val = e.target.parentElement.querySelector('.range__val');
      if (val) val.textContent = v + ' 层';
      settingsSyncFoot();
    });

    /* 两个输入行共用这套回车逻辑：白名单走 settingsAllow、黑名单走 settingsDeny（后者可能拒绝）。
       settingsChange 是同步的，所以下面那句提示一定读到的是刚算出来的结果。 */
    panel.addEventListener('keydown', function (e) {
      var id = e.target && e.target.id;
      if (e.key !== 'Enter' || (id !== 'settingsAllowInput' && id !== 'settingsDenyInput')) return;
      var name = String(e.target.value || '').trim();
      if (!name) return;
      var toDeny = id === 'settingsDenyInput';
      var taken = true;
      settingsChange(function (cfg) {
        if (toDeny) taken = settingsDeny(cfg, name);
        else { settingsAllow(cfg, name); taken = true; }
      });
      if (!taken) showToast('<code>' + esc(name) + '</code> 已经由「默认排除目录」管着，这里不用再加', 3000);
      var input = document.getElementById(id);
      if (input) input.focus();
    });
  }

  /* ---- 初始化：面板容器一次性建好（之后 Open 只切类名与重画内容） ---- */
  var settingsMask = document.createElement('div');
  settingsMask.className = 'settings-mask';
  settingsMask.id = 'settingsMask';
  var settingsPanelEl = document.createElement('aside');
  settingsPanelEl.className = 'settings';
  settingsPanelEl.id = 'settingsPanel';
  settingsPanelEl.setAttribute('role', 'dialog');
  settingsPanelEl.setAttribute('aria-modal', 'true');
  settingsPanelEl.setAttribute('aria-label', '忽略与显示规则');
  document.body.appendChild(settingsMask);
  document.body.appendChild(settingsPanelEl);

  /* 启动时先按当前配置填一遍（打开面板时还会再读一次），只是让"打开之前"也有真值可用。
     这里原本是骨架期的演示值（还带着一个 .github 白名单），接真数据后必须去掉 ——
     否则任何在打开面板之前读 settingsCfg() 的路径都会拿到一份不存在的配置。 */
  settingsLoadScopes();
  bindSettingsOnce();
