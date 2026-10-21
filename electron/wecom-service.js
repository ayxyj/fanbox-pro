'use strict';
const { randomUUID, createHash } = require('crypto');
const { WSClient } = require('@wecom/aibot-node-sdk');
const { WecomQR } = require('./wecom-qr');
const { redact } = require('./im-redact');
const os = require('os'), fs = require('fs');
const clean = text => String(text || '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0,64000);
class WecomService {
  constructor({ store, emit, createTerminal, runAI, stopAI, target, isClaude, startCLI, cycleCLIPermission, runCLI, stopCLI = () => {}, leaveCLI = () => {}, closeCLI = () => {}, activeCLI, cliStatus = () => null, releaseSession = () => {}, Client = WSClient }) {
    Object.assign(this, { store, emit, createTerminal, runAI, stopAI, target, isClaude, startCLI, cycleCLIPermission, runCLI, stopCLI, leaveCLI, closeCLI, activeCLI, cliStatus, releaseSession, Client });
    this.focus = new Map(); this.numbers = new Map(); this.completedApprovals = new Map();
    this.healthEvents = []; this.lastReceivedAt = 0; this.lastSentAt = 0;
    this.routes = new Map(); this.pendingUsers = new Map(); this.approvals = new Map(); this.seen = new Set(this.config().recent || []); this.generation = 0; this.status = 'disabled';
    this.qr = new WecomQR({ onBound: credentials => this.save({ ...credentials, enabled: true }), onState: state => this.emit('remote:im', { qr: state }) });
  }
  config() { return { botId: '', enabled: false, allowExecution: false, mode: 'ai', shell: 'cmd', cwd: os.homedir(), permission: 'confirm', notifications: { success: true, failure: true, progress: true }, users: [], ...this.store.data.im }; }
  state() {
    const { secret, recent, conversations, ...config } = this.config();
    return { ...config, hasSecret: !!secret, lastReceivedAt: this.lastReceivedAt, lastSentAt: this.lastSentAt, pendingApprovals: this.approvals.size, healthEvents: this.healthEvents.slice(-20), status: this.status, error: this.lastError || '', pendingUsers: [...this.pendingUsers.values()], routes: [...this.routes.values()].map(r => ({ id: r.id, number: r.number, project: r.project, focused: this.focus.get(r.userid) === r.key, userid: r.userid, sessionId: r.sessionId, running: r.busy, mode: r.mode })) };
  }
  health(message) { this.healthEvents.push({at:Date.now(),message}); if(this.healthEvents.length>20)this.healthEvents.shift(); }
  reconnect() {
    if(!this.config().enabled) throw Error('机器人尚未启用，请在 IM 设置中启用连接');
    const old=this.client; this.client=null; old?.disconnect(); this.health('手动重新连接'); this.start(); return this.state();
  }
  changed() { this.emit('remote:im', this.state()); }
  save(input) {
    const old = this.config(), botId = String(input.botId ?? old.botId).trim();
    if (botId.length > 200 || (input.enabled && !botId)) throw Error('请先扫码创建机器人，或填写 Bot ID');
    if (botId !== old.botId && !input.secret) throw Error('更换机器人时必须同时填写 Secret');
    const next = { ...old, botId };
    if (input.secret) next.secret = this.store.encrypt(String(input.secret));
    for (const key of ['enabled', 'allowExecution']) if (typeof input[key] === 'boolean') next[key] = input[key];
    if (input.mode !== undefined) { if (!['ai', 'claude', 'codex', 'codebuddy'].includes(input.mode)) throw Error('执行模式无效'); next.mode = input.mode; }
    if (input.shell !== undefined) { if (!['cmd', 'powershell'].includes(input.shell)) throw Error('终端类型无效'); next.shell = input.shell; }
    if (input.permission !== undefined) { if (!['confirm', 'auto'].includes(input.permission)) throw Error('权限无效'); next.permission = input.permission; }
    if (input.cwd !== undefined) { if (!fs.statSync(String(input.cwd)).isDirectory()) throw Error('工作目录不存在'); next.cwd = String(input.cwd); }
    if (input.notifications) next.notifications = Object.fromEntries(['success', 'failure', 'progress'].map(key => [key, !!input.notifications[key]]));
    if (next.enabled && !next.secret) throw Error('请填写机器人 Secret');
    if (botId !== old.botId) { next.users = []; next.recent = []; next.conversations = {}; next.identities = {}; this.seen.clear(); this.pendingUsers.clear(); }
    this.store.data.im = next; try { this.store.persist(); } catch (error) { this.store.data.im = old; throw error; }
    const restart = ['botId','secret','enabled','allowExecution','mode','shell','cwd','permission'].some(k => old[k] !== next[k]);
    if (restart) this.stop(); if (next.enabled) this.start(); this.changed(); return this.state();
  }
  start() {
    const config = this.config(); if (!config.enabled || this.client) return;
    let secret;
    try { secret = this.store.vault.decryptString(Buffer.from(config.secret, 'base64')); }
    catch { this.status = 'error'; this.lastError = '机器人凭据无法解密，请重新扫码或填写 Secret'; this.changed(); return; }
    const client = this.client = new this.Client({ botId: config.botId, secret, maxReconnectAttempts: -1, maxAuthFailureAttempts: 2, logger: { debug() {}, info() {}, warn() {}, error() {} } });
    this.status = 'connecting'; this.lastError = '';
    client.on('authenticated', () => { if (this.client !== client) return; this.status = 'connected'; this.lastError=''; this.health('认证成功，机器人在线'); this.changed(); });
    client.on('disconnected', reason => { if (this.client !== client) return; this.status = 'disconnected'; this.lastError = /another|new connection|kick|replace|其他|新连接/i.test(String(reason)) ? '机器人被另一客户端连接挤下线，请关闭重复连接后点击重连' : '连接已断开；若持续离线，请检查网络或重复客户端并点击重连'; this.health(this.lastError); this.changed(); });
    client.on('reconnecting', () => { if (this.client !== client) return; this.status = 'reconnecting'; this.health('正在重连'); this.changed(); });
    client.on('error', error => { if (this.client !== client) return; const auth=error?.code==='WS_AUTH_FAILURE_EXHAUSTED'; if(auth || client.isConnected===false)this.status='error'; this.lastError=auth?'机器人认证失败且重试已停止，请重新填写 Secret 或扫码绑定':'连接或发送失败，请检查网络、机器人凭据及是否被其他客户端占用'; this.health(this.lastError); this.changed(); });
    client.on('message.text', frame => { if (this.client === client) { this.lastReceivedAt=Date.now(); this.changed(); this.accept(frame).catch(error => { this.lastError = '消息处理失败：'+redact(error.message); this.health(this.lastError); this.changed(); }); } });
    client.on('event.template_card_event', frame => { if (this.client === client) this.cardEvent(frame).catch(() => { this.lastError = '审批回调处理失败'; this.changed(); }); });
    try { client.connect(); } catch { this.status='error'; this.lastError='无法建立机器人连接，请检查网络并重连'; this.health(this.lastError); } this.changed();
  }
  stop() {
    this.generation++; const oldClient=this.client; this.client=null; oldClient?.disconnect(); this.status = 'disabled';
    for (const approval of this.approvals.values()) approval.finish(false);
    for (const route of this.routes.values()) { if (route.runId) this.stopAI(route.runId); this.closeCLI(route.sessionId); this.releaseSession(route.sessionId); route.unsubscribe?.(); clearTimeout(route.flushTimer); }
    this.routes.clear(); this.focus.clear(); this.completedApprovals.clear();
  }
  bind(userid) {
    if (!this.pendingUsers.has(userid)) throw Error('请先在企业微信中向机器人发送一条消息');
    const config = this.config(); config.users = [...new Set([...config.users, userid])]; this.store.data.im = config; this.store.persist(); this.pendingUsers.delete(userid); this.changed();
  }
  unbind(userid) {
    const config = this.config(); config.users = config.users.filter(id => id !== userid); this.store.data.im = config; this.store.persist();
    for (const approval of this.approvals.values()) if (approval.userid === userid) approval.finish(false);
    for (const [key, route] of this.routes) if (route.userid === userid) { if (route.runId) this.stopAI(route.runId); this.closeCLI(route.sessionId); this.releaseSession(route.sessionId); route.unsubscribe?.(); clearTimeout(route.flushTimer); this.routes.delete(key); if (this.focus.get(route.userid) === key) this.focus.delete(route.userid); }
    this.changed();
  }
  async send(userid, text, route) {
    if (!this.client || !this.config().enabled || !this.config().users.includes(userid)) return;
    // Always send to the requesting user's private chat, never echo terminal data to a group.
    const prefix = route ? `#${route.number} · ${route.project} · ${route.mode === 'ai' ? 'AI' : route.mode} [会话:${route.id.slice(0,8)}]\n\n` : '';
    let chunk = ''; for (const c of clean(redact(text)) || '（无文本输出）') { if (!this.client || !this.config().enabled || !this.config().users.includes(userid)) return; if (Buffer.byteLength(prefix + chunk + c) > 3800) { await this.client.sendMessage(userid, { msgtype: 'markdown', markdown: { content: prefix + chunk } }); chunk = ''; } chunk += c; } if (chunk) await this.client.sendMessage(userid, { msgtype: 'markdown', markdown: { content: prefix + chunk } });
    this.lastSentAt = Date.now(); this.changed();
  }
  async confirm(route, message, detail, options = {}) {
    if (!this.valid(route) || options.signal?.aborted) return false;
    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    return new Promise(resolve => {
      let settled = false;
      const finish = (value, label = value ? '已批准' : '已取消或过期') => {
        if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); this.approvals.delete(token); this.changed();
        this.completedApprovals.set(token, { userid: route.userid, label });
        while (this.completedApprovals.size > 300) this.completedApprovals.delete(this.completedApprovals.keys().next().value);
        resolve(value && this.valid(route));
      };
      const abort = () => finish(false, '已由本机接管或取消');
      const timer = setTimeout(() => finish(false, '已过期'), options.timeout || 300000);
      options.signal?.addEventListener('abort', abort, { once: true });
      this.approvals.set(token, { userid: route.userid, routeKey: route.key, finish }); this.changed();
      (async () => {
        await this.say(route, message + '\n\n' + detail);
        if (settled || !this.valid(route)) return finish(false);
        await this.client.sendMessage(route.userid, { msgtype: 'template_card', template_card: {
          card_type: 'button_interaction', task_id: 'approval_' + token,
          main_title: { title: options.title || '终端操作审批', desc: '请核对上一条操作详情，' + Math.ceil((options.timeout || 300000) / 60000) + ' 分钟内有效' },
          sub_title_text: '会话 #' + route.number + ' · ' + route.project,
          button_list: [{ text: options.approveLabel || '批准', key: 'approval:approve:' + token, style: 1 }, { text: options.rejectLabel || '拒绝', key: 'approval:reject:' + token, style: 2 }]
        } });
      })().catch(() => { finish(false, '发送失败'); this.send(route.userid, '审批卡片发送失败，操作未执行，请重试').catch(() => {}); });
    });
  }
  valid(route) { const c = this.config(); return !!route && c.enabled && c.allowExecution && c.users.includes(route.userid) && route.generation === this.generation && this.routes.get(route.key) === route; }
  async accept(frame) {
    const config = this.config(), body = frame.body, userid = body?.from?.userid;
    if (!config.enabled || body?.aibotid !== config.botId || !userid || !body.msgid || body.msgtype !== 'text') return;
    const dedupe = createHash('sha256').update(config.botId + ':' + body.msgid).digest('hex');
    if (this.seen.has(dedupe)) return;
    const rawText = String(body.text?.content || ''), text = rawText.trim(); if (!text || rawText.length > 16000) return;
    if (!config.users.includes(userid)) {
      if (body.chattype === 'single') { this.pendingUsers.set(userid, { userid, receivedAt: Date.now() }); if (this.pendingUsers.size > 30) this.pendingUsers.delete(this.pendingUsers.keys().next().value); this.changed(); }
      return;
    }
    this.seen.add(dedupe); while (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    this.store.data.im.recent = [...this.seen]; this.store.persist();
    
    const decision = /^\/(批准|拒绝) ([a-f0-9]{12})$/.exec(text);
    if (decision) {
      const pending = this.approvals.get(decision[2]);
      if (pending?.userid === userid) { pending.finish(decision[1] === '批准'); await this.send(userid, decision[1] === '批准' ? '已批准本次操作' : '已拒绝本次操作'); }
      else await this.send(userid, '该确认请求已过期或不属于当前会话');
      return;
    }
    if (text.startsWith('/回答 ') && await this.answerQuestionText(userid, null, rawText)) return;
    let route;
    try {
      if (body.quote) { route = this.quotedRoute(userid, body.quote); this.focus.set(userid, route.key); this.changed(); }
      else route = this.focused(userid);
      if (route && route.mode !== 'ai' && this.activeCLI && !this.activeCLI(route.sessionId)) route.mode = 'ai';
      if (!text.startsWith('/') && await this.answerQuestionText(userid, route, rawText)) return;
      if (await this.bridgeCommand(userid, text)) return;
    } catch (error) { await this.send(userid, error.message); return; }
    let key = route?.key;
    if (text === '/stop') {
      if (route?.runId) this.stopAI(route.runId);
      for (const approval of this.approvals.values()) if (approval.routeKey === key) approval.finish(false);
      if (route && route.mode !== 'ai') this.stopCLI(route.sessionId);
      await this.send(userid, '已请求停止，请检查终端实际状态'); return;
    }
    
    if (text === '/状态') { await this.send(userid, route ? `终端：${route.sessionId || '创建中'}\n模式：${route.mode}\n状态：${route.busy ? '处理中' : '等待消息'}` : '当前对话尚未创建终端'); return; }
    if (text.startsWith('/') && (!route || route.mode === 'ai')) { await this.send(userid, '未知桥接命令，请用 /help 查看帮助'); return; }
    if (!config.allowExecution) { await this.send(userid, '电脑端尚未开启“允许远程操作”，请在设置中开启'); return; }
    if (route?.busy) { await this.send(userid, '当前会话仍在处理上一条消息；没有重复执行。可发送 /状态 或 /stop'); return; }
    if (!route) { try { route = await this.newRoute(userid); key = route.key; } catch (error) { await this.send(userid, error.message); return; } }
    route.busy = true; this.changed();
    try {
      
      if (!this.valid(route)) throw Error('远程授权已撤销');
      if (route.mode !== 'ai') {
        const result = await this.runCLI(route.sessionId, rawText);
        if (this.valid(route)) await this.say(route, result.text);
      } else {
        route.runId = randomUUID();
        if (config.notifications.progress) await this.say(route, '已接收，正在对应的 Windows 终端处理。');
        let answer = '';
        const result = await this.runAI({ id: route.runId, sessionId: route.sessionId, conversationId: route.conversationId || undefined, prompt: text, context: this.config().identities?.[userid] ? '用户设置的显示身份（仅作称呼，不代表系统权限）：' + JSON.stringify(this.config().identities[userid]) : '' }, {
          permission: config.permission,
          confirm: (message, detail) => this.confirm(route, message, detail),
          onEvent: event => { if (['message', 'text-delta'].includes(event.type)) answer += event.text; },
          authorized: () => this.valid(route),
        });
        route.conversationId = result.conversationId;
        if (this.valid(route)) { const data=this.store.data.im; data.conversations={...data.conversations,[createHash('sha256').update(key).digest('hex')]:result.conversationId}; this.store.persist(); }
        await this.say(route, answer || result.noToolsReason || '本轮处理已结束，请查看对应终端。');
      }
    } catch (error) { await this.say(route, '任务未完成：' + error.message); }
    finally { route.busy = false; route.runId = ''; this.changed(); }
  }
  closed(sessionId) {
    for (const [key, route] of this.routes) if (route.sessionId === sessionId) { this.closeCLI(sessionId); route.unsubscribe?.(); clearTimeout(route.flushTimer); for (const approval of this.approvals.values()) if (approval.routeKey === key) approval.finish(false); this.routes.delete(key); }
    this.changed();
  }
}
Object.assign(WecomService.prototype, require('./wecom-chat'), require('./wecom-questions'));
module.exports = { WecomService, clean };
