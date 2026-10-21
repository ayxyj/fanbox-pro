'use strict';
/**
 * FanBox — Electron 主进程
 *
 * 复用零依赖后端 server.js（文件能力），叠加 node-pty 内嵌终端，
 * 让 TUI coding agent（Claude Code / Codex / Aider…）在界面里直接跑起来。
 */
const { app, BrowserWindow, ipcMain, shell, nativeImage, Menu, clipboard, dialog, net, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { isHomeAppDataChange } = require('./watch-filter');
// Single-instance events can arrive while startup dependencies are loading.
let win = null;

// Preserve existing appearance/window settings when renaming the Windows product.
// An explicit --user-data-dir (including test profiles) always takes precedence.
if (process.platform === 'win32' && !process.argv.some(a => a === '--user-data-dir' || a.startsWith('--user-data-dir='))) {
  const previousProfile = path.join(app.getPath('appData'), 'fanbox-pro-win');
  if (fs.existsSync(previousProfile)) app.setPath('userData', previousProfile);
}

// 复用现有后端：require 即 listen 127.0.0.1:PORT，不自动开浏览器
// Acquire the profile lock before starting the HTTP server or opening stores.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  process.exit(0);
}
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
global.__fanboxStartupError = error => {
  app.whenReady().then(() => {
    const detail = error.code === 'EADDRINUSE'
      ? `端口 ${PORT} 已被占用。旧版 FanBox 可能仍在后台运行，请先退出旧版再启动。\n关闭旧版会中断其中的终端和 SSH 会话。`
      : `本地服务启动失败：${error.message}`;
    dialog.showErrorBox('FanBox 启动失败', detail);
    app.exit(1);
  });
};
process.env.FANBOX_NO_OPEN = '1';
const PORT = Number(process.env.GITSYNC_PORT || process.env.FANBOX_PORT) || 4569;
require('../server.js');

// node-pty 是原生模块，需 electron-rebuild 编译过；未就绪时终端能力降级但 app 仍可用
let pty = null;
try { pty = require('node-pty'); }
catch (e) { console.error('[fanbox] node-pty 未就绪（跑 npm run rebuild）：', e.message); }

const terminals = new Map();
const terminalCwds = new Map(); // id -> cwd（Windows 无 /proc/pid/cwd / lsof，直接缓存）
let desktopPet = null;
const remoteWorkspace = require('./remote-workspace').installRemoteWorkspace({ app, ipcMain, dialog, safeStorage, getWindow: () => win, terminals, terminalCwds, port: PORT, onIMState: state => desktopPet?.publish(state) });

// ---------- 窗口尺寸/位置记忆 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (b && b.width > 400 && b.height > 300) return b;
  } catch { /* 首次启动无记录 */ }
  return { width: 1320, height: 860 };
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* */ }
}

function createWindow() {
  const b = loadBounds();
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 920, minHeight: 600,
    icon: path.join(__dirname, '..', 'public', 'brand-icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : 'default',
    ...(process.platform === 'win32' ? {titleBarOverlay:{color:'#151714',symbolColor:'#e4e7df',height:34},autoHideMenuBar:true} : {}),
    backgroundColor: '#0b0c0a',
    ...(isMac ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if(process.platform === 'win32') win.setMenuBarVisibility(false);
  // 拖动/缩放后防抖记忆，关窗再存一次兜底
  let bt = null;
  const remember = () => { clearTimeout(bt); bt = setTimeout(saveBounds, 400); };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', saveBounds);

  // 等后端起来再加载（首次 listen 有几十毫秒延迟）
  const load = () => win.loadURL(`http://127.0.0.1:${PORT}`).catch(() => setTimeout(load, 150));
  setTimeout(load, 250);

  // 外部链接走系统浏览器，不在 app 里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.webContents.once('did-finish-load', () => { if(!desktopPet) desktopPet=require('./desktop-pet').createDesktopPet({port:PORT,getMain:()=>win,getState:()=>remoteWorkspace.petState()}); });
  win.on('closed', () => { desktopPet?.destroy(); desktopPet=null; win = null; });
}

app.whenReady().then(() => {
  // 开发模式下 macOS 默认显示 Electron 图标——换成翻箱自己的（打包后由 electron-builder 的 icon 接管）
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'brand-icon.png'))); } catch { /* */ }
  }
  app.setName('fanbox-pro');
  buildMenu();
  createWindow();
  startShotWatch();
  // 启动 6 秒后查一次新版本（不挡启动）；长开会话每 2 小时再查；
  // 窗口重新聚焦也顺手查（30 分钟节流）——否则发版当天老 app 要等满周期才知道有新版
  // This fork has no configured release feed.

  app.on('browser-window-focus', () => {

  });
});

// ---------- 截图直通车：监听系统截屏落盘，新截图推给渲染层浮出直通卡 ----------
function screenshotDir() {
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execSync('defaults read com.apple.screencapture location 2>/dev/null', { encoding: 'utf8' }).trim();
      if (out) return out.startsWith('~') ? path.join(os.homedir(), out.slice(1)) : out;
    } catch { /* 未自定义 → 默认桌面 */ }
    return path.join(os.homedir(), 'Desktop');
  }
  if (process.platform === 'linux') {
    // Linux 截屏工具常用目录：Flameshot / GNOME Screenshot / Spectacle
    const candidates = [
      path.join(os.homedir(), 'Pictures', 'Screenshots'),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Pictures'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    return path.join(os.homedir(), 'Pictures');
  }
  if (process.platform === 'win32') {
    // Windows 截图（Win+Shift+S / Win+PrtScn）默认保存到 Pictures\Screenshots
    const candidates = [
      path.join(os.homedir(), 'Pictures', 'Screenshots'),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Pictures'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    return path.join(os.homedir(), 'Desktop');
  }
  return path.join(os.homedir(), 'Desktop');
}
let shotWatcher = null;
const shotSent = new Map(); // path -> t，fs.watch 同一文件会连发多个事件，3s 内去重
function startShotWatch() {
  if (shotWatcher) return;
  const dir = screenshotDir();
  if (!fs.existsSync(dir)) return;
  // 截屏文件名模式：macOS + Linux + Windows 常见命名
  const shotRe = process.platform === 'darwin'
    ? /^(截屏|截圖|截图|Screenshot|Screen Shot|CleanShot|SCR-)/i
    : process.platform === 'win32'
      ? /^(Screenshot|截图|截屏|Capture)/i
      : /^(Screenshot|Flameshot|Spectacle|Peek|Deepin_|gnome-screenshot)/i;
  try {
    shotWatcher = fs.watch(dir, { persistent: false }, (evt, filename) => {
      const name = filename ? filename.toString() : '';
      if (!shotRe.test(name) || !/\.(png|jpe?g)$/i.test(name)) return;
      const fp = path.join(dir, name);
      setTimeout(() => { // 等写盘完成再确认
        fs.stat(fp, (err, st) => {
          if (err || !st.isFile() || st.size < 1000) return;
          const last = shotSent.get(fp) || 0;
          if (Date.now() - last < 3000) return;
          shotSent.set(fp, Date.now());
          if (shotSent.size > 50) { const k = shotSent.keys().next().value; shotSent.delete(k); }
          if (win && !win.isDestroyed()) win.webContents.send('shot:new', { path: fp, name, size: st.size });
        });
      }, 600);
    });
  } catch { /* 无权限等，静默放弃 */ }
}

// ---------- 更新检测：查 GitHub Releases，有新版本通知渲染层引导下载 ----------
// 现阶段只做「检测 + 引导」：Apple Development 签名过不了 Squirrel.Mac 的校验，
// electron-updater 全自动更新要等升级 Developer ID 后再换
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
const RELEASE_REPOSITORY = process.env.FANBOX_RELEASE_REPOSITORY || 'ayxyj/fanbox-pro';
const REL_PAGE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(RELEASE_REPOSITORY) ? `https://github.com/${RELEASE_REPOSITORY}/releases/latest` : null;
async function fetchLatestRelease() {
  if (!REL_PAGE) return null;
  // 先走 API（信息全）；代理共享出口 IP 很容易吃 GitHub API 的未认证限流（60 次/小时/IP，403），
  // 失败就退回抓 releases/latest 网页重定向——重定向后的 URL 自带 tag，且不占 API 配额
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
      headers: { 'User-Agent': 'fanbox-app', Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const rel = await res.json();
      if (rel.tag_name) return { tag: rel.tag_name, url: rel.html_url || REL_PAGE };
    }
  } catch { /* 走兜底 */ }
  const res = await net.fetch(REL_PAGE, { headers: { 'User-Agent': 'fanbox-app' } });
  const m = String(res.url || '').match(/\/releases\/tag\/([^/?#]+)/);
  if (m) return { tag: decodeURIComponent(m[1]), url: res.url };
  return null;
}
let pendingUpdate = null; // 渲染层晚注册监听也能拉到（启动 6 秒的推送 vs init 加载大目录，谁先谁后说不准）
let updRetry = 0;
let lastAutoCheck = 0;
async function checkUpdate(opts) {
  const manual = !!(opts && opts.manual);
  if (!REL_PAGE) {
    if (manual) dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {type:"info",buttons:[M("好","OK")],message:M("当前版本尚未配置更新源","No release feed configured"),detail:M("请从 fanbox-pro 的发布页面下载 Windows 安装包。当前版本：" + app.getVersion(),"Download the Windows installer from the fanbox-pro release page. Current version: " + app.getVersion())});
    return;
  }
  if (!manual) lastAutoCheck = Date.now();
  let info = null;
  try { info = await fetchLatestRelease(); } catch { info = null; }
  if (!info) {
    if (manual) {
      dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
        type: 'warning', buttons: [M('好', 'OK')], message: M('检查更新失败', 'Update check failed'),
        detail: M('没连上 GitHub（网络问题或接口限流），稍后再试。', 'Could not reach GitHub (network issue or rate limit). Try again later.'),
      });
    } else if (updRetry < 3) { updRetry++; setTimeout(checkUpdate, 10 * 60 * 1000); } // 失败别干等 12 小时
    return;
  }
  updRetry = 0;
  const newer = cmpVer(info.tag, app.getVersion()) > 0;
  if (newer) {
    pendingUpdate = { version: info.tag.replace(/^v/, ''), url: info.url };
    if (win && !win.isDestroyed()) win.webContents.send('update:available', pendingUpdate);
  }
  if (manual) {
    const owner = win && !win.isDestroyed() ? win : undefined;
    if (newer) {
      const c = dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('去下载', 'Download'), M('取消', 'Cancel')], defaultId: 0, cancelId: 1,
        message: M(`发现新版本 v${pendingUpdate.version}`, `New version v${pendingUpdate.version} available`),
        detail: M(`当前版本 v${app.getVersion()}。点「去下载」打开发布页，下载后替换${process.platform === 'darwin' ? ' /Applications 里的旧版' : '旧版'}即可。`, `You are on v${app.getVersion()}. "Download" opens the release page; replace the old app${process.platform === 'darwin' ? ' in /Applications' : ''}.`),
      });
      if (c === 0) shell.openExternal(pendingUpdate.url);
    } else {
      dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('好', 'OK')], message: M('已是最新版本', 'You are up to date'),
        detail: M(`当前版本 v${app.getVersion()} 就是最新发布版。`, `v${app.getVersion()} is the latest release.`),
      });
    }
  }
}
ipcMain.handle('update:open', (e, { url }) => { if (/^https:\/\/github\.com\//.test(String(url))) shell.openExternal(url); });
ipcMain.handle('update:get', () => pendingUpdate);

// 点完成通知把 app 拉到前台（渲染层 window.focus() 唤不醒最小化/被遮挡的窗口）
ipcMain.handle('win:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// 界面语言：用户手动选过的存在 ~/.fanbox/config.json（渲染层切换时写入），没选过跟随系统
function uiLang() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.fanbox', 'config.json'), 'utf8'));
    if (c.lang === 'zh' || c.lang === 'en') return c.lang;
  } catch { /* 没配置过 */ }
  return String(app.getLocale() || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
const M = (zh, en) => (uiLang() === 'zh' ? zh : en);

// 原生菜单——关键是 Edit role，终端里的 ⌘C/⌘V 才生效
const importedThemes = require('../public/themes/terax-builtin.json');
const skinChoices = [['terminal','终端（默认）','Terminal (default)'],['warm','档案','Archive'],['editorial','索引','Editorial'],...importedThemes.map(t=>[t.id,t.name,t.name])];
let customMenuThemes = [];
let currentTheme = 'terminal';
let currentThemeMode = 'dark';
const sendTheme = command => { if(win && !win.isDestroyed())win.webContents.send('theme:set',command); };
const sendEdit = command => { if(win && !win.isDestroyed())win.webContents.send('clipboard:edit',command); };
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: 'FanBox', submenu: [
      { role: 'about', label: M('关于 FanBox', 'About FanBox') },
      { label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) },
      { type: 'separator' },
      { role: 'hide', label: M('隐藏 FanBox', 'Hide FanBox') }, { role: 'hideOthers', label: M('隐藏其他', 'Hide Others') }, { role: 'unhide', label: M('全部显示', 'Show All') },
      { type: 'separator' },
      { role: 'quit', label: M('退出 FanBox', 'Quit FanBox') },
    ] }] : []),
    { label: M('文件', 'File'), submenu: [
      ...(isMac ? [] : [{ label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) }, { type: 'separator' }]),
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: M('编辑', 'Edit'), submenu: [
      { role: 'undo', label: M('撤销', 'Undo') }, { role: 'redo', label: M('重做', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: M('剪切', 'Cut') },
      { label:M('复制','Copy'), accelerator:'CommandOrControl+C',click:()=>sendEdit('copy') },
      { label:M('复制终端选区','Copy terminal selection'), accelerator:'CommandOrControl+Shift+C',click:()=>sendEdit('copy-selection') },
      { label:M('粘贴','Paste'), accelerator:'CommandOrControl+V',click:()=>sendEdit('paste') },
      { label:M('全选','Select All'),accelerator:'CommandOrControl+A',click:()=>sendEdit('selectAll') },
    ] },
    { label: M('视图', 'View'), submenu: [
      { label: M('主题', 'Appearance'), submenu: [
        { label:M('主题配置…','Theme settings…'),click:()=>sendTheme('settings') },
        { label:M('明暗模式','Color mode'),submenu:[['dark','深色','Dark'],['light','浅色','Light'],['system','跟随系统','System']].map(([id,zh,en])=>({id:'theme-mode-'+id,label:M(zh,en),type:'radio',checked:currentThemeMode===id,click:()=>sendTheme('mode:'+id)})) },
        {type:'separator'},
        ...[...skinChoices,...customMenuThemes].map(([skin,zh,en])=>({id:'skin-'+skin,label:M(zh,en),type:'radio',checked:currentTheme===skin,click:()=>sendTheme(skin)})),
      ] },
      { type: 'separator' },
      { role: 'reload', label: M('重新加载', 'Reload') }, { role: 'toggleDevTools', label: M('开发者工具', 'Developer Tools') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen', label: M('全屏', 'Full Screen') },
    ] },
    { label: M('设置', 'Settings'), submenu: [{ label: M('AI 配置…', 'AI Configuration…'), click: () => { if (win && !win.isDestroyed()) win.webContents.send('remote:settings'); } }, { label: M('IM 远程干预与通知…', 'IM Remote Control…'), click: () => { if (win && !win.isDestroyed()) win.webContents.send('remote:im-settings'); } }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if(process.platform === 'win32' && win) win.setMenuBarVisibility(false);
}
ipcMain.on('theme:changed', (event, value) => {
  if(!win || win.isDestroyed() || event.sender !== win.webContents) return;
  const skin=typeof value==='string'?value:value?.id;
  if(typeof skin!=='string' || skin.length>120)return;
  currentTheme=skin;
  if(['dark','light','system'].includes(value?.mode))currentThemeMode=value.mode;
  if (Array.isArray(value?.custom)) customMenuThemes=value.custom.filter(t=>t && typeof t.id==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id) && t.id.length<=80 && typeof t.name==='string' && t.name.length<=100 && !skinChoices.some(([id])=>id===t.id)).slice(0,100).map(t=>[t.id,t.name,t.name]);
  // Build the radio group from the applied state; individually unchecking items can select a different sibling.
  buildMenu();
});
function assertWindowSender(event) {
  if(!win || win.isDestroyed() || event.sender!==win.webContents)throw Error('Invalid window');
}
ipcMain.handle('clipboard:write-text',(event,text)=>{assertWindowSender(event);if(typeof text!=='string' || text.length>16*1024*1024)throw Error('Invalid clipboard text');clipboard.writeText(text);return true;});
ipcMain.handle('clipboard:read-text',event=>{assertWindowSender(event);return clipboard.readText();});
ipcMain.handle('clipboard:native-edit',(event,command)=>{assertWindowSender(event);const commands={copy:'copy',paste:'paste',selectAll:'selectAll','copy-selection':'copy'};if(typeof command==='string' && Object.hasOwn(commands,command))event.sender[commands[command]]();});
ipcMain.handle('theme:vibrancy',(event,enabled)=>{assertWindowSender(event);if(typeof enabled!=='boolean')return {ok:false,error:'无效参数'};if(process.platform!=='win32' || !win.setBackgroundMaterial)return {ok:false,error:'当前系统不支持 Mica'};const build=Number(os.release().split('.')[2]);if(build<22621)return {ok:false,error:'Mica 需要 Windows 11 22H2 或以上版本'};try{win.setBackgroundMaterial(enabled?'mica':'none');win.setBackgroundColor(enabled?'#00000000':'#0b0c0a');return {ok:true};}catch(err){return {ok:false,error:err.message};}});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
// ⌘Q 兜底：还有终端在跑时（agent 任务），退出前确认，避免手滑全灭
let quitConfirmed = false;
app.on('before-quit', (e) => {
  if (quitConfirmed || terminals.size === 0) return;
  e.preventDefault();
  const choice = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
    type: 'warning',
    buttons: [M('取消', 'Cancel'), M('退出', 'Quit')],
    defaultId: 0,
    cancelId: 0,
    message: M(`还有 ${terminals.size} 个终端会话在运行`, `${terminals.size} terminal session(s) still running`),
    detail: M('退出会终止正在运行的 agent 任务，确定退出？', 'Quitting will terminate running agent tasks. Quit anyway?'),
  });
  if (choice === 1) { quitConfirmed = true; app.quit(); }
});
app.on('window-all-closed', () => {
  terminals.forEach((p) => { try { p.kill(); } catch { /* */ } });
  terminals.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- 终端 IPC（node-pty）----------
ipcMain.handle('pty:spawn', async (e, { id, cwd, cols, rows, autorun, shell: requestedShell, sshProfile }) => {
  remoteWorkspace.guard(e);
  if (terminals.has(id) || remoteWorkspace.ssh.sessions.has(id)) return { ok: false, error: '会话 ID 已存在' };
  if (sshProfile) {
    try {
      const result = await remoteWorkspace.ssh.connect(id, sshProfile, cols || 80, rows || 24);
      terminals.set(id, { remote: true, write: data => remoteWorkspace.ssh.input(id, data), resize: (cols, rows) => remoteWorkspace.ssh.resize(id, cols, rows), kill: () => remoteWorkspace.ssh.disconnect(id) });
      return result;
    } catch (error) { return { ok: false, error: error.message }; }
  }
  if (!pty) return { ok: false, error: 'node-pty 未编译，跑：npm run rebuild' };
  if (requestedShell && !['cmd', 'powershell'].includes(requestedShell)) return { ok: false, error: '未知终端类型' };
  const shellPath = process.platform === 'win32' && requestedShell
    ? requestedShell === 'cmd' ? (process.env.ComSpec || 'cmd.exe') : 'powershell.exe'
    : process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : (process.platform === 'linux' ? '/bin/bash' : '/bin/zsh'));
  const startCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  // GUI 启动的 app 不继承 shell 的 locale，zsh 会把中文路径按字节转义成 \M-^@ 乱码 → 兜底 UTF-8
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', CLICOLOR: '1', FANBOX: '1' };
  // A GUI terminal must not inherit the command runner's non-colour output policy.
  delete env.NO_COLOR;
  if (env.FORCE_COLOR === '0') delete env.FORCE_COLOR;
  // Development hosts may inject their own PowerShell modules. Those modules
  // belong to the host runtime and can block this terminal with trust prompts.
  if (process.platform === 'win32' && env.PSModulePath) {
    env.PSModulePath = env.PSModulePath.split(';').filter(p => !/codex-runtimes|codex-primary-runtime/i.test(p)).join(';');
  }
  if (!/UTF-8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) env.LANG = 'zh_CN.UTF-8';
  let p;
  try {
    const isPowerShell = process.platform === 'win32' && /^(powershell|pwsh)(\.exe)?$/i.test(path.basename(shellPath));
    // npm installs .ps1 command wrappers. Apply policy only to this terminal process,
    // including scheduled/autorun sessions; never change machine or user settings.
    const args = isPowerShell
      ? ['-NoLogo', '-ExecutionPolicy', 'Bypass', ...(autorun ? ['-NoProfile', '-NoExit', '-Command', String(autorun)] : [])]
      : process.platform === 'win32' && /^cmd(\.exe)?$/i.test(path.basename(shellPath))
        ? ['/D', ...(autorun ? ['/K', String(autorun)] : [])]
        : autorun ? ['-c', String(autorun)] : [];
    p = pty.spawn(shellPath, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: startCwd,
      env,
    });
  } catch (err) { return { ok: false, error: err.message }; }
  terminals.set(id, p);
  terminalCwds.set(id, startCwd);
  remoteWorkspace.localStarted(id, shellPath, startCwd);
  p.onData((data) => { remoteWorkspace.localOutput(id, data); if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, data }); });
  p.onExit(({ exitCode }) => {
    remoteWorkspace.localClosed(id);
    terminals.delete(id);
    terminalCwds.delete(id);
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', { id, exitCode });
  });
  return { ok: true, cwd: startCwd };
});
// ---------- 剪贴板：复制图片本体 / 复制文件（访达可粘贴）----------
ipcMain.handle('clip:image', (e, { path: p }) => {
  try { const img = nativeImage.createFromPath(p); if (img.isEmpty()) return { ok: false, error: '不是可读图片' }; clipboard.writeImage(img); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('clip:file', (e, { path: p }) => new Promise((resolve) => {
  const { execFile } = require('child_process');
  if (process.platform === 'darwin') {
    // argv 传路径，避免拼进 AppleScript 字面量被注入
    execFile('osascript', ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', p], (err) => resolve({ ok: !err, error: err && err.message }));
  } else if (process.platform === 'win32') {
    // Windows：用 PowerShell Set-Clipboard -FileDropList 创建文件引用，资源管理器可粘贴
    const ps = `[Collections.Specialized.StringCollection]::new(@('${p.replace(/'/g, "''")}')) | Set-Clipboard -FileDropList`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => resolve({ ok: !err, error: err && err.message }));
  } else {
    // Linux: 复制 file:// URI 到剪贴板（xclip X11 / wl-copy Wayland）
    const uri = 'file://' + p;
    const isWayland = !!(process.env.WAYLAND_DISPLAY);
    const cmd = isWayland ? 'wl-copy' : 'xclip';
    const args = isWayland ? [] : ['-selection', 'clipboard', '-t', 'text/uri-list'];
    execFile(cmd, [...args, uri], (err) => {
      if (!err) return resolve({ ok: true });
      // 回退：把路径当纯文本复制
      execFile('xclip', ['-selection', 'clipboard'], { input: p }, (err2) => resolve({ ok: !err2, error: err2 && err2.message }));
    });
  }
}));

// 拖拽落盘：file-promise 类拖入（截图浮窗等）没有真实路径，把字节写进临时目录换路径
ipcMain.handle('drop:save', (e, { name, buf }) => {
  try {
    const dir = path.join(app.getPath('temp'), 'fanbox-drops');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || '拖入文件.png').replace(/[/\\:]/g, '_');
    let dest = path.join(dir, safe);
    if (fs.existsSync(dest)) dest = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(dest, Buffer.from(buf));
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.on('pty:input', (e, { id, data }) => { try { remoteWorkspace.guard(e); if (remoteWorkspace.authInput(id, data)) return; const p = terminals.get(id); if (p) { if (!p.remote) remoteWorkspace.noteInput(id, data); p.write(data); } } catch {} });
ipcMain.on('pty:resize', (e, { id, cols, rows }) => { try { remoteWorkspace.guard(e); } catch { return; } const p = terminals.get(id); if (p) { try { p.resize(cols, rows); } catch { /* */ } } });
ipcMain.on('pty:kill', (e, { id }) => { try { remoteWorkspace.guard(e); } catch { return; } remoteWorkspace.localClosed(id); if (remoteWorkspace.ssh.sessions.has(id)) remoteWorkspace.ssh.disconnect(id); const p = terminals.get(id); if (p) { try { p.kill(); } catch { /* */ } terminals.delete(id); terminalCwds.delete(id); } });

// lsof 在非 UTF-8 locale 下会把中文路径按字节转义成 \xe8 字面量（GUI 启动的 app 不继承 shell 的 locale，
// 正中这个坑：标签标题乱码、双击定位失效）。调 lsof 时显式给 UTF-8 locale，这里再留一层 \xNN 解码兜底
function decodeLsofPath(s) {
  if (!/\\x[0-9a-fA-F]{2}/.test(s)) return s;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) {
      bytes.push(parseInt(s.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      for (const b of Buffer.from(s[i], 'utf8')) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
// 取某终端 shell 的真实当前目录（Linux 用 /proc/<pid>/cwd 快读，macOS/Win 回退到 lsof）
ipcMain.handle('pty:cwd', (e, { id }) => new Promise((resolve) => {
  const p = terminals.get(id);
  if (!p || !p.pid) return resolve({ ok: false });
  // Windows：没有 /proc/pid/cwd 也没有 lsof，直接返回 spawn 时缓存的路径
  if (process.platform === 'win32') {
    const cached = terminalCwds.get(id);
    return resolve(cached ? { ok: true, cwd: cached } : { ok: false });
  }
  // Linux：/proc/<pid>/cwd 是内核维护的 symlink，比 spawn lsof 快一个数量级
  if (process.platform === 'linux') {
    try {
      const cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`);
      if (cwd) return resolve({ ok: true, cwd });
    } catch { /* 回退到 lsof */ }
  }
  const { exec } = require('child_process');
  exec(`lsof -a -p ${p.pid} -d cwd -Fn`, { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } }, (err, stdout) => {
    if (err) return resolve({ ok: false });
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    resolve(line ? { ok: true, cwd: decodeLsofPath(line.slice(1)) } : { ok: false });
  });
}));

// 取终端前台进程名（node-pty 维护）：判断当前是裸 shell 还是正跑着 claude/codex 等程序
ipcMain.handle('pty:proc', async (e, { id }) => {
  const p = terminals.get(id);
  if (!p || p.remote) return { ok: false };
  if (process.platform !== 'win32') return { ok: true, proc: p.process || '' };
  // node-pty reports the shell name on Windows even while a CLI owns the terminal.
  const pid = Number(p.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: false };
  const script = `Import-Module "$PSHOME\\Modules\\CimCmdlets\\CimCmdlets.psd1"; @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | Where-Object { $_.Name -ne 'conhost.exe' } | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress`;
  return new Promise(resolve => require('child_process').execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
    if (error) return resolve({ ok: false });
    try { const names = stdout.trim() ? JSON.parse(stdout) : []; const children = Array.isArray(names) ? names : [names]; resolve({ ok: true, proc: children[0] || p.process || '', busy: children.length > 0 }); }
    catch { resolve({ ok: false }); }
  }));
});

// ---------- 文件监听（agent 改文件 → 自动刷新 + 跨项目变更收件箱）----------
// 多目录监听：浏览目录 + 每个终端会话所在的项目目录。一下午开多个项目跑 agent 时，
// 不在前台的项目也能感知变更。前端发来期望监听集，这里做增量 diff（关掉多余、补上新增）。
const watchers = new Map(); // dir -> FSWatcher
function startWatch(dir) {
  if (watchers.has(dir) || !dir || !fs.existsSync(dir)) return;
  try {
    // macOS(FSEvents)/Windows 原生递归；Linux 递归不可靠，降级为非递归监听当前目录
    const recursive = process.platform !== 'linux';
    const w = fs.watch(dir, { persistent: false, recursive }, (evt, filename) => {
      if (!win || win.isDestroyed()) return;
      const name = filename ? filename.toString() : null;
      if (isHomeAppDataChange(dir, name, os.homedir())) return;
      // FSEvents 连「文件只是被读了一下」（atime/元数据更新）都报：agent cat/Read 个文件、
      // Spotlight 扫一遍都会触发。mtime/ctime 都不新鲜 = 内容根本没动过，丢弃；
      // stat 失败 = 刚被删，是真变更，照常转发
      if (name) {
        try {
          const st = fs.statSync(path.join(dir, name));
          const now = Date.now();
          if (now - st.mtimeMs > 3000 && now - st.ctimeMs > 3000) return;
        } catch { /* 已删除/无权限：当真变更转发 */ }
      }
      win.webContents.send('fs:changed', { dir, filename: name });
    });
    watchers.set(dir, w);
  } catch { /* 无权限等，跳过该目录 */ }
}
ipcMain.handle('fs:reveal', (event, payload) => {
  assertWindowSender(event);
  try {
    const target = payload?.path;
    if (typeof target !== 'string' || !path.isAbsolute(target)) return {ok:false,error:'文件路径无效'};
    fs.statSync(target);
    shell.showItemInFolder(path.normalize(target));
    return {ok:true,with:'reveal'};
  } catch (error) { return {ok:false,error:error.code==='ENOENT'?'文件不存在':error.message}; }
});
ipcMain.handle('fs:watch-set', (e, { dirs }) => {
  const want = new Set((dirs || []).filter(Boolean));
  for (const [dir, w] of watchers) { if (!want.has(dir)) { try { w.close(); } catch { /* */ } watchers.delete(dir); } }
  for (const dir of want) startWatch(dir);
  return { ok: true, count: watchers.size };
});
// 兼容旧单目录接口：等价于「只监听这一个目录」
ipcMain.handle('fs:watch', (e, { dir }) => {
  for (const [d, w] of watchers) { if (d !== dir) { try { w.close(); } catch { /* */ } watchers.delete(d); } }
  startWatch(dir);
  return { ok: true };
});

const scheduleRequests = new Map();
ipcMain.on('schedule:created', (event, result) => { const request = scheduleRequests.get(result.reqId); if (request && event.sender === win?.webContents) { clearTimeout(request.timer); scheduleRequests.delete(result.reqId); request.resolve(result); } });
global.__fanboxAgent = { create: ({ cwd, autorun }) => new Promise(resolve => {
 if (!win || win.isDestroyed()) return resolve({ ok: false, error: '桌面窗口不可用' });
 const reqId = require('crypto').randomBytes(12).toString('hex');
 const timer = setTimeout(() => { scheduleRequests.delete(reqId); resolve({ ok: false, error: '创建终端超时' }); }, 30000);
 scheduleRequests.set(reqId, { resolve, timer });
 win.webContents.send('schedule:create', { reqId, cwd, command: autorun });
}) };

ipcMain.handle('window:menus',event=>{remoteWorkspace.guard(event);return process.platform==='win32'?Menu.getApplicationMenu().items.map(item=>item.label):[];});
ipcMain.handle('window:menu',(event,{index,x,y}={})=>{remoteWorkspace.guard(event);if(process.platform!=='win32'||!Number.isInteger(index)||!Number.isFinite(x)||!Number.isFinite(y))return;const item=Menu.getApplicationMenu()?.items[index];item?.submenu?.popup({window:win,x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y))});});

ipcMain.handle('window:colors',(event,{color,symbolColor}={})=>{remoteWorkspace.guard(event);if(process.platform!=='win32'||!/^#[0-9a-f]{6}$/i.test(color)||!/^#[0-9a-f]{6}$/i.test(symbolColor))return;win.setTitleBarOverlay({color,symbolColor,height:34});});
