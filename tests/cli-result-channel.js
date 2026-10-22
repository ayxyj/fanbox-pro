'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { normalize } = require('../electron/cli-result-hook');
const { createResultChannel } = require('../electron/cli-result-channel');
async function invoke(file, args, input) {
 return new Promise((resolve,reject) => { const p=spawn(file,args,{windowsHide:true, ...(file === 'cmd.exe' ? { windowsVerbatimArguments:true } : {}),stdio:['pipe','pipe','pipe']}); let err='';p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve());p.stdin.end(input); });
}
(async () => {
 assert.equal(normalize({hook_event_name:'Notification',message:'spinner'}),null);
 assert.equal(normalize({hook_event_name:'Stop',agent_id:'sub',last_assistant_message:'private'}),null);
 assert.equal(normalize({hook_event_name:'Stop',last_assistant_message:'final'}).text,'final');
 assert.equal(normalize({type:'agent-turn-complete','last-assistant-message':'codex'}).text,'codex');
 assert.equal(normalize({hook_event_name:'StopFailure',error:'rate_limit'}).kind,'error');
 const seen=[],channel=createResultChannel('claude',e=>seen.push(e),{runtime:process.execPath,interval:60000});
 try {
  const settings=JSON.parse(fs.readFileSync(path.join(channel.directory,'settings.json'),'utf8'));
  const command=settings.hooks.Stop[0].hooks[0].command;
  // Run the actual Windows hook command, with spaces in Node's path and JSON on stdin.
  await invoke('cmd.exe',['/d','/s','/c','"'+command+'"'],JSON.stringify({hook_event_name:'Stop',last_assistant_message:'最终回复\n```python\nprint("你好")\n```',session_id:'one'}));
  await channel.poll();assert.equal(seen.length,1);assert.match(seen[0].text,/最终回复/);
  const transcript=path.join(channel.directory,'transcript.jsonl');
  fs.writeFileSync(transcript,[{message:{role:'assistant',content:[{type:'text',text:'OLD'}]}},{message:{role:'user',content:'new'}},{message:{role:'assistant',content:[{type:'thinking',thinking:'secret'},{type:'tool_use',name:'Bash'}]}},{message:{role:'assistant',content:[{type:'text',text:'RESULT'}]}}].map(JSON.stringify).join('\n'));
  assert.equal(normalize({hook_event_name:'Stop',transcript_path:transcript}).text,'RESULT');
  // Codex passes its notification as one argument instead of stdin.
  await invoke(process.execPath,[path.join(channel.directory,'notify.cjs'),channel.directory,JSON.stringify({type:'agent-turn-complete','thread-id':'t','turn-id':'r','last-assistant-message':'codex final'})]);
  await channel.poll();assert.equal(seen[1].text,'codex final');
  const codex=createResultChannel('codex',()=>{}, {runtime:process.execPath});assert.match(codex.args,/notify=\[/);codex.close();
  assert(settings.hooks.UserPromptSubmit, 'local terminal prompts must establish a bridged turn');
  // Reversed UUID filenames must not make a quick Stop arrive before its prompt.
  fs.writeFileSync(path.join(channel.directory,'aaaaaaaa-0000-0000-0000-000000000000.event'),JSON.stringify({kind:'result',createdAt:200,text:'quick'}));
  fs.writeFileSync(path.join(channel.directory,'ffffffff-0000-0000-0000-000000000000.event'),JSON.stringify({kind:'prompt',createdAt:100}));
  await channel.poll();assert.deepEqual(seen.slice(-2).map(e=>e.kind),['prompt','result']);
 } finally {channel.close();}
 console.log('PASS: structured results, real Windows hook command, Codex argument, transcript-only text, subagent exclusion, error and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
