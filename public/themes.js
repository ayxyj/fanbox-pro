/* Terax palette adapter. Original palettes: Apache-2.0, see THIRD_PARTY_NOTICES.md. */
(() => {
  const root = document.documentElement;
  const legacy = ['terminal', 'warm', 'editorial'];
  const ansi = ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  let custom = read('fb_custom_themes', []);
  if (!Array.isArray(custom)) custom = [];
  let mode = localStorage.getItem('fb_theme_mode') || 'dark';
  if (!['dark','light','system'].includes(mode)) mode = 'dark';
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const changedVars = new Set();
  let active, variant;
  let background = read('fb_theme_background', { opacity: .2, blur: 0, vibrancy: false });
  const bgLayer = document.createElement('div');
  bgLayer.id = 'theme-background';
  document.body.prepend(bgLayer);
  const resolved = () => mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
  const all = () => [...window.TERAX_THEMES, ...custom];
  const find = id => all().find(t => t.id === id);
  const color = value => typeof value === 'string' && value.length < 160 && CSS.supports('color', value);
  function validate(t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || t.id.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 100) throw Error('主题需要合法 id 和名称');
    if (!t.variants || (!t.variants.dark && !t.variants.light)) throw Error('需要 dark 或 light 配色');
    for (const v of Object.values(t.variants)) {
      if (!v || typeof v !== 'object') throw Error('无效的主题配色');
      for (const [k, value] of Object.entries(v.colors || {})) {
        if (k === 'radius' ? !/^\d+(\.\d+)?(px|rem)$/.test(value) : !color(value)) throw Error('无效颜色：' + k);
      }
      for (const [k, value] of Object.entries(v.terminal || {})) {
        if (k === 'ansi') { if (!Array.isArray(value) || value.length !== 16 || value.some(x => !color(x))) throw Error('ANSI 色板需要 16 个合法颜色'); }
        else if (k === 'fontSize') { if (!Number.isInteger(value) || value < 8 || value > 32) throw Error('字号范围为 8–32'); }
        else if (k === 'fontFamily') { if (typeof value !== 'string' || value.length > 200) throw Error('无效字体'); }
        else if (k === 'fontWeight') { if (!/^(normal|bold|[1-9]00)$/.test(value)) throw Error('无效字重'); }
        else if (!color(value)) throw Error('无效终端颜色：' + k);
      }
    }
    return t;
  }
  custom = custom.filter(t => { try { validate(t); return !legacy.includes(t.id) && !window.TERAX_THEMES.some(b => b.id === t.id); } catch { return false; } });
  function setVar(k, v) { root.style.setProperty(k, v); changedVars.add(k); }
  function apply(id) {
    for (const k of changedVars) root.style.removeProperty(k);
    changedVars.clear();
    active = find(id);
    variant = null;
    if (!active) { root.style.colorScheme = id === 'terminal' ? 'dark' : 'light'; return legacy.includes(id) ? id : 'terminal'; }
    variant = active.variants[resolved()] || active.variants.dark || active.variants.light;
    const fallback = window.TERAX_THEMES[0].variants[resolved()].colors;
    const c = { ...fallback, ...variant.colors };
    const map = { '--bg':c.background, '--bg-2':c.card, '--bg-3':c.secondary, '--panel':c.sidebar, '--border':c.border, '--rule':c.border, '--text':c.foreground, '--text-dim':c.mutedForeground, '--text-faint':c.mutedForeground, '--accent':c.primary, '--accent-ink':c.primaryForeground, '--radius':c.radius || '8px', '--green':variant.terminal?.ansi?.[2] || c.primary, '--yellow':variant.terminal?.ansi?.[3] || c.primary, '--sidebar-text':c.sidebarForeground, '--sidebar-border':c.sidebarBorder, '--popover-bg':c.popover, '--popover-text':c.popoverForeground };
    for (const [k,v] of Object.entries(map)) if (v) setVar(k,v);
    setVar('--accent-soft', `color-mix(in srgb, ${c.primary} 14%, transparent)`);
    setVar('--font-display', 'var(--font-ui)');
    setVar('--font-fname', 'var(--font-ui)');
    setVar('--shadow', resolved() === 'dark' ? '0 12px 40px #0008' : '0 12px 40px #0002');
    root.style.colorScheme = resolved();
    return id;
  }
  function terminal() {
    if (!active || !variant) return null;
    const c = { ...window.TERAX_THEMES[0].variants[resolved()].colors, ...variant.colors };
    const p = variant.terminal || {};
    const defaults = window.TERAX_THEMES[0].variants[resolved()].terminal;
    return { background:p.background || c.background, foreground:p.foreground || c.foreground, cursor:p.cursor || c.foreground, cursorAccent:p.cursorAccent || c.background, selectionBackground:p.selection || c.accent, ...Object.fromEntries(ansi.map((k,i) => [k,(p.ansi || defaults.ansi)[i]])) };
  }
  function terminalOptions() {
    const p = variant?.terminal || {};
    return { fontFamily:p.fontFamily || getComputedStyle(root).getPropertyValue('--font-mono').trim() || 'monospace', fontSize:p.fontSize || 13, fontWeight:p.fontWeight || 'normal' };
  }
  function refresh() { window.fanboxApplyTheme?.(localStorage.getItem('fb_theme') || 'terminal'); }
  function setMode(value) {
    if (!['dark','light','system'].includes(value)) return;
    mode = value; localStorage.setItem('fb_theme_mode',mode); refresh();
  }
  mq.addEventListener('change', () => { if(mode === 'system') refresh(); });
  function notify(id) { window.fanboxTheme?.changed({id, mode, custom:custom.map(({id,name})=>({id,name}))}); }
  function editorPalette() {
    let id=localStorage.getItem('fb_editor_mode') || 'auto';
    if(id==='auto')id=active?.editorTheme?.[resolved()] || (resolved()==='dark'?'github-dark':'github-light');
    if(id==='dark' || id==='light')id='github-'+id;
    return window.FB_EDITOR_THEMES.find(t=>t.id===id);
  }
  function applyEditorPalette() {
    const palette=editorPalette(); if(!palette) return;
    const p=palette.settings || {}; const style=document.getElementById('editor-palette-style') || document.head.appendChild(Object.assign(document.createElement('style'),{id:'editor-palette-style'}));
    const valid=c=>color(c)?c:null;
    let css='#preview-body pre code.hljs, #preview-body .editor-area { background:'+ (valid(p.background)||'var(--bg)') +';color:'+(valid(p.foreground)||'var(--text)')+'; }';
    const tokens={keyword:['keyword','selector-tag'],string:['string','attribute'],comment:['comment','quote'],number:['number','literal'],type:['type','built_in'],function:['title','title.function_'],variable:['variable','params'],constant:['literal'],operator:['operator'],regexp:['regexp'],metatag:['meta'],delimiter:['punctuation']};
    for(const rule of palette.rules || []) { if(!rule.foreground)continue; const value=/^(hsl|rgb)/.test(rule.foreground)?rule.foreground:'#'+rule.foreground;if(!valid(value))continue;const names=tokens[rule.token];if(names)css+=names.map(t=>'#preview-body .hljs-'+t.replace(/\./g,'.')).join(',')+'{color:'+value+';}'; }
    style.textContent=css;
  }
  const db = () => new Promise((resolve,reject) => { const request=indexedDB.open('fanbox-appearance',1); request.onupgradeneeded=()=>request.result.createObjectStore('images'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
  async function imageStore(op, value) {
    const database=await db();
    try { return await new Promise((resolve,reject)=>{ const tx=database.transaction('images',op==='get'?'readonly':'readwrite'); const store=tx.objectStore('images'); const request=op==='get'?store.get('background'):op==='put'?store.put(value,'background'):store.delete('background'); let result; request.onsuccess=()=>result=request.result; tx.oncomplete=()=>resolve(result); tx.onerror=()=>reject(tx.error); }); }
    finally { database.close(); }
  }
  let imageUrl, imageBlob, imageRevision=0, blurTimer;
  async function displayImage(blob) {
    imageBlob=blob;
    const revision=++imageRevision;
    let rendered=blob;
    const blur=Number(background.blur)||0;
    if(blob && blur>0) {
      const bitmap=await createImageBitmap(blob);
      try {
        // Bake blur into the image; a live CSS filter on a Mica window can smear scrolling content.
        const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));
        canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext('2d');
        ctx.filter=`blur(${blur}px)`;
        const pad=blur*3;
        ctx.drawImage(bitmap,-pad,-pad,canvas.width+pad*2,canvas.height+pad*2);
        rendered=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('无法处理背景图片')),'image/png'));
      } finally { bitmap.close(); }
    }
    if(revision!==imageRevision)return;
    const previous=imageUrl;
    imageUrl=rendered ? URL.createObjectURL(rendered) : null;
    bgLayer.style.backgroundImage=imageUrl ? `url("${imageUrl}")` : '';
    bgLayer.style.opacity=String(background.opacity);
    bgLayer.style.filter='none';
    bgLayer.dataset.renderedBlur=String(blob?blur:0);
    root.classList.toggle('has-theme-background', !!blob);
    if(previous) URL.revokeObjectURL(previous);
  }
  imageStore('get').then(displayImage).catch(()=>{});
  function saveBackground() {
    localStorage.setItem('fb_theme_background',JSON.stringify(background));
    bgLayer.style.opacity=String(background.opacity);
    bgLayer.style.filter='none';
    clearTimeout(blurTimer);
    blurTimer=setTimeout(()=>displayImage(imageBlob).catch(console.error),100);
  }
  function exportTheme(t) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(t,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=t.id+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function settings() {
    if (document.getElementById('appearance-settings')) return;
    const overlay=document.createElement('div'); overlay.className='appearance-overlay'; overlay.id='appearance-settings';
    overlay.innerHTML=`<section class="appearance-dialog" role="dialog" aria-modal="true" aria-label="主题配置"><header><h2>主题配置</h2><button data-close>关闭</button></header><div class="appearance-controls"><label>明暗模式 <select data-mode><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></label><label>编辑器配色 <select data-editor><option value="auto">跟随主题</option><option value="dark">深色</option><option value="light">浅色</option></select></label></div><div class="appearance-grid"></div><h3>自定义主题</h3><div class="appearance-actions"><button data-import>导入 JSON</button><button data-create>新建主题</button><input type="file" accept=".json,application/json" data-file hidden multiple></div><h3>背景</h3><p class="appearance-background-note">图片不透明度和图片模糊只作用于所选图片；100% 为完全不透明。Mica 使用 Windows 系统背景效果，独立于这两个设置。</p><div class="appearance-actions"><button data-image>选择图片</button><button data-remove-image>移除图片</button><input type="file" accept="image/*" data-image-file hidden></div><div class="appearance-controls"><label>图片不透明度 <input type="range" min="0" max="1" step=".01" data-opacity><output data-opacity-value></output></label><label>图片模糊 <input type="range" min="0" max="64" step="1" data-blur><output data-blur-value></output></label><label><input type="checkbox" data-vibrancy> Windows Mica 背景效果</label></div><p class="appearance-error" role="status"></p><div class="appearance-edit" hidden><label>主题 JSON<textarea spellcheck="false"></textarea></label><button data-save>保存主题</button><button data-cancel>取消</button></div></section>`;
    document.body.appendChild(overlay);
    const q=s=>overlay.querySelector(s);
    const error=e=>q('.appearance-error').textContent=e?.message || String(e || '');
    const previous=document.activeElement;
    const close=()=>{overlay.remove();document.removeEventListener('keydown',escape,true);previous?.focus();};
    const escape=e=>{if(e.key==='Escape'){e.stopPropagation();close();}};
    document.addEventListener('keydown',escape,true); q('[data-close]').onclick=close; overlay.onclick=e=>{if(e.target===overlay)close();};
    function select(id) { window.fanboxApplyTheme(id); render(); }
    function render() {
      const grid=q('.appearance-grid'); grid.replaceChildren();
      const items=[...legacy.map((id,i)=>({id,name:['终端（默认）','档案','索引'][i]})),...all()];
      for(const t of items) {
        const card=document.createElement('div'); card.className='appearance-card'+(t.id===localStorage.getItem('fb_theme')?' selected':'');
        const button=document.createElement('button'); button.className='appearance-choice';
        const v=t.variants?.[resolved()] || t.variants?.dark || t.variants?.light;
        const swatch=document.createElement('span'); swatch.className='appearance-swatch';
        const c=v?.colors || ({terminal:{background:'#0b0c0a',primary:'#cdf24b',foreground:'#f2f2ea'},warm:{background:'#f5f0e8',primary:'#cc785c',foreground:'#1a1a18'},editorial:{background:'#f4f1ea',primary:'#ff433d',foreground:'#0a0a0a'}}[t.id]);
        swatch.style.background=c?.background || '#141414';
        for(const color of [c?.primary,c?.foreground,c?.mutedForeground]){const bar=document.createElement('i');bar.style.background=color || '#888';swatch.appendChild(bar);}
        button.appendChild(swatch); const label=document.createElement('span');label.textContent=t.name;button.appendChild(label);button.onclick=()=>select(t.id);card.appendChild(button);
        if(t.variants){const actions=document.createElement('div');actions.className='appearance-card-actions';const exp=document.createElement('button');exp.textContent='导出';exp.onclick=()=>exportTheme(t);actions.appendChild(exp);const edit=document.createElement('button');edit.textContent=custom.includes(t)?'编辑':'复制修改';edit.onclick=()=>editTheme(custom.includes(t)?t:{...t,id:'custom-'+t.id,name:t.name+' 副本'});actions.appendChild(edit);if(custom.includes(t)){const del=document.createElement('button');del.textContent='删除';del.onclick=()=>{custom=custom.filter(x=>x.id!==t.id);localStorage.setItem('fb_custom_themes',JSON.stringify(custom));if(localStorage.getItem('fb_theme')===t.id)select('terminal');render();};actions.appendChild(del);}card.appendChild(actions);}
        grid.appendChild(card);
      }
    }
    function editTheme(t) { q('.appearance-edit').hidden=false;q('textarea').value=JSON.stringify(t,null,2);q('textarea').focus();q('.appearance-edit').scrollIntoView({block:'nearest'}); }
    function save(t) { validate(t); if(legacy.includes(t.id)||window.TERAX_THEMES.some(x=>x.id===t.id))throw Error('内置主题请修改 id 后保存');const next=[...custom.filter(x=>x.id!==t.id),t];localStorage.setItem('fb_custom_themes',JSON.stringify(next));custom=next;select(t.id); }
    q('[data-mode]').value=mode;q('[data-mode]').onchange=e=>{setMode(e.target.value);render();};
    q('[data-editor]').replaceChildren();
    for(const t of [{id:'auto',name:'跟随主题'},...window.FB_EDITOR_THEMES]){const option=document.createElement('option');option.value=t.id;option.textContent=t.name;q('[data-editor]').appendChild(option);}
    q('[data-editor]').value=localStorage.getItem('fb_editor_mode') || 'auto';q('[data-editor]').onchange=e=>{localStorage.setItem('fb_editor_mode',e.target.value);refresh();};
    q('[data-import]').onclick=()=>q('[data-file]').click();q('[data-file]').onchange=async e=>{try{for(const file of e.target.files){if(file.size>1024*1024)throw Error('主题文件过大');save(JSON.parse(await file.text()));}error('');}catch(err){error(err);}e.target.value='';};
    q('[data-create]').onclick=()=>{const template=JSON.parse(JSON.stringify(find(localStorage.getItem('fb_theme')) || window.TERAX_THEMES[0]));template.id='custom-'+Date.now();template.name='我的主题';editTheme(template);};
    q('[data-save]').onclick=()=>{try{save(JSON.parse(q('textarea').value));q('.appearance-edit').hidden=true;error('');}catch(err){error(err);}};q('[data-cancel]').onclick=()=>q('.appearance-edit').hidden=true;
    q('[data-image]').onclick=()=>q('[data-image-file]').click();q('[data-image-file]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/') || file.size>20*1024*1024)throw Error('请选择 20 MB 以内的图片');await createImageBitmap(file).then(b=>b.close());await imageStore('put',file);await displayImage(file);error('');}catch(err){error(err);}e.target.value='';};
    q('[data-remove-image]').onclick=async()=>{try{await imageStore('delete');await displayImage(null);}catch(err){error(err);}};
    for(const key of ['opacity','blur']){q('[data-'+key+']').value=background[key];const update=()=>q('[data-'+key+'-value]').textContent=key==='opacity'?Math.round(background[key]*100)+'%':background[key]+' px';update();q('[data-'+key+']').oninput=e=>{background[key]=Number(e.target.value);saveBackground();update();};}
    q('[data-vibrancy]').checked=!!background.vibrancy;q('[data-vibrancy]').onchange=async e=>{const result=await window.fanboxTheme?.vibrancy(e.target.checked);if(!result?.ok){e.target.checked=false;error(result?.error || '当前环境不支持此效果');}background.vibrancy=e.target.checked;root.classList.toggle('has-theme-mica',background.vibrancy);saveBackground();};
    render();q('[data-close]').focus();
  }
  window.fbThemes = { apply, terminal, terminalOptions, find, all, resolved, settings, setMode, notify, editorPalette, applyEditorPalette, isDark:()=>active?resolved()==='dark':localStorage.getItem('fb_theme')==='terminal', editorMode:()=>localStorage.getItem('fb_editor_mode') || 'auto' };
  if(background.vibrancy)window.fanboxTheme?.vibrancy(true).then(result=>root.classList.toggle('has-theme-mica',!!result.ok));
})();
