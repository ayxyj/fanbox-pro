'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),{spawn,execFileSync}=require('child_process');
// Reproduce a second-instance event during synchronous startup dependency loading.
const source=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8').split('// node-pty 是原生模块')[0];
let callback,fired=false;const app={requestSingleInstanceLock:()=>true,on:(name,fn)=>{if(name==='second-instance')callback=fn;}};
vm.runInNewContext(source,{require:name=>name==='electron'?{app}:name==='../server.js'?(callback(),fired=true,{}):name==='./watch-filter'?{}:require(name),process:{platform:'linux',argv:[],env:{},exit(){}},global:{}});
assert(fired);console.log('PASS: early second-instance event before server initialization completes');
if(!process.argv[2])process.exit(0);
const root=fs.mkdtempSync(path.join(require('os').tmpdir(),'fanbox-startup-'));const exe=path.resolve(process.argv[2]);let logs='',second;
const options={windowsHide:true,env:{...process.env,GITSYNC_HOME:path.join(root,'data'),GITSYNC_PORT:'14957'},stdio:['ignore','pipe','pipe']};
const args=['--user-data-dir='+path.join(root,'profile'),'--remote-debugging-port=14958'];
const child=spawn(exe,args,options);child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let page;
 for(let i=0;i<100;i++){try{page=(await (await fetch('http://127.0.0.1:14958/json/list')).json()).find(p=>p.type==='page'&&p.url==='http://127.0.0.1:14957/');if(page)break;}catch{}await delay(200);}
 assert(page,'main window did not load: '+logs);
 second=spawn(exe,args,options);second.stdout.on('data',d=>logs+=d);second.stderr.on('data',d=>logs+=d);
 await delay(1500);assert.equal(second.exitCode,0,'second instance did not exit');
 assert(!/ReferenceError|Uncaught Exception|Cannot find module/.test(logs),logs);
 const response=await fetch('http://127.0.0.1:14957/');assert(response.ok);
 console.log('PASS: packaged main window loaded, second launch exits cleanly, original app remains responsive');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const c of [second,child])if(c&&c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{};});
