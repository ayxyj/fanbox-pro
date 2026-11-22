'use strict';
// Optional installed-Claude check. All model requests go to a local fixture;
// the user's account, settings, projects and real bot are not used.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),{spawn}=require('child_process');
const {CLISessions}=require('../electron/cli-session');
const executable=process.argv[2];if(!executable)throw Error('Pass the installed claude.exe path');
const scratch=path.resolve(__dirname,'../dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'real-cli-hooks-'));
const final='FIXTURE_REAL_CLI_FINAL';let calls=0;
const server=http.createServer((req,res)=>{let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{
 if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');res.end('{"input_tokens":1}');return;}
 if(!req.url.includes('/messages')){res.setHeader('Content-Type','application/json');res.end('{}');return;}
 calls++;const message={id:'msg_fixture',type:'message',role:'assistant',model:'fixture-model',content:[{type:'text',text:final}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};
 if(!JSON.parse(raw).stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(message));return;}
 res.setHeader('Content-Type','text/event-stream');
 for(const [event,data]of [
  ['message_start',{message:{...message,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}}],
  ['content_block_start',{index:0,content_block:{type:'text',text:''}}],
  ['content_block_delta',{index:0,delta:{type:'text_delta',text:final}}],
  ['content_block_stop',{index:0}],
  ['message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}}],
  ['message_stop',{}]
 ])res.write('event: '+event+'\ndata: '+JSON.stringify({type:event,...data})+'\n\n');res.end();
 });});
(async()=>{
 const notices=[],events=[];let shell=true,channel,child;
 const t={identity:{},input(){shell=false;},subscribeOutput:()=>()=>{}};
 const manager=new CLISessions({target:()=>t,inspect:async()=>shell?{idle:true}:{name:'claude'},command:()=> 'claude',wait:async()=>{},notify:async(id,text)=>notices.push(text),resultChannel:(name,receive)=>{channel=require('../electron/cli-result-channel').createResultChannel(name,event=>{events.push(event.kind);return receive(event);},{runtime:process.execPath,interval:50});return channel;}});
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));await manager.start('fixture','claude');
  child=spawn(executable,['-p','fixture test','--model','fixture-model','--permission-mode','default','--tools','','--setting-sources','','--settings',path.join(channel.directory,'settings.json'),'--output-format','json'],{cwd:root,windowsHide:true,env:{...process.env,CLAUDE_CONFIG_DIR:path.join(root,'config'),ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,ANTHROPIC_API_KEY:'fixture-only-key',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CI:'true'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Installed Claude hook smoke timed out: '+logs.slice(-1800)));},60000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Claude exited '+code+': '+logs.slice(-1800)));});});
  await channel.poll();await manager.sessions.get('fixture').sending;
  assert(calls>0);assert(events.includes('prompt'),'real CLI fired UserPromptSubmit');assert(events.includes('result'),'real CLI fired Stop');assert(notices.includes(final),'final reached the bot-facing notification callback');assert(!manager.status('fixture').pending,'completion released busy state');
  console.log('PASS installed Claude -> actual exec-form hooks -> completion channel -> final notification and ready state; local fixture API only');
 }finally{child?.kill();manager.close('fixture');server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
