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
 const check=(v,m)=>{if(!v)throw Error(m)};
 document.getElementById('guide-ok')?.click();
 let result=fanboxUI.confirm({title:'删除会话记录',description:'确定删除这段会话的聊天记录吗？',facts:[['会话','测试会话 <img src=x onerror=alert(1)>']],note:'删除后无法恢复。仅删除聊天记录，不会删除 SSH 连接配置或项目文件。',danger:true,approveLabel:'删除记录'});
 check(!document.querySelector('.ui-confirm img'),'unsafe title');check(document.activeElement.hasAttribute('data-cancel'),'default cancel');
 document.querySelector('.ui-confirm .ui-dialog-close').click();check(await result===false,'close denied');
 result=fanboxUI.confirm({title:'删除会话记录',danger:true});document.querySelector('.ui-confirm').dispatchEvent(new Event('cancel',{cancelable:true}));check(await result===false,'escape denied');
 const controller=new AbortController();result=fanboxUI.confirm({title:'授权',signal:controller.signal});controller.abort();check(await result===false&&!document.querySelector('.ui-confirm'),'abort closes');
 result=fanboxUI.confirm({title:'授权'});document.querySelector('.ui-confirm [data-approve]').click();check(await result===true,'explicit approval');
 window.confirmPreview=fanboxUI.confirm({title:'允许 AI 执行命令？',description:'请核对目标和内容，本次授权仅用于下方操作。',facts:[['目标','jeremyxia@linux-server'],['系统 / Shell','linux / bash'],['执行位置','当前终端所在目录（继承终端状态）']],command:'ls -la /home\\ncat /home/test.txt',note:'允许后将在当前终端执行，请确认已回到 Shell 提示符且没有未提交的输入。',approveLabel:'仅允许本次'});
 return 'PASS: explicit approval, cancel, close, abort, text escaping and default focus';
 })()`));
 await evaluate("true");await delay(200);
 const shotId=++seq;const shot=await new Promise(resolve=>{pending.set(shotId,resolve);socket.send(JSON.stringify({id:shotId,method:'Page.captureScreenshot',params:{format:'png'}}));});fs.writeFileSync(path.join(root,'confirm-dialog.png'),Buffer.from(shot.result.data,'base64'));console.log(path.join(root,'confirm-dialog.png'));
 }finally{provider.close();socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
