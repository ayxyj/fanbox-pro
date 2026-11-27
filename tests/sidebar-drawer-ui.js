'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'sidebar-drawer-')),dirs=[path.join(root,'project-a'),path.join(root,'project-b')];for(const dir of dirs){fs.mkdirSync(path.join(dir,'nested'),{recursive:true});fs.writeFileSync(path.join(dir,'fixture.txt'),'drawer fixture');}
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14932','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14931',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function request(method,params={}){const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out '+logs.slice(-1500)));},30000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});socket.send(JSON.stringify({id,method,params}));});if(result.error)throw Error(JSON.stringify(result.error));return result.result;}
async function evaluate(expression){const result=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression,message){for(let i=0;i<100;i++){try{if(await evaluate(expression))return;}catch{}await delay(80);}throw Error(message||'UI timed out: '+expression);}
async function click(selector){const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing click target');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!r.width||!r.height||!el.contains(document.elementFromPoint(x,y)))throw Error('Click target obscured: '+${JSON.stringify(selector)});return {x,y};})()`);await request('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await request('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
async function snapshot(){return evaluate('drawerSnapshot()');}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14932/json')).json()).find(t=>t.url==='http://127.0.0.1:14931/');if(target)break;}catch{}}assert(target,'Application page loads');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const result=JSON.parse(e.data);pending.get(result.id)?.(result);pending.delete(result.id);});
 await until("document.readyState==='complete' && typeof term!=='undefined' && state.home",'Application initialization completes');
 assert(await evaluate('state.sidebarCollapsed && getComputedStyle(document.getElementById("sidebar")).display==="none"'),'Drawer starts closed');
 await evaluate("localStorage.setItem('fb_sidebar_collapsed','0');localStorage.setItem('fb_guided','1');localStorage.setItem('fb_term_open','0');window.__oldDrawerDocument=true;true");
 await request('Page.reload');await until("!window.__oldDrawerDocument && document.readyState==='complete' && typeof term!=='undefined' && state.home",'Reload completes');
 assert(await evaluate("state.sidebarCollapsed && localStorage.getItem('fb_sidebar_collapsed')==='0'"),'Legacy open preference does not restore a temporary drawer or get overwritten');
 await request('Page.bringToFront');
 await evaluate(`(async()=>{
  document.getElementById('guide-ok')?.click();await navigate(${JSON.stringify(root)});if(follow.on)setFileFollow(false);
  term.open();window.drawerSession=await term.newTab(${JSON.stringify(root)},'echo DRAWER_READY',{shell:'cmd'});await new Promise(r=>setTimeout(r,1200));
  const list=document.getElementById('roots-list');list.replaceChildren(...${JSON.stringify(dirs)}.map((p,i)=>{const li=navDirLi('Drawer project '+i,p);li.id='drawer-project-'+i;return li;}));
  window.drawerInputs=[];window.drawerResizes=[];drawerSession.xterm.onData(data=>drawerInputs.push(data));drawerSession.xterm.onResize(size=>drawerResizes.push(size));
  window.drawerSnapshot=()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {main:rect('main'),terminal:rect('terminal-panel'),files:rect('filemgmt'),cols:drawerSession.xterm.cols,rows:drawerSession.xterm.rows,pty:drawerSession.ptySize,maximized:term.maximized,squeezed:document.getElementById('main-body').classList.contains('fm-squeezed'),stored:{h:localStorage.getItem('fb_term_h'),w:localStorage.getItem('fb_term_w'),file:localStorage.getItem('fb_file_w'),squeeze:localStorage.getItem('fb_term_squeeze')}};};
 })()`);await delay(350);
 for(const mode of ['bottom','bottom-small-files','right','maximized','squeezed']){
  await evaluate(`(()=>{
   if(term.maximized)term.toggleMax(false);localStorage.setItem('fb_term_squeeze','0');term.dock=${JSON.stringify(mode==='right'?'right':'bottom')};term.applyDock();
   const panel=document.getElementById('terminal-panel'),body=document.getElementById('main-body');
   if(term.dock==='bottom'){const h=${JSON.stringify(mode)}==='bottom-small-files'?body.clientHeight-96:280;panel.style.height=h+'px';localStorage.setItem('fb_term_h',String(h));}
   else{const w=Math.max(280,body.clientWidth-330);term.applyFileWidth(body.clientWidth-6-w,true);localStorage.setItem('fb_term_w',String(w));}
   if(${JSON.stringify(mode)}==='maximized')term.toggleMax(true);
   if(${JSON.stringify(mode)}==='squeezed'){body.classList.add('fm-squeezed');localStorage.setItem('fb_term_squeeze','1');}
   term.fitActive();
  })()`);await delay(500);await evaluate('drawerInputs.length=0;drawerResizes.length=0;true');
  const before=await snapshot();await click('#btn-sidebar');await delay(130);
  assert(await evaluate('!state.sidebarCollapsed && document.getElementById("main").inert && document.activeElement.id==="sidebar-close"'),'Opening focuses drawer and protects main workspace');
  assert.deepEqual(await snapshot(),before,mode+': opening drawer preserves terminal and file geometry, cell dimensions and saved split');
  assert(await evaluate(`(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return r.left===0&&r.width<=420&&r.top>=document.querySelector('.window-menu').getBoundingClientRect().bottom;})()`),'Drawer stays below Windows menu');
  assert(await evaluate("document.getElementById('btn-sidebar').dataset.tip===document.getElementById('btn-sidebar').getAttribute('aria-label') && document.getElementById('btn-sidebar').dataset.tip.length<20 && !document.getElementById('btn-sidebar').hasAttribute('title')"),'Short single-state tooltip and accessible label');
  await evaluate("document.getElementById('sidebar-resizer').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:248,buttons:1}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:310,buttons:1}));window.dispatchEvent(new MouseEvent('mouseup',{clientX:310}));true");await delay(130);
  assert.deepEqual(await snapshot(),before,mode+': drawer width changes do not resize workspace');
  const index=mode==='right'||mode==='squeezed'?1:0;await click('#drawer-project-'+index+' .label');await until('state.cwd==='+JSON.stringify(dirs[index]),'Directory selection navigates');await delay(350);
  assert(await evaluate('state.sidebarCollapsed && !document.getElementById("main").inert && document.getElementById("sidebar-backdrop").hidden'),'Directory selection closes drawer');
  assert.deepEqual(await snapshot(),before,mode+': choosing a directory preserves terminal size, maximized/squeezed state and stored dimensions');
  assert.equal(await evaluate('drawerResizes.length'),0,mode+': drawer interaction causes no terminal resize events or PTY dimension updates');
 }
 // A tree disclosure is browsing inside the drawer, not selecting a directory.
 await click('#btn-sidebar');await click('#drawer-project-0 .twirl');await until("!!document.querySelector('#drawer-project-0 + .nav-sub li')",'Nested directory disclosure loads');
 assert(await evaluate('!state.sidebarCollapsed'),'Expanding a subtree leaves the drawer open');
 // Input events are sent to the focused drawer, never the active terminal.
 await request('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await request('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await delay(150);
 assert(await evaluate('state.sidebarCollapsed && !drawerInputs.some(data=>data.includes(String.fromCharCode(27)))'),'Escape closes drawer without sending escape to the PTY');
 await click('#btn-sidebar');const outside=await evaluate("(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();const x=r.right+20,y=Math.min(innerHeight-20,r.bottom-30);return {x,y,backdrop:document.elementFromPoint(x,y)?.id};})()");assert.equal(outside.backdrop,'sidebar-backdrop','Backdrop owns outside click');
 await request('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:outside.x,y:outside.y});await request('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:outside.x,y:outside.y});await delay(150);assert(await evaluate('state.sidebarCollapsed && document.getElementById("sidebar-backdrop").hidden'),'Backdrop closes drawer');
 assert.equal(await evaluate('drawerInputs.length'),0,'Closing events never send terminal input');
 console.log('PASS temporary sidebar drawer: default closed/legacy preference, overlay and width changes preserve terminal geometry/cells/PTY size, bottom/right/small-file/maximized/squeezed navigation, subtree browsing, focus/inert, short labels, Escape and consumed outside click');
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
