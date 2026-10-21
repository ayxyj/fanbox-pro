'use strict';
const { RemoteStore } = require('./remote-store');
const { SSHService } = require('./ssh-service');
const { ShellAI } = require('./shell-ai');
const { WecomService } = require('./wecom-service');
const { ChatHistory } = require('./chat-history');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { noteInput } = require('./shell-context');

function installRemoteWorkspace({ app, ipcMain, dialog, safeStorage, getWindow, terminals, terminalCwds, port, onIMState = () => {} }) {
  const directory = process.env.GITSYNC_HOME || path.join(os.homedir(), '.fanbox-pro-win');
  const store = new RemoteStore(directory, safeStorage);
  const history = new ChatHistory(directory), historyRuns = new Map(), historySessions = new Map(), activeHistories = new Map();
  const imScopes = new Map();
  let im; const runEvents = new Map(), terminalRequests = new Map();
  const outputListeners = new Map();
  const publishOutput = (id, text) => { for (const fn of outputListeners.get(id) || []) fn(text); };
  const subscribeOutput = (id, fn) => { if (!outputListeners.has(id)) outputListeners.set(id, new Set()); outputListeners.get(id).add(fn); return () => { const listeners = outputListeners.get(id); listeners?.delete(fn); if (!listeners?.size) outputListeners.delete(id); }; };
  const emit = (channel, data) => {
    if(channel==='remote:im')onIMState(data);
    if (channel === 'remote:ai') runEvents.get(data.id)?.(data);
    if (channel === 'remote:ai' && historyRuns.has(data.id)) history.event(historyRuns.get(data.id), data);
    if (channel === 'pty:data') publishOutput(data.id, data.data);
    if (channel === 'pty:exit') {
      im?.closed(data.id); history.release(data.id); activeHistories.delete(data.id);
      if (terminals.get(data.id)?.remote) terminals.delete(data.id);
      for (const [runId, controller] of ai.runs) if (controller.sessionId === data.id) ai.stop(runId, 'disconnected');
    }
    const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  const confirm = async (message, detail) => (await dialog.showMessageBox(getWindow(), { type: 'warning', message, detail, buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 })).response === 1;
  const challenges = new Map();
  const approvals = new Map();
  const confirmAI = (message, detail, { signal, ...context } = {}) => new Promise(resolve => {
    const win = getWindow();
    if (!win || win.isDestroyed() || signal?.aborted) return resolve(false);
    const token = crypto.randomUUID(), contents = win.webContents;
    const finish = approved => {
      if (!approvals.delete(token)) return;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      contents.removeListener('destroyed', cancel);
      contents.removeListener('did-start-navigation', navigate);
      emit('remote:approval-close', { token }); resolve(approved === true);
    };
    const cancel = () => finish(false);
    const navigate = (_event, _url, _inPlace, mainFrame) => { if (mainFrame) cancel(); };
    const timer = setTimeout(cancel, 300000);
    approvals.set(token, finish);
    signal?.addEventListener('abort', cancel, { once: true });
    contents.once('destroyed', cancel); contents.on('did-start-navigation', navigate);
    emit('remote:approval', { token, message, ...context });
  });
  const ask = (challenge, signal) => new Promise((resolve, reject) => {
    const token = crypto.randomUUID();
    const finish = (answers, error) => { if (!challenges.has(token)) return; challenges.delete(token); clearTimeout(timer); signal?.removeEventListener('abort', abort); emit('remote:auth-close', { token, sessionId: challenge.sessionId }); error ? reject(error) : resolve(answers); };
    const abort = () => finish(null, Error('SSH 认证已取消'));
    const timer = setTimeout(() => finish(null, Error('SSH 认证输入超时')), 600000);
    const pending = { count: challenge.prompts.length, finish, sessionId: challenge.sessionId, prompts: challenge.prompts, index: 0, buffer: '', answers: [] };
    challenges.set(token, pending);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    emit('remote:auth', { ...challenge, token });
    emit('pty:data', { id: challenge.sessionId, data: '\r\n' + cleanPrompt(challenge.username + '@' + challenge.host + ':' + challenge.port) + '\r\n' + cleanPrompt(challenge.instruction) });
    authPrompt(pending);
  });
  const cleanPrompt = text => String(text || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);
  function authPrompt(p) {
    const prompt = p.prompts[p.index];
    emit('pty:data', { id: p.sessionId, data: '\r\n' + (prompt.echo ? cleanPrompt(prompt.prompt) : /密码|password/i.test(prompt.prompt) ? 'password:' : cleanPrompt(prompt.prompt) + ':') + ' ' });
  }
  function authInput(id, text) {
    const p = [...challenges.values()].find(p => p.sessionId === id);
    if (!p) return false;
    for (const c of String(text)) {
      if (c === '\x03' || c === '\x04') { p.finish(null, Error('SSH 认证已取消')); break; }
      if (c === '\r' || c === '\n') {
        p.answers.push(p.buffer); p.buffer = ''; p.index++;
        emit('pty:data', { id, data: '\r\n' });
        if (p.index === p.count) { p.finish(p.answers); break; }
        authPrompt(p);
      } else if (c === '\x7f' || c === '\b') {
        if (p.buffer && p.prompts[p.index].echo) emit('pty:data', { id, data: '\b \b' });
        p.buffer = [...p.buffer].slice(0, -1).join('');
      } else if (c === '\x15') { if (p.prompts[p.index].echo) emit('pty:data', { id, data: '\b \b'.repeat(p.buffer.length) }); p.buffer = ''; }
      else if (c >= ' ' && p.buffer.length < 4096) { p.buffer += c; if (p.prompts[p.index].echo) emit('pty:data', { id, data: c }); }
    }
    return true;
  }
  const policies = new Map();
  const ssh = new SSHService({ store, confirm, emit, ask,
    chooseUpload: async () => { const result = await dialog.showOpenDialog(getWindow(), { title: 'ZMODEM：选择上传到 SSH 的文件', properties: ['openFile', 'multiSelections'] }); return result.canceled ? [] : result.filePaths; },
    chooseDownload: async name => { const result = await dialog.showSaveDialog(getWindow(), { title: 'ZMODEM：保存 SSH 下载文件', defaultPath: name }); return result.canceled ? null : result.filePath; }
  });
  const local = new Map();
  const target = id => {
    if (ssh.sessions.has(id)) {
      const s = ssh.get(id); return { detectEnvironment: signal => ssh.detectEnvironment(id,signal), pendingInput: s.zmodem?.job ? '文件传输中' : s.inputLine || '', subscribeOutput: fn => subscribeOutput(id, fn), policy: policies.get(id), identity: s, profileId: s.profileId, environment: { ...s.environment, interactiveTargetUnknown: !!s.interactiveTargetUnknown }, input: text => ssh.input(id, text), output: () => s.output };
    }
    const p = terminals.get(id), s = local.get(id);
    if (!p || !s) throw Error('终端已关闭，请重新选择');
    return { pendingInput: s.inputLine || '', subscribeOutput: fn => subscribeOutput(id, fn), policy: policies.get(id), identity: p, environment: { ...s.environment, cwd: terminalCwds.get(id) || s.environment.cwd, interactiveTargetUnknown: !!s.interactiveTargetUnknown }, input: text => { noteInput(s, text); p.write(text); }, output: () => s.output };
  };
  const sendFile = async (id, file, options = {}) => {
    const route = [...(im?.routes.values() || [])].find(r => r.sessionId === id);
    if (!route || !im.valid(route)) throw Error('文件发送仅适用于当前已授权的企业微信会话');
    return require('./wecom-files').sendFile(im, route, file, options);
  };
  const cli = new (require('./cli-session').CLISessions)({ target, sendFile, confirmTrust: async (id, directory, signal, name) => {
    const route = [...(im?.routes.values() || [])].find(r => r.sessionId === id);
    if (!route || !im.valid(route)) return false;
    if (name === 'codebuddy') {
      const question = 'CodeBuddy 请求信任目录：' + directory + '\n信任后可读取、修改和执行文件。请选择信任范围；取消或超时将退出。';
      const labels = ['仅信任当前目录', '信任父目录', '信任当前目录及子目录', '不信任并退出'];
      const answer = await im.askCLIQuestions(route, [{ title: 'CodeBuddy 目录信任', question, fixedOptions: true, options: labels.map(label => ({label})) }], signal);
      const index = labels.indexOf(answer?.[question]);
      return index < 0 ? 3 : index;
    }
    return im.confirm(route, 'Claude 请求确认工作目录是否可信', '目录：' + directory + '\n信任后，Claude 可在此目录读取、编辑文件及执行命令，具体操作仍受 CLI 自身权限设置控制。\n选择“不信任，退出”或超时将请求退出。', { title: 'Claude 目录信任', approveLabel: '信任目录', rejectLabel: '不信任，退出', signal });
  }, confirmPermission: async (id, request, signal) => {
    const route = [...(im?.routes.values() || [])].find(r => r.sessionId === id);
    if (!route || !im.valid(route)) return false;
    const parameters = require('./cli-permission-summary').permissionSummary(request.tool, request.input);
    if (parameters.length > 24000) { await im.say(route, 'Claude 操作参数过长，无法完整展示，本次未批准。请在本机核对。'); return false; }
    return im.confirm(route, 'Claude 请求执行操作：' + request.tool, '目录：' + request.cwd + '\n\n' + parameters + '\n\n仅针对本次操作，不设置永久允许。', { title: 'Claude 操作确认', approveLabel: '仅允许本次', rejectLabel: '拒绝本次', signal, timeout: 240000 });
  }, askQuestion: async (id, request, signal) => {
    const route = [...(im?.routes.values() || [])].find(r => r.sessionId === id);
    if (!route || !im.valid(route)) return null;
    return im.askCLIQuestions(route, request.input.questions, signal);
  }, notify: async (id, text, metadata) => {
    const route = [...(im?.routes.values() || [])].find(r => r.sessionId === id);
    if (route && im.valid(route)) { if (metadata?.progress) await im.cliProgress(route, text, metadata.taskId); else await im.say(route, text); }
  } });
  const ai = new ShellAI({ store, ssh, target, confirm: confirmAI, emit, auditFile: path.join(directory, 'shell-ai-audit.jsonl') });
  const historyTarget = id => {
    const t = target(id), e = t.environment;
    const profile = t.profileId ? store.data.profiles.find(p => p.id === t.profileId) : null;
    const identity = imScopes.has(id) ? ['wecom', imScopes.get(id)] : profile ? ['ssh', profile.id, profile.host, profile.port, profile.username] : ['local', e.host, e.os, e.shell];
    return { key: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex'), label: profile ? `${profile.name} · ${profile.username}@${profile.host}:${profile.port}` : `${e.host} · ${e.shell}` };
  };
  function guard(e) {
    const win = getWindow();
    if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame || new URL(e.senderFrame.url).origin !== `http://127.0.0.1:${port}`) throw Error('不允许此页面访问 SSH / AI 功能');
  }
  const handle = (name, fn) => ipcMain.handle('remote:' + name, async (e, args = {}) => { guard(e); try { return { ok: true, value: await fn(args) }; } catch (error) { return { ok: false, error: error.message }; } });
  handle('cli-permission', ({sessionId}) => cli.cyclePermission(sessionId));
  handle('approval-reply', ({ token, approved }) => {
    const finish = approvals.get(token);
    if (!finish) throw Error('此授权请求已结束');
    finish(approved === true);
  });
  handle('state', () => ({ profiles: store.list(), ai: store.aiConfig(), aiConfigs: store.aiList(), sessions: [...ssh.sessions.values()].map(s => ({ id: s.id, profileId: s.profileId, status: s.status, environment: s.environment })) }));
  handle('save-profile', p => store.save(p)); handle('delete-profile', ({ id }) => store.remove(id));
  handle('save-shortcut', p => store.saveShortcut(p));
  handle('delete-shortcut', p => store.deleteShortcut(p));
  handle('rename-shortcut-group', p => store.renameShortcutGroup(p));
  handle('run-shortcut', ({ sessionId, id }) => {
    const t = target(sessionId);
    if (!t.profileId) throw Error('请选择对应的 SSH 终端');
    if (t.pendingInput || historySessions.has(sessionId)) throw Error('终端有未提交输入或 AI 任务，请先处理后再执行');
    const command = store.shortcuts(t.profileId).find(x => x.id === id);
    if (!command) throw Error('此连接没有该快捷命令，请刷新后重试');
    const text = command.command.replace(/\n/g, '\r').replace(/\r+$/, '') + '\r';
    cli.userInput(sessionId, text); t.input(text); return { sent: true };
  });
  handle('auth-reply', ({ token, answers }) => {
    const pending = challenges.get(token); if (!pending) throw Error('认证请求已结束');
    if (answers !== null && (!Array.isArray(answers) || answers.length !== pending.count || answers.some(x => typeof x !== 'string' || x.length > 4096))) throw Error('认证输入无效');
    pending.finish(answers);
  });
  handle('save-ai', p => store.saveAI(p));
  handle('reveal-ai-key', ({ id }) => { const config=store.aiList().find(c=>c.id===id); if(!config)throw Error('AI 配置不存在'); return store.modelConnection(config).apiKey; });
  handle('reveal-im-secret', () => { const secret=im.config().secret;if(!secret)return '';try{return store.vault.decryptString(Buffer.from(secret,'base64'));}catch{throw Error('机器人凭据无法解密，请在此重新填写 Secret 并保存，或重新扫码');} });
  handle('test-ai-model', p => require('./model-settings').testModel(store.modelConnection(p), p.modelSettings));
  handle('list-ai-models', p => require('./model-catalog').listModels(store.modelConnection(p)));
  handle('activate-ai', ({ id }) => store.activateAI(id));
  handle('deactivate-ai', ({ id }) => store.deactivateAI(id));
  handle('delete-ai', ({ id }) => store.removeAI(id));
  handle('policy', ({ id, policy }) => {
    const t = target(id);
    if (policy) {
      if (!['read', 'confirm', 'auto'].includes(policy.mode)) throw Error('无效权限');
      policies.set(id, { mode: policy.mode, interactive: !!policy.interactive });
    }
    const current = { ...ai.policy(t), ...policies.get(id) };
    return { mode: current.mode, interactive: current.interactive };
  });
  handle('ai-clear', ({ id }) => ai.clear(id));
  handle('pick-key', async () => { const result = await dialog.showOpenDialog(getWindow(), { title: '选择 SSH 私钥', properties: ['openFile'] }); return result.filePaths[0] || ''; });
  handle('list', ({ id, path }) => ssh.list(id, path));
  handle('read', ({ id, path }) => ssh.read(id, path));
  handle('write', ({ id, path, text, expected }) => ssh.write(id, path, text, expected));
  handle('transfer', async ({ id, sessionId, direction, remote }) => {
    if (!['upload', 'download'].includes(direction)) throw Error('传输方向无效');
    ssh.get(sessionId);
    const result = direction === 'upload' ? await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], title: '选择上传文件' }) : await dialog.showSaveDialog(getWindow(), { defaultPath: path.posix.basename(remote), title: '下载远程文件' });
    const local = direction === 'upload' ? result.filePaths[0] : result.filePath;
    if (!local || result.canceled) return { cancelled: true };
    if (direction === 'upload') remote = path.posix.join(remote, path.basename(local));
    return ssh.transfer({ id: id || crypto.randomUUID(), sessionId, direction, local, remote });
  });
  handle('cancel-transfer', ({ id }) => ssh.cancel(id));
  const checkHistory = async (sessionId, id) => {
    const record = await history.get(id), key = historyTarget(sessionId).key;
    if (record.targetKey !== key || [...history.bindings].some(([session, conversation]) => conversation === id && session !== sessionId)) throw Error('该历史不属于当前会话');
    return record;
  };
  handle('history-list', async ({ sessionId }) => ({ records: (await history.list(historyTarget(sessionId).key)).map(record => ({ ...record, boundSessionId: [...history.bindings].find(([, id]) => id === record.id)?.[0] || '' })).filter(record => !record.boundSessionId || record.boundSessionId === sessionId), warnings: [...history.errors.values()] }));
  handle('history-read', ({ id, sessionId }) => checkHistory(sessionId, id));
  handle('history-open', async ({ sessionId, id, fresh }) => {
    if ([...ai.runs.values()].some(run => run.sessionId === sessionId) || historySessions.has(sessionId)) throw Error('请先停止当前会话的 AI 任务');
    const record = await history.forSession(historyTarget(sessionId), sessionId, id, !!fresh);
    if (record.running) throw Error('此历史会话正在另一终端运行，请先停止任务');
    ai.clear(sessionId); activeHistories.delete(sessionId); return record;
  });
  handle('history-delete', async ({ id, sessionId }) => { await checkHistory(sessionId, id); return history.remove(id); });
  async function runAI(args, options = {}) {
    if (cli.active(args.sessionId)) throw Error('当前会话处于 CLI 模式，请通过企微发送消息或在终端输入；/aiquit 返回 AI 对话');
    const { sessionId } = args;
    if (historySessions.has(sessionId) || [...ai.runs.values()].some(run => run.sessionId === sessionId)) throw Error('该会话已有 AI 任务');
    if (!String(args.prompt || '').trim()) throw Error('请输入任务');
    historySessions.set(sessionId, true);
    const id = args.id || crypto.randomUUID(); let record;
    try {
      const bound = history.bindings.get(sessionId);
      if (bound && args.conversationId && bound !== args.conversationId) throw Error('当前终端的对话绑定已变化，请重新打开 AI 会话');
      record = await history.forSession(historyTarget(sessionId), sessionId, args.conversationId);
      if (record.running) throw Error('此历史会话正在运行');
      const t = target(sessionId);
      if (activeHistories.get(sessionId) !== record.id || ai.history.get(sessionId)?.identity !== t.identity) ai.history.set(sessionId, { identity: t.identity, messages: history.context(record) });
      activeHistories.set(sessionId, record.id);
      await history.begin(record.id, String(args.prompt)); historyRuns.set(id, record.id);
      if (options.onEvent) { runEvents.set(id, options.onEvent); policies.set(sessionId, { mode: options.permission, interactive: true }); emit('remote:im-task', { id, sessionId, conversationId: record.id, prompt: args.prompt }); }
      let result;
      try { result = await ai.run({ ...args, id, confirmAction: options.confirm, authorized: options.authorized, sendFile: options.authorized ? (file, authorized) => sendFile(sessionId, file, { authorized, turn: id }) : undefined }); }
      catch (error) { await history.finish(record.id, error.message); throw error; }
      await history.finish(record.id, null, result); return { ...result, conversationId: record.id };
    } finally { if (options.onEvent) emit('remote:im-task-done', { id, sessionId }); runEvents.delete(id); historyRuns.delete(id); historySessions.delete(sessionId); }
  }
  handle('ai-run', args => runAI(args)); handle('ai-stop', ({ id }) => ai.stop(id));
  handle('ai-takeover', ({ id }) => ai.takeover(id)); handle('ai-resume', ({ id }) => ai.resume(id));
  handle('set-target-environment', ({id,kind}) => {
    if(historySessions.has(id)||[...ai.runs.values()].some(run=>run.sessionId===id))throw Error('请先停止当前 AI 任务');
    const environments={linux:{os:'linux',shell:'/bin/bash'},macos:{os:'darwin',shell:'/bin/zsh'},cmd:{os:'windows',shell:'cmd.exe'},powershell:{os:'windows',shell:'powershell.exe'}};
    if(!Object.hasOwn(environments,kind))throw Error('请选择有效的目标系统');
    const session=ssh.get(id);session.environment={...session.environment,...environments[kind],cwd:'',confirmedByUser:true};session.interactiveTargetUnknown=false;
    ai.clear(id);emit('remote:status',{id,status:session.status,environment:session.environment});return session.environment;
  });
  handle('target', ({ id }) => target(id).environment);
  im = new WecomService({ store, emit, target, runAI, releaseSession: id => history.release(id), stopAI: id => ai.stop(id),
    startCLI: (id, name, cwd) => { const t = target(id); if (t.pendingInput || historySessions.has(id)) throw Error('终端有未完成输入或 AI 任务'); return cli.start(id, name, cwd); },
    cycleCLIPermission: id => cli.cyclePermission(id),
    runCLI: (id, prompt) => cli.run(id, prompt), stopCLI: id => cli.stop(id), leaveCLI: id => cli.leave(id), closeCLI: id => cli.close(id), activeCLI: id => cli.sessions.get(id)?.name, cliStatus: id => cli.status(id),
    createTerminal: options => new Promise((resolve, reject) => {
      const token = crypto.randomUUID();
      const timer = setTimeout(() => { terminalRequests.delete(token); reject(Error('创建终端超时，请打开软件后重试')); }, 30000);
      terminalRequests.set(token, { resolve, reject, timer, routeKey: options.routeKey }); emit('remote:im-create-terminal', { ...options, token });
    })
  });
  handle('im-state', () => { im.start(); return im.state(); });
  handle('im-reconnect', () => im.reconnect());
  handle('im-save', args => im.save(args));
  handle('im-qr-start', () => im.qr.start()); handle('im-qr-cancel', () => im.qr.cancel());
  handle('im-bind', ({ userid }) => im.bind(userid)); handle('im-unbind', ({ userid }) => im.unbind(userid));
  handle('im-terminal-created', ({ token, sessionId, error }) => {
    const pending = terminalRequests.get(token); if (!pending) throw Error('终端创建请求已过期');
    terminalRequests.delete(token); clearTimeout(pending.timer);
    try { if (error) throw Error(error); target(sessionId); if (!local.has(sessionId)) throw Error('必须使用独立本地终端'); imScopes.set(sessionId, pending.routeKey); pending.resolve(sessionId); }
    catch (error) { pending.reject(error); }
  });
  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true; im.qr.cancel(); im.stop(); for (const p of terminalRequests.values()) { clearTimeout(p.timer); p.reject(Error('软件正在退出')); } terminalRequests.clear();
    for (const id of ai.runs.keys()) ai.stop(id, 'disconnected');
    history.flush().catch(() => {}).finally(() => app.quit());
  });
  app.on('will-quit', () => { for (const id of ssh.sessions.keys()) ssh.disconnect(id); for (const id of ai.runs.keys()) ai.stop(id); });
  return {
    ssh, guard, authInput,
    petState() { const s=im.state();return {status:s.status,error:s.error,enabled:s.enabled,allowExecution:s.allowExecution,lastReceivedAt:s.lastReceivedAt,lastSentAt:s.lastSentAt,pendingApprovals:s.pendingApprovals,healthEvents:s.healthEvents,users:s.users.map(()=>null),pendingUsers:s.pendingUsers.map(()=>null),routes:s.routes.map(r=>({running:r.running}))}; },
    noteInput(id, text) { cli.userInput(id, text); const s = ssh.sessions.get(id) || local.get(id); if (s) noteInput(s, text); },
    localStarted(id, shell, cwd) {
      let system = process.platform === 'win32' ? 'windows' : process.platform;
      if (process.platform === 'win32') {
        const name = path.basename(shell).toLowerCase();
        if (name === 'cmd.exe') shell = 'cmd';
        else if (name === 'powershell.exe') shell = 'powershell';
        else system = 'unknown';
      }
      local.set(id, { output: '', environment: { host: os.hostname(), os: system, shell, cwd } });
    },
    localOutput(id, text) { publishOutput(id, text); const s = local.get(id); if (s) s.output = (s.output + text).slice(-32000); },
    localClosed(id) { cli.close(id); im?.closed(id); imScopes.delete(id); local.delete(id); history.release(id); activeHistories.delete(id); for (const [runId, controller] of ai.runs) if (controller.sessionId === id) ai.stop(runId, 'disconnected'); },
  };
}
module.exports = { installRemoteWorkspace };
