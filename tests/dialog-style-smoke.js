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
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14774','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,PSExecutionPolicyPreference:'Restricted',GITSYNC_PORT:'14773',GITSYNC_HOME:path.join(root,'data'),TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',socket,seq=0;const pending=new Map();
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+expression.slice(0,180)+'\n'+logs.slice(-4000)));},60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result.result.value;}
(async()=>{try{
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14774/json')).json()).find(t=>t.url==='http://127.0.0.1:14773/');if(target)break;}catch{}}
 assert(target,'App loaded');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});await delay(2500);
 const result=await evaluate(`(async()=>{
 document.getElementById('guide-ok')?.click();const results=[];
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const inspect=selector=>{const el=document.querySelector(selector),button=el.querySelector('.ui-dialog-close'),style=getComputedStyle(button),box=button.getBoundingClientRect();check(button.getAttribute('aria-label')==='关闭'&&button.querySelector('svg'),'Shared close missing '+selector);check(Math.abs(box.width-32)<1&&Math.abs(box.height-32)<1,'Close dimensions '+selector+' '+box.width+'x'+box.height);const heading=el.querySelector('h2,.input-title');check(getComputedStyle(heading).fontSize==='17px','Title size '+selector);return {selector,font:style.fontSize,padding:style.padding,radius:getComputedStyle(el).borderRadius};};
 fanboxApplyTheme(TERAX_THEMES[0].id);
 for(const mode of ['dark','light']){
 fbThemes.setMode(mode);check(fbThemes.isDark()===(mode==='dark'),'Theme mode mismatch');fbThemes.settings();results.push(inspect('.appearance-dialog'));document.querySelector('.appearance-dialog [data-close]').click();check(!document.querySelector('.appearance-dialog'),'Theme did not close');
 await remoteUI.settings();results.push(inspect('.remote-dialog'));document.querySelector('[data-add-model]').click();const form=document.querySelector('.model-form');check(form&&form.querySelector('input'),'AI form missing');check(getComputedStyle(form.querySelector('input')).minHeight==='34px','Field height');document.querySelector('.remote-dialog [data-dismiss]').click();await new Promise(r=>setTimeout(r,300));
 await remoteUI.imSettings();results.push(inspect('.im-settings'));check(document.querySelector('.im-settings [data-save]'),'IM save missing');document.querySelector('.im-settings [data-dismiss]').click();await new Promise(r=>setTimeout(r,300));check(!document.querySelector('.im-settings'),'IM did not close');
 gsModal('Git 配置','<input aria-label="测试"><button class="primary">保存</button>');results.push(inspect('#gs-modal .input-dialog'));document.querySelector('#gs-modal-x').click();check(!document.querySelector('#gs-modal'),'Git did not close');
 }
 document.getElementById('ssh-nav-section').open=true;document.querySelector('[data-ssh-add]').click();for(let i=0;i<100&&!document.querySelector('.remote-dialog');i++)await new Promise(r=>setTimeout(r,300));results.push(inspect('.remote-dialog'));document.querySelector('.remote-dialog [data-dismiss]').click();const input=inputDialog('输入测试');document.querySelector('.input-dialog [data-dialog-dismiss]').click();check(await input===null,'Input close submitted');const confirm=confirmDialog('确认测试');document.querySelector('.input-dialog [data-dialog-dismiss]').click();check(await confirm===false,'Confirmation close approved');return results;
 })()`);
 await evaluate('remoteUI.imSettings()');const shotId=++seq;const shot=await new Promise(resolve=>{pending.set(shotId,resolve);socket.send(JSON.stringify({id:shotId,method:'Page.captureScreenshot',params:{format:'png'}}));});fs.writeFileSync(path.join(root,'dialogs.png'),Buffer.from(shot.result.data,'base64'));console.log('Screenshot:',path.join(root,'dialogs.png'));assert.equal(result.length,9);console.log('PASS: shared close geometry, title, fields, dark/light themes and close actions across theme/AI/IM/Git/SSH',JSON.stringify(result));
 }finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
