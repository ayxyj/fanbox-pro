'use strict';
(() => {
  if (!window.fanboxRemote) return;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderChatAuthor(element, kind) {
    element.className = 'chat-author';
    if (kind === 'user') {
      element.innerHTML = '<span class="chat-user-avatar" role="img" aria-label="用户" title="用户"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></svg></span>';
    } else if (kind === 'assistant') {
      element.innerHTML = '<span class="chat-user-avatar chat-ai-avatar" role="img" aria-label="AI 助手" title="AI 助手"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M3 11v5M21 11v5"/><rect x="6" y="6" width="12" height="14" rx="3"/><circle cx="9.5" cy="11.5" r=".8" fill="currentColor"/><circle cx="14.5" cy="11.5" r=".8" fill="currentColor"/><path d="M9 16h6"/></svg></span>';
    } else element.textContent = kind === 'command' ? '⌘ 执行的命令' : kind === 'error' ? '未完成' : kind === 'notice' ? '执行状态' : '✦ AI';
  }
  const panel = document.createElement('aside'); panel.className = 'remote-workspace'; panel.hidden = true; panel.setAttribute('aria-label', 'SSH 与 AI 工作台');
  panel.innerHTML = '<header><strong>SSH 与 AI 工作台</strong><button data-close aria-label="关闭工作台">✕</button></header><nav class="remote-nav"><button data-tab="connections">SSH 连接</button><button data-tab="files">远程文件</button><button data-tab="ai">AI 操作</button></nav><section class="remote-body"></section><footer class="remote-status" role="status">就绪</footer>';
  const main = document.getElementById('main-body');
  main.prepend(panel);
  const divider = document.createElement('div'); divider.className = 'remote-divider'; divider.hidden = true; panel.after(divider);
  divider.onpointerdown = event => {
    divider.setPointerCapture(event.pointerId);
    divider.onpointermove = e => { const r = main.getBoundingClientRect(); main.style.setProperty('--remote-width', Math.max(300, Math.min(r.width - 300, e.clientX - r.left)) + 'px'); };
    divider.onpointerup = () => { divider.onpointermove = null; term.fitActive(); };
  };
  const body = panel.querySelector('.remote-body'), status = panel.querySelector('.remote-status');
  let data, tab = 'connections', revision = 0, selected = '', directory = '.', logFrame = null, filePage = 0;
  let dirtyEditor = () => false;
  const transfers = new Map(), chats = new Map();
  const chat = id => { if (!chats.has(id)) chats.set(id, { items: [], prompt: '', context: false, progress: '', policy: null }); return chats.get(id); };
  window.fanboxRemote.on('auth', challenge => {
    const session = term.sessions.find(s => s.id === challenge.sessionId);
    if (session) { session.authenticating = true; term.open(); term.activate(session.id); session.xterm.focus(); }
  });
  window.fanboxRemote.on('auth-close', ({ sessionId }) => { const session = term.sessions.find(s => s.id === sessionId); if (session) session.authenticating = false; });
  const notify = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  const api = async (action, args) => { const r = await window.fanboxRemote.call(action, args); if (!r.ok) throw Error(r.error); return r.value; };
  const wrap = fn => async (...args) => { try { await fn(...args); } catch (e) { notify(e.message, true); } };
  const bind = (selector, fn) => { const element = body.querySelector(selector); if (element) element.onclick = wrap(fn); };
  const field = (name, label, value = '', type = 'text', full = false) => `<label class="${full ? 'full' : ''}">${label}<input name="${name}" type="${type}" value="${escape(value)}" autocomplete="off"></label>`;
  const select = (name, label, options, value, full = false) => `<label class="${full ? 'full' : ''}">${label}<select name="${name}">${options.map(([v, text]) => `<option value="${escape(v)}" ${String(value) === String(v) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
  const check = (name, label, value) => `<label class="check full"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}>${label}</label>`;
  const values = form => Object.fromEntries(new FormData(form));
  async function refresh() { data = await api('state'); drawSessionTree(); }
  async function open(next = tab) { if (next === 'settings') return modelSettings(); if (dirtyEditor() && !confirm('放弃远程文件尚未保存的修改？')) return; dirtyEditor = () => false; panel.hidden = false; divider.hidden = false; main.classList.add('remote-page-open'); if (term.maximized) term.toggleMax(false); tab = next; await refresh(); await render(); }
  function close() {
    if (dirtyEditor() && !confirm('放弃远程文件尚未保存的修改？')) return false;
    dirtyEditor = () => false; panel.hidden = true; divider.hidden = true; main.classList.remove('remote-page-open'); term.fitActive(); return true;
  }
  async function openAI(id = term.active) { selected = id; term.open(); term.activate(id); await open('ai'); term.fitActive(); }
  window.remoteUI = { open: wrap(open), openAI: wrap(openAI), settings: wrap(modelSettings), shortcutMenu, close };
  panel.querySelector('[data-close]').onclick = close;
  panel.querySelectorAll('[data-tab]').forEach(button => button.onclick = wrap(() => open(button.dataset.tab)));
  window.fanboxRemote.on('settings', wrap(modelSettings));
  const navigation = document.createElement('details'); navigation.id = 'ssh-nav-section'; navigation.className = 'nav-section'; navigation.open = false;
  navigation.innerHTML = '<summary class="nav-title">SSH 连接</summary><div class="ssh-manager-row"><button data-ssh-manager aria-expanded="false"><span data-manager-arrow>▸</span> 会话管理</button><button data-ssh-add title="新建 SSH 连接" aria-label="新建 SSH 连接">＋</button></div><div data-session-tree hidden></div>';
  document.getElementById('gs-nav-section').before(navigation);
  const expandedGroups = new Set(); let managerExpanded = false;
  navigation.querySelector('[data-ssh-manager]').onclick = wrap(async () => { managerExpanded = !managerExpanded; await refresh(); });
  navigation.querySelector('[data-ssh-add]').onclick = wrap(async event => { event.stopPropagation(); await refresh(); profileForm(); });
  async function connectProfile(id, forceNew = false) {
    const existing = term.sessions.find(s => s.sshProfile === id && !s.dead);
    if (existing && !forceNew) { term.open(); term.activate(existing.id); selected = existing.id; return existing; }
    notify('正在连接 SSH…');
    const session = await term.openInDir(state.cwd, { sshProfile: id, shell: 'cmd' });
    if (session && !session.dead) selected = session.id;
    await refresh(); return session;
  }
  function drawSessionTree() {
    if (!data) return;
    const tree = navigation.querySelector('[data-session-tree]'); tree.hidden = !managerExpanded;
    navigation.querySelector('[data-ssh-manager]').setAttribute('aria-expanded', String(managerExpanded)); navigation.querySelector('[data-manager-arrow]').textContent = managerExpanded ? '▾' : '▸';
    const groups = [...new Set(data.profiles.map(p => p.group).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    const row = p => `<button class="ssh-session" data-profile="${escape(p.id)}" title="${escape(p.username + '@' + p.host)}"><span>${term.sessions.some(s => s.sshProfile === p.id && !s.dead) ? '●' : '◇'}</span><span>${escape(p.name)}</span></button>`;
    tree.innerHTML = groups.map((g,i) => `<div class="ssh-group"><button data-group="${i}" aria-expanded="${expandedGroups.has(g)}">${expandedGroups.has(g) ? '▾' : '▸'} ${escape(g)}</button><div class="ssh-group-children" ${expandedGroups.has(g) ? '' : 'hidden'}>${data.profiles.filter(p => p.group === g).map(row).join('')}</div></div>`).join('') + data.profiles.filter(p => !p.group).map(row).join('') + (!data.profiles.length ? '<small>点击 ＋ 新建连接</small>' : '');
    tree.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { const g = groups[Number(b.dataset.group)]; expandedGroups.has(g) ? expandedGroups.delete(g) : expandedGroups.add(g); drawSessionTree(); });
    tree.querySelectorAll('[data-profile]').forEach(b => {
      b.onclick = wrap(() => connectProfile(b.dataset.profile));
      b.oncontextmenu = event => { event.preventDefault(); const id = b.dataset.profile; popupMenu(event, [
        { label: '连接新终端', fn: wrap(() => connectProfile(id, true)) },
        { label: '打开 AI 会话', fn: wrap(async () => { const session = await connectProfile(id); if (session && !session.dead) await openAI(session.id); }) },
        { label: '远程文件', fn: wrap(async () => { const session = await connectProfile(id); if (session && !session.dead) { selected = session.id; directory = '.'; await open('files'); } }) },
        { label: '新增快捷命令', fn: () => shortcutManager(id, true) },
        { label: '管理快捷命令 / 分组', fn: () => shortcutManager(id) },
        { label: '编辑连接', fn: () => profileForm(data.profiles.find(p => p.id === id)) },
        { label: '删除连接', danger: true, fn: wrap(async () => { if (confirm('删除此 SSH 连接配置？')) { await api('delete-profile', { id }); await refresh(); } }) },
      ]); };
    });
  }
  document.getElementById('sidebar').addEventListener('click', event => { if (!navigation.contains(event.target) && event.target.closest('li,.side-link,#cron-entry')) close(); }, true);
  document.getElementById('term-tabs').addEventListener('contextmenu', event => {
    const id = event.target.closest('[data-session-id]')?.dataset.sessionId; if (!id) return;
    event.preventDefault(); popupMenu(event, [{ label: '打开 AI 会话', fn: wrap(() => openAI(id)) }, ...shortcutMenu(id).map(x => ({label:x[0],fn:x[1]}))]);
  });
  async function render() {
    const rev = ++revision;
    panel.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    if (tab === 'connections') connections();
    else if (tab === 'files') await files(rev);
    else await aiView(rev);
    body.classList.toggle('is-chat', tab === 'ai'); panel.classList.toggle('chat-page', tab === 'ai');
    requestAnimationFrame(() => term.fitActive());
  }
  function connections() {
    body.innerHTML = '<div class="remote-actions"><button data-new>＋ 新建 SSH 连接</button></div><input class="remote-search" placeholder="搜索名称、分组、主机" aria-label="搜索 SSH 连接"><div data-connections></div>';
    const draw = () => {
      const query = body.querySelector('input').value.toLowerCase();
      const profiles = data.profiles.filter(p => [p.name, p.group, p.host, p.username].join(' ').toLowerCase().includes(query));
      body.querySelector('[data-connections]').innerHTML = profiles.map(p => {
        const sessions = data.sessions.filter(s => s.profileId === p.id);
        return `<article class="remote-card"><strong>${escape(p.name)}</strong><small>${escape(p.group || '未分组')} · ${escape(p.username)}@${escape(p.host)}:${p.port}${p.jumpId ? ' · 经跳板机' : ''}${p.proxy?.host ? ' · 使用代理' : ''}</small><small>${sessions.length ? sessions.map(s => escape(s.id + ' / ' + s.status + ' / ' + (s.environment?.os || '连接中'))).join('，') : '未连接'}</small><div class="remote-actions"><button data-connect="${p.id}">连接新会话</button><button data-edit="${p.id}">编辑</button><button data-delete="${p.id}">删除</button>${sessions.map(s => `<button data-focus="${s.id}">切换 ${s.id}</button><button data-disconnect="${s.id}">断开 ${s.id}</button>`).join('')}</div></article>`;
      }).join('') || '<p class="remote-help">还没有匹配的连接。添加主机后即可登录，密码默认仅保留到本次退出。</p>';
      body.querySelectorAll('[data-connect]').forEach(b => b.onclick = wrap(async () => {
        b.disabled = true; notify('正在连接 SSH，首次连接请核对主机指纹…');
        try { const s = await term.openInDir(state.cwd, { sshProfile: b.dataset.connect, shell: 'cmd' }); if (s && !s.dead) { selected = s.id; notify('SSH 已连接：' + s.title); } else notify('连接失败，请查看终端错误', true); } finally { await refresh(); if (!panel.hidden && tab === 'connections') connections(); }
      }));
      body.querySelectorAll('[data-focus]').forEach(b => b.oncontextmenu = event => { event.preventDefault(); popupMenu(event, [{ label: '打开 AI 会话', fn: wrap(() => openAI(b.dataset.focus)) }]); });
      body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => profileForm(data.profiles.find(p => p.id === b.dataset.edit)));
      body.querySelectorAll('[data-delete]').forEach(b => b.onclick = wrap(async () => { if (!confirm('删除此 SSH 连接配置？')) return; await api('delete-profile', { id: b.dataset.delete }); await open('connections'); }));
      body.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => { term.open(); term.activate(b.dataset.focus); selected = b.dataset.focus; });
      body.querySelectorAll('[data-disconnect]').forEach(b => b.onclick = wrap(async () => { if (!confirm('断开该 SSH 会话及其文件传输？')) return; term.closeTab(b.dataset.disconnect); await open('connections'); }));
    };
    body.querySelector('input').oninput = draw; bind('[data-new]', () => profileForm()); draw();
  }
  function modal(title) {
    const dialog = document.createElement('dialog'); dialog.className = 'remote-dialog';
    dialog.innerHTML = `<header><h2>${escape(title)}</h2>${fanboxUI.closeButton("data-dismiss")}</header><div class="dialog-content"></div><p class="dialog-error" role="status"></p>`;
    document.body.append(dialog); dialog.querySelector('[data-dismiss]').onclick = () => dialog.close(); dialog.onclose = () => dialog.remove(); dialog.showModal(); return dialog;
  }
  function shortcutMenu(id) {
    const session = term.sessions.find(s => s.id === id);
    if (!session?.sshProfile) return [];
    const profile = data?.profiles.find(p => p.id === session.sshProfile);
    const commands = [...(profile?.shortcuts || [])].sort((a,b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    return [...commands.map(c => [(c.group ? c.group + ' / ' : '') + c.name, wrap(async () => { await api('run-shortcut', {sessionId:id,id:c.id});term.activate(id);session.xterm.focus();notify('已发送快捷命令：' + c.name); }), !!session.dead]), ['管理快捷命令…', () => shortcutManager(session.sshProfile), false]];
  }
  async function shortcutManager(profileId, create = false) {
    await refresh(); const profile = data.profiles.find(p=>p.id===profileId); if(!profile)return;
    const dialog = modal('快捷命令 · ' + profile.name), content=dialog.querySelector('.dialog-content');
    const act = fn => async () => {try{await fn();}catch(e){dialog.querySelector('.dialog-error').textContent=e.message;}};
    const items = () => data.profiles.find(p=>p.id===profileId)?.shortcuts || [];
    const draw = () => {
      const groups=[...new Set(items().map(c=>c.group))].sort();
      content.innerHTML='<div class="remote-actions"><button data-new-shortcut>＋ 新增快捷命令</button></div><p class="remote-help">仅供此 SSH 连接使用。多行命令按顺序输入当前终端，不等待每条命令完成；输出直接在终端查看。</p>' + (groups.map((g,i)=>'<section class="shortcut-group"><header><strong>'+escape(g||'未分组')+'</strong>'+(g?'<button data-rename-group="'+i+'">重命名</button><button data-ungroup="'+i+'">移除分组</button>':'')+'</header>'+items().filter(c=>c.group===g).map(c=>'<article class="remote-card"><strong>'+escape(c.name)+'</strong><pre class="shortcut-preview">'+escape(c.command)+'</pre><div class="remote-actions"><button data-shortcut-edit="'+c.id+'">编辑</button><button data-shortcut-delete="'+c.id+'">删除</button></div></article>').join('')+'</section>').join('')||'<p class="remote-help">尚未保存快捷命令。</p>');
      content.querySelector('[data-new-shortcut]').onclick=()=>edit();
      content.querySelectorAll('[data-shortcut-edit]').forEach(b=>b.onclick=()=>edit(items().find(c=>c.id===b.dataset.shortcutEdit)));
      content.querySelectorAll('[data-shortcut-delete]').forEach(b=>b.onclick=act(async()=>{if(!confirm('删除此快捷命令？'))return;await api('delete-shortcut',{profileId,id:b.dataset.shortcutDelete});await refresh();draw();}));
      content.querySelectorAll('[data-rename-group]').forEach(b=>b.onclick=()=>{
        const group=groups[Number(b.dataset.renameGroup)]; content.innerHTML='<form class="remote-form">'+field('name','分组名称',group,'text',true)+'<button type="submit">保存分组</button><button type="button" data-back>返回</button></form>';
        const form=content.querySelector('form');form.elements.name.required=true;form.querySelector('[data-back]').onclick=draw;form.onsubmit=event=>{event.preventDefault();act(async()=>{await api('rename-shortcut-group',{profileId,group,name:form.elements.name.value});await refresh();draw();})();};
      });
      content.querySelectorAll('[data-ungroup]').forEach(b=>b.onclick=act(async()=>{if(!confirm('移除分组？其中的快捷命令会保留在“未分组”。'))return;await api('rename-shortcut-group',{profileId,group:groups[Number(b.dataset.ungroup)],name:''});await refresh();draw();}));
    };
    const edit = (command={}) => {
      content.innerHTML='<form class="remote-form shortcut-form">'+field('name','快捷名称',command.name,'text',true)+field('group','分组（输入新名称即可创建）',command.group,'text',true)+'<datalist id="shortcut-groups">'+[...new Set(items().map(c=>c.group).filter(Boolean))].map(g=>'<option value="'+escape(g)+'">').join('')+'</datalist><label class="full">命令（支持多行）<textarea name="command" rows="8" spellcheck="false" required>'+escape(command.command||'')+'</textarea></label><div class="remote-actions full"><button type="submit">保存快捷命令</button><button type="button" data-back>返回列表</button></div></form>';
      const form=content.querySelector('form');form.elements.name.required=true;form.elements.name.maxLength=100;form.elements.group.maxLength=100;form.elements.command.maxLength=32000;form.elements.group.setAttribute('list','shortcut-groups');form.querySelector('[data-back]').onclick=draw;
      form.onsubmit=event=>{event.preventDefault();act(async()=>{await api('save-shortcut',{...values(form),profileId,id:command.id});await refresh();draw();})();};
    };
    create?edit():draw();
  }
  function profileForm(p = {}) {
    const dialog = modal(p.id ? '编辑 SSH 连接' : '新建 SSH 连接'), content = dialog.querySelector('.dialog-content');
    content.innerHTML = `<form class="remote-form profile-form"><nav class="profile-categories full"><button type="button" data-category="general">常规</button><button type="button" data-category="network">连接 / 代理</button><button type="button" data-category="permissions">AI 权限</button></nav>
      <section data-category-page="general" class="remote-form full">
      ${field('name', '会话名称', p.name)}${field('group', '分组（可选）', p.group)}${field('host', '主机', p.host)}${field('port', '端口', p.port || 22, 'number')}${field('username', '用户名', p.username)}
      ${select('auth', '认证方式', [['password', '密码'], ['key', '私钥']], p.auth || 'password')}
      <div data-password class="full">${field('password', p.hasCredentials ? '密码（留空使用已有凭据）' : '密码（可选，留空在终端输入）', '', 'password', true)}</div>
      <div data-key-fields class="remote-form full">${field('keyPath', '私钥路径', p.keyPath, 'text', true)}<button type="button" data-key>选择私钥文件</button>${field('passphrase', '私钥口令（可选）', '', 'password')}</div>
      ${check('remember', '记住凭据（使用系统加密保存）', p.remember)}${p.hasCredentials ? check('clearCredentials', '清除已有凭据，下次在终端输入', false) : '<input type="checkbox" name="clearCredentials" hidden>'}
      </section><section data-category-page="network" class="remote-form full" hidden>
      ${select('terminalType', '终端类型', [['xterm','xterm（兼容堡垒机）'],['xterm-256color','xterm-256color'],['vt100','VT100']], p.terminalType || 'xterm', true)}
      ${select('jumpId', '跳板机', [['', '直接连接'], ...data.profiles.filter(x => x.id !== p.id).map(x => [x.id, x.name])], p.jumpId || '', true)}
      ${select('proxyType', '代理（跳板连接的代理请在跳板会话设置）', [['', '不使用'], ['socks5', 'SOCKS5'], ['http', 'HTTP CONNECT']], p.proxy?.type || '', true)}
      <div data-proxy-fields class="remote-form full">${field('proxyHost', '代理主机', p.proxy?.host)}${field('proxyPort', '代理端口', p.proxy?.port || 1080, 'number')}${field('proxyUser', '代理用户名（可选）', p.proxy?.username)}${field('proxyPassword', '代理密码（可选）', '', 'password')}</div>
      </section><section data-category-page="permissions" class="remote-form full" hidden>
      ${select('mode', '此连接的默认 AI 权限', [['', '继承默认（确认后执行）'], ['read', '仅建议'], ['confirm', '确认后执行'], ['auto', '自动执行']], p.policy?.mode || '', true)}${check('interactive', '允许 AI 使用交互式终端（输入前确认）', p.policy?.interactive)}
      </section><div class="remote-actions full"><button type="submit">保存连接</button></div></form>`;
    const form = content.querySelector('form');
    const update = () => { form.querySelector('[data-password]').hidden = form.elements.auth.value !== 'password'; form.querySelector('[data-key-fields]').hidden = form.elements.auth.value !== 'key'; form.querySelector('[data-proxy-fields]').hidden = !form.elements.proxyType.value; }; update();
    form.elements.auth.onchange = update; form.elements.proxyType.onchange = update;
    form.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { form.querySelectorAll('[data-category-page]').forEach(page => page.hidden = page.dataset.categoryPage !== b.dataset.category); });
    form.querySelector('[data-key]').onclick = wrap(async () => { const filename = await api('pick-key'); if (filename) form.elements.keyPath.value = filename; });
    form.onsubmit = async event => { event.preventDefault(); try { const v = values(form); await api('save-profile', { ...v, id: p.id, remember: form.elements.remember.checked, clearCredentials: form.elements.clearCredentials.checked, proxy: v.proxyType ? { type: v.proxyType, host: v.proxyHost, port: Number(v.proxyPort), username: v.proxyUser } : null, policy: v.mode ? { mode: v.mode, interactive: form.elements.interactive.checked } : null }); dialog.close(); await refresh(); if (!panel.hidden && tab === 'connections') connections(); notify('连接配置已保存'); } catch (error) { dialog.querySelector('.dialog-error').textContent = error.message; } };
  }
  async function modelSettings() {
    await refresh(); const dialog = modal('AI 配置'), content = dialog.querySelector('.dialog-content');
    const draw = () => {
      content.innerHTML = '<div class="remote-actions"><button data-add-model>＋ 新增 AI 配置</button></div><p class="remote-help">' + (data.ai.name ? `当前启用：${escape(data.ai.name)} · ${escape(data.ai.model)}` : '当前未启用 AI 配置，无法发起新任务。') + '。切换或停用对新任务生效；正在运行的任务请在聊天页停止。</p>' + (data.aiConfigs.map(c => `<article class="remote-card"><strong>${escape(c.name)} · ${c.active ? '已启用' : '未启用'}</strong><small>${escape(c.protocol === 'anthropic' ? 'Anthropic / Claude' : 'OpenAI 兼容')} · ${escape(c.model)}</small><small>${escape(c.baseUrl)}</small><div class="remote-actions"><button ${c.active ? 'data-deactivate' : 'data-activate'}="${c.id}" aria-label="${c.active ? '停用' : '启用'} ${escape(c.name)}">${c.active ? '停用' : '启用'}</button><button data-model-edit="${c.id}">编辑</button><button data-model-delete="${c.id}">删除</button></div></article>`).join('') || '<p class="remote-help">添加模型服务配置后，即可在终端 AI 会话中使用。</p>');
      content.querySelector('[data-add-model]').onclick = () => edit();
      content.querySelectorAll('[data-model-edit]').forEach(b => b.onclick = () => edit(data.aiConfigs.find(c => c.id === b.dataset.modelEdit)));
      const action = async fn => { try { await fn(); await refresh(); draw(); } catch (e) { dialog.querySelector('.dialog-error').textContent = e.message; } };
      content.querySelectorAll('[data-activate]').forEach(b => b.onclick = () => action(() => api('activate-ai', { id: b.dataset.activate })));
      content.querySelectorAll('[data-deactivate]').forEach(b => b.onclick = () => action(() => api('deactivate-ai', { id: b.dataset.deactivate })));
      content.querySelectorAll('[data-model-delete]').forEach(b => b.onclick = () => { if (confirm('删除此 AI 配置？')) action(() => api('delete-ai', { id: b.dataset.modelDelete })); });
    };
    const edit = (c = {}) => {
      content.innerHTML = `<form class="remote-form model-form">${field('name', '配置名称', c.name, 'text', true)}${select('protocol', 'API 协议', [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic / Claude']], c.protocol || 'openai', true)}${field('baseUrl', 'API 基础地址', c.baseUrl || 'https://api.openai.com/v1', 'url', true)}${field('apiKey', c.hasKey ? 'API 密钥（已保存，留空保留）' : 'API 密钥', '', 'password', true)}${check('clearKey', '清除已保存密钥', false)}${check('activate', '保存后启用', !data.aiConfigs.length || c.active)}<div class="full model-discovery"><div class="remote-actions"><button type="button" data-fetch-models>获取所有模型</button><span data-model-status role="status"></span></div><div data-model-slots class="remote-form"></div></div><p class="remote-help full">支持 HTTP / HTTPS。一份服务配置共用地址与密钥，获取模型后按用途选择，也可手动输入。Claude 的三个位置允许选择相同模型；默认用途决定内置 AI 对话使用的模型。CLI 自身的配置不会被改写。切换配置对下一轮对话生效。</p><div class="remote-actions full"><button type="submit">保存配置</button><button type="button" data-model-back>返回列表</button></div></form>`;
      const form = content.querySelector('form'); form.elements.name.required = true;
      const slots = form.querySelector('[data-model-slots]'), status = form.querySelector('[data-model-status]');
      let generation = 0, models = [], draft = { model: c.model || '', ...c.modelSlots }, role = c.defaultRole || 'sonnet';
      const capture = () => { for (const input of slots.querySelectorAll('[data-slot]')) draft[input.name] = input.value; if (form.elements.defaultRole) role = form.elements.defaultRole.value; };
      const renderSlots = () => {
        const anthropic = form.elements.protocol.value === 'anthropic';
        const entries = anthropic ? [['haiku','Haiku 模型'],['sonnet','Sonnet 模型'],['opus','Opus 模型']] : [['model','默认模型']];
        if (anthropic && !draft.sonnet) draft.sonnet = draft.model;
        slots.innerHTML = entries.map(([key,label]) => '<label class="full">' + label + (models.length ? '<select data-slot name="'+key+'"><option value="">请选择模型</option>' + [...new Set([draft[key],...models.map(m=>m.id)].filter(Boolean))].map(id=>'<option value="'+escape(id)+'" '+(draft[key]===id?'selected':'')+'>'+escape(id)+'</option>').join('') + '</select>' : '<input data-slot name="'+key+'" value="'+escape(draft[key]||'')+'" placeholder="输入模型名称">') + '</label>').join('') + (anthropic ? select('defaultRole','内置 AI 默认用途',[['haiku','Haiku'],['sonnet','Sonnet'],['opus','Opus']],role,true) : '') + (models.length ? '<button type="button" data-manual-model>改为手动输入模型</button>' : '');
        slots.querySelector('[data-manual-model]')?.addEventListener('click',()=>{capture();models=[];renderSlots();});
      };
      renderSlots();
      form.elements.protocol.onchange = () => { capture(); if (['https://api.openai.com/v1', 'https://api.anthropic.com'].includes(form.elements.baseUrl.value)) form.elements.baseUrl.value = form.elements.protocol.value === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'; models=[];renderSlots(); };
      form.querySelector('[data-model-back]').onclick = draw;
      const requestConfig = () => ({ ...values(form), id: c.id, clearKey: form.elements.clearKey.checked });
      for (const key of ['baseUrl','protocol','apiKey','clearKey']) form.elements[key].addEventListener('input',()=>{generation++;capture();models=[];status.textContent='';renderSlots();});
      form.querySelector('[data-fetch-models]').onclick = async event => {
        const button=event.currentTarget,current=++generation;button.disabled=true;status.textContent='正在获取模型…';dialog.querySelector('.dialog-error').textContent='';
        try { const result=await api('list-ai-models',requestConfig());if(!form.isConnected || !dialog.open || current!==generation)return;capture();models=result;renderSlots();status.textContent=models.length?'已获取 '+models.length+' 个模型，请在对应位置选择':'未返回模型，请手动输入'; }
        catch(error){if(form.isConnected && current===generation){status.textContent=error.message;dialog.querySelector('.dialog-error').textContent=error.message;}}
        finally{button.disabled=false;}
      };
      form.onsubmit = async event => { event.preventDefault(); capture(); const anthropic=form.elements.protocol.value==='anthropic';const modelSlots=anthropic?{haiku:draft.haiku||'',sonnet:draft.sonnet||'',opus:draft.opus||''}:{}; const model=anthropic?modelSlots[role]:draft.model;
        if(!model?.trim()){dialog.querySelector('.dialog-error').textContent='请选择或填写默认用途对应的模型';return;}
        try { await api('save-ai', { ...requestConfig(), model, modelSlots, defaultRole:anthropic?role:'', activate:form.elements.activate.checked }); await refresh();draw(); } catch(e){dialog.querySelector('.dialog-error').textContent=e.message;}
      };

    }; draw();
    dialog.addEventListener('close', () => { if (!panel.hidden && tab === 'ai') wrap(async () => { await refresh(); await render(); })(); });
  }
  function sessions(remoteOnly) { return term.sessions.filter(s => !s.dead && (!remoteOnly || s.sshProfile)); }
  function chooseTarget(remoteOnly) {
    const all = sessions(remoteOnly);
    if (!all.some(s => s.id === selected)) selected = all.find(s => s.id === term.active)?.id || all[0]?.id || '';
    return select('target', '目标会话', all.map(s => [s.id, `${s.title} · ${s.sshProfile ? 'SSH' : s.shell} · ${s.id}`]), selected, true);
  }
  const join = (base, name) => (base === '/' ? '' : base.replace(/\/$/, '')) + '/' + name;
  async function files(rev) {
    body.innerHTML = `<div class="remote-form">${chooseTarget(true)}</div><div class="remote-actions"><button data-refresh>刷新</button><button data-up title="上级目录" aria-label="上级目录">↑</button><button data-upload>上传文件</button></div><nav class="remote-breadcrumb" aria-label="远程路径"></nav><input class="remote-search" data-path value="${escape(directory)}" aria-label="远程目录"><div data-files></div><div data-transfers></div>`;
    body.querySelector('[name=target]').onchange = wrap(async event => { selected = event.target.value; directory = '.'; filePage = 0; await render(); });
    bind('[data-refresh]', () => { directory = body.querySelector('[data-path]').value; filePage = 0; return render(); });
    bind('[data-up]', () => { directory = directory.slice(0, directory.lastIndexOf('/')) || '/'; filePage = 0; return render(); });
    body.querySelector('[data-path]').onkeydown = wrap(async event => { if (event.key === 'Enter') { directory = event.target.value; filePage = 0; await render(); } });
    bind('[data-upload]', () => transfer('upload', directory));
    drawTransfers();
    if (!selected) { body.querySelector('[data-files]').textContent = '请先连接 SSH 会话。'; return; }
    const result = await api('list', { id: selected, path: directory }); if (rev !== revision) return;
    directory = result.path; body.querySelector('[data-path]').value = directory;
    const parts = directory.split('/').filter(Boolean), ancestors = [{ label: '/', path: '/' }];
    parts.forEach((part,i) => ancestors.push({ label: part, path: '/' + parts.slice(0,i+1).join('/') }));
    body.querySelector('.remote-breadcrumb').innerHTML = ancestors.map((a,i) => `<button data-ancestor="${i}" title="${escape(a.path)}">${escape(a.label)}</button>`).join('<span>/</span>');
    body.querySelectorAll('[data-ancestor]').forEach(b => b.onclick = wrap(async () => { directory = ancestors[Number(b.dataset.ancestor)].path; filePage = 0; await render(); }));
    body.querySelector('[data-files]').innerHTML = `<p class="remote-help">${escape(term.sessions.find(s => s.id === selected)?.title)} · ${result.entries.length} 项。文件“编辑”保存会写入远端。</p><table class="remote-files">${result.entries.slice(filePage * 200, (filePage + 1) * 200).map((e, index) => { const i = filePage * 200 + index; return `<tr data-entry="${i}" tabindex="0"><td class="name">${e.directory ? '📁' : '📄'} ${escape(e.name)}<div class="remote-help">${e.directory ? '文件夹' : e.size + ' B'} · ${new Date(e.mtime * 1000).toLocaleString()}</div></td><td>${e.directory ? `<button data-dir="${i}">打开</button>` : `<button data-download="${i}">下载</button><button data-edit-file="${i}">编辑</button>`}</td></tr>`; }).join('')}</table><div class="remote-actions"><button data-prev-page ${filePage === 0 ? 'disabled' : ''}>上一页</button><span>第 ${filePage + 1} 页</span><button data-next-page ${(filePage + 1) * 200 >= result.entries.length ? 'disabled' : ''}>下一页</button></div>`;
    const enterEntry = async i => { const entry = result.entries[i]; if (entry.directory) { directory = join(directory, entry.name); filePage = 0; await render(); } else await editFile(join(directory, entry.name)); };
    body.querySelectorAll('[data-entry]').forEach(row => { row.ondblclick = wrap(event => { if (!event.target.closest('button')) return enterEntry(Number(row.dataset.entry)); }); row.onkeydown = wrap(event => { if (event.key === 'Enter' && event.target === row) return enterEntry(Number(row.dataset.entry)); }); });
    bind('[data-prev-page]', () => { filePage--; return render(); }); bind('[data-next-page]', () => { filePage++; return render(); });
    body.querySelectorAll('[data-dir]').forEach(b => b.onclick = wrap(async () => { directory = join(directory, result.entries[Number(b.dataset.dir)].name); filePage = 0; await render(); }));
    body.querySelectorAll('[data-download]').forEach(b => b.onclick = wrap(() => transfer('download', join(directory, result.entries[Number(b.dataset.download)].name))));
    body.querySelectorAll('[data-edit-file]').forEach(b => b.onclick = wrap(() => editFile(join(directory, result.entries[Number(b.dataset.editFile)].name))));
  }
  async function editFile(filename) {
    const sessionId = selected, rev = ++revision, value = await api('read', { id: sessionId, path: filename }); if (rev !== revision) return;
    body.innerHTML = `<div class="remote-target">${escape(term.sessions.find(s => s.id === sessionId)?.title)}\n${escape(filename)}</div><textarea class="remote-editor" spellcheck="false" aria-label="远程文件编辑器"></textarea><div class="remote-actions"><button data-save>保存到远端</button><button data-back>返回文件列表</button></div>`;
    const editor = body.querySelector('textarea'); editor.value = value.text; dirtyEditor = () => editor.value !== value.text;
    bind('[data-save]', async () => { await api('write', { id: sessionId, path: filename, text: editor.value, expected: { mtime: value.mtime, size: value.size, hash: value.hash } }); dirtyEditor = () => false; notify('远程文件已保存'); await editFile(filename); });
    bind('[data-back]', async () => { if (dirtyEditor() && !confirm('放弃尚未保存的修改？')) return; dirtyEditor = () => false; await render(); });
  }
  async function transfer(direction, remote, retry) {
    if (!selected) throw Error('请先选择 SSH 会话');
    const id = crypto.randomUUID(), sessionId = retry?.sessionId || selected;
    transfers.set(id, { id, sessionId, direction, remote, status: '选择文件', transferred: 0 }); drawTransfers();
    try { const result = await api('transfer', { id, sessionId, direction, remote }); if (result.cancelled) transfers.delete(id); notify(result.cancelled ? '已取消' : '文件传输完成'); }
    catch (e) { const item = transfers.get(id); if (item && item.status !== 'cancelled') { item.status = 'failed'; item.error = e.message; } throw e; }
    finally { drawTransfers(); }
  }
  function drawTransfers() {
    const container = body.querySelector('[data-transfers]'); if (!container) return;
    container.innerHTML = [...transfers.values()].slice(-20).map(t => `<div class="remote-transfer">${escape(t.direction + ' · ' + t.remote)}<br>${escape(t.status)} ${t.transferred || 0} / ${t.total || '?'} B ${escape(t.error || '')}<progress max="${t.total || 1}" value="${t.transferred || 0}"></progress>${t.status === 'running' ? `<button data-cancel-transfer="${t.id}">取消</button>` : ['failed', 'cancelled'].includes(t.status) ? `<button data-retry="${t.id}">重试（重新选择本地文件）</button>` : ''}</div>`).join('');
    container.querySelectorAll('[data-cancel-transfer]').forEach(b => b.onclick = wrap(() => api('cancel-transfer', { id: b.dataset.cancelTransfer })));
    container.querySelectorAll('[data-retry]').forEach(b => b.onclick = wrap(() => { const t = transfers.get(b.dataset.retry); return transfer(t.direction, t.direction === 'upload' ? t.remote.slice(0, t.remote.lastIndexOf('/')) || '/' : t.remote, t); }));
  }
  async function aiView(rev) {
    const targetOptions = chooseTarget(false), current = chat(selected);
    if (selected && !current.conversationId && !current.runId) {
      const record = await api('history-open', { sessionId: selected });
      current.conversationId = record.id; current.items = record.items; current.visibleCount = 100;
      if (rev !== revision) return;
    }
    body.innerHTML = `<div class="ai-session-bar" role="tablist" aria-label="AI 会话">${sessions(false).map(session => `<button role="tab" aria-selected="${session.id === selected}" data-chat-session="${session.id}" title="${escape(session.title)}">${escape(session.title)}<small>${session.sshProfile ? 'SSH' : escape(session.shell || 'Shell')}</small></button>`).join('')}<button data-chat-add title="打开其他会话" aria-label="打开其他会话">＋</button></div><div class="remote-log" aria-label="AI 对话" tabindex="0"></div><div class="chat-progress" role="status" hidden></div><div class="chat-composer"><textarea class="remote-prompt" placeholder="输入消息，Enter 发送" aria-label="AI 任务"></textarea><div class="chat-input-actions"><details class="chat-options"><summary title="会话选项" aria-label="会话选项">☰</summary><div class="chat-options-menu"><div class="remote-target" data-environment>正在读取目标…</div><div class="chat-model">${escape(data.ai.name || '请在设置中配置模型')} · ${escape(data.ai.model || '')}</div><div class="remote-form">${targetOptions}${select('mode', '执行权限', [['read', '仅建议'], ['confirm', '确认后执行'], ['auto', '自动执行']], 'confirm', true)}${check('interactive', '允许 AI 交互式终端', false)}${check('context', '发送终端最近 16 KB 内容', current.context)}</div><div class="chat-menu-actions"><button data-takeover title="接管终端" aria-label="接管终端">⌨ <span>接管终端</span></button><button data-clear title="清空当前对话" aria-label="清空当前对话">↻ <span>清空对话</span></button><button data-chat-files title="远程文件" aria-label="远程文件">▤ <span>远程文件</span></button><button data-chat-exit title="返回文件浏览" aria-label="返回文件浏览">↩ <span>返回文件浏览</span></button></div></div></details><button data-permission-pill class="permission-pill" title="设置当前会话执行权限">读取权限…</button><span class="chat-input-hint">Shift + Enter 换行</span><button data-stop title="停止 AI" aria-label="停止 AI">■</button><button data-run title="发送消息" aria-label="发送消息">↑</button></div></div>`;
    body.querySelectorAll('[data-chat-session]').forEach(b => b.onclick = wrap(() => openAI(b.dataset.chatSession)));
    body.querySelector('.ai-session-bar').insertAdjacentHTML('beforeend', '<button data-chat-history title="查看、继续或删除历史对话" aria-label="会话历史">◷ 会话历史</button><button data-chat-new title="新建对话" aria-label="新建对话">✎ 新对话</button>');
    bind('[data-chat-history]', historyDialog);
    bind('[data-chat-new]', newConversation);
    bind('[data-chat-add]', event => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); popupMenu({ clientX: r.left, clientY: r.bottom }, [...sessions(false).map(session => ({ label: session.title + ' · ' + session.id, fn: wrap(() => openAI(session.id)) })), { label: '新建本地终端会话', fn: wrap(async () => { const session = await term.openInDir(state.cwd); if (session) await openAI(session.id); }) }, { label: 'SSH 会话管理', fn: wrap(async () => { managerExpanded = true; await refresh(); await open('connections'); }) }]); });
    bind('[data-permission-pill]', () => { body.querySelector('.chat-options').open = !body.querySelector('.chat-options').open; });
    bind('[data-chat-files]', () => open('files')); bind('[data-chat-exit]', close);
    const prompt = body.querySelector('.remote-prompt'); prompt.value = current.prompt; prompt.oninput = () => { current.prompt = prompt.value; };
    prompt.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); wrap(startAI)(); } };
    body.querySelector('[name=context]').onchange = event => { current.context = event.target.checked; };
    body.querySelector('[name=target]').onchange = wrap(event => openAI(event.target.value));
    const updatePolicy = wrap(async () => { current.policy = await api('policy', { id: selected, policy: { mode: body.querySelector('[name=mode]').value, interactive: body.querySelector('[name=interactive]').checked } }); drawLog(); notify('权限已更新，执行中的任务也会重新检查权限'); });
    body.querySelector('[name=mode]').onchange = updatePolicy; body.querySelector('[name=interactive]').onchange = updatePolicy; body.querySelector('[name=interactive]').setAttribute('role', 'switch');
    bind('[data-run]', startAI); bind('[data-stop]', async () => { if (chat(selected).runId) await api('ai-stop', { id: chat(selected).runId }); });
    bind('[data-takeover]', async () => { if (chat(selected).runId) await api('ai-takeover', { id: chat(selected).runId }); term.open(); term.activate(selected); term.sessions.find(s => s.id === selected)?.xterm.focus(); });
    bind('[data-clear]', newConversation);
    body.querySelector('[data-clear]').title = '新建对话（保留历史）'; body.querySelector('[data-clear] span').textContent = '新建对话'; drawLog();
    if (!selected) { body.querySelector('[data-environment]').textContent = '请打开本地终端或连接 SSH 会话。'; return; }
    const [env, policy] = await Promise.all([api('target', { id: selected }), api('policy', { id: selected })]); if (rev !== revision) return;
    current.policy = policy; drawLog();
    body.querySelector('[name=mode]').value = policy.mode; body.querySelector('[name=interactive]').checked = policy.interactive;
    body.querySelector('[data-environment]').textContent = `${env.host} · ${env.os} · ${env.shell}\n命令直接在右侧终端执行，继承当前目录和环境。${env.interactiveTargetUnknown ? '\n检测到手动环境切换，执行前需重新确认目标。' : ''}`;
  }
  function addItem(current, kind, text = '', key = crypto.randomUUID()) {
    let item = current.items.find(item => item.key === key);
    if (!item) { item = { key, kind, text, reasoning: '' }; current.items.push(item); }
    return item;
  }
  async function restoreConversation(id, fresh = false) {
    if (!selected) throw Error('请先打开目标终端');
    const sessionId = selected, current = chat(sessionId);
    if (current.runId) throw Error('请先停止当前 AI 任务');
    const record = await api('history-open', { sessionId, id, fresh });
    current.conversationId = record.id; current.items = record.items; current.lastRunId = ''; current.prompt = ''; current.visibleCount = 100;
    if (selected === sessionId) await render();
  }
  async function newConversation() { await restoreConversation(undefined, true); }
  async function historyDialog() {
    if (!selected) throw Error('请先选择对应的终端会话');
    const historySession = selected;
    const dialog = modal('会话历史'), content = dialog.querySelector('.dialog-content');
    const action = fn => async () => { try { await fn(); } catch (error) { dialog.querySelector('.dialog-error').textContent = error.message; } };
    const draw = async () => {
      const result = await api('history-list', { sessionId: historySession });
      content.innerHTML = result.warnings.map(w => `<p class="dialog-error">${escape(w)}</p>`).join('') + '<div class="history-table-wrap"><table class="remote-files history-table"><thead><tr><th>会话</th><th>更新时间</th><th>状态</th><th>操作</th></tr></thead><tbody>' + (result.records.map(r => `<tr><td>${escape(r.title)}</td><td>${escape(new Date(r.updatedAt).toLocaleString())}</td><td>${r.running ? '运行中' : '已保存'}</td><td><button data-history-read="${r.id}">查看</button><button data-history-resume="${r.id}" ${r.running ? 'disabled' : ''}>继续</button><button data-history-delete="${r.id}" ${r.running ? 'disabled' : ''}>删除</button></td></tr>`).join('') || '<tr><td colspan="4">当前会话暂无历史记录</td></tr>') + '</tbody></table></div>';
      content.querySelectorAll('[data-history-resume]').forEach(button => {
        const record = result.records.find(r => r.id === button.dataset.historyResume);
        if (record.boundSessionId && record.boundSessionId !== selected) { button.disabled = true; button.textContent = '已绑定其他终端'; button.title = '可查看记录；继续对话请回到原终端，或关闭原终端后再恢复'; }
        button.onclick = action(async () => { await restoreConversation(button.dataset.historyResume); dialog.close(); });
      });
      content.querySelectorAll('[data-history-delete]').forEach(button => button.onclick = action(async () => { if (!confirm('删除这段会话历史？')) return; const id = button.dataset.historyDelete; await api('history-delete', { id, sessionId: historySession }); for (const current of chats.values()) if (current.conversationId === id) { current.conversationId = ''; current.items = []; } await draw(); }));
      content.querySelectorAll('[data-history-read]').forEach(button => button.onclick = action(async () => {
        const record = await api('history-read', { id: button.dataset.historyRead, sessionId: historySession });
        content.innerHTML = '<button data-history-back>← 返回历史列表</button><div class="history-transcript"></div>';
        const transcript = content.querySelector('.history-transcript');
        for (const item of record.items) {
          const node = document.createElement('article'); node.className = 'chat-message chat-' + item.kind;
          const author = document.createElement('div'); renderChatAuthor(author, item.kind); node.append(author); const messageBody = document.createElement('div'); messageBody.className = 'chat-content'; node.append(messageBody);
          if (item.reasoning) { const details = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('div'); summary.textContent = '思考 / 分析'; text.textContent = item.reasoning; details.append(summary, text); messageBody.append(details); }
          const text = document.createElement('div'); text.className = 'chat-message-text'; text.textContent = item.text; messageBody.append(text); transcript.append(node);
        }
        content.querySelector('[data-history-back]').onclick = action(draw);
      }));
    };
    dialog.addEventListener('close', () => { if (!panel.hidden && tab === 'ai') wrap(render)(); }); await draw();
  }
  function drawLog() {
    const current = chat(selected), element = body.querySelector('.remote-log');
    if (!panel.hidden && tab === 'ai') current.unread = false;
    if (element) {
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      if (!current.items.length) element.innerHTML = '<div class="chat-empty"><span>✦</span><strong>和当前终端一起工作</strong><p>描述目标，执行过程会在这里显示。<br>命令输出请在右侧终端查看。</p></div>';
      else {
        element.querySelector('.chat-empty')?.remove();
        const visible = current.items.slice(-(current.visibleCount || 100));
        const keys = new Set(visible.map(item => item.key));
        for (const child of [...element.children]) if (!keys.has(child.dataset.messageId)) child.remove();
        for (const item of visible) {
          let node = [...element.children].find(child => child.dataset.messageId === item.key);
          if (!node) {
            node = document.createElement('article'); node.dataset.messageId = item.key; node.className = 'chat-message chat-' + item.kind;
            node.innerHTML = '<div class="chat-author"></div><div class="chat-content"><details class="chat-reasoning"><summary>思考 / 分析</summary><div></div></details><div class="chat-message-text"></div></div>';
            renderChatAuthor(node.querySelector('.chat-author'), item.kind);
            if (item.kind === 'command') { const copy = document.createElement('button'); copy.className = 'chat-copy'; copy.textContent = '⧉'; copy.title = '复制命令'; copy.onclick = wrap(() => navigator.clipboard.writeText(item.text)); node.append(copy); }
            element.append(node);
          }
          const details = node.querySelector('.chat-reasoning'); details.hidden = !item.reasoning;
          const analysis = details.querySelector('div'); if (!analysis.textContent && item.reasoning) details.open = true; if (analysis.textContent !== item.reasoning) analysis.textContent = item.reasoning;
          const content = node.querySelector('.chat-message-text'); if (content.textContent !== item.text) content.textContent = item.text;
          node.classList.toggle('is-thinking', !!item.thinking);
        }
        if (current.items.length > visible.length) {
          const more = document.createElement('button'); more.textContent = '加载更早的消息';
          more.onclick = () => { const before = element.scrollHeight; current.visibleCount = (current.visibleCount || 100) + 100; drawLog(); element.scrollTop += element.scrollHeight - before; };
          element.prepend(more);
        }
      }
      if (atBottom) element.scrollTop = element.scrollHeight;
    }
    const progress = body.querySelector('.chat-progress'); if (progress) {
      progress.hidden = !current.runId;
      if (!progress.querySelector('[data-progress-text]')) {
        progress.innerHTML = '<span data-progress-text></span><button data-wait title="继续等待" aria-label="继续等待">◷</button><button data-resume title="让 AI 继续" aria-label="让 AI 继续">▶</button><button data-progress-takeover title="接管终端，保留运行中的命令" aria-label="接管终端">⌨</button>';
        progress.querySelector('[data-wait]').onclick = () => { notify('正在持续监听，不会重复执行命令'); };
        progress.querySelector('[data-resume]').onclick = wrap(() => api('ai-resume', { id: chat(selected).runId }));
        progress.querySelector('[data-progress-takeover]').onclick = () => body.querySelector('[data-takeover]').click();
      }
      progress.querySelector('[data-progress-text]').textContent = current.progress || '正在连接模型…';
      progress.querySelector('[data-resume]').hidden = !current.paused;
      progress.querySelector('[data-wait]').hidden = !!current.paused;
      progress.querySelector('[data-progress-takeover]').hidden = !!current.paused;
    }
    body.querySelectorAll('[data-chat-session]').forEach(button => {
      const other = chat(button.dataset.chatSession), badge = button.querySelector('.chat-task-badge') || button.appendChild(document.createElement('span'));
      badge.className = 'chat-task-badge'; badge.textContent = other.runId ? other.paused ? ' · 已接管' : ' · 运行中' : other.unread ? ' · 已结束' : '';
    });
    const pill = body.querySelector('[data-permission-pill]');
    if (pill) { const p = current.policy; pill.textContent = !p ? '读取权限…' : p.mode === 'read' || !p.interactive ? '◉ 仅聊天' : p.mode === 'auto' ? '◉ 自动执行' : '◉ 确认后执行'; pill.classList.toggle('enabled', !!p && p.mode !== 'read' && p.interactive); }
    const run = body.querySelector('[data-run]'); if (run) run.disabled = !!current.runId || !selected;
    const stop = body.querySelector('[data-stop]'); if (stop) { stop.disabled = !current.runId; stop.hidden = !current.runId; stop.title = '停止命令及 AI（发送 Ctrl+C）'; stop.setAttribute('aria-label', stop.title); }
  }
  async function startAI() {
    if (chat(selected).runId) throw Error('当前会话已有任务在执行'); if (!selected) throw Error('请选择目标会话');
    const current = chat(selected), prompt = current.prompt.trim(); if (!prompt) return;
    let context = ''; const session = term.sessions.find(s => s.id === selected);
    if (!session || session.dead || session.authenticating) throw Error('请等待终端连接完成');
    if (current.context) { const b = session.xterm.buffer.active; for (let i = Math.max(0, b.length - 200); i < b.length; i++) context += b.getLine(i).translateToString(true) + '\n'; }
    const id = crypto.randomUUID(), sessionId = selected; current.runId = id; current.lastRunId = id; current.paused = false; current.unread = false;
    addItem(current, 'user', prompt); current.progress = '正在连接模型…'; current.prompt = ''; body.querySelector('.remote-prompt').value = ''; drawLog();
    let outcome = 'AI 本轮已结束，请在右侧终端查看命令结果';
    try { const result = await api('ai-run', { id, sessionId, conversationId: current.conversationId, prompt, context: context.slice(-16000) }); current.conversationId = result.conversationId || current.conversationId; if (result.pending) { outcome = '命令未确认结束，已暂停后续执行；请查看终端或接管'; addItem(current, 'notice', outcome); } else if (result.noToolsReason) { outcome = result.noToolsReason; addItem(current, 'notice', result.noToolsReason + (result.noToolsReason.includes('权限') || result.noToolsReason.includes('仅建议') ? '。点击输入框旁的权限按钮可设置。' : '。如果您要求执行操作，请检查模型是否支持工具调用。')); } }
    catch (error) { outcome = error.message; addItem(current, 'error', error.message); throw error; }
    finally { current.runId = ''; current.paused = false; current.unread = selected !== sessionId || panel.hidden; current.items.forEach(item => item.thinking = false); if (selected === sessionId) notify(outcome); drawLog(); }
  }
  window.addEventListener('terminal-active', event => { if (!panel.hidden && tab === 'ai' && selected !== event.detail) { selected = event.detail; wrap(render)(); } });
  wrap(refresh)();
  window.addEventListener('beforeunload', event => { if (dirtyEditor()) { event.preventDefault(); event.returnValue = ''; } });
  window.fanboxRemote.on('status', message => { drawSessionTree(); if (!panel.hidden) notify(`SSH ${message.id}：${message.status}${message.error ? ' · ' + message.error : ''}`); });
  window.fanboxRemote.on('transfer', message => { transfers.set(message.id, { ...transfers.get(message.id), ...message }); drawTransfers(); });
  window.fanboxRemote.on('im-task', message => { const current=chat(message.sessionId); current.runId=message.id; current.lastRunId=message.id; current.conversationId=message.conversationId; addItem(current,'user',message.prompt); drawLog(); });
  window.fanboxRemote.on('im-task-done', message => { const current=chat(message.sessionId); if(current.runId===message.id) {current.runId=''; current.progress='本轮远程任务结束'; drawLog();} });
  window.fanboxRemote.on('ai', message => {
    const current = chat(message.sessionId);
    if (message.id !== current.lastRunId) return;
    const key = message.id + ':' + (message.step || 1);
    if (message.type === 'status' || message.type === 'control') {
      if (message.paused !== undefined) current.paused = message.paused;
      current.progress = current.paused && !message.paused ? '已接管终端，AI 后续操作已暂停' : message.text;
      if (message.reminder) addItem(current, 'notice', '命令已运行超过 5 分钟，仍在监听。您可以继续等待、停止命令或接管终端。');
      if (selected === message.sessionId) notify(current.progress);
    }
    else if (message.type === 'analysis-start') { const item = addItem(current, 'assistant', '', key); item.thinking = true; }
    else if (message.type === 'analysis-end') { const item = current.items.find(item => item.key === key); if (item) item.thinking = false; }
    else if (message.type === 'command') addItem(current, 'command', message.text);
    else if (message.type === 'message' || message.type === 'text-delta') { const item = addItem(current, 'assistant', '', key); item.text = (item.text + message.text).slice(-100000); }
    else if (message.type === 'reasoning-delta') { const item = addItem(current, 'assistant', '', key); item.reasoning = (item.reasoning + message.text).slice(-64000); }
    if (!logFrame) logFrame = requestAnimationFrame(() => { logFrame = null; drawLog(); });
  });
})();
