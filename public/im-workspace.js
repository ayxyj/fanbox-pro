(() => {
  if (!window.fanboxRemote) return;
  const api = async (action, args) => { const r = await fanboxRemote.call(action, args); if (!r.ok) throw Error(r.error); return r.value; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let dialog, state;
  const statusText = { disabled:'已停用', connecting:'连接中', connected:'已连接', disconnected:'连接断开', reconnecting:'重连中', error:'连接失败' };
  function notice(text) { if (dialog) dialog.querySelector('[data-notice]').textContent = text; }
  const act = fn => async () => { try { await fn(); } catch (e) { notice(e.message); } };
  function accounts() {
    if (!dialog || !state) return;
    dialog.querySelector('[data-status]').textContent = `${statusText[state.status] || state.status} · ${state.botId || '尚未绑定机器人'}`;
    dialog.querySelector('[data-accounts]').innerHTML = [...state.users.map(userid => `<tr><td>${esc(userid)}</td><td>已授权</td><td><button data-unbind="${esc(userid)}">解除绑定</button></td></tr>`), ...state.pendingUsers.map(({userid}) => `<tr><td>${esc(userid)}</td><td>等待本机确认</td><td><button data-bind="${esc(userid)}">绑定此账号</button></td></tr>`)].join('') || '<tr><td colspan="3">请先在企业微信中给机器人发送一条私聊消息。</td></tr>';
    for (const b of dialog.querySelectorAll('[data-bind]')) b.onclick = act(async () => { await api('im-bind', { userid:b.dataset.bind }); state = await api('im-state'); accounts(); });
    for (const b of dialog.querySelectorAll('[data-unbind]')) b.onclick = act(async () => { await api('im-unbind', { userid:b.dataset.unbind }); state = await api('im-state'); accounts(); });
    dialog.querySelector('[data-routes]').innerHTML = state.routes.map(r => `<tr><td>${esc(r.userid)}</td><td>${r.focused ? '▶ ' : ''}#${esc(r.number)} ${esc(r.project)}</td><td>${esc(r.mode === 'ai' ? 'AI 执行' : r.mode + ' CLI')}</td><td>${r.running ? '处理中' : '等待消息'}</td><td><button data-open="${esc(r.sessionId)}">查看终端与会话</button></td></tr>`).join('') || '<tr><td colspan="5">收到已授权账号的任务后创建独立终端。</td></tr>';
    for (const b of dialog.querySelectorAll('[data-open]')) b.onclick = () => { const id=b.dataset.open; dialog.close(); window.remoteUI.openAI(id); };
    notice(state.error || '');
  }
  async function open() {
    if (dialog) { dialog.focus(); return; }
    state = await api('im-state'); dialog = document.createElement('dialog'); dialog.className = 'im-settings';
    dialog.innerHTML = `<header><h2>IM 远程干预与通知</h2>${fanboxUI.closeButton("data-dismiss")}</header>
      <section><h3>企业微信 <small data-status></small></h3><p data-notice role="status"></p>
      <button data-qr>扫码创建机器人</button> <button data-reconnect>重新连接</button> <button data-pet>显示状态宠物</button> <label><input type="checkbox" name="enabled">启用连接</label><div data-code></div>
      <details><summary>已有机器人 · 手动填写凭据</summary><label>Bot ID<input name="botId" autocomplete="off"></label><label>Secret<input type="password" name="secret" autocomplete="new-password" placeholder="留空保留已保存的凭据"></label></details></section>
      <section><h3>绑定接收账号</h3><p>扫码后先向机器人发送私聊消息，再在此确认账号。只有已绑定账号可以操作终端。</p><table><thead><tr><th>账号</th><th>状态</th><th>操作</th></tr></thead><tbody data-accounts></tbody></table></section>
      <section><h3>远程操作</h3><label><input type="checkbox" name="allowExecution">允许已绑定账号操作终端</label><div class="im-grid"><label>处理方式<select name="mode"><option value="ai">AI 分析并执行命令</option><option value="claude">Claude CLI</option><option value="codex">Codex CLI</option><option value="codebuddy">CodeBuddy CLI</option></select></label><label>终端<select name="shell"><option value="cmd">Windows CMD</option><option value="powershell">PowerShell</option></select></label><label>命令权限<select name="permission"><option value="confirm">通过企微按钮批准 / 拒绝</option><option value="auto">允许 AI 自动执行命令</option></select></label><label>工作目录<input name="cwd"></label></div><p>AI 使用设置中的已启用模型。CLI 需预先安装、登录。/claude、/codex、/codebuddy 在当前终端启动交互式 CLI，消息原样发送；/aiquit 发送 Ctrl+C，退出后返回 AI 对话。CLI 自身权限配置生效。企微支持 /projects、/new、/list、/sel、/content、/set_name、/help、/permiss 和 /stop。/new 项目名 使用工作目录下的子目录，也支持完整路径。</p><label><input name="progress" type="checkbox">任务接收通知</label><p>任务结果、错误及权限请求始终回复发送者；CLI 采用少量进度通知、关键节点交互与最终结果；不发送终端动画、回显和重绘。可要求 Agent 把生成的文档、图片或截图作为文件发送到当前企微会话。</p></section>
      <section><h3>当前会话</h3><table><thead><tr><th>账号</th><th>会话 / 项目</th><th>模式</th><th>状态</th><th>操作</th></tr></thead><tbody data-routes></tbody></table></section><footer><span data-save-result role="status" aria-live="polite"></span><button data-save>保存设置</button></footer>`;
    document.body.append(dialog);
    dialog.querySelector("[data-dismiss]").onclick = () => dialog.close();
    for (const key of ['botId','enabled','allowExecution','mode','shell','permission','cwd']) { const el=dialog.querySelector(`[name=${key}]`); el.type === 'checkbox' ? el.checked=state[key] : el.value=state[key]; }
    dialog.querySelector('[name=progress]').checked=state.notifications.progress;
    dialog.onclose = () => { api('im-qr-cancel').catch(()=>{}); dialog.remove(); dialog=null; };
    dialog.querySelector('[data-qr]').onclick=act(async () => { notice('正在获取二维码…'); const qr=await api('im-qr-start'); if (!dialog) return; const image=document.createElement('img'); image.src=qr.image; image.alt='请使用企业微信扫码创建机器人'; dialog.querySelector('[data-code]').replaceChildren(image); notice('使用企业微信扫码并确认，二维码 5 分钟内有效。'); });
    const secretField=fanboxUI.secretInput(dialog.querySelector('[name=secret]'),{saved:state.hasSecret,read:()=>api('reveal-im-secret'),onError:e=>notice(e.message)});
    dialog.querySelector('[data-save]').onclick=async () => { const currentDialog=dialog,button=currentDialog.querySelector('[data-save]'),result=currentDialog.querySelector('[data-save-result]');button.disabled=true;result.textContent='正在保存…';result.className='';try { const values={}; for(const key of ['botId','secret','enabled','allowExecution','mode','shell','permission','cwd']) { const el=dialog.querySelector(`[name=${key}]`); values[key]=el.type==='checkbox'?el.checked:el.value; } values.secret=secretField.value(); values.notifications={...state.notifications,progress:dialog.querySelector('[name=progress]').checked}; state=await api('im-save',values); secretField.reset(state.hasSecret); accounts(); result.textContent='保存成功';result.className='save-success'; } catch(error){result.textContent='保存失败：'+error.message;result.className='save-failure';}finally{button.disabled=false;} };
    dialog.querySelector('[data-pet]').onclick=()=>{dialog.close();window.imPet?.show();};
    dialog.querySelector('[data-reconnect]').onclick=act(async()=>{state=await api('im-reconnect');accounts();});
    accounts(); dialog.showModal();
  }
  window.remoteUI.imSettings = open;
  fanboxRemote.on('im-settings', () => open().catch(e => alert(e.message)));
  fanboxRemote.on('im', event => { if (event.qr) { notice(event.qr.text); if (event.qr.status==='bound' && dialog) { dialog.querySelector('[data-code]').replaceChildren(); api('im-state').then(s=>{state=s; if(dialog){dialog.querySelector('[name=botId]').value=s.botId;dialog.querySelector('[name=enabled]').checked=s.enabled;accounts();}}); } } else { state=event; accounts(); } });
  fanboxRemote.on('im-create-terminal', async request => {
    try { const session=await term.newTab(request.cwd, undefined, {shell:request.shell}); if(session.dead) throw Error('本地终端启动失败'); session.title='企微 · '+(request.project || request.userid); term.renderTabs(); await api('im-terminal-created',{token:request.token,sessionId:session.id}); window.remoteUI.openAI(session.id); }
    catch(e){ await api('im-terminal-created',{token:request.token,error:e.message}).catch(()=>{}); }
  });
  api('im-state').catch(()=>{});
})();
