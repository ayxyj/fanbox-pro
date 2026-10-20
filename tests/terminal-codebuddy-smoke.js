'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'terminal-codebuddy-')),fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14642','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14641',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map();child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14642/json')).json()).find(t=>t.url==='http://127.0.0.1:14641/');if(target)break;}catch{}}if(!target)throw Error('Page failed '+logs);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof state!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 await delay(2500);
 await request('Page.bringToFront',{});

 const ready=await evaluate(String.raw`(async()=>{
 document.getElementById('guide-ok')?.click();await navigate(${JSON.stringify(require('os').homedir())});
 document.getElementById('terminal-panel').classList.remove('hidden');document.getElementById('terminal-resizer').classList.remove('hidden');term.applyDock();document.getElementById('terminal-panel').style.height='280px';term.fitActive();
 window.cbRaw=[];window.cbInputs=[];window.cbResizes=[];window.fanboxPty.onData(m=>{if(m.id===window.cbSession?.id)cbRaw.push(m.data);});
 const s=await term.newTab(state.cwd,undefined,{shell:'cmd'});window.cbSession=s;
 await new Promise(r=>setTimeout(r,1000));term.input(s.id,'codebuddy\r');
 window.cbSnapshot=()=>{const b=s.xterm.buffer.active;let text='';for(let i=0;i<b.length;i++)text+=b.getLine(i).translateToString(true)+'\n';const r=s.host.getBoundingClientRect();return {headers:(text.match(/CodeBuddy Code v2\./g)||[]).length,text,base:b.baseY,y:b.viewportY,type:b.type,mouse:s.xterm.modes.mouseTrackingMode,windowsPty:s.xterm.options.windowsPty,rows:s.xterm.rows,cols:s.xterm.cols,x:r.x+r.width/2,z:r.y+r.height/2,raw:cbRaw.length,inputs:cbInputs,resizes:cbResizes};};
 for(let i=0;i<450&&!cbSnapshot().headers;i++)await new Promise(r=>setTimeout(r,100));
 if(!cbSnapshot().headers)throw Error('CodeBuddy not ready; this optional test requires the installed CLI to be configured and authenticated.');
 await new Promise(r=>setTimeout(r,1500));s.xterm.onData(d=>cbInputs.push([...d].map(c=>c.charCodeAt(0))));s.xterm.onResize(e=>cbResizes.push(e));
 return cbSnapshot();
 })()`);
 const compact=s=>{const {text,...rest}=s;return {...rest,chars:text.length};};console.log('before',JSON.stringify(compact(ready)));
 for(const dy of [-120,-120,120,120,-120,120]){await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:ready.x,y:ready.z,deltaX:0,deltaY:dy});await delay(150);const snap=await evaluate('cbSnapshot()');console.log('wheel',dy,JSON.stringify(compact(snap)));}
 const baseline=ready;
 for(let round=0;round<3;round++){
  for(const dy of [-120,-120,-120,120,120,120]){await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:ready.x,y:ready.z,deltaX:0,deltaY:dy});await delay(100);}
  const current=await evaluate('cbSnapshot()');assert.equal(current.headers,baseline.headers,'Wheel duplicated headers');assert.deepEqual(current.inputs,baseline.inputs,'Wheel sent application input');assert.deepEqual(current.resizes,baseline.resizes,'Wheel resized terminal');
 }
 const scrollbar=await evaluate(`(()=>{const v=cbSession.host.querySelector('.xterm-viewport'),r=v.getBoundingClientRect();return {x:r.right-5,top:r.top,bottom:r.bottom,height:r.height,scrollHeight:v.scrollHeight,scrollTop:v.scrollTop};})()`);
 const thumbHeight=scrollbar.height*scrollbar.height/scrollbar.scrollHeight;
 const thumbY=scrollbar.top+scrollbar.scrollTop*scrollbar.height/scrollbar.scrollHeight+thumbHeight/2;
 await request('Input.dispatchMouseEvent',{type:'mousePressed',x:scrollbar.x,y:thumbY,button:'left',clickCount:1});
 for(const y of [scrollbar.top+5,scrollbar.bottom-5,scrollbar.top+5,scrollbar.bottom-5]){await request('Input.dispatchMouseEvent',{type:'mouseMoved',x:scrollbar.x,y,button:'left',buttons:1});await delay(200);}
 await request('Input.dispatchMouseEvent',{type:'mouseReleased',x:scrollbar.x,y:scrollbar.bottom-5,button:'left',clickCount:1});await delay(300);
 const afterDrag=await evaluate('cbSnapshot()');assert.equal(afterDrag.headers,baseline.headers,'Scrollbar duplicated headers');assert.deepEqual(afterDrag.inputs,baseline.inputs,'Scrollbar sent input');assert.deepEqual(afterDrag.resizes,baseline.resizes,'Scrollbar resized terminal');
 console.log('Wheel and scrollbar preserve CodeBuddy history:',JSON.stringify(compact(afterDrag)));
 for(let i=0;i<12;i++){await delay(1000);await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:ready.x,y:ready.z,deltaX:0,deltaY:i%2?120:-120});const snap=await evaluate('cbSnapshot()');assert.equal(snap.headers,baseline.headers,'Continued wheel duplicated headers');assert.deepEqual(snap.inputs,baseline.inputs,'Continued wheel sent input');assert.deepEqual(snap.resizes,baseline.resizes,'Continued wheel resized terminal');}
 console.log('PASS: 36 mouse wheel events and scrollbar drag; no duplicate CodeBuddy headers, application input, or resize.');
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
