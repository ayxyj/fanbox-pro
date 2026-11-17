'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('fs');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
 try{
  for(const language of ['en','zh']){
   await window.loadURL('data:text/html;charset=utf-8,<div id="lang-toggle"></div><nav id="labels"><span>文件</span><span>视图</span><span>设置</span><span>SSH 连接</span><span>Git 仓库管理</span><span>定时任务</span></nav><div id="statusbar">63 items</div><div class="preview-foot"><span>3 KB</span><span>Created 2026-10-28 16:05</span><span>Modified 2026-10-28 16:05</span></div>');
   await window.webContents.insertCSS(fs.readFileSync('public/style.css','utf8'));
   const dict=fs.readFileSync('public/i18n-dict.js','utf8'),i18n=fs.readFileSync('public/i18n.js','utf8'),menu=fs.readFileSync('public/window-menu.js','utf8');
   const result=await window.webContents.executeJavaScript(`(async()=>{
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>'${language}'}});
    let menuLanguage;
    window.fanboxEnv={platform:'win32'};
    window.fanboxWindowMenu={colors:async()=>{},open:async()=>{},list:async lang=>{menuLanguage=lang;return lang==='en'?['File','Edit','View','Settings']:['文件','编辑','视图','设置']}};
    ${dict}
    ${i18n}
    ${menu}
    await new Promise(resolve=>setTimeout(resolve,30));
    const assert=(value,message)=>{if(!value)throw Error(message)};
    const expected='${language}'==='en'?['File','View','Settings','SSH Connections','Git Repositories','Scheduled Tasks']:['文件','视图','设置','SSH 连接','Git 仓库管理','定时任务'];
    assert([...document.querySelectorAll('#labels span')].every((node,i)=>node.textContent===expected[i]),'sidebar and menu translations '+JSON.stringify([...document.querySelectorAll('#labels span')].map(node=>node.textContent)));
    const dynamic=document.createElement('span');dynamic.textContent='会话管理';document.querySelector('#labels').append(dynamic);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert(dynamic.textContent===('${language}'==='en'?'Sessions':'会话管理'),'dynamic session label');
    assert(menuLanguage==='${language}','native menu receives renderer language');
    assert(document.querySelector('.window-menu button').textContent===('${language}'==='en'?'File':'文件'),'window menu language');
    const statistics=document.querySelector('#statusbar'),footer=document.querySelector('.preview-foot');
    assert(statistics.getBoundingClientRect().height===22&&footer.getBoundingClientRect().height===22,'matching 22px footer heights');
    footer.style.width='180px';
    assert(footer.getBoundingClientRect().height===22,'narrow preview stays one row');
    assert(footer.scrollWidth>footer.clientWidth,'long file info remains horizontally scrollable');
    return 'PASS: ${language} labels, dynamic translation, native menu language and matching footer heights';
   })().catch(error=>error.stack)`);
   if(!String(result).startsWith('PASS:'))throw Error(result);
   console.log(result);
  }
 }finally{window.destroy();app.quit()}
}).catch(error=>{console.error(error);app.exit(1)});
