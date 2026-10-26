'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'sql-preview-')),fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);
const file=path.join(fixtures,'long.sql');const sql=Array.from({length:2200},(_,i)=>`INSERT INTO records (id, name, message) VALUES (${i}, '测试数据 ${i}', 'long SQL scroll test');`).join('\n');fs.writeFileSync(file,sql);fs.utimesSync(file,new Date(Date.now()-10000),new Date(Date.now()-10000));
const md=path.join(fixtures,'long.md');fs.writeFileSync(md,Array.from({length:300},(_,i)=>'## Section '+i+'\n\nLong markdown paragraph 中文 '+i+'\n\n').join(''));
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14598','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14597',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map();child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14598/json')).json()).find(t=>t.url==='http://127.0.0.1:14597/');if(target)break;}catch{}}if(!target)throw Error('Page failed '+logs);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof state!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 await delay(2500);
 await request('Page.bringToFront',{});
 await evaluate(`(async()=>{
 document.getElementById('guide-ok')?.click();await navigate(${JSON.stringify(fixtures)});
 document.getElementById('terminal-panel').classList.remove('hidden');document.getElementById('terminal-resizer').classList.remove('hidden');
 const entry=state.entries.find(e=>e.name==='long.sql');await onItemClick(entry);
 })()`);
 await evaluate("document.getElementById('preview-dock').click();true");
 const firstDock=await evaluate("previewIsBottom()");
 await evaluate("document.getElementById('preview-dock').click();true");
 assert.notEqual(await evaluate("previewIsBottom()"),firstDock,'Preview button switches layout independently');
 await evaluate("localStorage.removeItem('fb_preview_dock');applyPreviewSize();true");
 const records=[];
 for(const dock of ['bottom','right'])for(const size of [280,420]) {
  const metrics=await evaluate(`(async()=>{
   term.dock=${JSON.stringify(dock)};term.applyDock();const panel=document.getElementById('terminal-panel');panel.style[term.dock==='bottom'?'height':'width']=${size}+'px';
   await new Promise(r=>setTimeout(r,450));mona.editor.layout();
   const host=document.getElementById('ed-host'),body=document.getElementById('preview-body'),terminal=document.getElementById('terminal-panel');
   const h=host.getBoundingClientRect(),b=body.getBoundingClientRect(),t=terminal.getBoundingClientRect();
   if(h.bottom>b.bottom-parseFloat(getComputedStyle(body).paddingBottom)+2 || h.top<b.top || h.height>body.clientHeight)throw Error('Editor exceeds preview '+JSON.stringify({h:h.toJSON(),b:b.toJSON()}));
   if(term.dock==='bottom'?h.bottom>t.top:h.right>t.left)throw Error('Editor overlaps terminal');
   if(body.scrollHeight>body.clientHeight+2)throw Error('Outer panel has a competing scroll area');
   const editor=mona.editor;editor.setScrollTop(0);const max=editor.getScrollHeight()-editor.getLayoutInfo().height;
   if(max<1000)throw Error('Long document is not scrollable');
   return {dock:term.dock,size:${size},height:h.height,preview:b.height,terminalTop:t.top,scrollHeight:editor.getScrollHeight(),x:h.left+h.width/2,y:h.top+Math.min(80,h.height/2)};
  })()`);
  await request('Input.dispatchMouseEvent',{type:'mouseWheel',x:metrics.x,y:metrics.y,deltaX:0,deltaY:600});await delay(450);
  const scrolled=await evaluate('mona.editor.getScrollTop()');assert(scrolled>0,'Wheel did not scroll editor '+JSON.stringify(metrics));
  const bottom=await evaluate('(async()=>{const e=mona.editor;e.setScrollTop(e.getScrollHeight());await new Promise(r=>setTimeout(r,100));return {top:e.getScrollTop(),height:e.getScrollHeight(),viewport:e.getLayoutInfo().height};})()');
  assert(bottom.top+bottom.viewport>=bottom.height-3,'Cannot reach last lines');records.push({...metrics,wheel:scrolled});
 }
 const other=await evaluate(`(async()=>{
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};const entry=state.entries.find(e=>e.name==='long.sql'),editor=mona.editor;
  document.getElementById('preview-max').click();await new Promise(r=>setTimeout(r,350));const restore=document.getElementById('preview-max'),rh=restore.getBoundingClientRect(),ph=document.querySelector('.preview-head').getBoundingClientRect();check(!!restore.querySelector('svg')&&restore.getAttribute('aria-pressed')==='true'&&rh.height>=28&&ph.height>=40&&rh.top>=ph.top&&rh.bottom<=ph.bottom,'Fullscreen restore button is visible');check(getComputedStyle(document.getElementById('terminal-panel')).display==='none','Fullscreen terminal hidden');check(mona.editor===editor,'Fullscreen recreated editor');check(editor.getLayoutInfo().height>300,'Fullscreen did not resize editor');document.getElementById('preview-max').click();check(!previewMaximized,'Restore button exits fullscreen');await new Promise(r=>setTimeout(r,350));
  const loader=mona.load;try{mona.load=async()=>null;await onItemClick(entry);const ta=document.getElementById('ed-host');check(ta.tagName==='TEXTAREA','Fallback missing');check(ta.clientHeight>0 && ta.scrollHeight>ta.clientHeight,'Fallback not scrollable');ta.scrollTop=600;check(ta.scrollTop>0,'Fallback scroll failed');check(ta.getBoundingClientRect().bottom<=document.getElementById('preview-body').getBoundingClientRect().bottom,'Fallback exceeds preview');}finally{mona.load=loader;}
  const markdown=state.entries.find(e=>e.name==='long.md');await onItemClick(markdown);const host=document.getElementById('ed-host');check(host.classList.contains('crepe-host'),'Markdown rich editor missing');check(host.scrollHeight>host.clientHeight && host.clientHeight>0,'Markdown not scrollable');host.scrollTop=600;check(host.scrollTop>0,'Markdown scroll failed');check(host.getBoundingClientRect().bottom<=document.getElementById('preview-body').getBoundingClientRect().bottom,'Markdown exceeds preview');
  return {fullscreen:true,fallback:true,markdown:true};
 })()`);
 console.log('PASS editor and terminal independent layout, real wheel scrolling, last-line access, panel resize, fullscreen, textarea and Markdown',JSON.stringify({records,other}));
 const shot=await request('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(scratch,'editor-layout.png'),Buffer.from(shot.data,'base64'));

 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
