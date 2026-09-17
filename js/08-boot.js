/* boot.js —— 启动流程：建立常驻首页标签，静态服务器下自动列出同目录 markdown。
   本文件属于 MDSlice 的拆分模块，加载顺序见 MDSlice.html（共享全局作用域，无需打包）。 */
'use strict';

  /* ---- 启动：只建首页并落在首页（不再自动打开 doc.md） ---- */
  var home = createHomeTab();

  if (location.protocol === 'file:') {
    // file:// 无法读取本地目录：首页给出说明 + 「添加目录」入口
    homeNotice = FILE_TIP;
  } else {
    // 静态服务器：自动列出同目录的 markdown，结果异步填进首页
    var autoDir = { name: autoDirName(), source: 'server', children: [], expanded: true,
                    url: new URL('./', location.href).href };
    nodeId(autoDir);
    homeDirs.push(autoDir);
    loadServerDir(autoDir);
  }

  activateTab(home.id);
