'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {Server}=require('ssh2'),{SSHService}=require('../electron/ssh-service');
const {hideProbeText}=require('../electron/ssh-environment');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
const peers=new Set(),events=[];
const server=new Server({hostKeys:[key]},client=>{
 peers.add(client);client.on('error',()=>{});client.on('close',()=>peers.delete(client));
 client.on('authentication',ctx=>ctx.accept());
 client.on('ready',()=>client.on('session',accept=>{
  const session=accept();session.on('pty',accept=>accept());
  session.on('shell',accept=>{
   const stream=accept();stream.write('Welcome\r\n[user@host ~]$ '.replaceAll('\\r','\r').replaceAll('\\n','\n'));
   stream.on('data',chunk=>{
    const command=chunk.toString(),nonce=command.match(/[a-f0-9]{24}/)?.[0];
    if(!nonce){stream.write('real output\r\n');return}
    stream.write(command+'\n');
    setTimeout(()=>{stream.write('background notice\r\n__FB_'+nonce.slice(0,8));setTimeout(()=>stream.write(nonce.slice(8)+'__Linux\r\n[user@host ~]$ '),5)},5);
   });
  });
 }));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile={host:'127.0.0.1',port:server.address().port,username:'user',password:'fixture',auth:'password'};
 const ssh=new SSHService({store:{get:()=>({...profile}),data:{fingerprints:{}},persist(){}},confirm:async()=>true,emit:(type,event)=>events.push({type,...event})});
 try{
  await ssh.connect('test','profile',80,24);
  for(let i=0;i<250&&ssh.get('test').environment.os==='unknown';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ssh.get('test').environment.os,'linux');
  const visible=events.filter(event=>event.type==='pty:data').map(event=>event.data).join('');
  assert(!visible.includes('__FB_'));assert(!visible.includes('uname -s'));assert(visible.includes('background notice'));assert(visible.includes('Welcome'));
  assert.equal((visible.match(/user@host/g)||[]).length,1,'probe prompt does not duplicate existing prompt');
  assert(!ssh.get('test').output.includes('__FB_'));
  assert.equal(hideProbeText('real output\r\n','probe\r','__FB_nonce__','[user@host ~]$'),'real output\r\n');
  console.log('PASS: automatic detection succeeds, fragmented probe hidden, original prompt and unrelated output retained');
 }finally{ssh.disconnect('test');for(const peer of peers)peer.end();server.close()}
})().catch(error=>{console.error(error);for(const peer of peers)peer.destroy();server.close();process.exitCode=1});
