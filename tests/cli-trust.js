'use strict';
const assert = require('assert/strict');
const { CLISessions } = require('../electron/cli-session');
const turn = () => new Promise(r => setImmediate(r));
(async () => {
 const fixture = 'Accessing workspace:\r\n\r\n C:\\Users\\jeremyxia\r\n\r\n Quick safety check: Is this a project you created or one you trust?\r\n ❯ 1. Yes, I trust this folder\r\n   2. No, exit';
 let decide, cards=0, signal, directory; const writes=[],listeners=new Set(), notices=[];
 const target={identity:{},environment:{cwd:'C:\\Users\\jeremyxia'},state:{idle:true},input:t=>{writes.push(t);if(t==='claude\r')target.state={name:'claude'};},subscribeOutput:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 const cli=new CLISessions({target:()=>target,inspect:async()=>target.state,command:n=>n,wait:async()=>{},resultChannel:()=>({args:'',close(){}}),confirmTrust:async(id,dir,s)=>{cards++;directory=dir;signal=s;return new Promise(r=>decide=r);},notify:async(id,t)=>notices.push(t)});
 const emit=t=>{for(const fn of listeners)fn(t);};
 await cli.start('a','claude'); cli.userInput('a','\x1b[1;1R');
 emit(fixture.slice(0,80));emit(fixture.slice(80));emit(fixture);assert.equal(cards,1);assert.equal(directory,'C:\\Users\\jeremyxia');
 await assert.rejects(cli.run('a','hello'),/信任卡片/);decide(true);await turn();await turn();assert.deepEqual(writes.slice(-2),['\x1b[A','\r']);assert.match(notices.at(-1),/确认信任/);
 cli.close('a'); target.state={idle:true};await cli.start('a','claude');emit(fixture.replace(/\s+/g, ''));decide(false);await turn();await turn();assert.deepEqual(writes.slice(-2),['\x1b[B','\r']);
 cli.close('a');target.state={idle:true};await cli.start('a','claude');emit(fixture);const before=writes.length;cli.userInput('a','\r');assert(signal.aborted);decide(true);await turn();assert.equal(writes.length,before);
 cli.close('a');target.state={idle:true};await cli.start('a','claude');emit(fixture);const beforeClose=writes.length;cli.close('a');decide(true);await turn();assert.equal(writes.length,beforeClose);
 console.log('PASS: split trust prompt, one card, directory, approve/reject, input blocking, local takeover, closed terminal and xterm status replies');
})().catch(e=>{console.error(e);process.exitCode=1;});
