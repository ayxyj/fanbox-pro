'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {createResultChannel}=require('../electron/cli-result-channel');
const {normalize,waitDecision}=require('../electron/cli-result-hook');
const questions=require('../electron/wecom-questions');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let answer=true,events=[];
 const channel=createResultChannel('claude',event=>{events.push(event);channel.respond(event.key,answer);},{runtime:process.execPath,interval:20});
 async function call(event){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(channel.directory,'notify.cjs'),channel.directory],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0);resolve(JSON.parse(out));}catch(e){reject(e);}});child.stdin.end(JSON.stringify(event));});}
 try{
  const config=JSON.parse(fs.readFileSync(path.join(channel.directory,'settings.json'),'utf8'));assert(config.hooks.PermissionRequest);assert.equal(config.hooks.PreToolUse[0].matcher,'AskUserQuestion');
  let result=await call({hook_event_name:'PermissionRequest',tool_name:'Bash',tool_input:{command:'echo hello'},agent_id:'child'});assert.equal(result.hookSpecificOutput.decision.behavior,'allow');assert.equal(events[0].input.command,'echo hello');
  answer=false;result=await call({hook_event_name:'PermissionRequest',tool_name:'Bash',tool_input:{command:'echo denied'}});assert.equal(result.hookSpecificOutput.decision.behavior,'deny');
  answer={'目标项目':'fanbox-pro-win'};result=await call({hook_event_name:'PreToolUse',tool_name:'AskUserQuestion',tool_input:{questions:[{question:'目标项目',options:[{label:'fanbox-pro-win'},{label:'fanbox-plus'}]}]}});assert.equal(result.hookSpecificOutput.permissionDecision,'allow');assert.deepEqual(result.hookSpecificOutput.updatedInput.answers,answer);assert.equal(result.hookSpecificOutput.updatedInput.questions.length,1);
  answer=false;result=await call({hook_event_name:'PreToolUse',tool_name:'AskUserQuestion',tool_input:{questions:[]}});assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
  const key='00000000-0000-0000-0000-000000000000';fs.writeFileSync(path.join(channel.directory,key+'.request'),'1');assert.equal(await waitDecision(channel.directory,key,5),false);
 }finally{channel.close();}
 const sent=[],updates=[],route={userid:'u',number:1,project:'fixture'},other={userid:'u',number:2,project:'other'};
 const service={...questions,valid:r=>r===route||r===other,say:async(r,t)=>sent.push(t),send:async(u,t)=>sent.push(t),client:{sendMessage:async(u,b)=>sent.push(b),updateTemplateCard:async(f,c)=>updates.push(c)}};
 const q={question:'Which project?',options:[{label:'fanbox-pro-win',description:'推荐'},{label:'fanbox-plus'}]};
 let controller=new AbortController(),pending=service.askCLIQuestions(route,[q],controller.signal);await tick();let entry=[...service.questions.values()][0];
 const event=action=>({event_key:`question:${entry.token}:${action}`,task_id:'question_'+entry.token});
 await service.questionEvent({},event('0'),'intruder');assert(service.questions.has(entry.token));
 await service.questionEvent({},event('0'),'u');assert.deepEqual(await pending,{'Which project?':'fanbox-pro-win'});await service.questionEvent({},event('0'),'u');assert.equal(updates.length,1);
 pending=service.askCLIQuestions(route,[{...q,multiSelect:true}],controller.signal);await tick();entry=[...service.questions.values()][0];await service.questionEvent({},event('0'),'u');await service.questionEvent({},event('1'),'u');await service.questionEvent({},event('done'),'u');assert.deepEqual(await pending,{'Which project?':'fanbox-pro-win, fanbox-plus'});
 pending=service.askCLIQuestions(route,[q],controller.signal);await tick();entry=[...service.questions.values()][0];assert.equal(await service.answerQuestionText('u',other,'custom'),false);await service.answerQuestionText('u',null,`/回答 ${entry.token} 整个目录概览`);assert.deepEqual(await pending,{'Which project?':'整个目录概览'});
 pending=service.askCLIQuestions(route,[q],controller.signal);await tick();controller.abort();assert.equal(await pending,null);assert.equal(service.questions.size,0);
 controller=new AbortController();const trust={title:'CodeBuddy 目录信任',question:'信任哪个范围？',fixedOptions:true,options:['仅当前目录','父目录','当前目录及子目录','退出'].map(label=>({label}))};
 pending=service.askCLIQuestions(route,[trust],controller.signal);await tick();entry=[...service.questions.values()][0];const card=service.questionCard(entry);assert.equal(card.main_title.title,trust.title);assert.equal(card.button_list.length,5);assert(!card.button_list.some(b=>b.text==='自定义回答'));
 await service.answerQuestionText('u',route,'随意信任');assert(service.questions.has(entry.token));await service.questionEvent({},event('2'),'intruder');assert(service.questions.has(entry.token));await service.questionEvent({},event('2'),'u');assert.deepEqual(await pending,{[trust.question]:'当前目录及子目录'});
 const {CLISessions}=require('../electron/cli-session');let resolvePermission,requestCount=0;const replies=[];
 const terminal={identity:{},state:{idle:true},input:()=>{terminal.state={name:'claude'};},subscribeOutput:()=>()=>{}};
 const manager=new CLISessions({target:()=>terminal,inspect:async()=>terminal.state,command:n=>n,wait:async()=>{},resultChannel:()=>({args:'',close(){},respond:(key,value)=>replies.push({key,value})}),confirmPermission:async()=>{requestCount++;return new Promise(r=>resolvePermission=r);},askQuestion:async()=>({'Project':'fanbox'})});
 await manager.start('m','claude');const session=manager.sessions.get('m');const request={kind:'permission',key:'a',createdAt:Date.now()};manager.result('m',session,request);manager.result('m',session,request);assert.equal(requestCount,1);assert.equal(session.permissions.size,1);await assert.rejects(manager.run('m','new task'),/审批/);
 for (const reply of ['\x1b[I', '\x1b[O', '\x1b[?2026;2$y', '\x1b[8;30;120t', '\x1bP1$r0m\x1b\\']) manager.userInput('m',reply);
 assert.equal(session.permissions.size,1,'terminal focus/status responses must not cancel approval');
 resolvePermission(true);await tick();assert.equal(replies.at(-1).value,true);
 manager.result('m',session,{...request,key:'local-cancel',createdAt:Date.now()+10});
 manager.stop('m');resolvePermission(true);await tick();assert.equal(replies.at(-1).value,false);assert.equal(session.permissions.size,0);
 manager.result('m',session,{kind:'question',key:'b',createdAt:Date.now()+10});await tick();assert.deepEqual(replies.at(-1).value,{'Project':'fanbox'});manager.close('m');
 console.log('PASS: real hook allow/deny/question replies, timeout, option cards, multi-select, custom answer, ownership, focus isolation, replay, cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
