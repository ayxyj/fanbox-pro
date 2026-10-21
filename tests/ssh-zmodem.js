'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const Z=require('zmodem.js'),{Header}=require('zmodem.js/src/zheader');
const {SSHZmodem,safeName}=require('../electron/ssh-zmodem');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fanbox-zmodem-test-'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<500;i++){if(fn())return;await delay(10);}throw Error('timeout');}
function pair(options={}){
 let app,peer,logs=''; const errors=[];
 const deliver=(fn,bytes)=>setImmediate(()=>{try{fn(bytes.slice());}catch(e){errors.push(e);}});
 app=new SSHZmodem({stream:{write:b=>{deliver(b=>peer.consume(Array.from(b)),b);return true;}},terminal:b=>logs+=b.toString(),...options});
 peer=new Z.Sentry({to_terminal(){},sender:b=>{const chunks=options.wire ? options.wire(b) : [b];for(const chunk of chunks)deliver(b=>app.consume(Buffer.from(b)),chunk);},on_retract(){},on_detect:d=>options.remote(d.confirm())});
 return {app,peer,errors,get logs(){return logs;},deliver};
}
(async()=>{
 assert.equal(safeName('../../a.txt'),'a.txt');assert.equal(safeName('C:\\foo\\CON'),'download.bin');
 const payload=Buffer.alloc(100000);for(let i=0;i<payload.length;i++)payload[i]=i%256;
 const source=path.join(root,'中文.bin');fs.writeFileSync(source,payload);
 // rz: remote receiver initiates; split its initial handshake into single bytes.
 let received=[],receiver=new Z.Session.Receive();
 let p=pair({chooseUpload:async()=>[source,source],chooseDownload:async()=>null,remote(){}});
 p.peer.consume=bytes=>receiver.consume(bytes);
 receiver.set_sender(bytes=>{for(const byte of bytes)p.deliver(b=>p.app.consume(Buffer.from(b)),[byte]);});
 receiver.on('offer',o=>{const chunks=[];o.accept({on_input:b=>chunks.push(Buffer.from(b))}).then(()=>received.push(Buffer.concat(chunks)));});
 receiver.start();await until(()=>received.length===2&&!p.app.job);assert.deepEqual(received,[payload,payload]);assert.equal(p.errors.length,0);assert(!p.logs.includes(payload.subarray(50,100).toString()));
 p.app.close();
 // sz: remote sender initiates, peer sentry gets the receiver response.
 let sent=false;const dest=path.join(root,'result.bin');
 p=pair({chooseUpload:async()=>[],chooseDownload:async()=>dest,remote:async session=>{const t=await session.send_offer({name:'../../中文.bin',size:payload.length});await t.end(Array.from(payload));await session.close();sent=true;}});
 p.app.consume(Buffer.from(Header.build('ZRQINIT').to_hex()));await until(()=>sent&&!p.app.job);assert.deepEqual(fs.readFileSync(dest),payload);assert.equal(p.errors.length,0);p.app.close();
 // Missing OO with ANSI prompt, plus fragmented OO followed by the prompt.
 for(const mode of ['missing','split']) {
  sent=false;const prompt='\x1b]0;root@host:~/project\x07\x1b[?2004h[root@host]# ';
  p=pair({chooseUpload:async()=>[],chooseDownload:async()=>dest,
   wire: bytes=>bytes.length===2&&bytes[0]===79&&bytes[1]===79 ? (mode==='missing' ? [Array.from(Buffer.from(prompt))] : [[79],[79,...Buffer.from(prompt)]]) : [bytes],
   remote:async session=>{const t=await session.send_offer({name:'result.bin',size:payload.length});await t.end(Array.from(payload));await session.close();sent=true;}});
  p.app.consume(Buffer.from(Header.build('ZRQINIT').to_hex()));await until(()=>sent&&!p.app.job);assert.deepEqual(fs.readFileSync(dest),payload);assert(p.logs.includes(prompt));assert(!p.logs.includes('协议错误'));assert.equal(p.errors.length,0);p.app.close();
 }
 // Cancel while receiving preserves an existing target and removes partial files.
 fs.writeFileSync(dest,'original');let offered=false;
 p=pair({chooseUpload:async()=>[],chooseDownload:async()=>dest,remote:async session=>{const t=await session.send_offer({name:'result.bin',size:payload.length});t.send([1,2,3]);offered=true;}});
 p.app.consume(Buffer.from(Header.build('ZRQINIT').to_hex()));await until(()=>offered&&p.app.job?.bytes===3);assert(p.app.input('\x03'));await until(()=>!p.app.job);await delay(20);assert.equal(fs.readFileSync(dest,'utf8'),'original');assert(!fs.readdirSync(root).some(n=>n.endsWith('.part')));p.app.close();
 console.log('PASS ZMODEM: split handshake, multi-file upload, binary download, Chinese names, cancellation and atomic save');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
