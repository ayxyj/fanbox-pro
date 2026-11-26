'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn,execFileSync}=require('child_process');const {PNG}=require('pngjs');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'terminal-switch-'));
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14794','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14793',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function request(method,params){const id=++seq;const r=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),30000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});socket.send(JSON.stringify({id,method,params}));});if(r.error)throw Error(JSON.stringify(r.error));return r.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function pixels(){const clip=await evaluate(`(()=>{const s=term.sessions.find(s=>s.id===term.active),r=s.host.querySelector('.xterm-screen').getBoundingClientRect(),cell=s.xterm._core._renderService.dimensions.css.cell;return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(cell.width*55),height:Math.floor(cell.height*6),scale:1};})()`);return PNG.sync.read(Buffer.from((await request('Page.captureScreenshot',{format:'png',clip})).data,'base64')).data;}
async function activate(index){await evaluate('term.activate(switchSessions['+index+'].id);true');await delay(200);}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14794/json')).json()).find(t=>t.url==='http://127.0.0.1:14793/');if(target)break;}catch{}}
 if(!target)throw Error('App failed '+logs);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const r=JSON.parse(e.data);pending.get(r.id)?.(r);pending.delete(r.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("document.readyState==='complete' && typeof term!=='undefined'"))break;}catch{}await delay(100);}
 await request('Page.bringToFront',{});
 const setup=await evaluate(`(async()=>{
  localStorage.setItem('fb_guided','1');document.getElementById('guide-ok')?.click();window.__noWebgl=${process.env.TERMINAL_TEST_DOM==='1'};term.open();window.switchSessions=[];
  for(let i=0;i<2;i++)switchSessions.push(await term.newTab(undefined,'echo SWITCH_READY',{shell:'cmd'}));
  await new Promise(r=>setTimeout(r,1500));window.switchInputs=[];window.switchResizes=[];window.atlasClears=0;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for(const [index,s] of switchSessions.entries()){
   s.xterm.options.cursorBlink=false;s.xterm.reset();
   const output=Array.from({length:350},(_,row)=>'\\x1b[3'+(row%7+1)+'m'+String(row).padStart(4,'0')+' '+Array.from({length:45},(_,col)=>alphabet[(row+col+index*9)%alphabet.length]).join('')+' 中文终端 ┃ █\\x1b[0m\\r\\n').join('');
   await new Promise(r=>s.xterm.write(output,r));
   s.xterm.onData(data=>switchInputs.push(data));s.xterm.onResize(size=>switchResizes.push(size));
   const clear=s.xterm.clearTextureAtlas.bind(s.xterm);s.xterm.clearTextureAtlas=()=>{atlasClears++;clear();};
  }
  term.activate(switchSessions[0].id);await new Promise(r=>setTimeout(r,250));switchSessions[0].xterm.scrollToBottom();switchSessions[0].xterm.select(0,switchSessions[0].xterm.buffer.active.viewportY,4);
  window.switchSnapshot=s=>({lines:Array.from({length:s.xterm.buffer.active.length},(_,i)=>s.xterm.buffer.active.getLine(i).translateToString(true)),y:s.xterm.buffer.active.viewportY,selection:s.xterm.getSelection()});
  window.originalSwitchState=switchSnapshot(switchSessions[0]);switchInputs.length=0;switchResizes.length=0;atlasClears=0;
  return {webgl:!!switchSessions[0].xterm._core._renderService._renderer.value._glyphRenderer};
 })()`);
 await delay(250);const reference=await pixels();
 await activate(1);
 const corrupted=await evaluate(`(()=>{const renderer=switchSessions[0].xterm._core._renderService._renderer.value,glyph=renderer._glyphRenderer?.value;if(!glyph)return false;glyph._vertices.attributes.fill(0);return true;})()`);
 await activate(0);
 const recovered=await pixels();
 if(!reference.equals(recovered)){fs.writeFileSync(path.join(root,'reference.rgba'),reference);fs.writeFileSync(path.join(root,'recovered.rgba'),recovered);assert.fail('switching must rebuild stale glyph geometry without scrolling');}
 for(let i=0;i<12;i++)await activate(i%2);
 await activate(0);assert(reference.equals(await pixels()),'repeated switching preserves rendered pixels');
 await evaluate('term.close();true');await delay(100);await evaluate('term.open();true');await delay(300);assert(reference.equals(await pixels()),'panel reopen redraws the current history position');
 const state=await evaluate('({original:originalSwitchState,current:switchSnapshot(switchSessions[0]),inputs:switchInputs,resizes:switchResizes,atlasClears})');
 assert.deepEqual(state.current,state.original,'history, scroll position and selection stay intact');assert.equal(state.inputs.length,0,'redraw must not send terminal input');assert.equal(state.resizes.length,0,'same-size switching must not resize the PTY');assert.equal(state.atlasClears,0,'switching must not invalidate another terminal shared atlas');
 await evaluate(`(async()=>{const a=switchSessions[0];a.xterm.scrollLines(-80);term.activate(switchSessions[1].id);a.output.receive('LATEST-BACKGROUND-OUTPUT\\r\\n'.repeat(100));term.activate(a.id);await a.output.flush();await new Promise(r=>setTimeout(r,250));if(a.xterm.buffer.active.viewportY!==a.xterm.buffer.active.baseY)throw Error('switch must follow latest queued background output');if(!term.tailText(a,10).includes('LATEST-BACKGROUND-OUTPUT'))throw Error('background output missing');})()`);
 console.log('PASS latest background output after switch; pixel-verified tab switching and reopen, stale GPU geometry recovery='+corrupted+', WebGL='+setup.webgl+', preserved history/selection/scroll, no PTY keys/resizes or shared-atlas clearing');
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);if(process.env.GITHUB_ACTIONS)console.log('::error::'+String(error.stack||error).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));process.exitCode=1;});
