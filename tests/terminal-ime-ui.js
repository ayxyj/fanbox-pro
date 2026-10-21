'use strict';
const fs=require('fs'), path=require('path'), assert=require('assert');
const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..');
const scratch=path.join(workspace,'dist','test-data');fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'appearance-'));
fs.writeFileSync(path.join(root,'sample.js'),"const message = 'editor test';\n");
fs.writeFileSync(path.join(root,'定位 测试.sql'),'SELECT 1;');
fs.writeFileSync(path.join(root,'npm-wrapper.ps1'),"Write-Output 'PS_WRAPPER_OK'; Write-Output ('POLICY:'+ $env:PSExecutionPolicyPreference)");
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14874','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,PSExecutionPolicyPreference:'Restricted',GITSYNC_PORT:'14873',GITSYNC_HOME:path.join(root,'data'),TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',socket,seq=0;const pending=new Map();
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+expression.slice(0,180)+'\n'+logs.slice(-4000)));},60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result.result.value;}
const provider=require('http').createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture-ui' && req.headers['x-api-key']!=='fixture-ui'){res.writeHead(401);return res.end();}res.setHeader('Content-Type','application/json');if(req.method==='POST'){return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}]}));}res.end(JSON.stringify({data:[{id:'first-model'},{id:'second-model'},{id:'third-model'}]}));});
(async()=>{try{
 await new Promise(r=>provider.listen(14875,'127.0.0.1',r));
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14874/json')).json()).find(t=>t.url==='http://127.0.0.1:14873/');if(target)break;}catch{}}
 assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});await delay(2500);
 console.log(await evaluate(`(async()=>{
 document.getElementById('guide-ok')?.click();const host=document.createElement('div');host.style.cssText='position:fixed;inset:100px;background:#111;z-index:9999';document.body.append(host);
 const terminal=new Terminal();terminal.open(host);fbTerminalClipboard.attach(terminal,host);terminal.focus();const ta=terminal.textarea,received=[];terminal.onData(t=>received.push(t));const tick=()=>new Promise(r=>setTimeout(r,20));
 ta.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));ta.value='中文';ta.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'中文'}));await tick();
 ta.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',keyCode:13,isComposing:true}));
 if(received.length)throw Error('IME candidate confirmation leaked terminal data: '+JSON.stringify(received));
 ta.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));await tick();if(received.join('')!=='中文')throw Error('Chinese commit missing/duplicated: '+JSON.stringify(received));
 ta.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));ta.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape',keyCode:27,isComposing:true}));if(document.activeElement!==ta)throw Error('IME Escape stole terminal focus');ta.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));await tick();
 terminal.dispose();host.remove();return 'PASS: Chinese candidate Enter, single commit, candidate Escape focus';
 })()`));
 }finally{provider.close();socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
