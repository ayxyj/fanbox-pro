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
const provider=require('http').createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture-ui' && req.headers['x-api-key']!=='fixture-ui'){res.writeHead(401);return res.end();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'first-model'},{id:'second-model'},{id:'third-model'}]}));});
(async()=>{try{
 await new Promise(r=>provider.listen(14875,'127.0.0.1',r));
 let target;for(let i=0;i<100;i++){await delay(400);try{target=(await(await fetch('http://127.0.0.1:14874/json')).json()).find(t=>t.url==='http://127.0.0.1:14873/');if(target)break;}catch{}}
 assert(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});await delay(2500);

 function nativeWindows(minimize=false){
 const script=`Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class PetWindows {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
"@
$items=[System.Collections.Generic.List[object]]::new()
[PetWindows]::EnumWindows({param($h,$l) $ownerId=[uint32]0;[void][PetWindows]::GetWindowThreadProcessId($h,[ref]$ownerId);if($ownerId -eq ${child.pid}){$title=[System.Text.StringBuilder]::new(512);[void][PetWindows]::GetWindowText($h,$title,512);if($title.Length -gt 0){if(${minimize?'$true':'$false'} -and $title.ToString() -ne 'FanBox 桌面宠物'){[void][PetWindows]::ShowWindow($h,6)};$items.Add(@{title=$title.ToString();minimized=[PetWindows]::IsIconic($h);visible=[PetWindows]::IsWindowVisible($h)})}};return $true},[IntPtr]::Zero)|Out-Null
ConvertTo-Json -InputObject @($items.ToArray()) -Compress`;
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8'}).trim());
 }
 assert(await evaluate("document.querySelectorAll('.window-menu button').length===4 && document.querySelector('.window-menu img').getBoundingClientRect().right < document.querySelector('.window-menu button').getBoundingClientRect().left && document.querySelector('#app').getBoundingClientRect().top >= 35"),'Compact menu row: icon, four menus, no overlap');
 async function connect(url){socket?.close();socket=new WebSocket(url);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});}
 let pet;for(let i=0;i<100;i++){pet=(await(await fetch('http://127.0.0.1:14874/json')).json()).find(t=>t.url.endsWith('/desktop-pet.html'));if(pet)break;await delay(100);}assert(pet,'Desktop window absent');
 await delay(800);assert(await evaluate("window.fanboxDesktopPet && !window.fanboxDesktopPet.isDesktop && document.querySelector('.im-pet').hidden"),'Main view must not duplicate pet');
 const minimized=nativeWindows(true);assert(minimized.some(w=>w.title!=='FanBox 桌面宠物'&&w.minimized),'Main window minimized');assert(minimized.some(w=>w.title==='FanBox 桌面宠物'&&w.visible&&!w.minimized),'Pet remains visible');
 await connect(pet.webSocketDebuggerUrl);assert(await evaluate("window.fanboxDesktopPet.isDesktop && !document.querySelector('.im-pet').hidden"));
 assert(await evaluate("typeof window.fanboxPty==='undefined'"),'Pet must not have terminal access');
 await evaluate("document.querySelector('.im-pet-character').click()");await delay(400);assert(nativeWindows().some(w=>w.title!=='FanBox 桌面宠物'&&w.visible&&!w.minimized),'Click restores main window');
 await evaluate("document.querySelector('.im-pet-character').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await delay(300);await connect(target.webSocketDebuggerUrl);assert(await evaluate("!document.querySelector('.im-pet-panel').hidden"),'Right click opens settings');
 await evaluate("document.querySelector('[data-action]').value='builtin:1';document.querySelector('[data-action]').dispatchEvent(new Event('change'));true");
 await delay(200);await connect(pet.webSocketDebuggerUrl);
 assert(await evaluate("JSON.parse(localStorage.getItem('fanbox-im-pet-v1')).selectedAction==='builtin:1'"));
 await evaluate("document.querySelector('.im-pet-character').dispatchEvent(new PointerEvent('pointerenter'));true");
 assert(await evaluate("document.querySelector('.pet-body').getAnimations().some(a=>a.effect.getTiming().duration===2000)"),'Hover plays selected dance');
 console.log(await evaluate(`(()=>{
 const panel=document.querySelector('.im-pet-panel'), body=document.querySelector('.pet-body');
 const check=(v,m)=>{if(!v)throw Error(m)};
 const original=window.matchMedia;window.matchMedia=()=>({matches:true});
 body.getAnimations().forEach(a=>a.cancel());
 panel.querySelector('[data-run-action]').click();check(body.getAnimations().some(a=>a.playState==='running'),'manual playback with reduced motion and offline bot');
 const motion=panel.querySelector('[data-motion]');motion.checked=false;motion.dispatchEvent(new Event('change'));
 panel.querySelector('[data-run-action]').click();check(panel.querySelector('[data-extension-note]').textContent.includes('勾选'),'specific disabled reason');
 check(!document.querySelector('.pet-body').getAnimations().some(a=>a.playState==='running'),'disabled animation blocked');
 motion.checked=true;motion.dispatchEvent(new Event('change'));window.matchMedia=original;
 return 'PASS: manual action works offline/reduced-motion; explicit animation disable respected';
 })()`));
 await connect(target.webSocketDebuggerUrl);
 await evaluate("window.remoteUI.imSettings()");await delay(300);
 await evaluate("document.querySelector('.im-settings [name=enabled]').checked=false;document.querySelector('.im-settings [data-save]').click();true");await delay(400);
 assert(await evaluate("document.querySelector('.im-settings [data-save-result]').textContent==='保存成功'"),'IM save success feedback');
 await evaluate("document.querySelector('.im-settings [name=enabled]').checked=true;document.querySelector('.im-settings [name=botId]').value='';document.querySelector('.im-settings [data-save]').click();true");await delay(400);
 assert(await evaluate("document.querySelector('.im-settings [data-save-result]').textContent.startsWith('保存失败：')"),'IM save failure feedback');
 console.log('PASS: independent desktop pet, main minimize isolation, click restore, right-click settings, no terminal bridge');

 }finally{provider.close();socket?.close();try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
