'use strict';
const { BrowserWindow, ipcMain, screen, app } = require('electron');
const fs = require('fs'), path = require('path');
function createDesktopPet({ port, getMain, getState }) {
  const file=path.join(app.getPath('userData'),'desktop-pet-position.json');
  let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const area=screen.getPrimaryDisplay().workArea;
  const pet=new BrowserWindow({width:120,height:120,x:area.x+area.width-140,y:area.y+area.height-140,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,hasShadow:false,show:false,focusable:false,webPreferences:{preload:path.join(__dirname,'desktop-pet-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  let dragging=null,timer;
  const clamp=b=>{const r=screen.getDisplayMatching(b).workArea;return {...b,x:Math.round(Math.max(r.x,Math.min(b.x,r.x+r.width-b.width))),y:Math.round(Math.max(r.y,Math.min(b.y,r.y+r.height-b.height)))};};
  if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))pet.setBounds(clamp({...pet.getBounds(),x:saved.x,y:saved.y}));
  const persist=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!pet.isDestroyed())try{fs.writeFileSync(file,JSON.stringify(pet.getBounds()));}catch{}},250);};
  const petGuard=e=>{if(pet.isDestroyed()||e.sender!==pet.webContents||e.senderFrame!==pet.webContents.mainFrame||e.senderFrame.url!==`http://127.0.0.1:${port}/desktop-pet.html`)throw Error('不允许访问桌面宠物');};
  const mainGuard=e=>{const main=getMain();if(!main||e.sender!==main.webContents||e.senderFrame!==main.webContents.mainFrame||new URL(e.senderFrame.url).origin!==`http://127.0.0.1:${port}`)throw Error('不允许访问桌面宠物设置');};
  const restore=()=>{const main=getMain();if(!main||main.isDestroyed())return;if(main.isMinimized())main.restore();main.show();main.focus();};
  const handlers={
    'pet:state':e=>{petGuard(e);return {ok:true,value:getState()};},
    'pet:restore':e=>{petGuard(e);restore();},
    'pet:settings':e=>{petGuard(e);restore();getMain()?.webContents.send('pet:settings');},
    'pet:reset':e=>{mainGuard(e);const r=screen.getPrimaryDisplay().workArea,b=pet.getBounds();pet.setBounds(clamp({...b,x:r.x+r.width-b.width-20,y:r.y+r.height-b.height-20}));persist();},
    'pet:visible':(e,visible)=>{mainGuard(e);if(visible)pet.showInactive();else pet.hide();},
    'pet:sync':(e,{size,hidden}={})=>{petGuard(e);if(![64,88,112].includes(size)||typeof hidden!=='boolean')return;pet.setBounds(clamp({...pet.getBounds(),width:size+32,height:size+32}));hidden?pet.hide():pet.showInactive();persist();},
    'pet:drag':(e,phase)=>{petGuard(e);if(phase==='start')dragging={cursor:screen.getCursorScreenPoint(),bounds:pet.getBounds()};else if(phase==='move'&&dragging){const cursor=screen.getCursorScreenPoint();pet.setBounds(clamp({...dragging.bounds,x:dragging.bounds.x+cursor.x-dragging.cursor.x,y:dragging.bounds.y+cursor.y-dragging.cursor.y}));}else if(phase==='end'){dragging=null;persist();}}
  };
  for(const [name,fn] of Object.entries(handlers))ipcMain.handle(name,fn);
  const reflow=()=>{if(!pet.isDestroyed())pet.setBounds(clamp(pet.getBounds()));};
  screen.on('display-metrics-changed',reflow);screen.on('display-removed',reflow);
  pet.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  pet.webContents.on('will-navigate',(e,url)=>{if(url!==`http://127.0.0.1:${port}/desktop-pet.html`)e.preventDefault();});
  const load=()=>{if(!pet.isDestroyed())pet.loadURL(`http://127.0.0.1:${port}/desktop-pet.html`).catch(()=>{if(!pet.isDestroyed())setTimeout(load,500);});};load();
  pet.on('closed',()=>{clearTimeout(timer);for(const name of Object.keys(handlers))ipcMain.removeHandler(name);screen.removeListener('display-metrics-changed',reflow);screen.removeListener('display-removed',reflow);});
  return { window:pet, publish(state){if(!pet.isDestroyed()&&!state.qr)pet.webContents.send('pet:state',getState());},destroy(){if(!pet.isDestroyed())pet.destroy();} };
}
module.exports={createDesktopPet};
