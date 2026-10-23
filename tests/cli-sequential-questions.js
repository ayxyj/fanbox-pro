'use strict';
const assert=require('assert/strict');
const {NativeInteraction,parseMenu}=require('../electron/cli-native-interaction');
const questions=require('../electron/wecom-questions');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{for(let i=0;i<300;i++){if(test())return;await delay(10);}assert.fail('question sequence timed out');};
const titles=['Question ONE: language?','Question TWO: database?','Question THREE: deploy?'];
const options=[['JavaScript','Python'],['SQLite','Postgres'],['Local','Cloud']];
function screen(active){return titles.map((title,i)=>title+'\r\n'+options[i].map((label,j)=>`${i===active&&j===0?'❯':' '} ${j+1}. ${label}`).join('\r\n')).join('\r\n\r\n')+'\r\nEnter to confirm · Esc to cancel';}
(async()=>{
 for(let i=0;i<3;i++){const m=parseMenu(screen(i).split('\r\n'));assert(m);assert.deepEqual(m.options.map(o=>o.label),options[i]);assert(m.question.includes(titles[i]));for(let j=i+1;j<3;j++)assert(!JSON.stringify(m).includes(titles[j]),'future questions are not part of current menu');}
 const route={userid:'u',number:1,project:'fixture'},texts=[],cards=[],asked=[],writes=[],notices=[];let active=0;
 const service={...questions,valid:r=>r===route,say:async(r,text)=>texts.push(text),send:async()=>{},client:{sendMessage:async(u,b)=>cards.push(b.template_card),updateTemplateCard:async()=>{}}};
 const watcher=new NativeInteraction({settle:25,keyDelay:5,ackTimeout:300,confirmDelay:30,target:{size:()=>({cols:120,rows:40}),validate:async()=>true,input:key=>{
  writes.push(key);assert.equal(key,'\r');active++;
  watcher.output('\x1b[2J\x1b[H');
  // A partial redraw may briefly contain a later tab. It must not be published.
  if(active<2)watcher.output(screen(2));
  setTimeout(()=>watcher.output('\x1b[2J\x1b[H'+(active<3?screen(active):'Working…')),10);
 }},ask:(q,signal)=>{asked.push(q);return service.askCLIQuestion(route,q,signal,Date.now()+10000);},notify:t=>notices.push(t)});
 try{
  watcher.output('\x1b[2J\x1b[H'+screen(0));await until(()=>cards.length===1);
  await delay(100);assert.equal(asked.length,1);assert.equal(service.questions.size,1);assert(!texts.join('').includes(titles[1]));
  // Row movement and focus-only redraws retain the current question/card.
  watcher.output('\x1b[2J\x1b[H\r\n'+screen(0));await delay(70);assert.equal(cards.length,1);
  for(let i=0;i<3;i++){
   assert(asked[i].question.includes(titles[i]));assert.equal(asked.length,i+1);
   await service.answerQuestionText('u',route,'1');
   if(i<2)await until(()=>cards.length===i+2);else await until(()=>notices.length===3);
   assert.equal(writes.length,i+1);assert.equal(service.questions.size,i<2?1:0);
  }
  assert.equal(asked.length,3);assert.equal(cards.length,3);
 }finally{watcher.close();}
 // Cancelled/stale messages queued behind a slow send must never escape.
 let release;const sent=[],blocked=new Promise(r=>release=r),first=new AbortController(),stale=new AbortController(),last=new AbortController();
 service.say=async(r,t)=>{sent.push(t);if(sent.length===1)await blocked;};service.client.sendMessage=async(u,b)=>sent.push(b.template_card.main_title.desc);
 const q=n=>({nativeMenu:true,question:'Queued '+n,title:'CLI',options:[{label:'Yes'}]});
 const p1=service.askCLIQuestion(route,q(1),first.signal,Date.now()+10000);await until(()=>sent.length===1);first.abort();
 const p2=service.askCLIQuestion(route,q(2),stale.signal,Date.now()+10000);stale.abort();
 const p3=service.askCLIQuestion(route,q(3),last.signal,Date.now()+10000);release();await until(()=>sent.some(t=>t==='Queued 3'));assert(!sent.some(t=>t.includes('Queued 2')));last.abort();await Promise.all([p1,p2,p3]);
 // Structured question batches also wait for each answer instead of fan-out.
 service.say=async()=>{};service.client.sendMessage=async()=>{};
 const batch=new AbortController(),pending=service.askCLIQuestions(route,titles.map(question=>({question,options:[{label:'Yes'}]})),batch.signal);
 await until(()=>service.questions.size===1);assert.equal([...service.questions.values()][0].q.question,titles[0]);
 await service.answerQuestionText('u',route,'1');await until(()=>[...service.questions.values()][0]?.q.question===titles[1]);assert.equal(service.questions.size,1);batch.abort();assert.equal(await pending,null);assert.equal(service.questions.size,0);
 console.log('PASS only focused question, one active card, answer/terminal acknowledgement before next question, transient tabs, stale sends and sequential batches');
})().catch(e=>{console.error(e);process.exitCode=1;});
