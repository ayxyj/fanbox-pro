'use strict';
const assert=require('assert/strict');
const {parseMenu,NativeInteraction}=require('../electron/cli-native-interaction');
const {CLISessions}=require('../electron/cli-session');
const {createTerminalQuestions}=require('../electron/terminal-question');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await delay(5);}assert.fail('visible question timed out');};
const lines=focus=>['我的建议','方案一落地保底，方案二做一次 10 分钟验证。','修复方案','Unified 行参数方案怎么定？',...['方案二 + 验证方案一（推荐）','只做方案一','保持现状（后端 - 补全）','Type something.','Chat about this'].flatMap((label,i)=>[`${i===focus?'❯':' '} ${i+1}. ${label}`,...(i<3?['    deploy 改 job 引号 + system.properties 空默认，后端补全；UAT 验证环境变量注入']:[]),...(i===3?['────────────────────']:[])]),'Enter to select · ↑/↓ to navigate · Esc to cancel'];
(async()=>{
 // Both local and SSH targets must use the actual renderer question reader.
 const fs=require('fs'),vm=require('vm'),source=fs.readFileSync(require.resolve('../electron/remote-workspace'),'utf8');
 const start=source.indexOf('  const target = id => {'),end=source.indexOf('  const sendFile',start),reads=[];
 const sshSession={environment:{}},localSession={environment:{}},pty={cols:120,rows:35};
 const context={ssh:{sessions:new Map([['ssh',sshSession]]),get:()=>sshSession},local:new Map([['local',localSession]]),terminals:new Map([['local',pty]]),terminalCwds:new Map(),policies:new Map(),subscribeOutput(){},readQuestion:(id,text)=>{reads.push([id,text]);return Promise.resolve({menu:null,idle:false});}};
 const getTarget=vm.runInNewContext(source.slice(start,end)+';target',context);
 await getTarget('local').readQuestion('local question');await getTarget('ssh').readQuestion('SSH question');assert.deepEqual(reads,[['local','local question'],['ssh','SSH question']]);
 const requests=[],contents={send:(channel,data)=>requests.push({channel,data})},window={webContents:contents,isDestroyed:()=>false};
 const broker=createTerminalQuestions({getWindow:()=>window,hasTerminal:id=>id==='t',timeout:25});
 let pending=broker.request('t');let request=requests.at(-1).data;
 assert.equal(broker.receive({}, {...request,menu:parseMenu(lines(0)),idle:false}),false,'other windows cannot answer');
 assert.equal(broker.receive(contents,{...request,id:'wrong',menu:null,idle:true}),false,'other sessions cannot answer');
 broker.receive(contents,{...request,menu:parseMenu(lines(0)),idle:false,lines:['PRIVATE TERMINAL OUTPUT']});
 const received=await pending;assert.equal(received.menu.options.length,5);assert(!JSON.stringify(received).includes('PRIVATE TERMINAL OUTPUT'));
 pending=broker.request('t');request=requests.at(-1).data;broker.receive(contents,{...request,menu:{...parseMenu(lines(0)),selected:99},idle:false});await assert.rejects(pending,/问题数据无效/);
 await assert.rejects(broker.request('missing'),/已关闭/);await assert.rejects(broker.request('t'),/超时/);broker.close();
 let focus=0,shown=true,failRead=false,reply;const cards=[],writes=[],notices=[];
 const native=new NativeInteraction({settle:5,keyDelay:1,ackTimeout:100,confirmDelay:5,target:{size:()=>({cols:80,rows:24}),readQuestion:async()=>{if(failRead)throw Error('offline');return {menu:shown?parseMenu(lines(focus)):null,idle:!shown};},validate:async()=>true,input:key=>{writes.push(key);if(key==='\x1b[B')focus++;else if(key==='\r')shown=false;else assert.fail('unexpected key');}},ask:(q,signal)=>new Promise(resolve=>{reply=resolve;cards.push({q,signal});}),notify:t=>notices.push(t)});
 try{
  assert.equal(native.screen,undefined,'renderer-backed bridges must not create a second headless parser');
  for(let i=0;i<100;i++){
   native.output('\x1b[H'+('long wrapped line '.repeat(30)+'\r\n').repeat(5));
   native.resize(i%2?160:30,i%2?50:8);
  }
  await native.refresh();await until(()=>cards.length===1);
  native.resize(120,35);await native.retry();await until(()=>native.current);
  cards.length=0;native.invalidate();native.lastFingerprint=null;
  // Deliberately wrong independent mirror: the actual visible question is authoritative.
  native.output('stale shell and unrelated cursor state');await until(()=>cards.length===1);assert.equal(cards[0].q.options.length,5);assert.match(cards[0].q.question,/Unified/);
  native.input('local prompt\r');shown=false;await native.refresh();assert(cards[0].signal.aborted);
  shown=true;await native.retry();await until(()=>cards.length===2);
  reply({indices:[1]});await until(()=>notices.some(t=>t.includes('选择已生效')));assert.deepEqual(writes,['\x1b[B','\r']);
  shown=true;focus=0;await native.retry();await until(()=>cards.length===3);const count=writes.length;
  failRead=true;reply({indices:[0]});await until(()=>notices.some(t=>t.includes('停止继续输入')));assert.equal(writes.length,count,'failed actual question read cannot type into the stale mirror');
 }finally{native.close();}
 let multiFocus=0,multiShown=true,multiReply;const checked=new Set([0]),multiWrites=[];
 const multi=new NativeInteraction({settle:5,keyDelay:1,ackTimeout:100,confirmDelay:5,target:{validate:async()=>true,readQuestion:async()=>({idle:!multiShown,menu:multiShown?parseMenu(['Choose features?',...['A','B','C'].map((label,i)=>`${multiFocus===i?'❯':' '} ${i+1}. [${checked.has(i)?'x':' '}] ${label}`),'Space to toggle · Enter to confirm · Esc to cancel']):null}),input:key=>{multiWrites.push(key);if(key==='\x1b[B')multiFocus++;else if(key===' ')checked.has(multiFocus)?checked.delete(multiFocus):checked.add(multiFocus);else if(key==='\r')multiShown=false;else assert.fail('unexpected multi key');}},ask:()=>new Promise(resolve=>{multiReply=resolve;})});
 try{await multi.retry();await until(()=>multiReply);multiReply({indices:[1,2]});await until(()=>!multiShown&&!multi.current?.processing);assert.deepEqual([...checked],[1,2]);assert.equal(multiWrites.filter(key=>key==='\r').length,1,'visible checked states acknowledged before one submit');}finally{multi.close();}
 let readMenu=null;const notices2=[];const t={identity:{},input(){},subscribeOutput:()=>()=>{},readQuestion:async()=>({menu:readMenu,idle:false})};
 const cli=new CLISessions({target:()=>t,inspect:async()=>({idle:true,name:'claude'}),command:()=> 'claude',wait:async()=>{},resultChannel:()=>({args:'',close(){}}),askNative:()=>new Promise(()=>{}),notify:async(id,text)=>notices2.push(text)});
 try{
  await cli.start('t','claude');const s=cli.sessions.get('t');cli.userInput('t','local prompt\r');cli.result('t',s,{kind:'prompt',createdAt:Date.now()+1});
  await cli.result('t',s,{kind:'awaiting-input',createdAt:Date.now()+2});await s.sending;
  assert(s.progress.paused);assert.match(cli.status('t').text,/等待回答/);assert(notices2.some(t=>t.includes('/retry')));
  readMenu=parseMenu(lines(0));assert.match(await cli.retryInteraction('t'),/重新读取/);assert.equal(s.native.current.menu.options.length,5);assert.match(cli.status('t').text,/确认或回答/);
  cli.stop('t');assert(!s.awaitingInput);
 }finally{cli.close('t');}
 console.log('PASS screenshot five-choice question, actual visible menu over stale mirror, local prompt -> new question, fresh retry, actual-focus navigation, closed/unavailable fail-closed, waiting status and scoped question-only IPC');
})().catch(error=>{console.error(error);process.exitCode=1;});
