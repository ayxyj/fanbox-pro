'use strict';
const fs=require('fs'), path=require('path'), assert=require('assert');
const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..');
const images=path.join(workspace,'docs/user-guide/assets');fs.mkdirSync(images,{recursive:true});
const scratch=path.join(workspace,'dist','test-data');fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'appearance-'));
const demo=path.join(root,'demo-project');fs.mkdirSync(path.join(demo,'src'),{recursive:true});fs.mkdirSync(path.join(demo,'docs'));fs.writeFileSync(path.join(demo,'README.md'),'# 示例项目\n\n这是用户指南的独立演示项目。\n');fs.writeFileSync(path.join(demo,'src','quicksort.py'),'def quicksort(items):\n    if len(items) < 2:\n        return items\n    pivot = items[0]\n    return quicksort([x for x in items[1:] if x < pivot]) + [pivot] + quicksort([x for x in items[1:] if x >= pivot])\n');fs.writeFileSync(path.join(demo,'index.html'),'<html><meta charset="utf-8"><body style="font:20px sans-serif;padding:36px;background:#f4f7fa"><h1>项目文档预览</h1><p>在 FanBox 中浏览、编辑、运行。</p><ul><li>本地文件</li><li>SSH 与 AI</li><li>企业微信远程协作</li></ul></body></html>');
fs.writeFileSync(path.join(root,'sample.js'),"const message = 'editor test';\n");
fs.writeFileSync(path.join(root,'定位 测试.sql'),'SELECT 1;');
fs.writeFileSync(path.join(root,'npm-wrapper.ps1'),"Write-Output 'PS_WRAPPER_OK'; Write-Output ('POLICY:'+ $env:PSExecutionPolicyPreference)");
execFileSync('git',['init',demo],{stdio:'ignore'});
const executable=process.argv[2] || path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14874','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,PSExecutionPolicyPreference:'Restricted',GITSYNC_PORT:'14873',GITSYNC_HOME:path.join(root,'data'),TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',socket,seq=0;const pending=new Map();
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+expression.slice(0,180)+'\n'+logs.slice(-4000)));},60000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result.result.value;}
const provider=require('http').createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture-ui' && req.headers['x-api-key']!=='fixture-ui'){res.writeHead(401);return res.end();}res.setHeader('Content-Type','application/json');if(req.method==='POST'){return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'已收到。本次演示为仅建议模式，未执行终端命令。你可以在会话选项中开启交互权限，选择确认后执行，然后让我检查项目文件。'}}]}));}res.end(JSON.stringify({data:[{id:'first-model'},{id:'second-model'},{id:'third-model'}]}));});
(async()=>{try{
 await new Promise(r=>provider.listen(14875,'127.0.0.1',r));
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14874/json')).json()).find(t=>t.url==='http://127.0.0.1:14873/');if(target)break;}catch{}}
 assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});await delay(2500);

 async function shot(name){await evaluate("document.querySelector('#toast')?.classList.add('hidden');true");await delay(500);const id=++seq;const r=await new Promise(resolve=>{pending.set(id,resolve);socket.send(JSON.stringify({id,method:'Page.captureScreenshot',params:{format:'png'}}));});fs.writeFileSync(path.join(images,name+'.png'),Buffer.from(r.result.data,'base64'));console.log('Screenshot: '+name);}
 await evaluate(`document.getElementById('guide-ok')?.click();navigate(${JSON.stringify(demo)});true`);await delay(800);
 await evaluate("document.querySelector('[data-view=tree]').click();true");await shot('01-workspace');
 await evaluate(`navigate(${JSON.stringify(path.join(demo,'src'))});true`);await delay(400);await evaluate("openPreview(state.entries.find(e=>e.name==='quicksort.py'));true");await delay(1200);await shot('02-editor');
 await evaluate(`closePreview();navigate(${JSON.stringify(demo)});true`);await delay(400);await evaluate("openPreview(state.entries.find(e=>e.name==='index.html'));true");await delay(900);await shot('03-html-preview');
 await evaluate('closePreview();true');await evaluate(`term.openInDir(${JSON.stringify(demo)});true`);await delay(700);await shot('04-terminal');
 await evaluate("document.querySelector('[data-ssh-add]').click();true");await delay(200);
 await evaluate("(()=>{const f=document.querySelector('.remote-dialog form');f.elements.name.value='演示 Linux';f.elements.host.value='192.0.2.10';f.elements.username.value='demo';f.elements.group.value='测试环境';})()");await shot('05-ssh-profile');
 await evaluate("document.querySelector('.remote-dialog').close();true");
 await evaluate('remoteUI.settings()');await evaluate("document.querySelector('[data-add-model]').click();const f=document.querySelector('.model-form');f.elements.name.value='演示模型服务';f.elements.baseUrl.value='http://127.0.0.1:14875/v1';f.elements.apiKey.value='fixture-ui';f.querySelector('[data-fetch-models]').click();true");await delay(500);
 await evaluate("document.querySelector('[data-model]').click();true");await shot('06-model-service');
 await evaluate("document.querySelector('.model-discovery').scrollIntoView({block:'start'});document.querySelector('.model-config-dialog').scrollTop-=80;document.querySelector('[data-test]').click();true");await delay(500);await shot('07-model-selection');
 await evaluate("document.querySelector('[data-config]').click();true");await shot('08-model-parameters');
 await evaluate("document.querySelector('.model-parameter-dialog').close();document.querySelector('.model-form').requestSubmit();true");await delay(500);await evaluate("document.querySelector('.remote-dialog').close();remoteUI.openAI(term.active);true");await delay(600);
 await evaluate("const p=document.querySelector('.remote-prompt');p.value='如何检查当前项目的文件？先给出建议。';p.dispatchEvent(new Event('input'));document.querySelector('[data-run]').click();true");await delay(1200);await shot('09-ai-chat');
 await evaluate("document.querySelector('[data-permission-pill]').click();true");await shot('10-ai-permissions');await evaluate("document.querySelector('.chat-options').open=false;document.querySelector('[data-chat-history]').click();true");await delay(300);await shot('11-history');await evaluate("document.querySelector('.remote-dialog').close();true");
 await evaluate("window.guideConfirm=fanboxUI.confirm({title:'允许 AI 执行命令？',description:'请核对目标和内容，本次授权仅用于下方操作。',facts:[['目标','演示 Linux'],['系统 / Shell','linux / bash'],['执行位置','当前终端所在目录（继承终端状态）']],command:'ls -la',note:'演示授权窗口。允许后命令将输入对应终端。',approveLabel:'仅允许本次'});true");await shot('12-command-approval');await evaluate("document.querySelector('.ui-confirm [data-cancel]').click();true");
 await evaluate('remoteUI.imSettings()');await shot('13-im-settings');await evaluate("document.querySelector('.im-settings [name=cwd]').scrollIntoView({block:'center'});true");await shot('14-im-options');await evaluate("document.querySelector('.im-settings').close();remoteUI.close();true");
 await evaluate("document.querySelector('.im-pet-panel').hidden=false;document.querySelector('.pet-extension-settings').open=true;window.dispatchEvent(new Event('resize'));true");await shot('15-pet-settings');await evaluate("document.querySelector('.im-pet-panel').hidden=true;fbThemes.settings();true");await shot('16-themes');await evaluate("document.querySelector('#appearance-settings [data-close]').click();true");
 await evaluate("document.querySelector('#term-close').click();true");await evaluate(`(async()=>{const w=await apiPost('/api/gs/workspace/save',{path:${JSON.stringify(root)},name:'演示工作区',excludes:['electron','data']});const list=await api('/api/gs/workspace/list');await apiPost('/api/gs/workspace/scan',{id:list.workspaces[0].id});await gsShow('workspaces');})()`);await delay(400);await shot('17-git-workspaces');await evaluate("gsShow('repos');true");await delay(400);await shot('18-git-repos');
 await evaluate("cronPanel.show();true");await delay(400);await evaluate("document.querySelector('#cron-new-head').click();true");await shot('19-scheduled-task');
 }finally{provider.close();socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
