'use strict';
const assert=require('assert/strict');
const {WecomService}=require('../electron/wecom-service');
(async()=>{
 const sent=[],forwarded=[],stops=[];let seq=0;
 const service=new WecomService({store:{data:{im:{enabled:true,allowExecution:true,botId:'bot',users:['u']}},persist(){}},emit(){},activeCLI:()=> 'claude',runCLI:async(id,text)=>{forwarded.push(text);return {text:'sent'};},stopCLI:id=>stops.push(id),closeCLI(){},releaseSession(){}});
 service.client={sendMessage:async(u,b)=>sent.push(b.markdown?.content||b.template_card),updateTemplateCard:async()=>{},disconnect(){}};
 const a={key:'a',id:'11111111-1111-1111-1111-111111111111',sessionId:'a',number:1,project:'A',userid:'u',mode:'claude',generation:0};
 const b={...a,key:'b',id:'22222222-2222-2222-2222-222222222222',sessionId:'b',number:2,project:'B'};
 service.routes.set('a',a);service.routes.set('b',b);service.focus.set('u','b');
 const controller=new AbortController();
 const ask=(route,q)=>{const promise=service.askCLIQuestion(route,{nativeMenu:true,title:'CLI',question:'Question?',options:[],...q},controller.signal,Date.now()+10000);return {promise,entry:[...service.questions.values()].at(-1)};};
 const accept=(text,quote)=>service.accept({body:{aibotid:'bot',msgid:String(++seq),chattype:'single',msgtype:'text',from:{userid:'u'},text:{content:text},...(quote?{quote}: {})}});
 try{
  const direct=ask(b,{nativeText:true});
  await service.questionEvent({}, {task_id:'question_'+direct.entry.token,event_key:'question:'+direct.entry.token+':custom'},'u');
  assert(sent.some(t=>typeof t==='string'&&t.includes('请直接回复文字内容')));
  await accept('这就是文字回答\n包含第二行');assert.deepEqual(await direct.promise,{text:'这就是文字回答\n包含第二行'});
  const cross=ask(a,{multiSelect:true,options:[{label:'A'},{label:'B'},{label:'C'}]});
  await accept(`/回答 ${cross.entry.token} 1 3`);assert.deepEqual(await cross.promise,{indices:[0,2]});assert.equal(service.focused('u'),b);
  const quoted=ask(a,{options:[{label:'A'},{label:'B'}]});
  await accept('2',{text:{content:'[会话:11111111]'}});assert.deepEqual(await quoted.promise,{indices:[1]});assert.equal(service.focused('u'),a);
  const first=ask(a,{nativeText:true}),second=ask(a,{nativeText:true});
  await accept('ambiguous answer');assert.equal(service.questions.size,2);assert(sent.at(-1).includes('多个待回答问题'));
  await accept(`/回答 ${first.entry.token} first`);assert.deepEqual(await first.promise,{text:'first'});
  await accept('second');assert.deepEqual(await second.promise,{text:'second'});
  const customChoice=ask(a,{fixedOptions:true,options:[{label:'A'},{label:'Other'}]});
  await accept('自定义内容');assert(service.questions.has(customChoice.entry.token),'fixed options must be selected before text input');
  await accept('2');assert.deepEqual(await customChoice.promise,{indices:[1]});
  const literal=ask(a,{nativeText:true});await accept(`/回答 ${literal.entry.token} /stop`);assert.deepEqual(await literal.promise,{text:'/stop'});assert.equal(stops.length,0);
  const empty=ask(a,{multiSelect:true,options:[{label:'A'}]});
  await service.questionEvent({}, {task_id:'question_'+empty.entry.token,event_key:'question:'+empty.entry.token+':done'},'u');
  assert(service.questions.has(empty.entry.token));assert(sent.at(-1).includes('至少一项'));
  await accept('取消');assert.deepEqual(await empty.promise,{cancel:true});
  for(const text of ['/回答','/回答 你好','/回答 000000000000 1'])await accept(text);
  assert.equal(forwarded.length,0,'answer commands, invalid formats and expired answers never become new CLI prompts');
  console.log('PASS direct text/custom guidance, explicit cross-session multi-select, quoted replies, ambiguity handling, select Other before text, literal bridge commands, empty multi rejection and malformed/expired command isolation');
 }finally{controller.abort();service.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
