'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('fanboxDesktopPet',{
  isDesktop:true,
  restore:()=>ipcRenderer.invoke('pet:restore'),
  settings:()=>ipcRenderer.invoke('pet:settings'),
  sync:p=>ipcRenderer.invoke('pet:sync',p),
  drag:phase=>ipcRenderer.invoke('pet:drag',phase)
});
contextBridge.exposeInMainWorld('fanboxRemote',{
  call:action=>action==='im-state'?ipcRenderer.invoke('pet:state'):Promise.reject(Error('桌面宠物仅允许读取状态')),
  on:(event,fn)=>{if(event!=='im')return;const listener=(_,state)=>fn(state);ipcRenderer.on('pet:state',listener);return()=>ipcRenderer.removeListener('pet:state',listener);}
});
