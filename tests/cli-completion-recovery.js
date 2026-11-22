'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {CLISessions}=require('../electron/cli-session');
const {normalize}=require('../electron/cli-result-hook');
const {createResultChannel}=require('../electron/cli-result-channel');
(async()=>{
 for(const name of ['claude','codebuddy','codex']){
  let fail=true;const sent=[],t={identity:{},input(){},subscribeOutput:()=>()=>{}};
  const cli=new CLISessions({target:()=>t,inspect:async()=>({idle:true,name}),command:()=>name,wait:async()=>{},resultChannel:()=>({args:'',close(){}}),notify:async(id,text)=>{if(fail)throw Error('offline');sent.push(text);}});
  // start() only launches from a shell.
  let startup=true;cli.inspect=async()=>startup?(startup=false,{idle:true}):({name});
  try{
   await cli.start('t',name);await cli.run('t','first prompt');const s=cli.sessions.get('t');
   const event={kind:'result',key:'final-1',text:'FINAL_'+name,createdAt:Date.now()+1};
   cli.result('t',s,event);await s.sending;assert(!s.pending);assert.match(cli.status('t').text,/发送失败/);
   fail=false;assert.match(await cli.retryInteraction('t'),/重新发送上一轮/);assert.deepEqual(sent,['FINAL_'+name]);
   cli.result('t',s,event);await s.sending;assert.equal(sent.length,1,'duplicate completion cannot auto-resend');
   await cli.run('t','second prompt');assert(!s.finalDelivery,'new turn clears old resend cache');
   cli.userInput('t','\x03');assert(!s.pending,'local Ctrl+C releases the busy state');
   cli.result('t',s,{...event,key:'late',text:'LATE'});await s.sending;assert.equal(sent.length,1);
   await cli.run('t','third prompt');cli.userInput('t','\x1b');assert(!s.pending,'local Esc interruption releases the busy state');
  }finally{cli.close('t');}
 }
 const channel=createResultChannel('claude',()=>{},{runtime:process.execPath,interval:60000});
 let manager;
 try{
  const transcript=path.join(channel.directory,'fixture.jsonl');
  const before=Date.now()-5000,now=Date.now();
  fs.writeFileSync(transcript,[
   {sessionId:'fixture',timestamp:new Date(before-1000).toISOString(),message:{role:'assistant',content:[{type:'text',text:'OLD_PRIVATE'}]}},
   {sessionId:'fixture',timestamp:new Date(before).toISOString(),message:{role:'user',content:'current task'}},
   {sessionId:'fixture',timestamp:new Date(now).toISOString(),message:{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'CURRENT_FINAL'}]}},
   {sessionId:'fixture',isSidechain:true,timestamp:new Date(now).toISOString(),message:{role:'assistant',content:'PRIVATE_CHILD'}},
   {sessionId:'other',timestamp:new Date(now).toISOString(),message:{role:'assistant',content:'OTHER_SESSION'}}
  ].map(JSON.stringify).join('\n'));
  const idle=normalize({hook_event_name:'Notification',notification_type:'idle_prompt',session_id:'fixture',transcript_path:transcript,message:'NOT_THE_FINAL'});
  assert.equal(idle.kind,'idle');assert.equal(idle.text,'CURRENT_FINAL');assert.equal(idle.turnAt,before);assert.equal(idle.finishedAt,now);
  const sent=[],t={identity:{},input(){},subscribeOutput:()=>()=>{}};let startup=true;
  manager=new CLISessions({target:()=>t,inspect:async()=>startup?(startup=false,{idle:true}):({name:'claude'}),command:()=> 'claude',wait:async()=>{},resultChannel:()=>({args:'',close(){}}),notify:async(id,text)=>sent.push(text)});
  await manager.start('t','claude');const s=manager.sessions.get('t');manager.beginTask('t',s,before+10);
  manager.result('t',s,{...idle,finishedAt:before-1});assert(s.pending,'an old transcript cannot complete the current task');
  manager.result('t',s,normalize({hook_event_name:'Notification',notification_type:'idle_prompt'}));assert(s.pending,'missing transcript cannot be treated as success');
  manager.result('t',s,idle);await s.sending;assert(!s.pending);assert.deepEqual(sent,['CURRENT_FINAL']);
  manager.result('t',s,normalize({hook_event_name:'Stop',session_id:'fixture',last_assistant_message:'CURRENT_FINAL'}));await s.sending;assert.equal(sent.length,1,'late Stop after idle fallback is deduplicated');
  await manager.run('t','pending with queued completion');
  s.channel.poll=async()=>{manager.result('t',s,{kind:'result',key:'queued-final',text:'QUEUED_FINAL',createdAt:Date.now()+1});s.channel.poll=undefined;};
  await manager.run('t','next prompt');await s.sending;assert(sent.includes('QUEUED_FINAL'));assert(s.pending,'queued completion is drained before accepting the next task');
 }finally{manager?.close('t');channel.close();}
 console.log('PASS three-CLI final delivery/retry, local interruptions, late-result isolation, explicit idle recovery, exact current-turn transcript and duplicate suppression');
})().catch(error=>{console.error(error);process.exitCode=1;});
