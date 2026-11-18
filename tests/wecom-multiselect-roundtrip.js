'use strict';
const assert=require('assert/strict');
const {NativeInteraction,parseMenu}=require('../electron/cli-native-interaction');
const questions=require('../electron/wecom-questions');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{for(let i=0;i<300;i++){if(test())return;await delay(5);}assert.fail('multi-select timed out');};
(async()=>{
 for(const name of ['claude','codebuddy','codex'])for(const mode of ['card','text']){
  const route={userid:'u',number:1,project:'fixture'},writes=[],notices=[],sent=[];
  let focus=2,selected=new Set([1,4]),submitted,hold,unblock,updates=0;
  const labels=['Alpha','Beta','Other','Delta','Echo','Foxtrot'];
  const screen=()=> 'Which features?\r\n'+labels.map((label,i)=>`${focus===i?'❯':' '} ${i+1}. ${selected.has(i)?'☒':'☐'} ${label}`).join('\r\n')+'\r\nEnter to submit · Esc to cancel';
  const service={...questions,valid:r=>r===route,say:async(r,t)=>sent.push(t),send:async(u,t)=>sent.push(t),client:{sendMessage:async()=>{},updateTemplateCard:async()=>{updates++;if(hold){hold=false;await new Promise(r=>unblock=r);}}}};
  const watcher=new NativeInteraction({name,settle:5,keyDelay:1,ackTimeout:200,confirmDelay:5,target:{size:()=>({cols:110,rows:30}),validate:async()=>true,input:key=>{
   writes.push(key);
   if(key==='\x1b[B')focus++;
   else if(key==='\x1b[A')focus--;
   else if(key===' '){if(selected.has(focus))selected.delete(focus);else selected.add(focus);}
   else if(key==='\r'){submitted=[...selected].sort((a,b)=>a-b);watcher.output('\x1b[2J\x1b[HWorking…');return;}
   else assert.fail('Unexpected key '+JSON.stringify(key));
   watcher.output('\x1b[2J\x1b[H'+screen());
  }},ask:(q,signal)=>service.askCLIQuestion(route,q,signal,Date.now()+10000),notify:t=>notices.push(t)});
  try{
   watcher.output('\x1b[2J\x1b[H'+screen());await until(()=>service.questions?.size===1);
   const entry=[...service.questions.values()][0];
   assert(entry.q.multiSelect);assert(!entry.q.nativeText);assert(entry.q.title.startsWith(name));
   assert.deepEqual([...entry.selected],[1,4]);
   const event=(action,id)=>service.questionEvent({body:{msgid:id}},{task_id:'question_'+entry.token,event_key:'question:'+entry.token+':'+action},'u');
   hold=true;const first=event('0','toggle-first');await until(()=>unblock);
   const duplicate=event('0','toggle-first');
   if(mode==='card'){
    const remaining=[event('1','remove-beta'),event('next','page2'),event('2','add-other'),event('next','page3'),event('4','remove-echo'),event('5','add-foxtrot'),event('done','submit')];
    unblock();await Promise.all([first,duplicate,...remaining]);
    await until(()=>submitted&&notices.length);assert.deepEqual(submitted,[0,2,5]);
    assert.equal(entry.page,2);assert.equal(updates,8,'duplicate callback must not toggle/update twice');
   }else{
    const answer=service.answerQuestionText('u',null,`/回答 ${entry.token} 2，6，2`);
    unblock();await Promise.all([first,duplicate,answer]);await until(()=>submitted&&notices.length);
    assert.deepEqual(submitted,[1,5],'text is the complete desired set, replaces card choices and deduplicates');
   }
   assert.equal(writes.filter(x=>x==='\r').length,1);assert(notices.some(t=>t.includes('选择已生效')));
  }finally{watcher.close();}
 }
 // A checkbox change during the final process check must prevent confirmation.
 let focus=0,selected=new Set([0]),validations=0,resolveAnswer;const writes=[],notices=[];
 const screen=()=>`Pick features\r\n${focus===0?'❯':' '} 1. [${selected.has(0)?'x':' '}] A\r\n${focus===1?'❯':' '} 2. [${selected.has(1)?'x':' '}] B\r\nSpace to toggle · Enter to submit · Esc to cancel`;
 const watcher=new NativeInteraction({settle:5,keyDelay:1,ackTimeout:100,confirmDelay:5,target:{size:()=>({cols:110,rows:30}),validate:async()=>{
  if(++validations===2){selected.add(0);watcher.output('\x1b[2J\x1b[H'+screen());}return true;
 },input:key=>{writes.push(key);if(key==='\x1b[B')focus++;else if(key===' '){if(selected.has(focus))selected.delete(focus);else selected.add(focus);}watcher.output('\x1b[2J\x1b[H'+screen());}},ask:()=>new Promise(r=>resolveAnswer=r),notify:t=>notices.push(t)});
 try{watcher.output(screen());await until(()=>resolveAnswer);resolveAnswer({indices:[1]});await until(()=>notices.length);assert(!writes.includes('\r'));assert(notices[0].includes('停止继续输入'));}finally{watcher.close();}
 // Checkbox state from another question must not turn a focused single choice into multi-select.
 const single=parseMenu(['Earlier question','1. [x] Previous','2. [ ] Previous B','','Current question','❯ 1. Yes','  2. No','Enter to confirm · Esc to cancel']);assert(single);assert(!single.multi);
 const other=parseMenu(['Pick one','  1. Alpha','❯ 2. Other','Enter to submit · Esc to cancel']);assert.equal(other.kind,'choice');
 console.log('PASS all three CLI multi-select roundtrips: initial selections, checkbox symbols, Other focus, rapid/duplicate callbacks, paging, toggle off, text replacement/dedupe, one submit and final-set validation');
})().catch(error=>{console.error(error);process.exitCode=1;});
