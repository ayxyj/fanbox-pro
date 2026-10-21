'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {Server}=require('ssh2');const {SSHService}=require('../electron/ssh-service');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
let sessions=0,execs=0,term;const peers=new Set();
const server=new Server({hostKeys:[key]},client=>{
 peers.add(client);client.on('error',()=>{});client.on('close',()=>peers.delete(client));
 client.on('authentication',ctx=>ctx.method==='password'&&ctx.password==='fixture'?ctx.accept():ctx.reject(['password']));
 client.on('ready',()=>client.on('session',(accept,reject)=>{
  sessions++;if(sessions>1){reject();return;}
  const session=accept();session.on('exec',(accept)=>{execs++;const stream=accept();stream.end('Please re-login.');});
  session.on('pty',(accept,reject,info)=>{term=info.term;accept();});
  session.on('shell',accept=>{const stream=accept();stream.write('Connecting to target ...\r\nLast login: fixture\r\n');});
 }));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile={host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',auth:'password'};
 const ssh=new SSHService({store:{get:()=>({...profile}),data:{fingerprints:{}},persist(){}},confirm:async()=>true,emit(){}});
 try{await ssh.connect('test','profile',80,24);await new Promise(r=>setTimeout(r,50));assert.equal(sessions,1);assert.equal(execs,0);assert.equal(term,'xterm');assert.match(ssh.get('test').output,/Last login/);console.log('PASS: single-session bastion, direct PTY shell, no hidden exec, login banner delivered');}
 finally{ssh.disconnect('test');for(const client of peers)client.end();server.close();}
})().catch(e=>{console.error(e);for(const client of peers)client.destroy();server.close();process.exitCode=1;});
