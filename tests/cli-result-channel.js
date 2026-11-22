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
  const hook=settings.hooks.Stop[0].hooks[0];
  assert.deepEqual(hook.args,[path.join(channel.directory,'notify.cjs'),channel.directory].map(p=>p.replaceAll('\\','/')));
  // Actual exec form preserves paths with spaces and never invokes a shell.
  await invoke(hook.command,hook.args,JSON.stringify({hook_event_name:'Stop',last_assistant_message:'最终回复\n```python\nprint("你好")\n```',session_id:'one'}));
  await channel.poll();assert.equal(seen.length,1);assert.match(seen[0].text,/最终回复/);
  const transcript=path.join(channel.directory,'transcript.jsonl');
  fs.writeFileSync(transcript,[{message:{role:'assistant',content:[{type:'text',text:'OLD'}]}},{message:{role:'user',content:'new'}},{message:{role:'assistant',content:[{type:'thinking',thinking:'secret'},{type:'tool_use',name:'Bash'}]}},{message:{role:'assistant',content:[{type:'text',text:'RESULT'}]}}].map(JSON.stringify).join('\n'));
  assert.equal(normalize({hook_event_name:'Stop',transcript_path:transcript}).text,'RESULT');
  // Codex passes its notification as one argument instead of stdin.
  await invoke(process.execPath,[path.join(channel.directory,'notify.cjs'),channel.directory,JSON.stringify({type:'agent-turn-complete','thread-id':'t','turn-id':'r','last-assistant-message':'codex final'})]);
  await channel.poll();assert.equal(seen[1].text,'codex final');
  const codex=createResultChannel('codex',()=>{}, {runtime:process.execPath});assert.match(codex.args,/notify=\[/);codex.close();
  const buddyEvents=[],buddy=createResultChannel('codebuddy',e=>buddyEvents.push(e),{runtime:process.execPath,interval:60000});
  try{const h=JSON.parse(fs.readFileSync(path.join(buddy.directory,'settings.json'),'utf8')).hooks.Stop[0].hooks[0];for(const shell of ['cmd.exe','powershell.exe']){const event={hook_event_name:'Stop',last_assistant_message:'BUDDY_'+shell};await invoke(shell,shell==='cmd.exe'?['/d','/s','/c',h.command]:['-NoProfile','-NonInteractive','-Command',h.command],JSON.stringify(event));await buddy.poll();}assert.deepEqual(buddyEvents.map(e=>e.text),['BUDDY_cmd.exe','BUDDY_powershell.exe']);}finally{buddy.close();}
  assert(settings.hooks.UserPromptSubmit, 'local terminal prompts must establish a bridged turn');
  // Reversed UUID filenames must not make a quick Stop arrive before its prompt.
  fs.writeFileSync(path.join(channel.directory,'aaaaaaaa-0000-0000-0000-000000000000.event'),JSON.stringify({kind:'result',createdAt:200,text:'quick'}));
  fs.writeFileSync(path.join(channel.directory,'ffffffff-0000-0000-0000-000000000000.event'),JSON.stringify({kind:'prompt',createdAt:100}));
  await channel.poll();assert.deepEqual(seen.slice(-2).map(e=>e.kind),['prompt','result']);
  // A failed callback must not discard the rest of the polled completion batch.
  let fail=true;const recovered=[],retry=createResultChannel('claude',event=>{if(event.kind==='progress'&&fail){fail=false;throw Error('transient');}recovered.push(event.kind);},{runtime:process.execPath,interval:60000});
  try{for(const [key,kind]of [['aaaaaaaa','progress'],['bbbbbbbb','result']])fs.writeFileSync(path.join(retry.directory,key+'.event'),JSON.stringify({kind,createdAt:kind==='progress'?1:2}));await retry.poll();assert.deepEqual(recovered,['result']);await retry.poll();assert.deepEqual(recovered,['result','progress']);}finally{retry.close();}
 } finally {channel.close();}
 console.log('PASS: exec-form completion hooks, CodeBuddy CMD/PowerShell, Codex notify, transcript-only text, subagent isolation and per-event retry');
})().catch(e=>{console.error(e);process.exitCode=1;});
