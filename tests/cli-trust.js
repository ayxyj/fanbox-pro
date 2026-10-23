'use strict';
const assert = require('assert/strict');
const { CLISessions } = require('../electron/cli-session');
const turn = () => new Promise(r => setImmediate(r));
(async () => {
 const fixture = 'Accessing workspace:\r\n\r\n C:\\Users\\jeremyxia\r\n\r\n Quick safety check: Is this a project you created or one you trust?\r\n ❯ 1. Yes, I trust this folder\r\n   2. No, exit';
 let decide, cards=0, signal, directory; const writes=[],listeners=new Set(), notices=[];
 const target={identity:{},environment:{cwd:'C:\\Users\\jeremyxia'},state:{idle:true},input:t=>{writes.push(t);if(t==='claude --permission-mode auto\r')target.state={name:'claude'};},subscribeOutput:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 const cli=new CLISessions({target:()=>target,inspect:async()=>target.state,command:n=>n,wait:async()=>{},resultChannel:()=>({args:'',close(){}}),confirmTrust:async(id,dir,s)=>{cards++;directory=dir;signal=s;return new Promise(r=>decide=r);},notify:async(id,t)=>notices.push(t)});
 const emit=t=>{for(const fn of listeners)fn(t);};
 await cli.start('a','claude'); cli.userInput('a','\x1b[1;1R');
 emit(fixture.slice(0,80));emit(fixture.slice(80));emit(fixture);assert.equal(cards,1);assert.equal(directory,'C:\\Users\\jeremyxia');
 await assert.rejects(cli.run('a','hello'),/信任卡片/);decide(true);await turn();await turn();assert.deepEqual(writes.slice(-2),['\x1b[A','\r']);assert.match(notices.at(-1),/确认信任/);
 cli.close('a'); target.state={idle:true};await cli.start('a','claude');emit(fixture.replace(/\s+/g, ''));decide(false);await turn();await turn();assert.deepEqual(writes.slice(-2),['\x1b[B','\r']);
 cli.close('a');target.state={idle:true};await cli.start('a','claude');emit(fixture);const before=writes.length;cli.userInput('a','\r');assert(signal.aborted);decide(true);await turn();assert.equal(writes.length,before);
 cli.close('a');target.state={idle:true};await cli.start('a','claude');emit(fixture);const beforeClose=writes.length;cli.close('a');decide(true);await turn();assert.equal(writes.length,beforeClose);
 const buddyPrompt='│ Do you trust the files in this folder? │\r\n│ C:\\Users\\jeremyxia │\r\n│ CodeBuddy Code may read, write, or execute files contained in this directory. │\r\n│ > 1. Trust folder only (jeremyxia) │\r\n│ 2. Trust parent folder (Users/**) │\r\n│ 3. Trust folder and all subdirectories (jeremyxia/**) │\r\n│ 4. No, exit (escape) │\r\nEnter to confirm • Esc to exit';
 const buddy=new CLISessions({target:()=>target,inspect:async()=>({name:'codebuddy',idle:true}),command:n=>n,wait:async()=>{},resultChannel:()=>({args:'',close(){}}),confirmTrust:async(id,dir,abort,name)=>{assert.equal(name,'codebuddy');assert.equal(dir,'C:\\Users\\jeremyxia');cards++;signal=abort;return new Promise(r=>decide=r);}});
 cli.close('a');
 for(const choice of [0,1,2,3,null]){
  await buddy.start('b','codebuddy');const count=cards;
  emit(buddyPrompt.slice(0,100));emit(buddyPrompt.slice(100));emit(buddyPrompt);assert.equal(cards,count+1);
  await assert.rejects(buddy.run('b','hello'),/信任卡片/);
  const begin=writes.length;decide(choice);await turn();await turn();assert.deepEqual(writes.slice(begin),choice===null||choice===3?['\x1b']:choice===0?['\r']:['\x1b[B'.repeat(choice),'\r']);buddy.close('b');
 }
 await buddy.start('b','codebuddy');const count=cards;emit(buddyPrompt.replace('C:\\Users\\jeremyxia','D:\\unexpected'));assert.equal(cards,count,'Unrelated directory must not be approved');buddy.close('b');
 await buddy.start('b','codebuddy');emit(buddyPrompt);const begin=writes.length;buddy.userInput('b','\x1b[B');assert(signal.aborted);decide(2);await turn();assert.equal(writes.length,begin);buddy.close('b');
 console.log('PASS: split trust prompt, one card, directory, approve/reject, input blocking, local takeover, closed terminal and xterm status replies');
})().catch(e=>{console.error(e);process.exitCode=1;});
