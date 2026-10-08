/* config.js —— 可见性配置：忽略名单 / 白名单 / 递归深度 / 空目录剪枝的唯一出处。
   首页那棵树里"该出现什么"由这里回答：三处消费点（服务器列表、本地文件夹、目录句柄）与剪枝判定都问它，
   改规则只动这一处。

   配置来源按运行环境分三种，读不到就用内置默认，字段缺哪补哪：
   - 本地服务（bin/mdslice.js）注入 window.MDSLICE 的 configFile / configPath / configText，这里直接解析原文、
     不发请求 —— 服务端因此不需要认识配置语义，也就不会出现两份合并逻辑；
   - 普通静态服务器：同源 fetch 应用目录下的 mdslice-config.json（与读目录索引页是同一机制）；
   - file:// 直开：浏览器不允许读本地文件，直接用内置默认（配置在这个模式下不生效，见 README）。

   合并规则：default 段是基线，projects 段按「项目绝对路径归一化后」精确匹配，只覆盖它写了的字段。
   提示口径：只有"配置本身写错"（JSON 语法、字段名、类型、schema）才在首页提示；文件读不到一律静默按内置默认跑。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  var CONFIG_FILE = 'mdslice-config.json';
  var CONFIG_SCHEMA = 1;
  var CONFIG_FIELDS = { ignoreDirs: 1, ignoreDotDirs: 1, allowDirs: 1, maxDepth: 1, pruneEmpty: 1 };

  /** 字段名是不是本表自己的键。不能直接写 `CONFIG_FIELDS[k]`：`constructor` / `toString` 这类原型键
      会命中原型上的成员，于是"名字不认识"的字段被当成认识的，静默溜过去 —— 恰恰是最难查的那种。 */
  function isConfigField(k) { return Object.prototype.hasOwnProperty.call(CONFIG_FIELDS, k); }

  /* 内置默认：字段缺失时的兜底，也是 file:// 下唯一生效的一份（内容与仓库里的样板 mdslice-config.json 一致） */
  var CONFIG_DEFAULT = {
    ignoreDirs: ['node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '__pycache__'],
    ignoreDotDirs: true,
    allowDirs: [],
    maxDepth: 8,
    pruneEmpty: true
  };

  var config = CONFIG_DEFAULT;   // 生效中的配置；启动时由 resolveConfig 解析一次，之前先按默认跑
  var configRaw = { default: null, project: null };   // 文件里两段的原文（未归一化），设置面板据此编辑
  var configNotice = '';         // 配置有问题时的一句话（纯文本，由首页转义后显示）
  var configFileLabel = CONFIG_FILE;   // 提示里用的文件名（本地服务会注入绝对路径，便于直接去改）

  /** 项目路径归一化：反斜杠统一成正斜杠并小写 —— projects 段的键写 `d:\a\b` 还是 `D:/a/b` 都能对上。 */
  function configKey(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

  /** 取布尔字段：不是布尔值就退回默认。 */
  function pickBool(v, def) { return typeof v === 'boolean' ? v : def; }
  /** 取「目录名数组」字段：不是数组就退回默认；只收非空字符串项并去重（重复项没有意义）。 */
  function pickNames(v, def) {
    if (!Array.isArray(v)) return def.slice();
    var out = [];
    v.forEach(function (n) { if (typeof n === 'string' && n && out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  /** 取递归深度上限：只认正整数，其余退回默认（0、负数、小数、字符串一律不当数用）。 */
  function pickDepth(v, def) { return (typeof v === 'number' && v > 0 && v === Math.floor(v)) ? v : def; }

  /** 把一段可能残缺的配置归一化成完整配置：缺的字段用 base 兜底。 */
  function normalizeConfig(seg, base) {
    seg = seg || {};
    return {
      ignoreDirs: pickNames(seg.ignoreDirs, base.ignoreDirs),
      ignoreDotDirs: pickBool(seg.ignoreDotDirs, base.ignoreDotDirs),
      allowDirs: pickNames(seg.allowDirs, base.allowDirs),
      maxDepth: pickDepth(seg.maxDepth, base.maxDepth),
      pruneEmpty: pickBool(seg.pruneEmpty, base.pruneEmpty)
    };
  }

  /** 是不是一段能用的配置对象（排掉 null / 数组 / 字符串）。 */
  function isSection(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /** 单个字段的值是否合规矩（只查类型，不查"该不该有"）。 */
  function fieldOk(k, v) {
    if (k === 'ignoreDotDirs' || k === 'pruneEmpty') return typeof v === 'boolean';
    if (k === 'maxDepth') return typeof v === 'number' && v > 0 && v === Math.floor(v);
    return Array.isArray(v) && v.every(function (n) { return typeof n === 'string' && n; });
  }

  /** 检查一段配置：名字不认识的字段、类型对不上的字段都攒进 bad —— 这两类都会被静默忽略，
      正是"改了配置却没生效"最难查的原因，必须点出来。整段不是对象就作废（返回 null）。 */
  function checkSection(v, label, bad) {
    if (v === undefined) return null;
    if (!isSection(v)) { bad.push(label); return null; }
    Object.keys(v).forEach(function (k) {
      if (!isConfigField(k) || !fieldOk(k, v[k])) bad.push(k);
    });
    return v;
  }

  /** 解析配置原文：挑出 default 段与匹配本项目的 projects 段，字段级合并后归一化。
      文本坏了返回 { cfg: null, raw: null, notice: '…' }，由调用方退回内置默认。
      raw 是两段各自的原文（未归一化），设置面板按段编辑要用它。 */
  function readConfigText(text, projectPath) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { cfg: null, raw: null, notice: '配置文件 ' + configFileLabel + ' 解析失败，已按内置默认运行：' + e.message }; }
    if (!isSection(data)) {
      return { cfg: null, raw: null, notice: '配置文件 ' + configFileLabel + ' 的内容不是一个对象，已按内置默认运行。' };
    }
    if (data.schema !== undefined && data.schema !== CONFIG_SCHEMA) {
      return { cfg: null, raw: null, notice: '配置文件 ' + configFileLabel + ' 的 schema 是 ' + JSON.stringify(data.schema) +
        '，本版本只认 ' + CONFIG_SCHEMA + '，已按内置默认运行。' };
    }
    var bad = [];
    Object.keys(data).forEach(function (k) {
      if (k !== 'schema' && k !== 'default' && k !== 'projects') bad.push(k);
    });
    var base = checkSection(data.default, 'default', bad);

    var hit = null;
    if (data.projects !== undefined) {
      if (!isSection(data.projects)) bad.push('projects');
      else {
        var key = configKey(projectPath);
        var hitKey = null;
        Object.keys(data.projects).forEach(function (k) { if (key && configKey(k) === key) hitKey = k; });
        if (hitKey !== null) hit = checkSection(data.projects[hitKey], 'projects[' + hitKey + ']', bad);
      }
    }

    var merged = {};
    [base, hit].forEach(function (seg) {
      if (!seg) return;
      Object.keys(seg).forEach(function (k) { merged[k] = seg[k]; });
    });
    return {
      cfg: normalizeConfig(merged, CONFIG_DEFAULT),
      raw: { default: base, project: hit },
      notice: bad.length ? '配置文件 ' + configFileLabel + ' 里这些字段没用上（名字不认识或类型不对）：' + bad.join('、') : ''
    };
  }

  /** 把一份解析结果用上（传 null = 全部退回内置默认），并记下要提示的那句话。
      两段原文也一并留住：设置面板按段编辑，缺了它就只能改"合并后的结果"。
      提示只留给"用户自己写错的配置"：读取失败一律静默（见 resolveConfig）。 */
  function useConfig(res) {
    config = (res && res.cfg) || normalizeConfig(null, CONFIG_DEFAULT);
    configRaw = (res && res.raw) || { default: null, project: null };
    configNotice = (res && res.notice) || '';
    if (configNotice) console.warn('[MDSlice] ' + configNotice);
  }

  /** 启动前解析配置：done() 一定会被调用一次（注入了原文就是同步，静态服务下是异步的）。 */
  function resolveConfig(done) {
    var boot = window.MDSLICE || {};
    if (typeof boot.configText === 'string') {          // 本地服务注入了原文：以注入为准，不再发请求
      if (boot.configFile) configFileLabel = boot.configFile;
      if (boot.configText.trim() === '') useConfig(null);       // 注入空串 = 应用目录里没有配置文件
      else useConfig(readConfigText(boot.configText, boot.configPath || ''));
      done();
      return;
    }
    if (location.protocol === 'file:') { useConfig(null); done(); return; }
    fetch(CONFIG_FILE).then(function (res) {
      if (res.status === 404) return '';                 // 没有配置文件是正常情况
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      if (text.trim() === '') { useConfig(null); done(); return; }
      useConfig(readConfigText(text, ''));               // 静态服务下没有项目路径可用，projects 段不参与
      done();
    }).catch(function (e) {
      /* 读不到就按内置默认跑，**不提示**：这属于环境问题（服务器没给这个文件、权限、或进程与页面不是同一版），
         用户在页面上无从下手；该提示的是"用户自己写错的配置"（语法 / 字段名 / 类型 / schema），那几类已在上面提示。
         排查时看 console 即可（下面仍留一条 warn）。 */
      useConfig(null);
      console.warn('[MDSlice] 读取 ' + CONFIG_FILE + ' 失败，已按内置默认运行：' + ((e && e.message) || e));
      done();
    });
  }

  /** 保存成功后把新原文用上：与启动时同一套解析，页面不必刷新就能按新规则跑。
      解析不了就原样不动并返回 false —— 宁可继续用手上这份配置，也不要静默退回内置默认
      （那种"看起来成功了、规则却全变回出厂"最难查）。 */
  function configApplyText(text, projectPath) {
    if (typeof text !== 'string' || text.trim() === '') return false;
    var res = readConfigText(text, projectPath || configProjectPath());
    if (!res.cfg) return false;
    useConfig(res);
    return true;
  }

  /* ---- 设置面板用的读写面（规则判定仍走下面的 tree* 函数，这里只提供"某一段现在是什么"） ---- */
  function cloneCfg(c) {
    return {
      ignoreDirs: c.ignoreDirs.slice(), ignoreDotDirs: c.ignoreDotDirs,
      allowDirs: c.allowDirs.slice(), maxDepth: c.maxDepth, pruneEmpty: c.pruneEmpty
    };
  }
  /** 内置默认排除名单：面板里那排开关的"出厂状态"，唯一出处仍是 CONFIG_DEFAULT。 */
  function configInnerIgnore() { return CONFIG_DEFAULT.ignoreDirs.slice(); }
  /** 一份出厂配置的副本（面板的"恢复默认"用它；与 file:// 下生效的那份完全一致）。 */
  function configBuiltinCfg() { return cloneCfg(CONFIG_DEFAULT); }
  /** 某一档配置的可编辑副本：全局默认 = default 段归一化后的样子；本项目 = 启动时合并好的那一份
      （合并结果才是这个项目上真正生效的，面板要显示的就是它）。 */
  function configScopeCfg(scope) {
    return cloneCfg(scope === 'project' ? config : normalizeConfig(configRaw.default, CONFIG_DEFAULT));
  }
  /** 本项目的绝对路径（本地服务注入；静态服务与 file:// 下为空 = 没有"本项目"可言）。 */
  function configProjectPath() { return (window.MDSLICE || {}).configPath || ''; }
  /** 本项目的目录名（面板"写入域"那一行用它）：路径分隔符与末段切分只在这里懂一次。 */
  function configProjectName() {
    var full = configProjectPath();
    return full.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || full;
  }
  /** 配置文件的位置：本地服务给绝对路径，其余模式给相对文件名（就在应用目录下）。 */
  function configFilePath() { return (window.MDSLICE || {}).configFile || CONFIG_FILE; }

  /* ---- 对外查询 ---- */
  /** 是否在白名单里（白名单目录一定显示，且不参与空目录剪枝）。 */
  function treeIsAllowed(name) { return config.allowDirs.indexOf(name) >= 0; }
  /** 该目录是否从树里藏掉：白名单优先，其次点号规则（只作用于目录），最后是忽略名单。 */
  function treeHideDir(name) {
    if (treeIsAllowed(name)) return false;
    if (config.ignoreDotDirs && name.charAt(0) === '.') return true;
    return config.ignoreDirs.indexOf(name) >= 0;
  }
  /** 递归深度上限（含自身这一层：深度超过它就不再往下建节点）。 */
  function treeMaxDepth() { return config.maxDepth; }
  /** 是否开启空目录剪枝（关掉后，递归里不含 markdown 的目录也照常显示）。 */
  function treePruneEmpty() { return config.pruneEmpty; }
