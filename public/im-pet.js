(() => {
  if (!window.fanboxRemote) return;
  const desktopBridge=window.fanboxDesktopPet,desktop=desktopBridge?.isDesktop===true,desktopHost=!!desktopBridge&&!desktop;
  const native=promise=>promise?.catch(()=>{});
  const key='fanbox-im-pet-v1', defaults={type:'cat',size:88,motion:true,hidden:false,x:1,y:1,skin:'original',selectedAction:'builtin:0',actions:[],skins:[]};
  let prefs={...defaults};try{prefs={...defaults,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(prefs));return true;}catch{return false;}};
  const call=async(action)=>{const r=await fanboxRemote.call(action);if(!r.ok)throw Error(r.error);return r.value;};
  const extensions=window.fanboxPetExtensions;
  if(typeof prefs.skin!=='string')prefs.skin='original';
  prefs.actions=(Array.isArray(prefs.actions)?prefs.actions:[]).slice(0,20).flatMap(a=>{try{return [extensions.action(a)];}catch{return [];}});
  prefs.skins=(Array.isArray(prefs.skins)?prefs.skins:[]).slice(0,8).flatMap(a=>{try{if(a.image){if(typeof a.name!=='string'||a.name.length>40||a.image.length>350000||!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(a.image))return [];return [{name:a.name,image:a.image}];}return [extensions.skin(a)];}catch{return [];}});
  const names={cat:'小猫',dog:'小狗',fox:'狐狸',robot:'机器人'};
  if(!names[prefs.type])prefs.type='cat';
  if(![64,88,112].includes(prefs.size))prefs.size=88;
  let state=null,mode='unknown',drag=null,moved=false,refreshing=false;
  const root=document.createElement('div');root.className='im-pet';root.hidden=desktopHost||!!prefs.hidden;
  root.innerHTML='<button class="im-pet-character" aria-label="企微机器人状态，点击查看详情"><span class="im-pet-art"></span><span class="im-pet-badge"></span></button>';
  const panel=document.createElement('section');panel.className='im-pet-panel';panel.hidden=true;panel.setAttribute('aria-label','企微状态与宠物设置');
  panel.innerHTML='<header><strong>企微小伙伴</strong><button data-close aria-label="关闭详情">×</button></header><p data-status></p><p data-error role="status"></p><dl data-health></dl><div class="im-pet-actions"><button data-refresh>刷新状态</button><button data-reconnect>重新连接</button><button data-settings>打开 IM 设置</button></div><details><summary>最近连接记录</summary><ul data-events></ul></details><hr><div class="im-pet-options"><label>宠物造型<select data-type><option value="cat">小猫</option><option value="dog">小狗</option><option value="fox">狐狸</option><option value="robot">机器人</option></select></label><label>大小<select data-size><option value="64">小</option><option value="88">中</option><option value="112">大</option></select></label><label><input type="checkbox" data-motion>启用动画</label></div><div class="im-pet-actions"><button data-play>打个招呼</button><button data-reset>重置位置</button><button data-hide>隐藏宠物</button></div><details class="pet-extension-settings"><summary>皮肤与自定义动作</summary><label>皮肤<select data-skin></select></label><div class="im-pet-actions"><button data-import-skin>导入皮肤</button><button data-remove-skin>删除所选皮肤</button></div><label>动作<select data-action></select></label><div class="im-pet-actions"><button data-run-action>播放动作</button><button data-import-action>导入动作</button><button data-remove-action>删除所选动作</button><button data-template>下载动作示例</button></div><input type="file" data-skin-file accept=".json,.png,.webp" hidden><input type="file" data-action-file accept=".json" hidden><p data-extension-note role="status"></p><small>动作使用 JSON；皮肤支持配色 JSON 或 PNG/WebP 图片（不超过 256KB、512×512）。离线时默认睡眠，仍可手动播放动作。Windows 减少动态效果时仅关闭自动互动；关闭动画后不播放动作。</small></details><small>鼠标移入播放所选动作，拖动宠物可调整位置。隐藏后可在 IM 设置中重新显示。在线仅代表连接成功，执行权限单独设置。</small>';
  document.body.append(root,panel);
  const character=root.querySelector('button');
  const set=(selector,text)=>{panel.querySelector(selector).textContent=text;};
  let playing=null;
  const palettes={original:null,cream:{fur:'#F0D9AE',outline:'#917753',muzzle:'#FFF8E9'},night:{fur:'#8D97B1',outline:'#4D566F',muzzle:'#DCE4F0'},mint:{fur:'#9BD4BE',outline:'#47786A',muzzle:'#FFF5DE'}};
  function art(){
    playing?.cancel();playing=null;
    const skin=prefs.skin.startsWith('custom:')?prefs.skins[Number(prefs.skin.slice(7))]:palettes[prefs.skin];
    const type=prefs.type,color=skin?.fur||{cat:'#e6b982',dog:'#b88b67',fox:'#ee9c59',robot:'#93b9d0'}[type];
    const uid='pet-volume';
    const ears=type==='robot'?'<path d="M50 25V12" stroke="#607d93" stroke-width="4"/><circle cx="50" cy="10" r="4" fill="#B8F5E2"/>':type==='dog'?'<g class="pet-ears"><ellipse cx="24" cy="43" rx="11" ry="22" fill="#795948"/><ellipse cx="76" cy="43" rx="11" ry="22" fill="#795948"/></g>':'<g class="pet-ears"><path d="M23 41Q15 3 29 14L44 30M56 30L71 14Q85 3 77 41" fill="'+color+'"/><path d="M26 30L25 17L37 29M63 29L75 17L74 30" fill="#DA9B96" opacity=".7"/></g>';
    const tail=type==='robot'?'':'<path class="pet-tail" d="M70 78Q97 81 86 54" fill="none" stroke="'+color+'" stroke-width="10" stroke-linecap="round"/>';
    root.querySelector('.im-pet-art').innerHTML='<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="'+uid+'" cx="30%" cy="18%" r="85%"><stop stop-color="#fff" stop-opacity=".65"/><stop offset=".42" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#372438" stop-opacity=".38"/></radialGradient><radialGradient id="pet-cheek"><stop stop-color="#F59C99" stop-opacity=".65"/><stop offset="1" stop-color="#F59C99" stop-opacity="0"/></radialGradient><radialGradient id="pet-ground"><stop stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><ellipse class="pet-ground" cx="50" cy="91" rx="38" ry="7" fill="url(#pet-ground)"/><g class="pet-body">'+tail+'<ellipse cx="50" cy="72" rx="25" ry="19" fill="'+color+'"/><ellipse cx="50" cy="72" rx="25" ry="19" fill="url(#'+uid+')"/><ellipse cx="48" cy="74" rx="15" ry="12" fill="#fff4df" opacity=".55"/><g class="pet-head">'+ears+'<rect x="17" y="24" width="66" height="52" rx="'+(type==='robot'?15:27)+'" fill="'+color+'"/><rect x="17" y="24" width="66" height="52" rx="'+(type==='robot'?15:27)+'" fill="url(#'+uid+')"/><path d="M27 34Q40 24 56 29" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/><ellipse cx="50" cy="62" rx="21" ry="11" fill="#fff4df"/><ellipse cx="25" cy="57" rx="9" ry="6" fill="url(#pet-cheek)"/><ellipse cx="75" cy="57" rx="9" ry="6" fill="url(#pet-cheek)"/><g class="pet-eyes"><ellipse cx="35" cy="47" rx="5" ry="6" fill="#34313C"/><ellipse cx="65" cy="47" rx="5" ry="6" fill="#34313C"/><g class="pet-eye-glints" fill="#fff"><circle cx="33.5" cy="44.5" r="1.8"/><circle cx="63.5" cy="44.5" r="1.8"/><circle cx="37" cy="49" r=".8"/><circle cx="67" cy="49" r=".8"/></g></g><g class="pet-sleep-eyes" fill="none" stroke="#725948" stroke-width="2.5" stroke-linecap="round"><path d="M30 48q5 5 10 0M60 48q5 5 10 0"/></g><path d="M46 56Q50 53 54 56L50 61Z" fill="#725948"/><path d="M47 56h3" stroke="#fff" stroke-opacity=".6" stroke-linecap="round"/><path d="M43 65q7 5 14 0" fill="none" stroke="#725948" stroke-width="1.8" stroke-linecap="round"/></g><g class="pet-paws"><ellipse cx="32" cy="85" rx="10" ry="6" fill="'+color+'"/><ellipse cx="68" cy="85" rx="10" ry="6" fill="'+color+'"/><ellipse cx="32" cy="85" rx="10" ry="6" fill="url(#'+uid+')"/><ellipse cx="68" cy="85" rx="10" ry="6" fill="url(#'+uid+')"/></g></g><text class="pet-zzz" x="73" y="22" fill="#AABBD3" font-size="15" font-weight="bold">zZ</text></svg>';
    const svg=root.querySelector('svg');
    if(skin?.image){const body=svg.querySelector('.pet-body');body.replaceChildren();const image=document.createElementNS('http://www.w3.org/2000/svg','image');image.setAttribute('href',skin.image);image.setAttribute('width','90');image.setAttribute('height','85');image.setAttribute('x','5');image.setAttribute('y','5');body.append(image);}
    else if(skin){for(const el of svg.querySelectorAll('[stroke="#725948"],[stroke="#8c624a"],[fill="#725948"]')){if(el.hasAttribute('stroke'))el.setAttribute('stroke',skin.outline);if(el.getAttribute('fill')==='#725948')el.setAttribute('fill',skin.outline);}svg.querySelectorAll('[fill="#fff4df"]').forEach(el=>el.setAttribute('fill',skin.muzzle));}
    root.style.setProperty('--pet-size',prefs.size+'px');root.classList.toggle('pet-still',!prefs.motion);if(desktop)native(desktopBridge.sync({size:prefs.size,hidden:!!prefs.hidden}));position();
  }
  function position(){
    if(desktop)return;
    const x=Number.isFinite(prefs.x)?prefs.x:1,y=Number.isFinite(prefs.y)?prefs.y:1;
    root.style.left=(8+Math.max(0,Math.min(1,x))*Math.max(0,innerWidth-root.offsetWidth-16))+'px';
    root.style.top=(8+Math.max(0,Math.min(1,y))*Math.max(0,innerHeight-root.offsetHeight-16))+'px';
    if(panel.hidden)return;
    const r=desktopHost?{left:innerWidth-prefs.size-16,right:innerWidth-16,top:innerHeight-prefs.size-16,bottom:innerHeight-16}:root.getBoundingClientRect(),gap=22,margin=8;
    const left=r.left-gap-margin,right=innerWidth-r.right-gap-margin;
    const width=Math.min(320,innerWidth-2*margin);
    panel.style.width=width+'px';
    if(Math.max(left,right)>=width){
      panel.style.maxHeight=Math.max(80,innerHeight-2*margin)+'px';
      panel.style.left=(left>=right?r.left-gap-width:r.right+gap)+'px';
      panel.style.top=Math.max(margin,Math.min(r.top,innerHeight-panel.offsetHeight-margin))+'px';
    }else{
      const above=r.top-gap-margin,below=innerHeight-r.bottom-gap-margin,useAbove=above>=below;
      panel.style.maxHeight=Math.max(0,useAbove?above:below)+'px';
      panel.style.left=Math.max(margin,Math.min(r.left,innerWidth-width-margin))+'px';
      panel.style.top=(useAbove?r.top-gap-panel.offsetHeight:r.bottom+gap)+'px';
    }
  }
  const time=value=>value?new Date(value).toLocaleTimeString():'暂无记录';
  function update(next){
    if(next?.qr)return;if(next)state=next;
    let label='状态未知';
    if(state){
      mode=state.status==='connected'?'online':['connecting','reconnecting'].includes(state.status)?'connecting':'offline';
      label=mode==='online'?'企微在线':mode==='connecting'?'正在连接':'企微离线';
      if(state.status==='disabled')label='企微未启用';
      if(mode==='online'&&state.routes?.some(r=>r.running)){mode='busy';label='正在处理任务';}
      if(state.pendingApprovals){mode='attention';label='等待审批';}
      if(state.pendingUsers?.length){mode='attention';label='有账号待绑定';}
      if(state.status!=='connected'&&!['connecting','reconnecting'].includes(state.status)){mode='offline';if(state.error?.includes('解密'))label='凭据需更新';}
      if(state.status==='connected'&&!state.allowExecution)label='在线 · 执行未授权';
    }
    root.dataset.mode=mode;
    root.querySelector('.im-pet-badge').textContent=mode==='offline'?'z':mode==='attention'?'!':mode==='busy'?'…':'';
    character.title=label+(desktop?' · 单击显示软件，右键打开宠物设置':' · 点击查看详情');character.setAttribute('aria-label',character.title);
    set('[data-status]',label);set('[data-error]',state?.error||'');
    const health=panel.querySelector('[data-health]');health.replaceChildren();
    for(const [name,value] of [['最近收到消息',time(state?.lastReceivedAt)],['最近成功回复',time(state?.lastSentAt)],['已绑定账号',state?.users?.length||0],['待审批',state?.pendingApprovals||0]]){
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=String(value);health.append(dt,dd);
    }
    const events=panel.querySelector('[data-events]');events.replaceChildren();
    for(const event of (state?.healthEvents||[]).slice().reverse()){const li=document.createElement('li');li.textContent=time(event.at)+' '+event.message;events.append(li);}
    if(!events.children.length){const li=document.createElement('li');li.textContent='暂无连接记录';events.append(li);}
    panel.querySelector('[data-reconnect]').disabled=!state?.enabled||['connecting','reconnecting'].includes(state?.status);
    position();
  }
  async function refresh(){if(refreshing)return;refreshing=true;try{update(await call('im-state'));}catch{state=null;mode='unknown';update();set('[data-error]','无法读取机器人状态，请检查应用是否正常运行');}finally{refreshing=false;}}
  panel.querySelector('[data-close]').onclick=()=>panel.hidden=true;
  panel.querySelector('[data-refresh]').onclick=refresh;
  panel.querySelector('[data-reconnect]').onclick=async()=>{const b=panel.querySelector('[data-reconnect]');b.disabled=true;try{update(await call('im-reconnect'));}catch(e){set('[data-error]',e.message);}finally{b.disabled=!state?.enabled;}};
  panel.querySelector('[data-settings]').onclick=()=>{panel.hidden=true;window.remoteUI.imSettings();};
  panel.querySelector('[data-type]').value=prefs.type;panel.querySelector('[data-type]').onchange=e=>{prefs.type=e.target.value;save();art();};
  panel.querySelector('[data-size]').value=prefs.size;panel.querySelector('[data-size]').onchange=e=>{prefs.size=Number(e.target.value);save();art();};
  panel.querySelector('[data-motion]').checked=prefs.motion;panel.querySelector('[data-motion]').onchange=e=>{prefs.motion=e.target.checked;save();art();};
  panel.querySelector('[data-hide]').onclick=()=>{prefs.hidden=true;root.hidden=true;panel.hidden=true;save();if(desktopHost)native(desktopBridge.visible(false));};
  panel.querySelector('[data-reset]').onclick=()=>{prefs.x=1;prefs.y=1;save();position();if(desktopHost)native(desktopBridge.reset());};
  const builtinActions=[extensions.action({version:1,name:'打招呼',duration:900,iterations:1,keyframes:[{offset:0},{offset:.25,rotate:-12},{offset:.75,rotate:12},{offset:1}]}),extensions.action({version:1,name:'街舞摇摆',duration:2000,iterations:2,keyframes:[{offset:0},{offset:.2,x:-10,y:-4,rotate:-18},{offset:.4,x:10,y:-4,rotate:18},{offset:.6,y:-18,scale:1.1},{offset:.8,x:-8,rotate:-12},{offset:1}]})];
  const note=text=>panel.querySelector('[data-extension-note]').textContent=text;
  const options=(select,entries,value)=>{select.replaceChildren();for(const [id,label] of entries){const option=document.createElement('option');option.value=id;option.textContent=label;select.append(option);}if(value)select.value=value;};
  function extensionOptions(){options(panel.querySelector('[data-skin]'),[['original','原色'],['cream','奶油'],['night','夜空'],['mint','薄荷'],...prefs.skins.map((x,i)=>['custom:'+i,x.name])],prefs.skin);options(panel.querySelector('[data-action]'),[...builtinActions.map((x,i)=>['builtin:'+i,x.name]),...prefs.actions.map((x,i)=>['custom:'+i,x.name])],prefs.selectedAction);}
  function play(action,hover=false){
    if(!prefs.motion){if(!hover)note('宠物动画已关闭，请先勾选“启用动画”。');return;}
    if(hover&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    // An explicit Play click may preview an action even when Windows reduces
    // automatic motion. Bot connectivity only controls the resting appearance.
    if(desktopHost){localStorage.setItem(key+'-action',JSON.stringify({action,hover,nonce:Date.now()}));note('正在播放：'+action.name);return;}
    playing?.cancel();
    playing=root.querySelector('.pet-body').animate(action.keyframes.map(f=>({offset:f.offset,transform:'translate('+f.x+'px,'+f.y+'px) rotate('+f.rotate+'deg) scale('+f.scale+')'})),{duration:action.duration,iterations:action.iterations,easing:'ease-in-out'});
    if(!hover)note('正在播放：'+action.name);
  }

  function selectedAction(){const [kind,index]=String(prefs.selectedAction||'builtin:0').split(':');return (kind==='custom'?prefs.actions:builtinActions)[Number(index)]||builtinActions[0];}
  panel.querySelector('[data-action]').onchange=e=>{prefs.selectedAction=e.target.value;save();};
  character.onpointerenter=()=>{if(!drag&&playing?.playState!=='running')play(selectedAction(),true);};
  panel.querySelector('[data-play]').onclick=()=>play(builtinActions[0]);
  panel.querySelector('[data-run-action]').onclick=()=>{const [kind,index]=panel.querySelector('[data-action]').value.split(':');const action=(kind==='builtin'?builtinActions:prefs.actions)[Number(index)];if(action)play(action);};
  panel.querySelector('[data-skin]').onchange=e=>{prefs.skin=e.target.value;save();art();};
  panel.querySelector('[data-import-action]').onclick=()=>panel.querySelector('[data-action-file]').click();
  panel.querySelector('[data-import-skin]').onclick=()=>panel.querySelector('[data-skin-file]').click();
  panel.querySelector('[data-action-file]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>32000||prefs.actions.length>=20)throw Error('动作文件最多 32KB，最多保存 20 个动作');const action=extensions.action(JSON.parse(await file.text()));prefs.actions.push(action);prefs.selectedAction='custom:'+(prefs.actions.length-1);if(!save()){prefs.actions.pop();throw Error('本机存储空间不足');}extensionOptions();panel.querySelector('[data-action]').value='custom:'+(prefs.actions.length-1);note('动作已导入：'+action.name);}catch(err){note('导入失败：'+err.message);}finally{e.target.value='';}};
  panel.querySelector('[data-skin-file]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>256*1024||prefs.skins.length>=8)throw Error('皮肤最多 256KB，最多保存 8 个皮肤');let skin;
    if(/\.json$/i.test(file.name))skin=extensions.skin(JSON.parse(await file.text()));
    else{if(!['image/png','image/webp'].includes(file.type))throw Error('请选择 PNG、WebP 或配色 JSON');const image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);});const img=new Image();img.src=image;await img.decode();if(img.width>512||img.height>512)throw Error('图片尺寸最多 512×512');skin={name:file.name.slice(0,40),image};}
    prefs.skins.push(skin);const old=prefs.skin;prefs.skin='custom:'+(prefs.skins.length-1);if(!save()){prefs.skins.pop();prefs.skin=old;throw Error('本机存储空间不足');}extensionOptions();art();note('皮肤已导入：'+skin.name);
  }catch(err){note('导入失败：'+err.message);}finally{e.target.value='';}};
  panel.querySelector('[data-remove-action]').onclick=()=>{const [kind,index]=panel.querySelector('[data-action]').value.split(':');if(kind!=='custom'){note('内置动作不能删除');return;}playing?.cancel();prefs.actions.splice(Number(index),1);prefs.selectedAction='builtin:0';save();extensionOptions();note('动作已删除');};
  panel.querySelector('[data-remove-skin]').onclick=()=>{if(!prefs.skin.startsWith('custom:')){note('默认皮肤不能删除');return;}prefs.skins.splice(Number(prefs.skin.slice(7)),1);prefs.skin='original';save();extensionOptions();art();note('皮肤已删除');};
  panel.querySelector('[data-template]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(builtinActions[1],null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pet-street-dance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  extensionOptions();

  character.onpointerdown=e=>{if(e.button!==0)return;if(desktop){drag={x:e.screenX,y:e.screenY};moved=false;character.setPointerCapture(e.pointerId);native(desktopBridge.drag('start'));return;}drag={x:e.clientX,y:e.clientY,left:root.offsetLeft,top:root.offsetTop};moved=false;character.setPointerCapture(e.pointerId);};
  character.onpointerleave=()=>{root.style.setProperty('--pet-gaze-x','0px');root.style.setProperty('--pet-gaze-y','0px');};
  character.onpointermove=e=>{if(desktop&&drag){if(Math.abs(e.screenX-drag.x)+Math.abs(e.screenY-drag.y)>5)moved=true;if(moved)native(desktopBridge.drag('move'));return;}if(!drag){if(prefs.motion&&mode!=='offline'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const r=character.getBoundingClientRect();root.style.setProperty('--pet-gaze-x',((e.clientX-r.left)/r.width*3-1.5)+'px');root.style.setProperty('--pet-gaze-y',((e.clientY-r.top)/r.height*2-1)+'px');}return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(!moved)return;prefs.x=Math.max(0,Math.min(1,(drag.left+dx-8)/Math.max(1,innerWidth-root.offsetWidth-16)));prefs.y=Math.max(0,Math.min(1,(drag.top+dy-8)/Math.max(1,innerHeight-root.offsetHeight-16)));position();};
  character.onpointerup=()=>{drag=null;if(desktop){native(desktopBridge.drag('end'));return;}if(moved)save();};
  character.onpointercancel=()=>{drag=null;if(desktop)native(desktopBridge.drag('end'));};
  character.onclick=()=>{if(moved){moved=false;return;}if(desktop){native(desktopBridge.restore());return;}panel.hidden=!panel.hidden;position();if(!panel.hidden)refresh();};
  character.oncontextmenu=e=>{if(desktop){e.preventDefault();native(desktopBridge.settings());}};
  document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!root.contains(e.target))panel.hidden=true;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')panel.hidden=true;});
  addEventListener('resize',position);
  panel.addEventListener('toggle',position,true);
  new ResizeObserver(()=>{if(!panel.hidden)position();}).observe(panel);
  fanboxRemote.on('im',update);
  window.imPet={show(){prefs.hidden=false;root.hidden=desktopHost;save();art();refresh();if(desktopHost){native(desktopBridge.visible(true));panel.hidden=false;position();}},refresh};
  desktopBridge?.onSettings?.(()=>{panel.hidden=false;position();refresh();});
  addEventListener('storage',event=>{if(desktop&&event.key===key+'-action'){try{const request=JSON.parse(event.newValue);play(extensions.action(request.action),request.hover===true);}catch{}return;}if(event.key!==key)return;try{Object.assign(prefs,JSON.parse(event.newValue||'{}'));panel.querySelector('[data-motion]').checked=!!prefs.motion;root.hidden=desktopHost||!!prefs.hidden;extensionOptions();art();update();}catch{}});
  art();update();refresh();
  setInterval(()=>{if(!document.hidden)refresh();},15000);
})();
