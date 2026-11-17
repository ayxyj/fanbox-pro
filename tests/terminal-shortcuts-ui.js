'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  try {
    await window.loadURL('data:text/html,<div id="terminal-panel" style="display:flex;flex-direction:column;height:200px"><div style="flex:1">terminal</div></div>');
    await window.webContents.insertCSS(fs.readFileSync('public/remote-workspace.css','utf8'));
    const source=fs.readFileSync('public/remote-workspace.js','utf8');
    const bar=source.slice(source.indexOf('  const shortcutGroups'),source.indexOf('  async function shortcutManager'));
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const assert=(value,message)=>{if(!value)throw Error(message)};
      const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const term={active:'a',sessions:[{id:'a',sshProfile:'profile',xterm:{focus(){}}},{id:'b',sshProfile:'other',xterm:{focus(){}}}],activate(){}};
      const data={profiles:[{id:'profile',shortcuts:[{id:'one',group:'deploy',name:'发布',command:'deploy'},{id:'two',group:'inspect',name:'检查',command:'inspect'}]},{id:'other',shortcuts:[]}]};
      let menu,edit,called;
      const popupMenu=(_event,items)=>{menu=items};
      const shortcutManager=(...args)=>{edit=args};
      const wrap=fn=>fn,notify=()=>{},confirm=()=>true;
      const api=async(action,args)=>{called={action,args};if(action==='delete-shortcut')data.profiles[0].shortcuts=data.profiles[0].shortcuts.filter(c=>c.id!==args.id)};
      const refresh=async()=>renderShortcutBar();
      ${bar}
      term.sessions.push({id:'local',shell:'powershell'});
      term.active='local';renderShortcutBar();assert(!document.querySelector('.terminal-shortcuts'),'no footer for initial Windows terminal');
      term.active='a';renderShortcutBar();
      const footer=document.querySelector('.terminal-shortcuts');
      assert(getComputedStyle(footer).height==='22px','same height as file statistics');
      assert(footer.getBoundingClientRect().bottom===document.querySelector('#terminal-panel').getBoundingClientRect().bottom,'bottom aligned');
      assert(footer.querySelector('.shortcut-run').textContent==='发布','initial group');
      const select=footer.querySelector('select');select.value='inspect';select.onchange({target:select});
      assert(footer.querySelector('.shortcut-run').textContent==='检查','group switching');
      assert(!footer.querySelector('[data-shortcut-add]'),'no plus button');
      footer.querySelector('[data-group-menu]').oncontextmenu({preventDefault(){}});
      assert(menu.some(item=>item.label==='添加组')&&menu.some(item=>item.label==='删除当前组')&&menu.some(item=>item.label==='管理组'),'group management context menu');
      await menu.find(item=>item.label==='新增快捷指令').fn();assert(edit[2].group==='inspect','new command in selected group');
      await footer.querySelector('.shortcut-run').onclick();assert(called.args.sessionId==='a'&&called.args.id==='two','runs on active session');
      assert(!footer.querySelector('.shortcut-edit'),'no per-command ellipsis');
      assert(footer.querySelector('.shortcut-run svg'),'command icon');
      assert(footer.querySelector('.shortcut-group-tools').firstElementChild.hasAttribute('data-group-menu'),'group menu at left');
      footer.querySelector('.terminal-shortcut').oncontextmenu({preventDefault(){}});
      await menu[0].fn();assert(edit[2].id==='two','direct edit');
      await menu[1].fn();assert(data.profiles[0].shortcuts.length===1,'direct delete');
      term.active='b';renderShortcutBar();assert(footer.querySelectorAll('.shortcut-run').length===0,'profile isolation');
      term.active='a';renderShortcutBar();assert(footer.querySelector('.shortcut-run').textContent==='发布','valid group after deletion');
      assert(document.querySelectorAll('.terminal-shortcuts').length===1,'single footer');
      term.active='local';renderShortcutBar();assert(!document.querySelector('.terminal-shortcuts'),'footer removed when switching to Windows');
      term.active='a';renderShortcutBar();assert(document.querySelector('.terminal-shortcuts .shortcut-run').textContent==='发布','footer restored when switching to SSH');
      term.active='missing';renderShortcutBar();assert(!document.querySelector('.terminal-shortcuts'),'no footer without active session');
      return 'PASS: SSH-only visibility, bottom alignment, 22px height, groups, create/edit/delete, active terminal and profile isolation';
    })().catch(error=>error.stack)`);
    if(!String(result).startsWith('PASS:'))throw Error(result);
    console.log(result);
  }finally{window.destroy();app.quit()}
}).catch(error=>{console.error(error);app.exit(1)});
