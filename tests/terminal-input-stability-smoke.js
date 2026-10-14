'use strict';
const fs=require('fs'),path=require('path');const {spawn,execFileSync}=require('child_process');
let baselineMethods=null;
if(process.env.TERMINAL_BASELINE==='1'){
 const original=execFileSync('git',['show','HEAD:public/app.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 baselineMethods={};
 for(const [name,end] of [['renderTabs','  retheme('],['markBusy','  // 取缓冲区末尾']]){
  const start=original.indexOf('  '+name+'('),finish=original.indexOf(end,start);
  if(start<0 || finish<0)throw Error('Baseline method missing: '+name);
  baselineMethods[name]=original.slice(start,finish).trim().replace(name+'(', 'function(').replace(/,\s*$/, '');
 }
}
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'terminal-input-')),fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14618','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14617',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map();child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14618/json')).json()).find(t=>t.url==='http://127.0.0.1:14617/');if(target)break;}catch{}}if(!target)throw Error('Page failed '+logs);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof state!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 await delay(2500);
 await request('Page.bringToFront',{});
 const result=await evaluate(`(async()=>{
 document.getElementById('guide-ok')?.click();await navigate(${JSON.stringify(fixtures)});document.getElementById('terminal-panel').classList.remove('hidden');document.getElementById('terminal-resizer').classList.remove('hidden');term.applyDock();
 const s=await term.newTab(state.cwd,"Write-Output 'INPUT_READY'",{shell:'powershell'});
 const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Terminal not ready: '+term.tailText(s,40));};
 if(s.dead)throw Error('PowerShell spawn failed: '+term.tailText(s,8));
 await wait(()=>term.tailText(s,40).includes('INPUT_READY'));await new Promise(r=>setTimeout(r,1000));
 const baseline=${JSON.stringify(baselineMethods)};if(baseline){for(const [name,source] of Object.entries(baseline))term[name]=(0,eval)('('+source+')');}
 const panel=document.getElementById('terminal-panel'),bar=document.getElementById('term-tabs'),target=document.getElementById('term-target');
 s.lastInput=Date.now();const panelObserver=new MutationObserver(()=>{});panelObserver.observe(panel,{attributes:true,attributeFilter:['class']});
 for(let i=0;i<80;i++)term.markBusy(s);
 const echoClassWrites=panelObserver.takeRecords().length;panelObserver.disconnect();
 const tab=bar.querySelector('[data-session-id="'+s.id+'"]');
 const tabsObserver=new MutationObserver(()=>{});tabsObserver.observe(bar,{childList:true});tabsObserver.observe(target,{childList:true});
 for(let i=0;i<20;i++){s.status=i%2?'idle':'busy';term.renderTabs();}
 const headerReplacements=tabsObserver.takeRecords().length;tabsObserver.disconnect();
 const tabPreserved=bar.querySelector('[data-session-id="'+s.id+'"]')===tab;
 const records=[];
 for(const dock of ['bottom','right']) {
   term.dock=dock;term.applyDock();if(dock==='right')panel.style.width='400px';
   await new Promise(r=>setTimeout(r,500));term.fitActive();await new Promise(r=>setTimeout(r,150));
   const changes=[];const subscription=s.xterm.onResize(e=>changes.push(e));
   const initial=[panel.getBoundingClientRect(),panel.querySelector('.term-head').getBoundingClientRect(),s.host.getBoundingClientRect()].map(r=>[r.x,r.y,r.width,r.height]);
   let movement=0,stop=false;const sample=()=>{if(stop)return;[panel,panel.querySelector('.term-head'),s.host].forEach((el,i)=>{const r=el.getBoundingClientRect();[r.x,r.y,r.width,r.height].forEach((v,j)=>movement=Math.max(movement,Math.abs(v-initial[i][j])));});requestAnimationFrame(sample);};sample();
   s.xterm.focus();for(const ch of Array.from('# typing-test 中文输入 '+('abcdefghij'.repeat(8)))){s.xterm.input(ch,true);await new Promise(r=>setTimeout(r,15));}
   s.xterm.input('\\r',true);await new Promise(r=>setTimeout(r,1100));
   stop=true;subscription.dispose();records.push({dock,movement,resizeEvents:changes.length});
 }
 // Repeated observer requests should skip unchanged dimensions; actual drag resizing must still work.
 const originalFit=s.fit.fit.bind(s.fit);let fitCalls=0;s.fit.fit=()=>{fitCalls++;return originalFit();};
 for(let i=0;i<100;i++)term.fitActive();await new Promise(r=>setTimeout(r,150));
 const unchangedFits=fitCalls,previousCols=s.xterm.cols;panel.style.width='480px';term.fitActive();await new Promise(r=>setTimeout(r,250));
 for(let i=0;i<30 && (s.xterm.cols<=previousCols || s.ptySize.cols!==s.xterm.cols);i++){term.fitActive();await new Promise(r=>setTimeout(r,100));}
 s.fit.fit=originalFit;
 if(unchangedFits!==0 || s.xterm.cols<=previousCols || s.ptySize.cols!==s.xterm.cols)throw Error('Resize regression '+JSON.stringify({unchangedFits,previousCols,cols:s.xterm.cols,ptySize:s.ptySize}));
 if(${process.env.TERMINAL_BASELINE==='1'})return {echoClassWrites,headerReplacements,tabPreserved,records,unchangedFits,dragResize:true};
 if(echoClassWrites!==0 || headerReplacements!==0 || !tabPreserved)throw Error('Header still rebuilds during typing/status changes: '+JSON.stringify({echoClassWrites,headerReplacements,tabPreserved}));
 for(const record of records)if(record.movement>.5 || record.resizeEvents!==0)throw Error('Typing changed terminal geometry '+JSON.stringify(record));
 return {echoClassWrites,headerReplacements,tabPreserved,records,unchangedFits,dragResize:true};
 })()`);console.log('Terminal input stability:',JSON.stringify(result));

 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
