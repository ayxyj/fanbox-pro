'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),scratch=path.join(workspace,'dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'visible-question-'));
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14812','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_PORT:'14811',GITSYNC_HOME:path.join(root,'data'),TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let socket,seq=0,logs='';const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function evaluate(expression){const id=++seq;const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout '+logs.slice(-1000))),30000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(message.result?.exceptionDetails)throw Error(JSON.stringify(message.result.exceptionDetails));return message.result.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14812/json')).json()).find(t=>t.url==='http://127.0.0.1:14811/');if(target)break;}catch{}}
 assert(target,'App starts');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const r=JSON.parse(e.data);pending.get(r.id)?.(r);pending.delete(r.id);});
 for(let i=0;i<100;i++){try{if(await evaluate("typeof term!=='undefined' && document.readyState==='complete'"))break;}catch{}await delay(100);}
 const result=await evaluate(`(async()=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);};localStorage.setItem('fb_guided','1');document.getElementById('guide-ok')?.click();term.open();const s=await term.newTab(undefined,'echo QUESTION_READY',{shell:'cmd'});term.toggleMax(true);await new Promise(r=>setTimeout(r,1000));
  s.xterm.reset();await new Promise(r=>s.xterm.write(Array.from({length:300},(_,i)=>'PRIVATE_HISTORY_'+i+'\\r\\n').join(''),r));
  const options=['方案二 + 验证方案一（推荐）','只做方案一','保持现状（后端 - 补全）','Type something.','Chat about this'];
  const screen=focus=>'\\x1b[2J\\x1b[H修复方案\\r\\n\\r\\nUnified 行参数方案怎么定？\\r\\n\\r\\n'+options.map((label,i)=>(i===focus?'❯':' ')+' '+(i+1)+'. '+label+'\\r\\n'+(i<3?'    deploy 改 job 引号 + system.properties 空默认，后端补全；UAT 验证环境变量注入\\r\\n':'')+(i===3?'────────────────────\\r\\n':'')).join('')+'Enter to select · ↑/↓ to navigate · Esc to cancel';
  s.output.receive(screen(0));
  const first=await fanboxPty.question(s.id);check(first.menu?.options.length===5,'queued visible five-option question');check(first.menu.selected===0,'first option focus');check(first.menu.question.includes('Unified'),'question title');check(!('lines' in first)&&!JSON.stringify(first).includes('PRIVATE_HISTORY'),'raw terminal history stays in the renderer');
  s.xterm.scrollLines(-60);const y=s.xterm.buffer.active.viewportY;
  const whileReading=await fanboxPty.question(s.id);check(whileReading.menu?.options[4].label==='Chat about this','current question is read independently of old scrollback');check(s.xterm.buffer.active.viewportY===y,'question read does not scroll the user');
  s.output.receive(screen(1));const updated=await fanboxPty.question(s.id);check(updated.menu?.selected===1,'retry reads fresh actual focus');
  s.output.receive('\\x1b[2J\\x1b[HChoose features?\\r\\n  1. [x] A\\r\\n❯ 2. [ ] B\\r\\n  3. [x] C\\r\\nSpace to toggle · Enter to confirm · Esc to cancel');const multi=await fanboxPty.question(s.id);check(multi.menu?.multi&&multi.menu.selected===1&&multi.menu.options[0].checked&&!multi.menu.options[1].checked&&multi.menu.options[2].checked,'actual renderer multi-select focus and checked states');
  s.output.receive('\\x1b[2J\\x1b[HWorking...');const unknown=await fanboxPty.question(s.id);check(unknown.menu===null&&!('lines' in unknown),'unrecognized screen returns no raw output');
  s.output.receive('\\x1b[2J\\x1b[H❯ \\r\\nEnter to submit · Esc to cancel');const custom=await fanboxPty.question(s.id,'Unified 行参数方案怎么定？');check(custom.menu?.kind==='input'&&custom.menu.question.includes('Unified'),'recognized custom-answer step preserves its question');
  s.output.receive('\\x1b[2J\\x1b[HUnified 行参数方案怎么定？\\r\\n  1. 方案一\\r\\n  2. 方案二\\r\\n  3. 保持现状\\r\\n❯ 4. \\r\\n  5. Chat about this\\r\\nEnter to submit · Esc to cancel');const inline=await fanboxPty.question(s.id,'Unified 行参数方案怎么定？');check(inline.menu?.kind==='input','inline numbered custom-answer step');
  term.closeTab(s.id);let closed=false;try{await fanboxPty.question(s.id);}catch{closed=true;}check(closed,'closed session rejects reads');
  return {options:first.menu.options.length,focus:updated.menu.selected,historyPrivate:true,currentScreen:true,customText:true,closed:true};
 })()`);console.log('PASS actual renderer -> question-only IPC:',JSON.stringify(result));
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);if(process.env.GITHUB_ACTIONS)console.log('::error::'+String(error.stack||error).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));process.exitCode=1;});
