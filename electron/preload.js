'use strict';
/**
 * 安全桥接：把终端 IPC 暴露给渲染进程（contextIsolation 下唯一的通道）。
 * 渲染进程通过 window.fanboxPty 控制 node-pty，window.fanboxEnv 判断是否在桌面 app 内。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('fanboxPty', {
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  input: (id, data) => ipcRenderer.send('pty:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  cwd: (id) => ipcRenderer.invoke('pty:cwd', { id }),
  proc: (id) => ipcRenderer.invoke('pty:proc', { id }),
  onData: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('pty:data', h); return () => ipcRenderer.removeListener('pty:data', h); },
  onExit: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('pty:exit', h); return () => ipcRenderer.removeListener('pty:exit', h); },
});

contextBridge.exposeInMainWorld('fanboxFs', {
  reveal: path => ipcRenderer.invoke('fs:reveal', { path }),
  watch: (dir) => ipcRenderer.invoke('fs:watch', { dir }),
  watchSet: (dirs) => ipcRenderer.invoke('fs:watch-set', { dirs }),
  onChanged: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('fs:changed', h); return () => ipcRenderer.removeListener('fs:changed', h); },
});

contextBridge.exposeInMainWorld('fanboxClipboard', {

  write: text => ipcRenderer.invoke('clipboard:write-text',text),
  read: () => ipcRenderer.invoke('clipboard:read-text'),
  onEdit: cb => { const h=(event,command)=>cb(command); ipcRenderer.on('clipboard:edit',h); return ()=>ipcRenderer.removeListener('clipboard:edit',h); },
  nativeEdit: command => ipcRenderer.invoke('clipboard:native-edit',command),

  copyImage: (path) => ipcRenderer.invoke('clip:image', { path }),
  copyFile: (path) => ipcRenderer.invoke('clip:file', { path }),
});

contextBridge.exposeInMainWorld('fanboxDrop', {
  // 系统拖入的 File → 真实路径（Electron 32+ 移除了 File.path，须走 webUtils）
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  // file-promise 类拖拽（如 macOS 截图浮窗缩略图）没有现成路径：把内容落盘到临时目录换一个路径
  saveTemp: (name, buf) => ipcRenderer.invoke('drop:save', { name, buf }),
});

contextBridge.exposeInMainWorld('fanboxShot', {
  // 系统截屏落盘事件（截图直通车）
  onNew: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('shot:new', h); return () => ipcRenderer.removeListener('shot:new', h); },
});

contextBridge.exposeInMainWorld('fanboxUpdate', {
  onAvailable: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('update:available', h); return () => ipcRenderer.removeListener('update:available', h); },
  get: () => ipcRenderer.invoke('update:get'), // 拉一把启动早期可能错过的推送
  open: (url) => ipcRenderer.invoke('update:open', { url }),
});

contextBridge.exposeInMainWorld('fanboxWin', {
  focus: () => ipcRenderer.invoke('win:focus'), // 点通知拉回前台
});

contextBridge.exposeInMainWorld('fanboxEnv', {
  isDesktopApp: true,
  platform: process.platform,
});

contextBridge.exposeInMainWorld('fanboxSchedule', {
 onCreate: cb => ipcRenderer.on('schedule:create', (event, message) => cb(message)),
 created: result => ipcRenderer.send('schedule:created', result),
});

contextBridge.exposeInMainWorld('fanboxTheme', {
  onChange: cb => { const handler=(event, skin)=>cb(skin); ipcRenderer.on('theme:set',handler); return ()=>ipcRenderer.removeListener('theme:set',handler); },
  changed: skin => ipcRenderer.send('theme:changed',skin),
  vibrancy: enabled => ipcRenderer.invoke('theme:vibrancy',enabled),
});


contextBridge.exposeInMainWorld('fanboxRemote', {
  call: (action, args) => {
    const allowed = ['mcp-read','mcp-save','mcp-prepare','cli-permission','state','save-profile','save-shortcut','delete-shortcut','rename-shortcut-group','run-shortcut','delete-profile','save-ai','list-ai-models','test-ai-model','reveal-ai-key','reveal-im-secret','pick-key','list','read','write','transfer','cancel-transfer','ai-run','ai-stop','ai-takeover','ai-resume','history-list','history-open','history-read','history-delete','target','set-target-environment','auth-reply','approval-reply','activate-ai','deactivate-ai','delete-ai','policy','ai-clear','im-state','im-reconnect','im-save','im-qr-start','im-qr-cancel','im-bind','im-unbind','im-terminal-created'];
    if (!allowed.includes(action)) return Promise.reject(new Error('Unknown remote action'));
    return ipcRenderer.invoke('remote:' + action, args);
  },
  on: (event, callback) => {
    if (!['status','transfer','ai','auth','auth-close','approval','approval-close','settings','im-settings','mcp-settings','im','im-create-terminal','im-task','im-task-done'].includes(event)) throw new Error('Unknown remote event');
    const channel = 'remote:' + event, listener = (_, data) => callback(data);
    ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener);
  },
});

contextBridge.exposeInMainWorld('fanboxDesktopPet',{isDesktop:false,reset:()=>ipcRenderer.invoke('pet:reset'),visible:value=>ipcRenderer.invoke('pet:visible',value),onSettings:fn=>{const listener=()=>fn();ipcRenderer.on('pet:settings',listener);return()=>ipcRenderer.removeListener('pet:settings',listener);}});

contextBridge.exposeInMainWorld('fanboxWindowMenu',{colors:args=>ipcRenderer.invoke('window:colors',args),list:()=>ipcRenderer.invoke('window:menus'),open:args=>ipcRenderer.invoke('window:menu',args)});
