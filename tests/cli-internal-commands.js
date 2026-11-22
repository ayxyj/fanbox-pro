'use strict';
const assert=require('assert/strict');
const {CLISessions}=require('../electron/cli-session');
const {normalize,uiCommand}=require('../electron/cli-result-hook');
const {parseMenu,terminalIdle}=require('../public/terminal-question');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const modelLines=['Select model?','❯ 1. glm-5.3-flash-tc','  2. Another model','Enter to select · Esc to cancel'];
const done=['❯ /model','  ⎿ Set model to glm-5.3-flash-tc and saved as your default for new sessions','','❯ ','─────────','auto mode on (shift+tab to cycle)'];
(async()=>{
 assert(terminalIdle(done,done.length-1),'model completion with cursor on footer');
 assert(!terminalIdle([...done,'esc to interrupt'],5),'active model processing is never idle');
 assert(!terminalIdle(['❯ ','Select model','❯ glm-5.3-flash-tc','Esc to cancel'],3),'unrecognized picker remains busy');
 assert(!terminalIdle(['❯ user is still typing'],0),'nonempty input is not idle');
 assert.equal(uiCommand('/model glm-5.3-flash-tc'),'/model');assert.equal(uiCommand('/model\ncontinue task'),null);assert.equal(uiCommand('/review'),null);
 assert.equal(normalize({hook_event_name:'UserPromptSubmit',prompt:'/model'}).command,'/model');
 assert(!JSON.stringify(normalize({hook_event_name:'UserPromptSubmit',prompt:'private user request'})).includes('private user request'));
 for(const reader of [true,false]){
  let emit,phase='idle',prompt='';const sent=[],writes=[];
  const current=()=>phase==='menu'?modelLines:phase==='idle'?done:['❯ ','Working…','esc to interrupt'];
  const t={identity:{},pendingInput:'',size:()=>({cols:110,rows:30}),subscribeOutput:fn=>{emit=fn;return()=>{};},...(reader?{readQuestion:async()=>({menu:parseMenu(current()),idle:!parseMenu(current())&&terminalIdle(current(),current().length-1)})}:{}),input:key=>{writes.push(key);if(key.startsWith('\x1b[200~')){prompt=key.slice(6,-6);phase='working';}if(key==='\r'){phase=prompt.startsWith('/model')?'menu':'working';}emit?.('\x1b[2J\x1b[H'+current().join('\r\n'));}};
  const cli=new CLISessions({target:()=>t,inspect:async()=>({idle:true,name:'claude'}),command:()=> 'claude',wait:async()=>{},resultChannel:()=>({args:'',close(){}}),askNative:()=>new Promise(()=>{}),notify:async(id,text)=>sent.push(text)});
  try{
   await cli.start('t','claude');const s=cli.sessions.get('t');s.native.settle=1;
   const refresh=async()=>{emit('\x1b[2J\x1b[H'+current().join('\r\n'));await delay(15);await s.native.refresh();};
   await cli.run('t','/model');await refresh();assert(s.pending&&s.nativeMenu,'picker keeps task pending');
   cli.userInput('t','\r');phase='idle';await refresh();await s.sending;assert(!s.pending&&!s.nativeMenu,'model selection releases busy state without Stop');assert(sent.some(text=>text.includes('/model 操作已结束')));
   const count=sent.length;await refresh();await s.sending;assert.equal(sent.length,count,'completion notice is not repeated');
   await cli.run('t','normal task');phase='idle';await refresh();assert(s.pending,'ordinary task still requires completion callback');cli.stop('t');
   await cli.run('t','/review');phase='idle';await refresh();assert(s.pending,'custom slash tasks still require completion callback');cli.stop('t');
   // Local command input is tracked even on CLI versions that omit prompt text.
   t.pendingInput='/model';cli.userInput('t','\r');t.pendingInput='';cli.result('t',s,{kind:'prompt',createdAt:Date.now()+1});phase='menu';await refresh();assert(s.pending&&s.nativeMenu);
   cli.userInput('t','\r');phase='idle';await refresh();assert(!s.pending,'local /model also releases busy state');
   // A hook carrying a canonical built-in command needs no local key buffer.
   cli.result('t',s,normalize({hook_event_name:'UserPromptSubmit',prompt:'/model glm-5.3-flash-tc'}));assert(s.pending);await refresh();assert(!s.pending);
   if(reader){await cli.run('t','/model glm-5.3-flash-tc');phase='idle';await cli.run('t','next after completed model');assert(s.pending&&!s.slashCommand,'next message rereads completed internal command before rejecting busy');cli.stop('t');}
  }finally{cli.close('t');}
 }
 console.log('PASS remote/local /model menu and direct args, footer-cursor idle, no Stop requirement, ordinary/custom tasks remain pending and no prompt text leakage');
})().catch(error=>{console.error(error);process.exitCode=1;});
