'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),assert=require('assert/strict');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:1000,height:700,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});
 try{
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{margin:0;overflow:hidden}#xterm-host{position:absolute;inset:0;overflow:hidden}#host{position:absolute;inset:4px 2px 2px 8px;overflow:hidden}.xterm{height:100%}</style><div id="xterm-host"><div id="host"></div></div>'));
  await window.webContents.insertCSS(fs.readFileSync('public/vendor/xterm/xterm.css','utf8'));
  for(const file of ['public/vendor/xterm/xterm.js','public/vendor/xterm/addon-fit.js','public/terminal-layout.js'])await window.webContents.executeJavaScript(fs.readFileSync(file,'utf8'));
  window.on('resize',()=>{window.webContents.executeJavaScript('window.nativeRecover?.()').catch(()=>{})});
  await window.webContents.executeJavaScript(`(async()=>{
   window.terminal=new Terminal({scrollback:6000,fontSize:14});
   const fit=new FitAddon.FitAddon();terminal.loadAddon(fit);terminal.open(document.querySelector('#host'));
   window.session={xterm:terminal,fit,host:document.querySelector('#host')};
   refreshTerminalLayout(session,true);
   await new Promise(resolve=>terminal.write(Array.from({length:4000},(_,i)=>'HISTORY-'+String(i).padStart(5,'0')+'\\r\\n').join(''),resolve));
   terminal.scrollToBottom();
   window.fanboxPty={onLayout:callback=>{window.nativeRecover=callback;return()=>{window.nativeRecover=null}}};
   window.recoveries=0;window.stopWatching=watchTerminalDisplay(()=>{recoveries++;refreshTerminalLayout(session,true)});
  })()`);
  const snapshot=()=>window.webContents.executeJavaScript(`({
   bottom:terminal.buffer.active.viewportY===terminal.buffer.active.baseY,y:terminal.buffer.active.viewportY,base:terminal.buffer.active.baseY,recoveries,
   left:terminal.element.querySelector('.xterm-screen').getBoundingClientRect().left,
   hostLeft:session.host.getBoundingClientRect().left,
   screenWidth:terminal.element.querySelector('.xterm-screen').getBoundingClientRect().width,
   hostWidth:session.host.clientWidth,
   viewportLeft:session.host.querySelector('.xterm-viewport').scrollLeft,
   lines:Array.from({length:terminal.buffer.active.length},(_,i)=>terminal.buffer.active.getLine(i).translateToString(true)).filter(line=>line.startsWith('HISTORY-'))
  })`);
  await new Promise(resolve=>setTimeout(resolve,250));
  await window.webContents.executeJavaScript(`const spacer=document.createElement('div');spacer.style.cssText='width:5000px;height:1px';session.host.parentElement.append(spacer);session.host.parentElement.scrollLeft=80;refreshTerminalLayout(session,true);if(session.host.parentElement.scrollLeft!==0)throw Error('parent clipping persists');spacer.remove()`);
  const original=(await snapshot()).lines;
  assert.equal(original.length,4000);
  await window.webContents.executeJavaScript("terminal.scrollLines(-100);window.readingY=terminal.buffer.active.viewportY;refreshTerminalLayout(session,false)");
  assert(await window.webContents.executeJavaScript('terminal.buffer.active.viewportY===readingY'),'ordinary layout preserves history');
  await window.webContents.executeJavaScript(`window.measureCount=0;const measure=terminal._core._charSizeService.measure.bind(terminal._core._charSizeService);terminal._core._charSizeService.measure=()=>{measureCount++;measure()};refreshTerminalLayout(session,true)`);
  assert(await window.webContents.executeJavaScript('measureCount>0'),'remeasure even when dimensions are unchanged');
  for(const [width,height,zoom] of [[760,500,1.25],[1260,820,1.5],[1000,700,1],[760,500,.8]]){
   await window.webContents.executeJavaScript('terminal.scrollLines(-150)');
   const beforeRecovery=(await snapshot()).recoveries;
   window.setContentSize(width,height);window.webContents.setZoomFactor(zoom);
   await new Promise(resolve=>setTimeout(resolve,450));
   const state=await snapshot();
   assert(state.bottom,'resize/DPI recovers newest output '+JSON.stringify({width,height,zoom,y:state.y,base:state.base,recoveries:state.recoveries,beforeRecovery}));
   assert(state.left>=state.hostLeft-1,'leftmost glyphs remain in host');
   assert(state.screenWidth<=state.hostWidth+1,'canvas fits host');
   assert.equal(state.viewportLeft,0);
   assert.deepEqual(state.lines,original,'history unchanged across display recovery');
  }
  await window.webContents.executeJavaScript(`session.host.style.display='none';window.hiddenResult=refreshTerminalLayout(session,true);session.host.style.display='block';refreshTerminalLayout(session,true);stopWatching()`);
  assert(await window.webContents.executeJavaScript('hiddenResult===false&&terminal.buffer.active.viewportY===terminal.buffer.active.baseY'),'hidden terminal recovers when shown');
  console.log('PASS: resolution/zoom changes, same-size remeasurement, clipped-edge recovery, latest-output scrolling, preserved history and hidden terminals');
 }finally{window.destroy();app.quit()}
}).catch(error=>{console.error(error);app.exit(1)});
