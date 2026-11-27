'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'terminal-scroll-')),fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14628','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14627',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map();child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14628/json')).json()).find(t=>t.url==='http://127.0.0.1:14627/');if(target)break;}catch{}}if(!target)throw Error('Page failed '+logs);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof state!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 await delay(2500);
 await request('Page.bringToFront',{});
 const ready=await evaluate(String.raw`(async()=>{
 document.getElementById('guide-ok')?.click();await navigate(${JSON.stringify(fixtures)});
 document.getElementById('terminal-panel').classList.remove('hidden');document.getElementById('terminal-resizer').classList.remove('hidden');term.applyDock();
 const command="Write-Output ('ENV-COLOR:'+$(if($env:NO_COLOR){$env:NO_COLOR}else{'none'})+'|'+$env:TERM+'|'+$env:COLORTERM);Write-Output ('CLAUDE-SCROLLBACK:'+$env:CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN+'|'+$env:CLAUDE_CODE_NO_FLICKER);Write-Output ([char]27+'[31mCOLOR-RED'+[char]27+'[0m '+[char]27+'[38;5;42mCOLOR-256'+[char]27+'[0m '+[char]27+'[38;2;12;180;90mCOLOR-RGB'+[char]27+'[0m');Write-Output 'COLOR-READY'";
 const s=await term.newTab(state.cwd,command,{shell:'powershell'});window.scrollTestSession=s;
 if(window.fanboxEnv?.platform==='win32'){
  const expected=await window.fanboxPty.options();
  if(s.xterm.options.windowsMode!==expected.windowsMode||s.xterm.options.windowsPty.backend!==expected.windowsPty.backend)throw Error('Local Windows terminal compatibility options missing');
 }
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const text=()=>{let out='';const b=s.xterm.buffer.active;for(let i=0;i<b.length;i++)out+=b.getLine(i).translateToString(true)+'\n';return out;};
 for(let i=0;i<150&&!text().includes('COLOR-READY');i++)await pause(100);
 const output=text();if(!output.includes('ENV-COLOR:none|xterm-256color|truecolor'))throw Error('Colour environment wrong: '+output);
 if(!output.includes('CLAUDE-SCROLLBACK:1|0'))throw Error('Claude native scrollback environment missing: '+output);
 let colours=[];const b=s.xterm.buffer.active;for(let i=0;i<b.length;i++){const line=b.getLine(i),row=line.translateToString(true);if(row.startsWith('COLOR-RED'))for(const word of ['COLOR-RED','COLOR-256','COLOR-RGB']){const cell=line.getCell(row.indexOf(word));colours.push({word,palette:cell.isFgPalette(),rgb:cell.isFgRGB(),colour:cell.getFgColor()});}}
 if(colours.length!==3 || colours[0].colour!==1 || colours[1].colour!==42 || colours[2].colour!==0x0cb45a)throw Error('ANSI colours lost: '+JSON.stringify(colours));
 await pause(500);s.xterm.reset();
 const batch=Array.from({length:6500},(_,i)=>'UNIQUE-'+String(i).padStart(5,'0')+'\r\n').join('')+'LEGAL-REPEAT\r\nLEGAL-REPEAT\r\n';s.output.receive(batch);
 for(let i=0;i<150&&!text().includes('UNIQUE-06499');i++)await pause(100);
 window.scrollSnapshot=()=>{const b=s.xterm.buffer.active;const lines=[];for(let i=0;i<b.length;i++)lines.push(b.getLine(i).translateToString(true));return {y:b.viewportY,base:b.baseY,lines,top:lines[b.viewportY],scrollTop:s.host.querySelector('.xterm-viewport').scrollTop};};
 const snap=scrollSnapshot(),numbers=snap.lines.filter(l=>/^UNIQUE-/.test(l));
 if(numbers.length<4900 || new Set(numbers).size!==numbers.length)throw Error('Duplicate/missing buffer records');
 if(snap.lines.filter(line=>line==='LEGAL-REPEAT').length!==2)throw Error('Legitimate repeated output was dropped');
 window.beforeScrollBuffer=snap.lines.join('\n');
 window.scrollWheelDiagnostics={inputs:[],resizes:[]};
 const wheelData=s.xterm.onData(data=>scrollWheelDiagnostics.inputs.push(data)),wheelSize=s.xterm.onResize(size=>scrollWheelDiagnostics.resizes.push(size));
 window.stopWheelDiagnostics=()=>{wheelData.dispose();wheelSize.dispose();};
 s.xterm._core.viewport._ignoreNextScrollEvent=true; // Reproduce the stale DOM scroll event guard after a hide/refresh.
 const r=s.host.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,base:snap.base,colours,retained:numbers.length};
 })()`);
 let previous=await evaluate('scrollSnapshot()');
 for(let i=0;i<24;i++){
  await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:ready.x,y:ready.y,deltaX:0,deltaY:-120});await delay(40);
  const current=await evaluate('scrollSnapshot()');assert(current.y<previous.y,'Upward wheel repeated the same viewport');assert.notEqual(current.top,previous.top,'Same top record repeated');previous=current;
 }
 for(let i=0;i<24;i++){
  await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:ready.x,y:ready.y,deltaX:0,deltaY:120});await delay(40);
  const current=await evaluate('scrollSnapshot()');if(previous.y<previous.base)assert(current.y>previous.y,'Downward wheel must advance viewport');previous=current;
 }
 assert(await evaluate("scrollSnapshot().lines.join('\\n')===beforeScrollBuffer"),'Wheel mutated terminal history');
 const wheel=await evaluate('({inputs:scrollWheelDiagnostics.inputs.length,resizes:scrollWheelDiagnostics.resizes.length})');assert.equal(wheel.inputs,0,'Ordinary history scrolling must not send PTY input');assert.equal(wheel.resizes,0,'Ordinary history scrolling must not resize the terminal');await evaluate('stopWheelDiagnostics();true');
 // Keep the history-reading viewport test below independent of the round trip.
 await evaluate('scrollTestSession.xterm.scrollLines(-100)');await delay(80);previous=await evaluate('scrollSnapshot()');
 const retained=previous.y;await evaluate("scrollTestSession.output.receive('UNIQUE-06500\\r\\n')");await delay(120);
 assert((await evaluate('scrollSnapshot().y'))<=retained,'New output forced history toward bottom');
 await evaluate("scrollTestSession.xterm.scrollToBottom()");await delay(120);assert.equal(await evaluate('scrollSnapshot().y===scrollSnapshot().base'),true);
 const applicationModes=await evaluate(String.raw`(async()=>{const t=scrollTestSession.xterm,host=scrollTestSession.host;let sent='';const listener=t.onData(d=>sent+=d);await new Promise(r=>t.write('\x1b[?1049h',r));const y=t.buffer.active.viewportY;host.querySelector('.xterm').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-120}));await new Promise(r=>setTimeout(r,50));const alternate=t.buffer.active.type==='alternate'&&sent.includes('\x1b[A');await new Promise(r=>t.write('\x1b[?1049l\x1b[?1000h\x1b[?1006h',r));sent='';const r=host.getBoundingClientRect();host.querySelector('.xterm').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+30,clientY:r.y+30,deltaY:-120}));await new Promise(r=>setTimeout(r,50));const mouse=sent.includes('\x1b[<');await new Promise(r=>t.write('\x1b[?1000l\x1b[?1006l',r));listener.dispose();return {alternate,mouse};})()`);
 assert(applicationModes.alternate && applicationModes.mouse,'Application mouse/alternate buffer scrolling broken');
 const zoom=await evaluate(String.raw`(async()=>{
  const s=scrollTestSession,before=s.xterm.options.fontSize,sizes=[],subscription=s.xterm.onResize(size=>sizes.push(size));
  for(let i=0;i<10;i++)s.host.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120}));
  await new Promise(r=>setTimeout(r,300));subscription.dispose();
  const after=s.xterm.options.fontSize;
  if(after!==Math.min(32,before+10))throw Error('Ctrl-wheel burst did not apply requested zoom');
  if(!sizes.length||sizes.length>2)throw Error('Ctrl-wheel burst flooded terminal resize '+JSON.stringify(sizes));
  if(s.ptySize.cols!==s.xterm.cols||s.ptySize.rows!==s.xterm.rows)throw Error('Renderer and PTY dimensions diverged after zoom');
  term.zoomFont(before-after);await new Promise(r=>setTimeout(r,200));return {before,after,resizeEvents:sizes.length};
 })()`);

 console.log('Terminal scroll and colour:',JSON.stringify({...ready,upwardWheels:24,downwardWheels:24,wheelNoInputOrResize:true,legitimateRepeatsPreserved:true,historyUnique:true,historyPreserved:true,applicationModes,zoom}));
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
