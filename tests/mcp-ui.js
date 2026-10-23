'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn,execFileSync}=require('child_process');
const workspace=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(require('os').tmpdir(),'fanbox-mcp-ui-'));
const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
const child=spawn(executable,[...(process.argv[2]?[]:['.']),'--disable-features=CalculateNativeWinOcclusion','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--remote-debugging-port=14984','--user-data-dir='+path.join(root,'electron')],{cwd:workspace,env:{...process.env,GITSYNC_PORT:'14983',GITSYNC_HOME:path.join(root,'data'),TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',socket,seq=0;const pending=new Map();
child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(expression){const id=++seq;const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout\n'+logs.slice(-2000)));},30000);pending.set(id,result=>{clearTimeout(timer);resolve(result);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(message.result?.exceptionDetails)throw Error(JSON.stringify(message.result.exceptionDetails));return message.result.result.value;}
(async()=>{try{
  let target;for(let i=0;i<100;i++){await delay(300);try{target=(await(await fetch('http://127.0.0.1:14984/json')).json()).find(value=>value.url==='http://127.0.0.1:14983/');if(target)break;}catch{}}
  assert.ok(target,'test app starts');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));socket.addEventListener('message',event=>{const message=JSON.parse(event.data);pending.get(message.id)?.(message);pending.delete(message.id);});
  await delay(2000);
  assert.equal(await evaluate(`(async()=>{
    await remoteUI.mcpSettings();
    const dialog=document.querySelector('.mcp-settings'),editor=dialog.querySelector('[data-json]');
    editor.value=JSON.stringify({mcpServers:{demo:{command:'node',args:['server.js'],env:{TOKEN:'ui-secret'}}}});editor.dispatchEvent(new Event('input'));dialog.querySelector('[data-save]').click();
    for(let i=0;i<100&&!dialog.querySelector('[data-status]').textContent.startsWith('已保存');i++)await new Promise(r=>setTimeout(r,100));
    if(!dialog.querySelector('[data-status]').textContent.startsWith('已保存'))throw Error(dialog.querySelector('[data-status]').textContent);
    dialog.querySelector('[data-close]').click();await remoteUI.mcpSettings();
    const reopened=document.querySelector('.mcp-settings');
    if(!reopened.querySelector('[data-json]').value.includes('ui-secret'))throw Error('encrypted settings reload');
    const toggle=reopened.querySelector('input[type=checkbox]');toggle.click();reopened.querySelector('[data-save]').click();
    for(let i=0;i<100&&!reopened.querySelector('[data-status]').textContent.startsWith('已保存');i++)await new Promise(r=>setTimeout(r,100));
    const read=await fanboxRemote.call('mcp-read');if(!read.value.disabled.includes('demo'))throw Error('toggle persistence');
    return true;
  })()`),true);
  const saved=fs.readFileSync(path.join(root,'data','remote-workspace.json'),'utf8');assert.ok(!saved.includes('ui-secret')&&!saved.includes('server.js'),'secrets and server definition encrypted on disk');
  const screenshotId=++seq;
  const shot=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(screenshotId);reject(Error('Screenshot timed out'));},30000);pending.set(screenshotId,value=>{clearTimeout(timer);resolve(value);});socket.send(JSON.stringify({id:screenshotId,method:'Page.captureScreenshot',params:{format:'png'}}));});
  fs.mkdirSync(path.join(workspace,'dist/review'),{recursive:true});fs.writeFileSync(path.join(workspace,'dist/review/mcp-settings.png'),Buffer.from(shot.result.data,'base64'));
  await evaluate(`document.querySelector('.mcp-settings [data-close]').click();location.href='/fs/blocked-navigation.html';true`);
  await delay(400);assert.equal(await evaluate('location.pathname'),'/','local preview cannot replace privileged main page');
  assert.equal(await evaluate(`window.open('data:text/html,blocked');true`),true);await delay(200);
  const targets=await(await fetch('http://127.0.0.1:14984/json')).json();assert.ok(!targets.some(target=>target.url.startsWith('data:')),'non-HTTP child windows denied');
  console.log('PASS MCP editor, Windows encryption, reload, enable toggle, close, main navigation and child window isolation');
}finally{socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}})().catch(error=>{console.error(error);process.exitCode=1;});
