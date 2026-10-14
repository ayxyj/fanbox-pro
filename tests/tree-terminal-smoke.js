'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'sql-preview-')),fixtures=path.join(root,'fixtures');fs.mkdirSync(fixtures);fs.writeFileSync(path.join(fixtures,'image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPj8AAAAASUVORK5CYII=','base64'));
const branch=path.join(fixtures,'folder'),nested=path.join(branch,'nested');fs.mkdirSync(nested,{recursive:true});fs.writeFileSync(path.join(nested,'deep.txt'),'deep');fs.writeFileSync(path.join(branch,'.hidden.txt'),'hidden');
const file=path.join(fixtures,'long.sql');const sql=Array.from({length:2200},(_,i)=>`INSERT INTO records (id, name, message) VALUES (${i}, '测试数据 ${i}', 'long SQL scroll test');`).join('\n');fs.writeFileSync(file,sql);fs.utimesSync(file,new Date(Date.now()-10000),new Date(Date.now()-10000));
for(let i=0;i<1200;i++)fs.writeFileSync(path.join(fixtures,'file-'+String(i).padStart(4,'0')+'.txt'),'scroll test '+i);
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--remote-debugging-port=14588','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14587',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map();child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function request(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(method+' timeout')),90000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method,params}));});if(m.error)throw Error(JSON.stringify(m.error));return m.result;}
async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14588/json')).json()).find(t=>t.url==='http://127.0.0.1:14587/');if(target)break;}catch{}}if(!target)throw Error('Page failed '+logs);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 await request('Page.bringToFront',{});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof state!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 await delay(2500);
 const result=await evaluate(`(async()=>{
 const checkInitial=state.view; if(checkInitial!=='tree')throw Error('First start should default to tree');document.getElementById('guide-ok')?.click();
 await navigate(${JSON.stringify(fixtures)});state.view='tree';renderFiles();
 const check=(ok,msg)=>{if(!ok)throw Error(msg);};
 const wait=async predicate=>{for(let i=0;i<160;i++){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');};
 const folder=state.visible.find(e=>e.name==='folder');check(folder,'Root directory missing');
 check(state.visible.length>1000 && document.querySelectorAll('.file-tree [data-path]').length<120,'Large directory not virtualized');
 const findRow=path=>[...document.querySelectorAll('.file-tree [data-path]')].find(row=>row.dataset.path===path);
 const folderRow=findRow(folder.path),folderIcon=folderRow.querySelector('.icon svg');
 const imageIndex=state.visible.findIndex(e=>e.name==='image.png');state.cursor=imageIndex;highlightCursor();
 const imageRow=findRow(state.visible[imageIndex].path);check(imageRow?.querySelector('.icon svg') && !imageRow.querySelector('img'),'Tree media icon waits for a thumbnail');
 check(getComputedStyle(imageRow).contentVisibility==='visible','Visible row rendering deferred');
 state.cursor=0;highlightCursor();

 const root=state.cwd;
 showContextMenu(new MouseEvent('contextmenu',{clientX:100,clientY:100,cancelable:true}),folder);
 const menuItems=[...document.querySelectorAll('#context-menu .ctx-item')];
 const contextOpen=menuItems.find(item=>item.textContent==='全部打开');check(contextOpen && menuItems.some(item=>item.textContent==='全部折叠'),'Folder bulk context actions missing');
 contextOpen.click();await wait(()=>!fileTree.bulk && state.visible.some(e=>e.name==='deep.txt'));
 check(state.visible.some(e=>e.name==='deep.txt'),'Folder context expand did not load descendants');
 const unrelated=root+state.sep+'other-folder';fileTree.current().expanded.add(unrelated);
 showContextMenu(new MouseEvent('contextmenu',{clientX:100,clientY:100,cancelable:true}),folder);
 [...document.querySelectorAll('#context-menu .ctx-item')].find(item=>item.textContent==='全部折叠').click();
 check(!fileTree.current().expanded.has(folder.path) && fileTree.current().expanded.has(unrelated),'Folder context collapse affected another subtree');
 fileTree.current().expanded.delete(unrelated);
 await fileTree.toggle(folder);
 await wait(()=>state.visible.some(e=>e.name==='nested'));
 document.getElementById('tree-collapse-all').click();
 check(fileTree.current().expanded.size===0 && !state.visible.some(e=>e.name==='nested'),'Collapse-all failed');
 await document.getElementById('tree-expand-all').onclick();
 check(state.visible.some(e=>e.name==='deep.txt'),'Expand-all did not load descendants');
 check(fileTree.current().expanded.has(folder.path),'Root folder did not expand');
 const fakeLink={...folder,name:'junction',path:root+state.sep+'junction',isSymlink:true};
 state.entries.push(fakeLink);await fileTree.expandAll();
 check(!fileTree.current().expanded.has(fakeLink.path),'Expand-all followed a directory link');
 state.entries=state.entries.filter(e=>e.path!==fakeLink.path);
 const fetchBeforeCancel=window.fetch;let finishRead;
 try {
   fileTree.collapseAll();fileTree.current().children.delete(folder.path);
   window.fetch=(url,options)=>String(url).includes('/api/list?tree=1&path='+encodeURIComponent(folder.path))
     ? new Promise(resolve=>{finishRead=()=>fetchBeforeCancel(url,options).then(resolve);}) : fetchBeforeCancel(url,options);
   const expanding=fileTree.expandAll();
   check(document.getElementById('tree-expand-all').textContent==='停止展开','Cancel button missing');
   check(!document.getElementById('tree-collapse-all').disabled,'Collapse-all unavailable during loading');
   document.getElementById('tree-collapse-all').click();check(fileTree.current().expanded.size===0,'Collapse while expanding failed');
   finishRead();await expanding;check(fileTree.current().expanded.size===0,'Pending read re-expanded collapsed folders');
 } finally {window.fetch=fetchBeforeCancel;finishRead?.();}
 await fileTree.expandAll();
 const inner=state.visible.find(e=>e.name==='nested');
 // Exercise the per-folder toggle after the bulk controls.
 await fileTree.toggle(inner);await fileTree.toggle(inner);
 await wait(()=>state.visible.some(e=>e.name==='deep.txt'));
 const nestedRow=findRow(inner.path),deepRow=findRow(state.visible.find(e=>e.name==='deep.txt').path);
 const rootX=findRow(folder.path).querySelector('.icon').getBoundingClientRect().left;
 const nestedX=nestedRow.querySelector('.icon').getBoundingClientRect().left,deepX=deepRow.querySelector('.icon').getBoundingClientRect().left;
 check(Math.abs(nestedX-rootX-18)<1 && Math.abs(deepX-nestedX-18)<1,'File icons do not follow tree depth');
 check(findRow(folder.path).querySelector('.icon svg')===folderIcon,'Expansion recreated parent icon');
 const deepIcon=deepRow.querySelector('.icon svg');applySelection(deepRow.dataset.path);renderFiles();
 check(findRow(deepRow.dataset.path).querySelector('.icon svg')===deepIcon,'Selection recreated file icon');
 state.entries.find(e=>e.path===folder.path).mtime+=1;renderFiles();check(findRow(folder.path).querySelector('.icon svg')===folderIcon,'Metadata update recreated parent icon');
 const contentViewport=document.getElementById('content');contentViewport.scrollTop=contentViewport.scrollHeight;
 const last=state.visible.at(-1);await wait(()=>!!findRow(last.path)?.querySelector('.icon svg'));
 check(findRow(last.path)?.querySelector('.icon svg'),'Fast scroll did not render final icon');
 check(document.querySelectorAll('.file-tree [data-path]').length<120,'Scrolled tree grew unbounded DOM');
 state.cursor=0;highlightCursor();
 check(state.cwd===root,'Expansion changed the root');
 const deep=state.visible.find(e=>e.name==='deep.txt');check(deep.treeDepth===2,'Incorrect tree depth');
 const area=document.getElementById('file-area'),savedWidth=area.style.width;
 area.style.width='220px';await new Promise(r=>setTimeout(r,80));
 const narrowRow=findRow(deep.path),nameBounds=narrowRow.querySelector('.tree-label').getBoundingClientRect(),detailBounds=narrowRow.querySelector('.tree-details').getBoundingClientRect();
 check(nameBounds.width>40 && nameBounds.height>0,'Narrow tree hides file name: '+JSON.stringify({name:nameBounds.width,row:narrowRow.getBoundingClientRect().width,area:area.getBoundingClientRect().width,columns:getComputedStyle(narrowRow).gridTemplateColumns,padding:getComputedStyle(narrowRow.querySelector('.fname')).paddingLeft}));
 check(detailBounds.top>=nameBounds.bottom && getComputedStyle(narrowRow).height==='48px','Metadata not below file name');
 area.style.width=savedWidth;
 await onItemClick(deep);check(document.getElementById('ed-host') && document.getElementById('ed-save'),'Text file not editable by default');
 check(!mona.editor || mona.editor.getOption(monaco.editor.EditorOption.readOnly)===false,'Editor is readonly');
 await closePreview();
 const sqlEntry=state.entries.find(e=>e.name==='long.sql');
 await Promise.all([onItemClick(deep),onItemClick(sqlEntry)]);
 check(state.selected===sqlEntry.path && mona.editor.getValue().includes('INSERT INTO records'),'Earlier file load replaced the current editor');
 await closePreview();
 const image=state.entries.find(e=>e.name==='image.png');await onItemClick(image);
 check(document.querySelector('#preview-body img') && !imgEditState && !document.getElementById('ie-canvas'),'Image should open in preview');await closePreview();

 check(!state.visible.some(e=>e.name==='.hidden.txt'),'Hidden file filtering failed');
 state.showHidden=true;renderFiles();check(state.visible.some(e=>e.name==='.hidden.txt'),'Hidden files missing');
 state.showHidden=false;renderFiles();
 const first=document.querySelector('.file-tree [data-path]');renderFiles();check(document.querySelector('.file-tree [data-path]')===first,'Unchanged rows rebuilt');
 applySelection(deep.path);await openPreview(deep);check(document.querySelector('#preview-body').textContent.includes('deep'),'Nested preview failed');
 const preview=document.getElementById('preview'),body=document.getElementById('preview-body'),max=document.getElementById('preview-max');
 const savedDock=term.dock,content=body.firstElementChild;
 for(const dock of ['bottom','right']) {
   term.dock=dock;term.applyDock();applyPreviewSize();await new Promise(r=>setTimeout(r,350));
   const before=preview.getBoundingClientRect();max.click();await wait(()=>{const rect=preview.getBoundingClientRect();return rect.left===0 && rect.top===0 && Math.abs(rect.width-innerWidth)<2 && Math.abs(rect.height-innerHeight)<2;});
   const full=preview.getBoundingClientRect();
   check(full.left===0 && full.top===0 && Math.abs(full.width-innerWidth)<2 && Math.abs(full.height-innerHeight)<2,'Preview did not fill window: '+dock);
   check(body.firstElementChild===content,'Fullscreen recreated preview content');
   check(max.getAttribute('aria-pressed')==='true' && max.title==='恢复预览大小','Restore control missing');
   max.click();await new Promise(r=>setTimeout(r,350));const after=preview.getBoundingClientRect();
   check(Math.abs(before.width-after.width)<2 && Math.abs(before.height-after.height)<2,'Previous preview size not restored: '+dock);
 }
 max.click();document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 check(!previewMaximized && !preview.classList.contains('hidden'),'Escape should restore fullscreen first');
 max.click();term.toggleMax(true);check(!previewMaximized && term.maximized,'Terminal fullscreen conflicts with preview');term.toggleMax(false);
 max.click();await closePreview();check(!previewMaximized,'Closing preview retained fullscreen');
 await openPreview(deep);check(!previewMaximized && !preview.classList.contains('preview-fullscreen'),'Reopening retained fullscreen');
 term.dock=savedDock;term.applyDock();applyPreviewSize();
 await fileTree.toggle(folder);check(!state.visible.some(e=>e.name==='deep.txt'),'Collapse failed');
 await fileTree.toggle(folder);check(state.visible.some(e=>e.name==='deep.txt'),'Expanded descendants were forgotten');
 await apiPost('/api/write',{path:${JSON.stringify(path.join(branch,'new.txt'))},content:'new'});
 await refresh();check(state.visible.some(e=>e.name==='new.txt'),'Expanded children not refreshed');
 const realFetch=window.fetch;let finishPost,posts=0;
 try {
   window.fetch=async (url,options)=>{
     if(String(url).includes('/api/gs/repo/commit')) {posts++;return await new Promise(resolve=>{finishPost=()=>resolve(new Response(JSON.stringify({repo:{id:'ui-progress'}})));});}
     if(String(url).includes('/api/gs/repo/progress'))return new Response(JSON.stringify({operation:{phase:'创建提交（含 Git hooks）',running:true}}));
     return realFetch(url,options);
   };
   const operation=gsRunDirty('ui-progress','commit',{message:'test'},'提交改动');
   await new Promise(r=>setTimeout(r,1200));check(document.querySelector('.gs-operation')?.textContent.includes('Git hooks'),'Operation phase not visible');
   await gsRunDirty('ui-progress','commit',{},'提交改动');check(posts===1,'Duplicate operation submitted');
   finishPost();await operation;check(!document.querySelector('.gs-operation'),'Progress was not cleaned up');
 } finally {window.fetch=realFetch;finishPost?.();}
 term.open();await wait(()=>term.sessions.length>0);const session=term.sessions[0];
 await wait(()=>!!session.cwd);await new Promise(r=>setTimeout(r,1200));
 let fits=0;const originalFit=session.fit.fit.bind(session.fit);session.fit.fit=()=>{fits++;originalFit();};
 for(let i=0;i<100;i++)term.fitActive();await new Promise(r=>setTimeout(r,100));check(fits<5,'Resize scheduling was not coalesced');
 term.input(session.id,'& { 1..3000 | ForEach-Object { "FB-BURST-$_-中文" }; "FB-END-3000" }\\r');
 await wait(()=>{const b=session.xterm.buffer.active;let text='';for(let i=0;i<b.length;i++)text+=b.getLine(i).translateToString(true);return (text.match(/FB-BURST-[0-9]+-中文/g)||[]).length>=3000;});
 await new Promise(r=>setTimeout(r,300));
 const buffer=session.xterm.buffer.active;let lines='';for(let i=0;i<buffer.length;i++)lines+=buffer.getLine(i).translateToString(true)+'\\n';
 const matches=lines.match(/FB-BURST-[0-9]+-中文/g)||[];check(matches.length>=3000,'Terminal lost output: '+matches.length);
 return {tree:true,folderContext:true,defaultEditing:true,narrowTree:true,indentedIcons:true,immediateIcons:true,virtualTree:true,bulkTree:true,previewFullscreen:true,nestedPreview:true,refresh:true,gitProgress:true,terminalLines:matches.length,fitCalls:fits};
 })()`);console.log('PASS tree and real PTY output',JSON.stringify(result));
 await evaluate("document.querySelector('#view-seg [data-view=grid]').click();localStorage.setItem('fb_guided','1');location.reload();true");
 await delay(1200);
 let preference;for(let i=0;i<60;i++){try{preference=await evaluate("typeof state!=='undefined' && state.view");if(preference)break;}catch{}await delay(200);}assert.equal(preference,'grid');
 await evaluate("document.querySelector('#view-seg [data-view=tree]').click();true");
 console.log('PASS first-start tree default and persisted view preference');
 const screenshot=await request('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(scratch,'tree-terminal.png'),Buffer.from(screenshot.data,'base64'));

 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
