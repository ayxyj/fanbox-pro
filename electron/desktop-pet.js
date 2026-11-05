'use strict';
const { BrowserWindow, ipcMain, screen, app } = require('electron');
const fs = require('fs'), path = require('path');
function createDesktopPet({ port, getMain, getState }) {
  const file=path.join(app.getPath('userData'),'desktop-pet-position.json');
  let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const area=screen.getPrimaryDisplay().workArea;
  const pet=new BrowserWindow({width:120,height:120,x:area.x+area.width-140,y:area.y+area.height-140,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:false,maximizable:false,minimizable:false,hasShadow:false,show:false,focusable:true,webPreferences:{preload:path.join(__dirname,'desktop-pet-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  let dragging=null,dragTimer,timer,inputRefreshTimer,inputRestoreSize;
  const raise=()=>{if(!pet.isDestroyed()){pet.setAlwaysOnTop(true,'screen-saver');pet.moveTop();pet.setSkipTaskbar(true);}};
  const showPet=()=>{pet.setSkipTaskbar(true);pet.showInactive();raise();};
  const mainWindow=getMain(),raiseVisible=()=>{if(!pet.isDestroyed()&&pet.isVisible())raise();};
  pet.on('show',raise);
  mainWindow?.on?.('focus',raiseVisible);
  const clamp=b=>{const r=screen.getDisplayMatching(b).workArea;return {...b,x:Math.round(Math.max(r.x,Math.min(b.x,r.x+r.width-b.width))),y:Math.round(Math.max(r.y,Math.min(b.y,r.y+r.height-b.height)))};};
  if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))pet.setBounds(clamp({...pet.getBounds(),x:saved.x,y:saved.y}));
  const persist=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!pet.isDestroyed())try{fs.writeFileSync(file,JSON.stringify(pet.getBounds()));}catch{}},250);};
  const petGuard=e=>{if(pet.isDestroyed()||e.sender!==pet.webContents||e.senderFrame!==pet.webContents.mainFrame||e.senderFrame.url!==`http://127.0.0.1:${port}/desktop-pet.html`)throw Error('不允许访问桌面宠物');};
  const mainGuard=e=>{const main=getMain();if(!main||e.sender!==main.webContents||e.senderFrame!==main.webContents.mainFrame||new URL(e.senderFrame.url).origin!==`http://127.0.0.1:${port}`)throw Error('不允许访问桌面宠物设置');};
  const restore=()=>{const main=getMain();if(!main||main.isDestroyed())return;if(main.isMinimized())main.restore();main.show();main.moveTop();main.focus();};
  const updateDrag=()=>{
    if(!dragging||pet.isDestroyed())return;
    const cursor=screen.getCursorScreenPoint();
    if(cursor.x===dragging.lastX&&cursor.y===dragging.lastY)return;
    dragging.lastX=cursor.x;dragging.lastY=cursor.y;
    if(!dragging.moved&&Math.abs(cursor.x-dragging.cursor.x)+Math.abs(cursor.y-dragging.cursor.y)<=5)return;
    dragging.moved=true;
    const b=clamp({...dragging.bounds,x:dragging.bounds.x+cursor.x-dragging.cursor.x,y:dragging.bounds.y+cursor.y-dragging.cursor.y});
    if(b.x!==dragging.x||b.y!==dragging.y){pet.setPosition(b.x,b.y,false);dragging.x=b.x;dragging.y=b.y;}
  };
  const stopDrag=()=>{clearInterval(dragTimer);dragTimer=null;dragging=null;};
  const resetInput=()=>{stopDrag();if(inputRestoreSize){pet.setBounds(clamp({...pet.getBounds(),...inputRestoreSize}));inputRestoreSize=null;}pet.setIgnoreMouseEvents(false);pet.setFocusable(true);pet.setSkipTaskbar(true);pet.webContents.send('pet:reset-input');};
  const refreshInputSurface=()=>{
    clearTimeout(inputRefreshTimer);
    const {width,height}=pet.getBounds();
    inputRestoreSize={width,height};
    // Refresh the native surface just as changing pet size does, then restore
    // the configured dimensions without changing the saved preferences.
    pet.setBounds(clamp({...pet.getBounds(),width:width+1,height:height+1}));
    inputRefreshTimer=setTimeout(()=>{if(!pet.isDestroyed())pet.setBounds(clamp({...pet.getBounds(),width,height}));inputRestoreSize=null;},50);
  };
  let interactive=false;
  pet.setIgnoreMouseEvents(true,{forward:true});
  const handlers={
    'pet:interactive':(e,value)=>{petGuard(e);if(typeof value!=='boolean')return;interactive=value;if(!dragging)pet.setIgnoreMouseEvents(!value,{forward:true});},
    'pet:state':e=>{petGuard(e);return {ok:true,value:getState()};},
    'pet:restore':e=>{petGuard(e);restore();},
    'pet:settings':e=>{petGuard(e);restore();getMain()?.webContents.send('pet:settings');},
    'pet:reset':e=>{mainGuard(e);clearTimeout(inputRefreshTimer);resetInput();const r=screen.getPrimaryDisplay().workArea,b=pet.getBounds();pet.setBounds(clamp({...b,x:r.x+r.width-b.width-20,y:r.y+r.height-b.height-20}));refreshInputSurface();persist();},
    'pet:visible':(e,visible)=>{mainGuard(e);if(typeof visible!=='boolean')return;pet.webContents.send('pet:visibility',visible);if(visible){pet.setBounds(clamp(pet.getBounds()));showPet();}else pet.hide();},
    'pet:sync':(e,{size,hidden}={})=>{petGuard(e);if(![64,88,112].includes(size)||typeof hidden!=='boolean')return;clearTimeout(inputRefreshTimer);inputRestoreSize=null;pet.setBounds(clamp({...pet.getBounds(),width:320,height:size+54}));hidden?pet.hide():showPet();persist();},
    'pet:drag':(e,phase)=>{petGuard(e);if(phase==='start'){stopDrag();pet.setIgnoreMouseEvents(false);dragging={cursor:screen.getCursorScreenPoint(),bounds:pet.getBounds()};dragTimer=setInterval(updateDrag,16);}else if(phase==='end'){updateDrag();stopDrag();pet.setIgnoreMouseEvents(!interactive,{forward:true});persist();}}
  };
  const hitTest=(e,value)=>handlers['pet:interactive'](e,value);
  ipcMain.on('pet:hit-test',hitTest);
  for(const [name,fn] of Object.entries(handlers))ipcMain.handle(name,fn);
  const reflow=()=>{if(!pet.isDestroyed())pet.setBounds(clamp(pet.getBounds()));};
  screen.on('display-metrics-changed',reflow);screen.on('display-removed',reflow);
  pet.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  pet.webContents.on('will-navigate',(e,url)=>{if(url!==`http://127.0.0.1:${port}/desktop-pet.html`)e.preventDefault();});
  const load=()=>{if(!pet.isDestroyed())pet.loadURL(`http://127.0.0.1:${port}/desktop-pet.html`).catch(()=>{if(!pet.isDestroyed())setTimeout(load,500);});};load();
  pet.on('closed',()=>{ipcMain.removeListener('pet:hit-test',hitTest);stopDrag();mainWindow?.removeListener?.('focus',raiseVisible);clearTimeout(timer);clearTimeout(inputRefreshTimer);for(const name of Object.keys(handlers))ipcMain.removeHandler(name);screen.removeListener('display-metrics-changed',reflow);screen.removeListener('display-removed',reflow);});
  return { window:pet, publish(state){if(!pet.isDestroyed()&&!state.qr)pet.webContents.send('pet:state',getState());},destroy(){if(!pet.isDestroyed())pet.destroy();} };
}
module.exports={createDesktopPet};
