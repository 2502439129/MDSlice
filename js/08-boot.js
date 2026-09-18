/* boot.js —— 启动流程：建立常驻首页标签，并按运行环境准备首页的目录区。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 启动 ---- */
  /** 建立首页标签并激活；file:// 下给出说明，静态服务器下自动列出同目录 markdown。 */
  var home = createHomeTab();

  if (location.protocol === 'file:') {
    homeNotice = FILE_PROTOCOL_NOTICE;                               // 浏览器拦截本地读取：给出说明与「添加目录」入口
  } else {
    var autoDir = { name: autoDirName(), source: 'server', children: [], expanded: true,
                    url: new URL('./', location.href).href };
    ensureNodeId(autoDir);
    homeDirs.push(autoDir);
    loadServerDir(autoDir);                              // 列出结果异步填进首页
  }

  activateTab(home.id);
