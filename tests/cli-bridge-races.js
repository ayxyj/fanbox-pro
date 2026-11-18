'use strict';
const assert = require('assert/strict');
const { CLISessions } = require('../electron/cli-session');
const { WecomService } = require('../electron/wecom-service');
const { createResultChannel } = require('../electron/cli-result-channel');
const fs = require('fs'), path = require('path');
(async () => {
  for (const change of ['local', 'exit', 'replace', 'stop']) {
    const writes = [], notices = [];
    let t = {identity:{}, input: x => writes.push(x), subscribeOutput: () => () => {}};
    let state = {idle:true,name:'codex'}, intervene = false;
    const cli = new CLISessions({target:()=>t, inspect:async()=>state, command:()=> 'codex', resultChannel:()=>({args:'',close(){}}), notify:async(id,text)=>notices.push(text), wait:async()=>{
      if (!intervene) return;
      if (change === 'local') cli.userInput('t','x');
      if (change === 'exit') state={idle:true};
      if (change === 'replace') t={...t,identity:{}};
      if (change === 'stop') cli.stop('t');
    }});
    try {
      await cli.start('t','codex'); intervene=true;
      await assert.rejects(cli.run('t','remote prompt'),/未发送回车/);
      assert(!writes.slice(1).includes('\r'),change+' must not submit after the terminal changes');
      assert(!cli.status('t').pending,'an unsubmitted prompt must not remain processing');
      const s=cli.sessions.get('t');
      cli.stop('t');
      cli.userInput('t','local prompt\r');
      const event={kind:'result',key:'local-turn',text:'LOCAL CODEX RESULT',createdAt:Date.now()+1};
      cli.result('t',s,event);cli.result('t',s,event);await s.sending;
      assert.equal(notices.filter(x=>x==='LOCAL CODEX RESULT').length,1);
      cli.userInput('t','another\r');cli.stop('t');
      cli.result('t',s,{...event,key:'stopped',text:'SHOULD NOT SEND',createdAt:Date.now()+2});await s.sending;
      assert(!notices.includes('SHOULD NOT SEND'));
    } finally {cli.close('t');}
  }
  const route={key:'r',id:'11111111',number:1,project:'fixture',mode:'codebuddy',userid:'u',generation:0};
  const service=new WecomService({store:{data:{im:{enabled:true,allowExecution:true,botId:'bot',users:['u']}},persist(){}},emit(){}});
  service.routes.set('r',route);service.client={sendMessage:async()=>{},disconnect(){}};
  const controller=new AbortController();
  try {
    const answer=service.askCLIQuestion(route,{question:'Enter a number',options:[]},controller.signal,Date.now()+10000);
    const entry=[...service.questions.values()][0];
    await service.accept({body:{aibotid:'bot',msgid:'1',msgtype:'text',from:{userid:'u'},text:{content:'  /回答\t'+entry.token+' 123'}}});
    assert.equal(await answer,'123','explicit replies allow leading whitespace/tab; text-only numeric answers are text');
    const pending=service.askCLIQuestion(route,{question:'Text',options:[]},controller.signal,Date.now()+10000);
    await service.answerQuestionText('u',route,'bad\x1b[31m');assert.equal(service.questions.size,1);
    await service.answerQuestionText('u',route,'x'.repeat(4001));assert.equal(service.questions.size,1);
    await service.answerQuestionText('u',route,'valid\nanswer');assert.equal(await pending,'valid\nanswer');
  } finally {controller.abort();service.stop();}
  const channel=createResultChannel('codebuddy',()=>{}, {runtime:process.execPath});
  try {const settings=JSON.parse(fs.readFileSync(path.join(channel.directory,'settings.json'),'utf8'));assert(settings.hooks.UserPromptSubmit);assert(settings.hooks.Notification);}
  finally {channel.close();}
  console.log('PASS CLI takeover/exit/replacement/stop races, local Codex results, stale completion suppression, explicit whitespace replies, numeric text, validation and CodeBuddy prompt hooks');
})().catch(error=>{console.error(error);process.exitCode=1;});
