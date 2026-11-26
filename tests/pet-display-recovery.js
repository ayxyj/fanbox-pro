'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'../electron/desktop-pet.js'),'utf8');
const display=(id,x,y,width,height,scaleFactor=1)=>({id,scaleFactor,bounds:{x,y,width,height},workArea:{x,y,width,height}});
function harness(initial,primaryId=initial[0].id,saved){
 let displays=initial,cursor={x:0,y:0},clock=0,next=0,written,primary=primaryId;
 const timers=new Map(),handlers=new Map(),ipcEvents=new EventEmitter(),screen=new EventEmitter(),main=new EventEmitter();
 Object.assign(main,{webContents:{mainFrame:{url:'http://127.0.0.1:4569/'}},isDestroyed:()=>false,isMinimized:()=>false,show(){},moveTop(){},focus(){}});
 const distance=(p,r)=>Math.max(r.x-p.x,0,p.x-r.x-r.width)**2+Math.max(r.y-p.y,0,p.y-r.y-r.height)**2;
 const nearest=p=>displays.reduce((a,b)=>distance(p,a.bounds)<=distance(p,b.bounds)?a:b);
 Object.assign(screen,{getAllDisplays:()=>displays,getPrimaryDisplay:()=>displays.find(d=>d.id===primary)||displays[0],getCursorScreenPoint:()=>({...cursor}),getDisplayNearestPoint:nearest,getDisplayMatching:b=>{
  assert(['x','y','width','height'].every(k=>Number.isInteger(b[k]))&&b.width>0&&b.height>0,'native getDisplayMatching requires a complete valid DIP Rectangle');
  const overlap=d=>Math.max(0,Math.min(b.x+b.width,d.bounds.x+d.bounds.width)-Math.max(b.x,d.bounds.x))*Math.max(0,Math.min(b.y+b.height,d.bounds.y+d.bounds.height)-Math.max(b.y,d.bounds.y));
  const matched=displays.reduce((a,d)=>overlap(a)>=overlap(d)?a:d);
  return overlap(matched)>0?matched:nearest({x:b.x+b.width/2,y:b.y+b.height/2});
 }});
 class Window extends EventEmitter{
  constructor(options){super();this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.mainFrame={url:'http://127.0.0.1:4569/desktop-pet.html'};this.webContents.sent=[];this.webContents.send=(...v)=>this.webContents.sent.push(v);this.webContents.setWindowOpenHandler=()=>{};}
  getBounds(){return {...this.bounds};}setPosition(x,y){this.bounds={...this.bounds,x,y};}setBounds(b){const resized=b.width!==this.bounds.width||b.height!==this.bounds.height;this.bounds={...b};if(resized)this.emit('resize');}
  isDestroyed(){return this.destroyed;}setIgnoreMouseEvents(v){this.ignore=v;}setFocusable(v){this.focusable=v;}setSkipTaskbar(v){this.skipTaskbar=v;}setAlwaysOnTop(){}moveTop(){}isVisible(){return this.visible;}showInactive(){this.visible=true;this.emit('show');}hide(){this.visible=false;}loadURL(){return Promise.resolve();}destroy(){this.destroyed=true;this.emit('closed');}
 }
 const electron={BrowserWindow:Window,screen,app:{getPath:()=>'/test-profile'},ipcMain:{on:(n,fn)=>ipcEvents.on(n,fn),removeListener:(n,fn)=>ipcEvents.removeListener(n,fn),handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)}};
 const schedule=(fn,ms,interval)=>{const id=++next;timers.set(id,{fn,at:clock+ms,interval:interval?ms:0});return id;};
 const moduleObject={exports:{}};
 vm.runInNewContext(source,{URL,module:moduleObject,exports:moduleObject.exports,__dirname,require:n=>n==='electron'?electron:n==='fs'?{readFileSync(){if(saved)return JSON.stringify(saved);throw Error('no saved position');},writeFileSync(file,data){written=JSON.parse(data);}}:require(n),setTimeout:(fn,ms)=>schedule(fn,ms,false),setInterval:(fn,ms)=>schedule(fn,ms,true),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)});
 const controller=moduleObject.exports.createDesktopPet({port:4569,getMain:()=>main,getState:()=>({})}),pet=controller.window;
 const petEvent={sender:pet.webContents,senderFrame:pet.webContents.mainFrame},mainEvent={sender:main.webContents,senderFrame:main.webContents.mainFrame};
 const advance=ms=>{const end=clock+ms;for(let count=0;count<10000;count++){
  const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
  if(!entry){clock=end;return;}const [id,t]=entry;clock=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();
 }throw Error('timer loop');};
 const invoke=(name,value)=>handlers.get(name)(name==='pet:visible'||name==='pet:reset'?mainEvent:petEvent,value);
 const sync=(width=120,height=150,size=88,hidden=false)=>invoke('pet:sync',{size,hidden,width,height});
 const begin=()=>{cursor={x:pet.bounds.x+pet.bounds.width/2,y:pet.bounds.y+pet.bounds.height/2};invoke('pet:drag','start');};
 const move=(x,y)=>{cursor={x,y};advance(16);};
 const end=()=>invoke('pet:drag','end');
 const dragTo=(x,y)=>{begin();move(cursor.x+x-pet.bounds.x,cursor.y+y-pet.bounds.y);end();};
 const bounds=()=>JSON.parse(JSON.stringify(pet.getBounds()));
 const topology=(value,newPrimary=primary)=>{displays=value;primary=newPrimary;};
 const close=()=>{controller.destroy();assert.equal(timers.size,0,'destroy clears native movement, resize, surface, persistence and delayed recovery timers');assert.equal(handlers.size,0);for(const event of ['display-added','display-removed','display-metrics-changed'])assert.equal(screen.listenerCount(event),0,event+' listener released');assert.equal(ipcEvents.listenerCount('pet:hit-test'),0);};
 return {screen,pet,advance,invoke,sync,begin,move,end,dragTo,bounds,topology,close,timers,get saved(){return written;},get cursor(){return cursor;}};
}
const compact={width:120,height:150};
// All coordinates are Electron DIP. The side monitor has a negative origin and a different scale factor.
{
 const h=harness([display(1,0,40,1920,1000),display(2,-1600,-200,1600,900,1.5)]);h.sync();
 assert.equal(h.bounds().width,120,'renderer-measured window replaces the old 320 DIP transparent strip');
 h.begin();h.move(-4000,-100);assert.equal(h.bounds().x,-1600,'pet can reach the left edge of the negative-coordinate display');h.move(-3990,-100);assert.equal(h.bounds().x,-1590,'edge overshoot has no reverse-drag dead zone');
 h.move(-1500,2000);assert.equal(h.bounds().y,700-compact.height,'bottom boundary follows the destination work area');h.end();h.advance(1000);
 assert.equal(h.saved.displayId,2,'persistence keeps destination display identity');assert.equal(h.saved.workArea.x,-1600);
 h.close();
}
// Replacing the primary monitor changes the desktop origin; keep the same monitor and edge gaps.
{
 const h=harness([display(1,0,0,1920,1040),display(2,1920,80,1280,920,1.5)]);h.sync();h.dragTo(3060,830);h.advance(300);
 const before=h.bounds();assert.equal(before.x,3200-compact.width-20);assert.equal(before.y,1000-compact.height-20);
 h.begin();const resets=h.pet.webContents.sent.filter(v=>v[0]==='pet:reset-input').length;
 h.topology([display(1,1280,0,1920,1040),display(2,0,48,1280,672,2)],2);h.screen.emit('display-metrics-changed',{},null,['bounds','workArea','scaleFactor']);
 assert(![...h.timers.values()].some(t=>t.interval===16),'screen changes cancel the old native drag');assert(h.pet.webContents.sent.filter(v=>v[0]==='pet:reset-input').length>resets,'screen changes clear renderer capture state');
 h.advance(1000);assert.deepEqual(h.bounds(),{x:1140,y:550,...compact},'same display ID retains 20 DIP right/bottom gaps after origin, resolution and DPI changes');assert.equal(h.pet.ignore,false,'native input is re-enabled after topology recovery');assert(h.pet.visible,'visible pet remains visible');
 h.invoke('pet:visible',false);h.topology([display(1,1280,0,1920,1040)],1);h.screen.emit('display-removed',{},null);h.advance(1000);assert(!h.pet.visible,'display removal never unhides a hidden pet');
 const r=h.bounds();assert(r.x>=1280&&r.x+r.width<=3200&&r.y>=0&&r.y+r.height<=1040,'unplugged-monitor position moves into the remaining work area');
 h.invoke('pet:visible',true);assert(h.pet.visible);h.close();
}
// Windows may resize/reposition the native window before reporting its display topology change.
{
 const h=harness([display(1,0,0,1920,1040),display(2,1920,80,1280,920,1.5)]);h.sync();h.dragTo(3060,830);h.advance(300);const anchored=h.bounds();
 h.pet.setBounds({x:100,y:100,width:240,height:300});h.advance(0);assert.deepEqual(h.bounds(),anchored,'native DPI movement cannot overwrite the last user placement/display before the screen event');
 h.topology([display(1,1280,0,1920,1040),display(2,0,48,1280,672,2)],2);h.screen.emit('display-metrics-changed');h.advance(1000);assert.deepEqual(h.bounds(),{x:1140,y:550,...compact},'late screen event still projects onto the original display ID');h.close();
}
// Interior positions track relative free-space coordinates, including a taskbar at the top.
{
 const h=harness([display(1,0,0,1920,1040)]);h.sync();h.dragTo(600,400);const before=h.bounds();
 h.topology([display(1,-1280,40,1280,680,1.25)]);h.screen.emit('display-metrics-changed');h.advance(1000);
 assert.deepEqual(h.bounds(),{x:Math.round(-1280+(before.x/(1920-120))*(1280-120)),y:Math.round(40+(before.y/(1040-150))*(680-150)),...compact},'interior placement remains proportional within the usable work area');
 h.pet.setBounds({...h.bounds(),width:240,height:300});h.advance(0);assert.equal(h.bounds().width,120,'native DPI width changes are restored to configured DIP size');assert.equal(h.bounds().height,150,'native DPI height changes cannot create a false lower drag boundary');
 h.topology([display(1,-1280,40,1280,680,1.25),display(3,0,-1080,1920,1080)]);const resetCount=h.pet.webContents.sent.length;h.screen.emit('display-added');h.advance(1000);assert(h.pet.webContents.sent.length>resetCount,'new monitor triggers geometry/input recovery');
 h.close();
}
// Late Windows bounds/work-area updates settle again; user actions supersede pending recoveries.
{
 const h=harness([display(1,0,0,1920,1040)]);h.sync();h.screen.emit('display-metrics-changed');h.advance(100);
 h.topology([display(1,0,40,1280,680,1.5)]);
 h.pet.setBounds({...h.bounds(),width:200,height:250});h.advance(0);h.advance(900);assert.deepEqual(h.bounds(),{x:1140,y:550,...compact},'delayed native dimensions/work-area updates converge to configured size and anchored edge gaps');
 h.screen.emit('display-metrics-changed');h.advance(50);h.dragTo(200,180);const moved=h.bounds();h.advance(1200);assert.deepEqual(h.bounds(),moved,'pending screen recovery cannot snap back after a new drag');
 h.screen.emit('display-metrics-changed');h.sync(180,190,112);h.advance(1200);assert.equal(h.bounds().width,180);assert.equal(h.bounds().height,190,'pending recovery cannot overwrite a new pet size');
 h.screen.emit('display-metrics-changed');h.close();
}
// Input-surface refresh must restore the whole bounds, including positions touching an edge.
{
 const h=harness([display(1,0,0,1920,1040)]);h.sync();h.dragTo(1800,890);const edge=h.bounds();
 for(let i=0;i<4;i++){h.screen.emit('display-metrics-changed');h.advance(1000);assert.deepEqual(h.bounds(),edge,'repeated surface refresh cannot creep away from an exact right/bottom edge');}
 h.close();
}
// Old versions saved only an absolute position; malformed metadata must not enter native Rectangle APIs.
{
 for(const saved of [{x:210,y:180},{x:210,y:180,width:'broken',height:null,displayId:99,workArea:{x:0,y:0,width:0,height:900}},{x:210,y:180,width:120,height:150,displayId:99,workArea:{x:0,y:0,width:null,height:900}}]){
  const h=harness([display(1,0,0,1920,1040)],1,saved);assert.equal(h.bounds().x,210);assert.equal(h.bounds().y,180);h.sync();h.advance(300);assert(h.saved.workArea.width>0);h.close();
 }
 const saved={x:3060,y:830,width:120,height:150,displayId:2,workArea:{x:1920,y:80,width:1280,height:920}};
 const h=harness([display(1,1280,0,1920,1040),display(2,0,48,1280,672,2)],2,saved);h.sync();h.advance(300);assert.deepEqual(h.bounds(),{x:1140,y:550,...compact},'saved display identity/edge metadata survives restarting after monitor topology changed');h.close();
}
console.log('PASS legacy and malformed saved positions; compact pet bounds, mixed-DPI negative-coordinate drag, immediate edge reversal, monitor identity/origin/resolution/taskbar changes, unplug/add, hidden recovery, native-size repair, stale-timer cancellation and cleanup');
