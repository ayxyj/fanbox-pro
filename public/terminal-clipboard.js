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
    let composing = false;
    host.addEventListener('compositionstart', () => { composing = true; host.dataset.imeComposing = 'true'; }, true);
    host.addEventListener('compositionend', () => { composing = false; delete host.dataset.imeComposing; }, true);
    host.addEventListener('focusout', () => { composing = false; delete host.dataset.imeComposing; });
    xterm.attachCustomKeyEventHandler(event => {
      // Do not cancel the browser's IME event. Only bypass xterm's key parser:
      // compositionend remains responsible for committing the text exactly once.
      if (composing || event.isComposing) return false;
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
      const session = typeof term !== 'undefined' ? term.sessions.find(s=>s.xterm===xterm) : null;
      showMenu(event,[{label:'复制选中内容',fn:()=>copy(xterm),disabled:!xterm.hasSelection()},{label:'粘贴',fn:()=>paste(xterm)},{label:'全选',fn:()=>xterm.selectAll()},...(session ? window.remoteUI?.shortcutMenu(session.id) || [] : [])]);
    });
  }
  function showMenu(event, items) {
      closeMenu?.();
      const menu=document.createElement('div');menu.className='terminal-context-menu';menu.setAttribute('role','menu');
      const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);if(closeMenu===close)closeMenu=null;};
      closeMenu=close;
      const outside=e=>{if(!menu.contains(e.target))close();}; const escape=e=>{if(e.key==='Escape')close();};
      const append = (parent, entries) => {
        for (const item of entries) {
          if (item.children) {
            const branch=document.createElement('details');branch.className='terminal-menu-group';
            const summary=document.createElement('summary');summary.textContent=item.label;branch.append(summary);
            const children=document.createElement('div');children.className='terminal-menu-children';append(children,item.children);branch.append(children);parent.append(branch);
          } else {
            const button=document.createElement('button');button.textContent=item.label;button.disabled=!!item.disabled;button.onclick=()=>{close();void item.fn();};parent.append(button);
          }
        }
      };
      append(menu, items);
      document.body.appendChild(menu);
      const position = () => { menu.style.left=Math.max(0,Math.min(event.clientX,innerWidth-menu.offsetWidth-6))+'px';menu.style.top=Math.max(0,Math.min(event.clientY,innerHeight-menu.offsetHeight-6))+'px'; }; position();menu.addEventListener('toggle',position,true);
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
  }
  window.fbTerminalClipboard={attach,copy,paste,showMenu};
})();
