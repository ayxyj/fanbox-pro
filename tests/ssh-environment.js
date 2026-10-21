'use strict';
const assert=require('assert/strict'),{EventEmitter}=require('events');
const {detectEnvironment,promptKind}=require('../electron/ssh-environment');
(async()=>{
 for(const output of ['Password:','Select server:','> 1. server','Please re-login.'])assert.equal(promptKind(output),null);
 for(const [prompt,os,expected] of [['[root@server ~]# ','Linux','linux'],['user@host:~$ ','Darwin','darwin'],['C:\\Users\\test>','Windows_NT','windows'],['PS C:\\Users\\test>','Win32NT','windows']]){
  const stream=new EventEmitter();let writes=0;stream.write=command=>{writes++;const nonce=command.match(/[a-f0-9]{24}/)[0];stream.emit('data',Buffer.from(command));setImmediate(()=>{stream.emit('data',Buffer.from('__FB_'+nonce+'__'+os.slice(0,2)));stream.emit('data',Buffer.from(os.slice(2)+'\r\n'));});};
  const s={stream,output:prompt,abort:new AbortController()};assert.equal((await detectEnvironment(s,new AbortController().signal,100)).os,expected);assert.equal(writes,1);assert.equal(stream.listenerCount('data'),0);
 }
 const stream=new EventEmitter();stream.write=()=>{};const session={stream,output:'root@host:~#',abort:new AbortController()};
 await assert.rejects(detectEnvironment({...session,output:'Password:'},null,10),/尚未/);
 await assert.rejects(detectEnvironment({...session,inputLine:'sudo '},null,10),/尚未/);
 await assert.rejects(detectEnvironment(session,null,10),/超时/);assert.equal(stream.listenerCount('data'),0);
 const controller=new AbortController();const pending=detectEnvironment(session,controller.signal,100);controller.abort();await assert.rejects(pending,/取消/);
 console.log('PASS: shell prompts, fragmented nonce replies, echo rejection, login/menu and pending input blocking, timeout and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
