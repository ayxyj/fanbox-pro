'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'terminal-selection-'));
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14782','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14781',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='',previous;const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),30000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function drag(modifiers=0,endColumn=11.8){
 const p=await evaluate(`(()=>{const r=selectionSession.host.querySelector('.xterm-screen').getBoundingClientRect(),d=selectionSession.xterm._core._renderService.dimensions.css.cell;return {x:r.x+d.width*.2,y:r.y+d.height*.5,end:r.x+d.width*${endColumn}};})()`);
 await request('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1,modifiers});
 for(let i=1;i<=8;i++)await request('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+(p.end-p.x)*i/8,y:p.y,button:'left',buttons:1,modifiers});
 await request('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.end,y:p.y,button:'left',clickCount:1,modifiers});
 await delay(100);return evaluate('selectionSession.xterm.getSelection()');
}
async function copy(modifiers=2){await request('Input.dispatchKeyEvent',{type:'keyDown',key:'c',code:'KeyC',windowsVirtualKeyCode:67,modifiers});await request('Input.dispatchKeyEvent',{type:'keyUp',key:'c',code:'KeyC',windowsVirtualKeyCode:67,modifiers});await delay(150);return evaluate('fanboxClipboard.read()');}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14782/json')).json()).find(t=>t.url==='http://127.0.0.1:14781/');if(target)break;}catch{}}
 if(!target)throw Error('Page failed '+logs);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 await delay(2000);await request('Page.bringToFront',{});
 previous=await evaluate('fanboxClipboard.read()');
 await evaluate(`(async()=>{document.getElementById('guide-ok')?.click();term.open();window.selectionSession=await term.newTab(undefined,"Write-Output 'SELECTION_READY'",{shell:'powershell'});for(let i=0;i<150&&!term.tailText(selectionSession,40).includes('SELECTION_READY');i++)await new Promise(r=>setTimeout(r,100));await new Promise(r=>setTimeout(r,1000));selectionSession.xterm.reset();await new Promise(r=>selectionSession.xterm.write('SELECT-COPY 中文\\r\\nsecond line\\r\\n',r));window.selectionInput=[];selectionSession.xterm.onData(d=>selectionInput.push(d));selectionSession.xterm.focus();})()`);
 const plain=await drag();assert.equal(plain,'SELECT-COPY ');
 assert.equal(await copy(),plain,'Ctrl+C must copy dragged text');
 const modes=[];
 for(const mode of [1000,1002,1003]){
  await evaluate(`new Promise(r=>selectionSession.xterm.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?${mode}h\x1b[?1006h',r))`);
  const selected=await drag(0,15.8);assert.equal(selected,'SELECT-COPY 中文','drag selection in mouse mode '+mode);assert.equal(await copy(),selected);assert.equal(await copy(10),selected,'Ctrl+Shift+C must copy');
  assert.equal(await drag(8),plain,'Shift selection still works');
  await evaluate('selectionInput.length=0');
  const p=await evaluate(`(()=>{const r=selectionSession.host.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()`);
  await request('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await request('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
  const click=await evaluate('selectionInput.slice()');assert.equal(click.length,2,'application click must send press/release');assert(click[0].endsWith('M'));assert(click[1].endsWith('m'));
  await evaluate('selectionInput.length=0');await drag(1);assert((await evaluate('selectionInput.length'))>=2,'Alt drag still belongs to application');
  modes.push(mode);
 }
 await evaluate(`new Promise(r=>selectionSession.xterm.write('\x1b[?1049h\x1b[2J\x1b[HSELECT-COPY 中文\\r\\nsecond line',r))`);
 assert.equal(await drag(),plain,'alternate-screen drag');
 await evaluate(`selectionSession.host.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));document.querySelector('.terminal-context-menu button').click()`);await delay(100);assert.equal(await evaluate('fanboxClipboard.read()'),plain,'right-click copy');
 await evaluate('selectionSession.xterm.clearSelection();selectionInput.length=0;selectionSession.xterm.focus()');await copy();assert((await evaluate('selectionInput')).includes('\x03'),'Ctrl+C without selection must still interrupt');
 console.log('PASS real mouse drag, Chinese text, Ctrl+C / Ctrl+Shift+C, right-click copy, mouse protocols '+modes.join('/')+', Shift selection, preserved application clicks/Alt drags, alternate screen and Ctrl+C interrupt');
 }finally{if(socket&&previous!==undefined)try{await evaluate('fanboxClipboard.write('+JSON.stringify(previous)+')');}catch{}socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
