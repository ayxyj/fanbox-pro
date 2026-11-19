(() => {
  let closeMenu;
  async function write(text) {
    if (window.fanboxClipboard) await window.fanboxClipboard.write(text);
    else await navigator.clipboard.writeText(text);
  }
  async function read() {
    return window.fanboxClipboard ? window.fanboxClipboard.read() : navigator.clipboard.readText();
  }
  async function copy(xterm, text=xterm.getSelection()) {
    if(!text)return false;
    try { await write(text); return true; } catch(err) { window.fanboxClipboardError?.('复制失败：'+err.message); return false; }
  }
  async function paste(xterm) {
    try { const text=await read(); if(text)xterm.paste(text); } catch(err) { window.fanboxClipboardError?.('粘贴失败：'+err.message); }
  }
  function attachMouseSelection(xterm, host) {
    // Keep application clicks, but reserve a drag for selecting output even
    // when a TUI enables mouse tracking. Shift keeps xterm's native override;
    // Alt deliberately sends the full drag to the application.
    const selection = xterm._core?._selectionService;
    if (!selection?.handleMouseDown) return;
    let replaying = false, cancel;
    const mouse = (type, event, extra = {}) => new MouseEvent(type, {
      bubbles:true, cancelable:true, view:window, clientX:event.clientX, clientY:event.clientY,
      screenX:event.screenX, screenY:event.screenY, button:event.button, buttons:event.buttons,
      detail:event.detail, ctrlKey:event.ctrlKey, altKey:event.altKey, shiftKey:event.shiftKey, metaKey:event.metaKey, ...extra,
    });
    const dispatch = (target, event) => { replaying=true; try { target.dispatchEvent(event); } finally { replaying=false; } };
    host.addEventListener('mousedown', down => {
      if (replaying || down.button!==0 || down.shiftKey || down.altKey || down.ctrlKey || down.metaKey || xterm.modes.mouseTrackingMode==='none') return;
      const screen=host.querySelector('.xterm-screen'), rect=screen?.getBoundingClientRect();
      if (!rect || down.clientX<rect.left || down.clientX>=rect.right || down.clientY<rect.top || down.clientY>=rect.bottom) return;
      cancel?.(); down.preventDefault(); down.stopImmediatePropagation(); xterm.focus();
      const doc=host.ownerDocument;
      let selecting=false;
      const start=()=>{
        selecting=true;
        const force=selection.shouldForceSelection;
        selection.shouldForceSelection=()=>true;
        try { selection.handleMouseDown(mouse('mousedown',down)); }
        finally { selection.shouldForceSelection=force; }
      };
      const move=event=>{
        if(replaying)return;
        if(!selecting && Math.hypot(event.clientX-down.clientX,event.clientY-down.clientY)>=3)start();
        if(selecting){event.preventDefault();event.stopImmediatePropagation();dispatch(doc,mouse('mousemove',event));}
      };
      const cleanup=()=>{doc.removeEventListener('mousemove',move,true);doc.removeEventListener('mouseup',up,true);window.removeEventListener('blur',blur);cancel=null;};
      const up=event=>{
        if(replaying || event.button!==0)return;
        event.preventDefault();event.stopImmediatePropagation();cleanup();
        if(selecting)dispatch(doc,mouse('mouseup',event));
        else { xterm.clearSelection(); dispatch(down.target,mouse('mousedown',down));dispatch(event.target,mouse('mouseup',event)); }
      };
      const blur=()=>{cleanup();if(selecting)dispatch(doc,mouse('mouseup',down,{buttons:0}));};
      cancel=blur;
      doc.addEventListener('mousemove',move,true);doc.addEventListener('mouseup',up,true);window.addEventListener('blur',blur);
      if(down.detail>=2)start();
    },true);
    xterm._core.register?.({dispose:()=>cancel?.()});
  }
  function attach(xterm, host) {
    attachMouseSelection(xterm,host);
    // The context menu belongs to FanBox. A TUI mouse report would otherwise
    // clear the selection before contextmenu fires; xterm's native handler also
    // relocates its textarea under the pointer and interferes with later drags.
    host.addEventListener('mousedown',event=>{
      if(event.button!==2)return;
      event.preventDefault();event.stopImmediatePropagation();xterm.focus();
    },true);
    host.addEventListener('mouseup',event=>{
      if(event.button===2){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    host.addEventListener('mousemove',event=>{
      if(!event.buttons && !event.altKey && xterm.hasSelection() && xterm.modes.mouseTrackingMode!=='none')event.stopImmediatePropagation();
    },true);
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
      event.preventDefault(); event.stopImmediatePropagation();
      const selectedText=xterm.getSelection();
      const session = typeof term !== 'undefined' ? term.sessions.find(s=>s.xterm===xterm) : null;
      showMenu(event,[{label:'复制选中内容',fn:async()=>{await copy(xterm,selectedText);xterm.focus();},disabled:!selectedText},{label:'粘贴',fn:async()=>{await paste(xterm);xterm.focus();}},{label:'全选',fn:()=>{xterm.selectAll();xterm.focus();}},...(session ? window.remoteUI?.shortcutMenu?.(session.id) || [] : [])]);
    },true);
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
