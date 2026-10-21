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
 const check=(x,m)=>{if(!x)throw Error(m);};const wait=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,40));}throw Error('UI timeout');};
 document.getElementById('guide-ok')?.click();await remoteUI.settings();document.querySelector('[data-add-model]').click();let form=document.querySelector('.model-form');
 form.elements.baseUrl.value='http://127.0.0.1:14875/v1';form.elements.apiKey.value='fixture-ui';form.elements.name.value='HTTP 服务';
 form.querySelector('[data-fetch-models]').click();await wait(()=>form.querySelectorAll('[data-slot] option').length===4);
 check(form.querySelectorAll('[data-model]').length===3,'Catalog cards missing');
 form.querySelector('[data-model="second-model"]').click();form.querySelector('[data-model="third-model"]').click();check(form.querySelectorAll('[data-test]').length===2,'Selected model rows missing');
 form.querySelector('[data-search]').value='third';form.querySelector('[data-search]').dispatchEvent(new Event('input'));check(form.querySelectorAll('[data-model]').length===1,'Search failed');
 form.querySelector('[data-config]').click();let parameters=document.querySelector('.model-parameter-dialog form');parameters.elements.contextWindow.value='200000';parameters.elements.maxTokens.value='512';parameters.elements.temperature.value='0.5';parameters.elements.reasoningEffort.value='low';parameters.requestSubmit();
 form.querySelector('[data-test]').click();await wait(()=>form.querySelector('.model-test-result').textContent.includes('连接成功'));check(form.querySelector('.model-test-result').textContent.includes('OK'),'Test reply missing');
 form.elements.model.value='second-model';form.requestSubmit();await wait(()=>document.querySelectorAll('.remote-card').length===1);
 let state=(await fanboxRemote.call('state',{})).value;check(state.aiConfigs.length===1 && state.ai.model==='second-model','Single OpenAI config');check(state.ai.selectedModels.length===2 && state.ai.selectedModels[0].maxTokens===512,'Model settings not persisted');check(!JSON.stringify(state).includes('fixture-ui'),'Key exposed');
 document.querySelector('[data-model-edit]').click();form=document.querySelector('.model-form');check(!form.elements.apiKey.value,'Key shown');form.querySelector('[data-fetch-models]').click();await wait(()=>form.querySelectorAll('[data-slot] option').length===4);
 form.elements.protocol.value='anthropic';form.elements.protocol.dispatchEvent(new Event('input'));form.elements.protocol.dispatchEvent(new Event('change'));form.elements.apiKey.value='fixture-ui';form.querySelector('[data-fetch-models]').click();await wait(()=>form.querySelectorAll('[data-slot] option').length===12);
 form.elements.haiku.value='first-model';form.elements.sonnet.value='second-model';form.elements.opus.value='third-model';form.elements.defaultRole.value='opus';form.requestSubmit();await wait(()=>document.querySelectorAll('.remote-card').length===1);
 state=(await fanboxRemote.call('state',{})).value;check(state.aiConfigs.length===1 && state.ai.model==='third-model','Role default failed');check(state.ai.modelSlots.haiku==='first-model','Role save failed');
 document.querySelector('[data-model-edit]').click();form=document.querySelector('.model-form');check(form.elements.opus.value==='third-model','Restore failed');form.elements.apiKey.value='bad';form.querySelector('[data-fetch-models]').click();await wait(()=>document.querySelector('.dialog-error').textContent.includes('401'));check(form.elements.sonnet.tagName==='INPUT','Manual fallback');
 form.elements.apiKey.value='fixture-ui';form.querySelector('[data-fetch-models]').click();await wait(()=>form.querySelectorAll('[data-model]').length===3);
 return 'PASS: HTTP discovery, saved key reuse, single service, OpenAI selection, three Claude slots, default role and manual fallback';
 })()`));
 await evaluate("document.querySelector('.model-selected-table').scrollIntoView({block:'center'});true");await delay(200);
 const shotId=++seq;const shot=await new Promise(resolve=>{pending.set(shotId,resolve);socket.send(JSON.stringify({id:shotId,method:'Page.captureScreenshot',params:{format:'png'}}));});fs.writeFileSync(path.join(root,'model-config.png'),Buffer.from(shot.result.data,'base64'));console.log(path.join(root,'model-config.png'));
 }finally{provider.close();socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
