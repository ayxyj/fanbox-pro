'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'toolbar-display-'));
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14942','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14941',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function request(method,params={}){const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out '+logs.slice(-1500)));},30000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});socket.send(JSON.stringify({id,method,params}));});if(result.error)throw Error(JSON.stringify(result.error));return result.result;}
async function evaluate(expression){const result=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression){for(let i=0;i<100;i++){try{if(await evaluate(expression))return;}catch{}await delay(100);}throw Error('UI timeout '+expression);}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14942/json')).json()).find(t=>t.url==='http://127.0.0.1:14941/');if(target)break;}catch{}}assert(target,'Application loads');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const result=JSON.parse(e.data);pending.get(result.id)?.(result);pending.delete(result.id);});
 await until("document.readyState==='complete' && typeof term!=='undefined' && state.home");await request('Page.bringToFront');
 await evaluate(`(async()=>{localStorage.setItem('fb_guided','1');document.getElementById('guide-ok')?.click();if(follow.on)setFileFollow(false);await navigate(${JSON.stringify(root)});term.open();window.displaySession=await term.newTab(${JSON.stringify(root)},'echo TOOLBAR_READY',{shell:'cmd'});await new Promise(r=>setTimeout(r,1000));displaySession.title='very-long-terminal-name-for-toolbar-and-multiple-monitor-resolution-test';term.renderTabs();})()`);
 // Replay the previous unbounded saved-width rule to prove the screenshot regression.
 await request('Emulation.setDeviceMetricsOverride',{width:760,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{localStorage.setItem('fb_term_squeeze','0');localStorage.setItem('fb_term_w','1800');term.dock='right';term.applyDock();const legacy=document.createElement('style');legacy.id='legacy-unbounded-panel';legacy.textContent='#main-body #terminal-panel{max-width:none;max-height:none}';document.head.append(legacy);term.fitActive();})()`);await delay(350);
 assert(await evaluate("document.getElementById('terminal-panel').getBoundingClientRect().right>document.getElementById('main-body').getBoundingClientRect().right+1"),'legacy saved split reproduces right-edge clipping');
 console.log('PASS reproduced legacy right-edge clipping from an 1800px saved split on a 760px display');
 await evaluate("document.getElementById('legacy-unbounded-panel').remove();term.fitActive();true");await delay(200);
 for(const mode of ['right','bottom','right-max','bottom-max','right-squeezed','bottom-squeezed']){
  await evaluate(`(()=>{if(term.maximized)term.toggleMax(false);localStorage.setItem('fb_term_squeeze','0');localStorage.setItem('fb_term_w','1800');localStorage.setItem('fb_term_h','1200');term.dock=${JSON.stringify(mode.startsWith('right')?'right':'bottom')};term.applyDock();if(${JSON.stringify(mode)}.endsWith('-max'))term.toggleMax(true);if(${JSON.stringify(mode)}.endsWith('-squeezed')){document.getElementById('main-body').classList.add('fm-squeezed');localStorage.setItem('fb_term_squeeze','1');}term.fitActive();})()`);
  for(const [width,height,scale]of [[760,720,1],[640,560,1.25],[900,760,1.5],[480,640,2],[2100,1500,1]]){
   await request('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await delay(500);
   const result=await evaluate(`(()=>{const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const parent=rect(document.getElementById('main-body')),panel=rect(document.getElementById('terminal-panel')),head=rect(document.querySelector('.term-head'));const buttons=[...document.querySelectorAll('.term-actions button')].map(el=>{const r=rect(el),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {id:el.id,...r,hit:!!hit&&el.contains(hit)};});return {parent,panel,head,buttons,viewport:{width:innerWidth,height:innerHeight},stored:{w:localStorage.getItem('fb_term_w'),h:localStorage.getItem('fb_term_h')}};})()`);
   const within=(r,p)=>r.width>0&&r.height>0&&r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1;
   const diagnostic=mode+' '+JSON.stringify({width,height,scale,result});assert(within(result.panel,result.parent),'terminal panel stays within workspace: '+diagnostic);
   assert(within(result.head,result.panel),'toolbar stays within terminal: '+diagnostic);
   for(const button of result.buttons){assert(within(button,result.panel)&&button.right<=width+1&&button.bottom<=height+1,'button visible '+button.id+': '+diagnostic);assert(button.hit,'button clickable '+button.id+': '+diagnostic);}
   assert.equal(result.stored.w,'1800','resolution fitting preserves requested width');assert.equal(result.stored.h,'1200','resolution fitting preserves requested height');
   if(width===2100&&!mode.includes('-'))assert(Math.abs((mode==='right'?result.panel.width:result.panel.height)-(mode==='right'?1800:1200))<=1,'larger display restores requested split: '+diagnostic);
  }
 }
 // Verify that visible controls still perform their actions at a reduced display size.
 await request('Emulation.setDeviceMetricsOverride',{width:640,height:600,deviceScaleFactor:1.5,mobile:false});
 await evaluate("if(term.maximized)term.toggleMax(false);localStorage.setItem('fb_term_squeeze','0');term.dock='right';term.applyDock();term.fitActive();true");await delay(350);
 const click=async id=>{const point=await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw Error('Control is obscured');return {x,y};})()`);await request('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await request('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await delay(300);};
 await click('term-max');assert(await evaluate('term.maximized'),'maximize control responds after display changes');
 await click('term-max');assert(await evaluate('!term.maximized'),'restore control responds after display changes');
 await click('term-dock');assert(await evaluate("term.dock==='bottom'"),'dock control responds after display changes');
 await click('term-close');assert(await evaluate("document.getElementById('terminal-panel').classList.contains('hidden')"),'close control responds after display changes');
 await click('btn-terminal');assert(await evaluate("!document.getElementById('terminal-panel').classList.contains('hidden')"),'terminal can reopen after display changes');
 console.log('PASS terminal toolbar display changes: oversized saved split, smaller/larger viewports, DPR 1/1.25/1.5/2, right/bottom/max/squeezed modes, all action buttons visible and hittable, saved split restored; actual maximize/restore/dock/close/reopen clicks');
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
