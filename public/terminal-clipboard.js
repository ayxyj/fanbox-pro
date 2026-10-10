(() => {
  let closeMenu;
  async function write(text) {
    if (window.fanboxClipboard) await window.fanboxClipboard.write(text);
    else await navigator.clipboard.writeText(text);
  }
  async function read() {
    return window.fanboxClipboard ? window.fanboxClipboard.read() : navigator.clipboard.readText();
  }
  async function copy(xterm) {
    const text=xterm.getSelection();
    if(!text)return false;
    try { await write(text); return true; } catch(err) { window.fanboxClipboardError?.('复制失败：'+err.message); return false; }
  }
  async function paste(xterm) {
    try { const text=await read(); if(text)xterm.paste(text); } catch(err) { window.fanboxClipboardError?.('粘贴失败：'+err.message); }
  }
  function attach(xterm, host) {
    xterm.attachCustomKeyEventHandler(event => {
      const key=event.key.toLowerCase(), modifier=event.ctrlKey || event.metaKey;
      if(!modifier || event.altKey)return true;
      if(key==='c' && (xterm.hasSelection() || event.shiftKey || event.metaKey)) {
        if(event.type==='keydown'){event.preventDefault();event.stopPropagation();void copy(xterm);}
        return false;
      }
      if(key==='v') {
        if(event.type==='keydown'){event.preventDefault();event.stopPropagation();void paste(xterm);}
        return false;
      }
      if(key==='a' && event.shiftKey){if(event.type==='keydown'){event.preventDefault();xterm.selectAll();}return false;}
      return true;
    });
    host.addEventListener('contextmenu',event=>{
      event.preventDefault(); event.stopPropagation();
      closeMenu?.();
      const menu=document.createElement('div');menu.className='terminal-context-menu';menu.setAttribute('role','menu');
      const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);if(closeMenu===close)closeMenu=null;};
      closeMenu=close;
      const outside=e=>{if(!menu.contains(e.target))close();}; const escape=e=>{if(e.key==='Escape')close();};
      for(const [label,action,disabled] of [['复制选中内容',()=>copy(xterm),!xterm.hasSelection()],['粘贴',()=>paste(xterm),false],['全选',()=>xterm.selectAll(),false]]){
        const button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=()=>{close();void action();};menu.appendChild(button);
      }
      document.body.appendChild(menu);
      menu.style.left=Math.max(0,Math.min(event.clientX,innerWidth-menu.offsetWidth-6))+'px';menu.style.top=Math.max(0,Math.min(event.clientY,innerHeight-menu.offsetHeight-6))+'px';
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    });
  }
  window.fbTerminalClipboard={attach,copy,paste};
})();
