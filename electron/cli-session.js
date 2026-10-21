'use strict';
const { inspectProcess } = require('./terminal-process');
const fs = require('fs'), path = require('path');
const { createResultChannel } = require('./cli-result-channel');
const { CLIProgress } = require('./cli-progress');
const { watchPermissionStatus } = require('./cli-permission-status');
const { randomUUID } = require('crypto');
const NAMES = ['claude', 'codex', 'codebuddy'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function commandFor(name) {
  if (!NAMES.includes(name)) throw Error('不支持的 CLI');
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : [''];
  for (const ext of extensions) for (const dir of dirs) {
    try { if (fs.statSync(path.join(dir, name + ext)).isFile()) return name + ext; } catch {}
  }
  throw Error(`未找到 ${name}，请先安装 CLI 并重启软件`);
}
class CLISessions {
  constructor({ target, notify = async () => {}, inspect = inspectProcess, command = commandFor, wait = delay, resultChannel = createResultChannel, confirmTrust = async () => false, confirmPermission = async () => false, askQuestion = async () => null, sendFile = async () => { throw Error('附件通道不可用'); } }) {
    Object.assign(this, { target, notify, inspect, command, wait, resultChannel, confirmTrust, confirmPermission, askQuestion, sendFile }); this.sessions = new Map(); this.locks = new Set();
  }
  active(id) { return this.sessions.has(id); }
  async exclusive(id, fn) {
    if (this.locks.has(id)) throw Error('CLI 正在切换，请稍后重试');
    this.locks.add(id); try { return await fn(); } finally { this.locks.delete(id); }
  }
  async start(id, name) {
    return this.exclusive(id, async () => {
      const command = this.command(name), t = this.target(id), state = await this.inspect(t);
      if (this.target(id).identity !== t.identity) throw Error('终端已更换，请重新选择会话');
      if (t.pendingInput) throw Error('终端有未提交输入，请先清空');
      if (state.name === name && this.sessions.get(id)?.name === name) return;
      if (!state.idle) throw Error('终端正在运行程序，请先 /aiquit 退出后再切换 CLI');
      this.close(id);
      const s = { name, identity: t.identity, tail: '', sending: Promise.resolve(), seen: new Set(), pending: false, startup: true, startupOutput: '', permissions: new Map(), permissionSeen: new Set() };
      s.channel = this.resultChannel(name, event => this.result(id, s, event));
      this.sessions.set(id, s);
      // PTY bytes are only inspected for a bounded error notice, never forwarded.
      s.unsubscribe = t.subscribeOutput(text => {
        if (s.startup && ['claude', 'codebuddy'].includes(s.name) && !s.trustRequested) {
          s.startupOutput = (s.startupOutput + text).slice(-16000);
          const visible = s.startupOutput.replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(Number(n) || 1, 1000))).replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
          const clean = visible.replace(/[│┃]/g, '');
          const buddy = s.name === 'codebuddy';
          const buddyMatch = clean.match(/Do\s*you\s*trust\s*the\s*files\s*in\s*this\s*folder\?\s*([\s\S]+?)\s*CodeBuddy\s*Code\s*may/);
          const match = buddy ? buddyMatch : visible.match(/Accessing\s*workspace:\s*([\s\S]+?)\s*Quick\s*safety\s*check:/);
          if (match && (buddy ? /1\.\s*Trust\s*folder\s*only/.test(clean) && /2\.\s*Trust\s*parent\s*folder/.test(clean) && /3\.\s*Trust\s*folder\s*and\s*all\s*subdirectories/.test(clean) && /4\.\s*No,\s*exit/.test(clean) : /1\.\s*Yes,\s*I\s*trust\s*this\s*folder/.test(visible) && /2\.\s*No,\s*exit/.test(visible))) {
            const actual = t.environment?.cwd;
            const compact = value => String(value).replace(/\s/g, '').replaceAll('/', '\\').toLowerCase();
            if (actual && compact(match[1]) !== compact(actual)) return;
            s.trustRequested = true; s.trustPending = true;
            s.trustController = new AbortController();
            this.requestTrust(id, s, actual || match[1].trim()).catch(() => {
              if (this.sessions.get(id) === s) this.deliver(id, s, '目录信任确认未完成，请在本机检查 CLI 或重新进入 /' + s.name + '。');
            });
          }
        }
        if (!s.pending) return;
        s.tail = (s.tail + text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).slice(-6000);
        if (!s.errorNotified && /(?:API error[\s\S]{0,1000}(?:429|usage.{0,40}(?:quota|limit)|quota|rate.limit)|exceeded the .{0,40}usage|hit your .{0,30}limit)/i.test(s.tail)) {
          s.errorNotified = true; if (s.progress) s.progress.paused = true;
          this.deliver(id, s, s.name + ' 服务额度不足或触发限流，暂未取得结果。CLI 可能仍在重试；可发送 /stop 中断，或 /aiquit 退出。');
        }
      });
      t.input(command + s.channel.args + '\r');
      // Starting a real TUI may take several seconds; never send a user prompt to an unverified shell.
      for (let attempt = 0; attempt < 5; attempt++) {
        await this.wait(400);
        // The launch command has already been written. A slow OS query must
        // not report "not sent" or switch routing back to AI over a live CLI.
        let current;
        try { current = await this.inspect(this.target(id)); }
        catch { return; } // run() still verifies before forwarding any prompt.
        if (current.name === name) return;
      }
      // Keep ownership while startup is pending; run() verifies the process before every message.
      return;
    });
  }
  async requestTrust(id, s, directory) {
    const signal = s.trustController.signal;
    const approved = await this.confirmTrust(id, directory, signal, s.name);
    if (signal.aborted || this.sessions.get(id) !== s || !s.trustPending) return;
    const t = this.target(id), state = await this.inspect(t);
    if (signal.aborted || this.sessions.get(id) !== s || t.identity !== s.identity || state.name !== s.name) return;
    // Select explicitly instead of depending on the default focus. Local input cancels this card.
    const choice = s.name === 'codebuddy' ? (Number.isInteger(approved) && approved >= 0 && approved <= 3 ? approved : 3) : (approved ? 0 : 1);
    if (s.name === 'codebuddy') {
      // The captured prompt starts on option 1; any local input cancels this request.
      if (choice === 3) t.input('\x1b');
      else if (choice) t.input('\x1b[B'.repeat(choice));
    } else t.input(approved ? '\x1b[A' : '\x1b[B');
    await this.wait(100);
    if (signal.aborted || this.sessions.get(id) !== s) return;
    if (!(s.name === 'codebuddy' && choice === 3)) t.input('\r');
    s.startup = false; s.trustPending = false;
    this.deliver(id, s, choice < (s.name === 'codebuddy' ? 3 : 1) ? '已在 ' + s.name + ' 中确认信任：' + directory + (s.name === 'codebuddy' ? '（' + ['仅当前目录','父目录','当前目录及子目录'][choice] + '）' : '') + '。可以继续发送消息。' : '已选择不信任并请求退出 ' + s.name + '。');
  }
  async requestPermission(id, s, event) {
    if (s.permissionSeen.has(event.key)) return;
    s.permissionSeen.add(event.key);
    const controller = new AbortController(); s.permissions.set(event.key, controller); if (s.progress) s.progress.paused = true;
    try {
      const allow = event.kind === 'question' ? await this.askQuestion(id, event, controller.signal) : await this.confirmPermission(id, event, controller.signal);
      const live = !controller.signal.aborted && this.sessions.get(id) === s && this.target(id).identity === s.identity;
      s.channel.respond(event.key, live ? allow : false);
    } catch { s.channel.respond(event.key, false); }
    finally { s.permissions.delete(event.key); if (s.progress) s.progress.paused = s.permissions.size > 0 || s.errorNotified; }
  }
  cancelPermissions(s) {
    for (const [key, controller] of s.permissions) { controller.abort(); s.channel.respond(key, false); }
    s.permissions.clear();
  }
  userInput(id, text) {
    // xterm also emits focus changes, DECRPM, window-size and DECRQSS
    // responses via onData. Switching to WeCom is not local takeover.
    // Match only complete protocol responses; ordinary keys/pastes still cancel.
    if (typeof text === 'string' && /^(?:\x1b\[[IO]|\x1b\[[?>=]?[\d;]*[cRn]|\x1b\[\??\d+;\d+\$y|\x1b\[\d+(?:;\d+)*t|\x1bP[01]\$r[ -~]*?\x1b\\|\x1b\][^\x07]*(?:\x07|\x1b\\))+$/.test(text)) return;
    const s = this.sessions.get(id); if (!s) return;
    s.interactionsCancelledAt = Date.now(); s.startup = false; s.trustPending = false; s.trustController?.abort(); this.cancelPermissions(s);
  }
  deliver(id, s, text, metadata) {
    if (!text?.trim()) return;
    s.sending = s.sending.catch(() => {}).then(() => this.sessions.get(id) === s ? this.notify(id, text, metadata) : undefined).catch(() => {});
  }
  result(id, s, event) {
    if (event.kind === 'attachment') {
      const taskId = s.taskId;
      const authorized = () => this.sessions.get(id) === s && s.pending && s.taskId === taskId && event.createdAt >= s.started && s.channel.hasRequest(event.key);
      if (!authorized()) { s.channel.respond(event.key, { error: '当前任务已结束或未授权发送附件' }); return; }
      s.attachments ||= new Set(); if (s.attachments.has(event.key)) return; s.attachments.add(event.key);
      this.sendFile(id, event.path, { authorized, turn: taskId }).then(value => s.channel.respond(event.key, value), error => s.channel.respond(event.key, { error: error.message })).catch(() => {}); return;
    }
    if (event.kind === 'progress') { if (this.sessions.get(id) === s && s.pending && event.createdAt >= s.started) s.progress?.event(event); return; }
    if (event.kind === 'permission' || event.kind === 'question') {
      if (this.sessions.get(id) !== s || s.name !== 'claude' || event.createdAt <= (s.interactionsCancelledAt || 0)) { s.channel.respond(event.key, false); return; }
      this.requestPermission(id, s, event).catch(() => {}); return;
    }
    if (this.sessions.get(id) !== s || !s.pending || event.createdAt < s.started || !event.key || s.seen.has(event.key)) return;
    s.seen.add(event.key); if (s.seen.size > 200) s.seen.delete(s.seen.values().next().value);
    if (!['result', 'error', 'missing'].includes(event.kind)) return;
    s.pending = false; this.finishProgress(s);
    if (event.kind === 'result' && typeof event.text === 'string' && event.text.trim()) this.deliver(id, s, event.text);
    else if (event.kind === 'missing') this.deliver(id, s, 'CLI 已结束本轮，但当前版本未提供最终回复。请查看本机 CLI 并检查版本；未转发终端界面内容。');
    else if (!s.errorNotified) this.deliver(id, s, s.name + ' 本轮未完成：' + String(event.text || 'CLI 返回错误').slice(0, 2000));
  }
  async cyclePermission(id) {
    return this.exclusive(id, async () => {
      const t = this.target(id), s = this.sessions.get(id);
      if (s?.trustPending || s?.permissions.size) throw Error('请先处理当前信任或操作确认，再切换权限模式');
      const state = await this.inspect(t);
      if (this.target(id).identity !== t.identity || this.sessions.get(id) !== s || state.name !== 'claude') throw Error('当前终端不是 Claude CLI，未发送权限切换快捷键');
      if (s?.trustPending || s?.permissions.size) throw Error('请先处理当前确认');
      const cancelledAt = s?.interactionsCancelledAt;
      const watcher = watchPermissionStatus(t);
      try {
        t.input('\x1b[Z');
        const status = await watcher.promise;
        if (this.target(id).identity !== t.identity || this.sessions.get(id) !== s || s?.interactionsCancelledAt !== cancelledAt) {
          return '终端会话已变化或被本机接管，暂未确认当前权限。';
        }
        return status
          ? `Claude 当前权限：${status.label}（${status.raw}）。`
          : '暂未确认当前权限，请查看终端底部。';
      } finally { watcher.cancel(); }
    });
  }
  async run(id, prompt) {
    return this.exclusive(id, async () => {
      const s = this.sessions.get(id); if (!s) throw Error('CLI 会话已退出');
      const t = this.target(id), state = await this.inspect(t);
      if (this.sessions.get(id) !== s || t.identity !== s.identity || state.name !== s.name) throw Error('CLI 未运行或已退出，消息未发送。请 /aiquit 返回 AI，或重新进入 CLI');
      if (s.permissions.size) throw Error('Claude 正在等待操作审批，请先点击企微卡片中的按钮');
      if (s.trustPending) throw Error('请先在企微信任卡片中选择“信任目录”或“不信任，退出”');
      if (t.pendingInput) throw Error('终端有未提交的本地输入，请先清空');
      if (s.pending) throw Error('CLI 正在处理上一条消息，请等待结果，或先 /stop 中断');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(prompt)) throw Error('消息为空、过长或包含终端控制字符');
      s.startup = false; s.pending = true; s.started = Date.now(); s.errorNotified = false; s.tail = ''; s.seen.clear();
      s.taskId = randomUUID();
      s.progress = new CLIProgress({ send: text => this.deliver(id, s, text, { taskId: s.taskId, progress: true }) });
      s.progressTimer = setInterval(() => s.progress?.tick(), 1000); s.progressTimer.unref?.();
      // Bracketed paste protects multiline text from being submitted one line at a time.
      t.input('\x1b[200~' + prompt + '\x1b[201~');
      await this.wait(100);
      if (this.sessions.get(id) !== s) throw Error('CLI 接入已关闭');
      t.input('\r');
      return { text: '已发送给 ' + s.name + '，正在处理。需要您确认或补充信息时，会在这里通知。' };
    });
  }
  finishProgress(s) { clearInterval(s.progressTimer); s.progress?.close(); }
  status(id) { const s = this.sessions.get(id); return s ? { taskId: s.taskId, pending: s.pending, text: !s.pending ? '本轮已结束或已请求中断' : s.permissions.size ? '等待您确认或回答' : s.errorNotified ? '服务异常，CLI 可能仍在重试' : s.progress?.current || '仍在处理，尚未收到最终结果' } : null; }
  stop(id) { this.userInput(id); const s = this.sessions.get(id); if (s) { s.pending = false; this.finishProgress(s); this.target(id).input('\x03'); } }
  async leave(id) {
    this.userInput(id);
    return this.exclusive(id, async () => {
      if (!this.active(id)) return;
      const t = this.target(id), s = this.sessions.get(id);
      if (t.identity !== s.identity) throw Error('终端已更换，请重新选择会话');
      if ((await this.inspect(t)).idle) { this.close(id); return; }
      t.input('\x03');
      // Keep the second interrupt inside the CLI double-Ctrl+C window.
      await this.wait(150);
      if (this.sessions.get(id) !== s) return;
      t.input('\x03');
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.wait(400);
        if ((await this.inspect(this.target(id))).idle) { this.close(id); return; }
      }
      throw Error('已发送 Ctrl+C，但程序尚未退出。仍保留 CLI 模式，请查看终端或再次 /aiquit');
    });
  }
  close(id) { const s = this.sessions.get(id); if (!s) return; this.finishProgress(s); s.trustController?.abort(); this.cancelPermissions(s); s.unsubscribe?.(); s.channel?.close(); this.sessions.delete(id); }
}
module.exports = { CLISessions, commandFor, inspectProcess };
