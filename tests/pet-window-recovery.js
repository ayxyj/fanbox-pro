'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const handlers=new Map(),timers=new Map();let nextTimer=0;
class Window extends EventEmitter{
 constructor(options){super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.webContents=new EventEmitter();this.webContents.mainFrame={url:'http://127.0.0.1:4569/desktop-pet.html'};this.webContents.sent=[];this.webContents.send=(...v)=>this.webContents.sent.push(v);this.webContents.setWindowOpenHandler=()=>{};}
 getBounds(){return {...this.bounds};}setBounds(b){this.bounds={...b};}isDestroyed(){return false;}setIgnoreMouseEvents(v){this.ignore=v;}setFocusable(v){this.focusable=v;this.skipTaskbar=false;}setSkipTaskbar(v){this.skipTaskbar=v;}setAlwaysOnTop(v){this.topmost=v;}moveTop(){this.raised=true;}isVisible(){return !!this.visible;}showInactive(){this.visible=true;this.skipTaskbar=false;}hide(){this.visible=false;}loadURL(){return Promise.resolve();}destroy(){this.emit('closed');}
}
const screen=Object.assign(new EventEmitter(),{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1200,height:900}}),getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:900}}),getCursorScreenPoint:()=>({x:20,y:20})});
const main={webContents:{mainFrame:{url:'http://127.0.0.1:4569/'}},isDestroyed:()=>false,isMinimized:()=>false,show(){},moveTop(){this.raised=true;},focus(){this.focused=true;}};
const electron={BrowserWindow:Window,screen,app:{getPath:()=>'/test-profile'},ipcMain:{handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)}};
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/desktop-pet.js'),'utf8'),{URL,module:moduleObject,exports:moduleObject.exports,__dirname:__dirname,require:n=>n==='electron'?electron:n==='fs'?{readFileSync(){throw Error('no saved bounds');},writeFileSync(){}}:require(n),setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
const controller=moduleObject.exports.createDesktopPet({port:4569,getMain:()=>main,getState:()=>({})}),pet=controller.window;
const mainEvent={sender:main.webContents,senderFrame:main.webContents.mainFrame},petEvent={sender:pet.webContents,senderFrame:pet.webContents.mainFrame};
const tick=()=>{for(const [id,t]of [...timers])if(t.ms===50){timers.delete(id);t.fn();}};
handlers.get('pet:reset')(mainEvent);assert.equal(pet.ignore,false);assert.equal(pet.focusable,true);assert.equal(pet.skipTaskbar,true,'input recovery preserves taskbar exclusion');assert.equal(pet.bounds.width,121);assert(pet.webContents.sent.some(x=>x[0]==='pet:reset-input'));
handlers.get('pet:reset')(mainEvent);assert.equal(pet.bounds.width,121,'repeated recovery cannot accumulate size changes');tick();assert.equal(pet.bounds.width,120);
handlers.get('pet:reset')(mainEvent);handlers.get('pet:sync')(petEvent,{size:112,hidden:false});tick();assert.equal(pet.bounds.width,144,'recovery cannot overwrite a newer size preference');
handlers.get('pet:restore')(petEvent);assert(main.raised&&main.focused);
handlers.get('pet:reset')(mainEvent);handlers.get('pet:visible')(mainEvent,true);assert(pet.topmost&&pet.raised,'show restores topmost state');assert.equal(pet.skipTaskbar,true,'show restores taskbar exclusion after native state changes');handlers.get('pet:visible')(mainEvent,false);handlers.get('pet:visible')(mainEvent,true);assert.equal(pet.skipTaskbar,true,'repeated hide/show stays out of taskbar');controller.destroy();assert(![...timers.values()].some(t=>t.ms===50));
console.log('PASS native hit-area refresh, preserved size, repeated reset, size-change race, foreground activation and timer cleanup');
