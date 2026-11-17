'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {Server}=require('ssh2');const {SSHService}=require('../electron/ssh-service');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
let sessions=0,execs=0,logins=0,terminalInput='',term;const peers=new Set();
const server=new Server({hostKeys:[key]},client=>{
 peers.add(client);client.on('error',()=>{});client.on('close',()=>peers.delete(client));
 client.on('authentication',ctx=>ctx.method==='password'&&ctx.password==='fixture'?ctx.accept():ctx.reject(['password']));
 client.on('ready',()=>{logins++;client.on('session',accept=>{
  sessions++;
  const session=accept();session.on('exec',(accept)=>{execs++;const stream=accept();stream.end('Please re-login.');});
  session.on('pty',(accept,reject,info)=>{term=info.term;accept();});
  session.on('shell',accept=>{const stream=accept();stream.on('data',chunk=>{terminalInput+=chunk.toString();});stream.write('Connecting to target ...\r\nLast login: fixture\r\n');});
 });});
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile={host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',auth:'password'};
 const ssh=new SSHService({store:{get:()=>({...profile}),data:{fingerprints:{}},persist(){}},confirm:async()=>true,emit(){}});
 try{await ssh.connect('test','profile',80,24);await new Promise(r=>setTimeout(r,50));assert.equal(sessions,1);assert.equal(execs,0);assert.equal(term,'xterm');assert.equal(ssh.get('test').client.config.keepaliveInterval,15000);assert.equal(ssh.get('test').client.config.keepaliveCountMax,8);assert.equal(terminalInput,'','connection keepalive must not inject terminal input');assert.match(ssh.get('test').output,/Last login/);await ssh.connect('second','profile',80,24);assert.equal(logins,1);assert.equal(sessions,2);assert.notEqual(ssh.get('test').stream,ssh.get('second').stream);ssh.disconnect('test');assert.equal(ssh.get('second').status,'connected');console.log('PASS: shared SSH authentication, independent terminals, no hidden exec');}
 finally{ssh.disconnect('test');ssh.disconnect('second');for(const client of peers)client.end();server.close();}
})().catch(e=>{console.error(e);for(const client of peers)client.destroy();server.close();process.exitCode=1;});
