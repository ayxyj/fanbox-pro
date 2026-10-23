'use strict';
const assert = require('assert/strict');
const { CLISessions } = require('../electron/cli-session');
const { WecomService } = require('../electron/wecom-service');
const { noteInput } = require('../electron/shell-context');
const { parseMenu } = require('../electron/cli-native-interaction');
const { normalize } = require('../electron/cli-result-hook');
const delay = ms => new Promise(r=>setTimeout(r,ms));
const until = async fn => { for(let i=0;i<100;i++){if(fn())return;await delay(10);}assert.fail('timed out waiting for bridge'); };
const choice = 'Allow this command?\r\n❯ 1. Yes\r\n  2. No\r\nEnter to confirm · Esc to cancel';
(async()=>{
  const writes=[],sent=[];let emit,seq=0,failCard=false;
  const route={key:'r',id:'11111111-1111-1111-1111-111111111111',userid:'alice',number:1,project:'fixture',mode:'claude',sessionId:'t',generation:0};
  const store={data:{im:{enabled:true,allowExecution:true,botId:'bot',users:['alice']}},persist(){}};
  const service=new WecomService({store,emit(){},target:()=>terminal,activeCLI:()=> 'claude',runCLI:()=>{throw Error('An answer must not start a new task');}});
  service.client={disconnect(){},sendMessage:async(u,b)=>{if(failCard && b.template_card)throw Error('card unavailable');sent.push(b);},updateTemplateCard:async()=>{}};
  service.routes.set('r',route);service.focus.set('alice','r');
  const terminal={identity:{},state:{idle:true},size:()=>({cols:100,rows:30}),input:t=>{writes.push(t);const native=cli.sessions.get('t')?.native,m=native&&parseMenu(native.lines());if(m&&t==='\x1b[B')emit('\x1b[2J\x1b[H'+choice.replace('❯ 1. Yes','  1. Yes').replace('  2. No','❯ 2. No'));else if(t==='\r'||t==='\x1b')emit('\x1b[2J\x1b[H> ');},subscribeOutput:fn=>{emit=fn;return()=>{};}};
  const cli=new CLISessions({target:()=>terminal,inspect:async()=>({idle:true,name:'claude'}),command:()=> 'claude',wait:async()=>{},resultChannel:()=>({args:'',close(){}}),
    askNative:(id,q,signal)=>service.askCLIQuestion(route,q,signal,Date.now()+10000),notify:(id,text)=>service.say(route,text)});
  service.retryCLIInteraction=id=>cli.retryInteraction(id);service.cliStatus=id=>cli.status(id);service.closeCLI=id=>cli.close(id);
  const frame=text=>({body:{aibotid:'bot',msgid:String(++seq),chattype:'single',msgtype:'text',from:{userid:'alice'},text:{content:text}}});
  const entry=()=>[...(service.questions?.values()||[])][0];
  const draw=text=>emit('\x1b[2J\x1b[H'+text);
  try {
    await cli.start('t','claude');const s=cli.sessions.get('t');s.native.settle=10;s.native.keyDelay=1;s.native.ackTimeout=50;s.native.confirmDelay=5;
    draw(choice);await until(()=>entry());const old=entry();
    // A transient clear followed by the same question keeps the live card.
    emit('\x1b[2J\x1b[H');await delay(20);emit(choice);await delay(40);assert.equal(entry(),old);
    cli.userInput('t','x');draw(choice);await until(()=>entry()&&entry()!==old);
    const n=writes.length;
    await service.questionEvent({}, {task_id:'question_'+old.token,event_key:'question:'+old.token+':0'},'alice');
    assert.equal(writes.length,n,'stale cards must never type');
    await service.accept(frame('2'));await until(()=>writes.at(-1)==='\r'&&!s.native.current?.processing);assert.deepEqual(writes.slice(-2),['\x1b[B','\r']);
    draw('> ');await delay(30);draw(choice);await until(()=>entry());const beforeResize=entry();cli.resize('t',110,32);await until(()=>entry()&&entry()!==beforeResize);
    assert.match(cli.status('t').text,/确认/);
    // Expiry must leave the native dialog intact and permit an explicit resend.
    entry().finish(null);await delay(20);assert(!entry());await service.accept(frame('/retry'));await until(()=>entry());
    await service.accept(frame('取消'));await until(()=>writes.at(-1)==='\x1b'&&!s.native.current?.processing);
    draw('Your answer?\r\n❯ 1. Type something.\r\nEnter to submit · Esc to cancel');await until(()=>entry());
    const inputEntry=entry();await service.accept(frame('bad\x1b[31m'));assert.equal(entry(),inputEntry,'invalid text keeps the question answerable');
    await service.accept(frame('/a/path'));await until(()=>writes.at(-1)==='\r'&&!s.native.current?.processing);assert.deepEqual(writes.slice(-2),['\x1b[200~/a/path\x1b[201~','\r']);
    failCard=true;draw(choice);await until(()=>entry());await until(()=>sent.some(b=>b.markdown?.content.includes('卡片发送失败')));
    await service.accept(frame('1'));await until(()=>writes.at(-1)==='\r');failCard=false;
    // Local submission must produce a task whose final result is forwarded once.
    cli.userInput('t','local task\r');const prompt=normalize({hook_event_name:'UserPromptSubmit'});cli.result('t',s,prompt);assert(s.pending);
    const result={kind:'result',key:'local-result',createdAt:prompt.createdAt+1,text:'LOCAL_FINAL'};
    cli.result('t',s,result);cli.result('t',s,result);await s.sending;
    assert.equal(sent.filter(b=>b.markdown?.content.includes('LOCAL_FINAL')).length,1);assert(!s.pending);
    const state={inputLine:''};
    for(const report of ['\x1b[?2026;2$y','\x1bP1$r0m\x1b\\','\x1b[I','\x1b[O','\x1b[8;30;120t'])noteInput(state,report);
    assert.equal(state.inputLine,'');noteInput(state,'normal');assert.equal(state.inputLine,'normal');
    assert(parseMenu(['Accessing workspace:','C:\\fixture','Quick safety check: Is this a project you trust?','❯ 1. Yes, I trust this folder','  2. No, exit']));
    const liveTrust=parseMenu(['Accessing workspace:','C:\\fixture','Quick safety check: Is this a project you trust?','❯ No, exit','  Yes, I trust this folder','Enter to confirm · Esc to cancel']);
    assert.deepEqual(liveTrust.options.map(o=>o.label),['No, exit','Yes, I trust this folder']);assert.equal(liveTrust.selected,0);
    console.log('PASS native screen -> WeCom -> actual terminal keys: redraw, stale clicks, resize, expiry/resend, text/control validation, slash answer, card fallback, local final result and terminal reports');
  } finally {cli.close('t');service.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
