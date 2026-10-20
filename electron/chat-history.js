'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Only conversation text is persisted: never PTY output, credentials or permissions.
class ChatHistory {
  constructor(directory) {
    this.directory = path.join(directory, 'ai-conversations');
    this.records = new Map(); this.timers = new Map(); this.writes = new Map(); this.errors = new Map(); this.bindings = new Map();
    this.ready = this.initialize();
  }
  async initialize() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    for (const name of await fs.promises.readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const record = JSON.parse(await fs.promises.readFile(path.join(this.directory, name), 'utf8'));
        if (record.id + '.json' !== name || !Array.isArray(record.items)) continue;
        if (record.running) {
          record.items.push({ key: randomUUID(), kind: 'notice', text: '上次任务在软件退出时尚未结束。历史不会自动恢复命令，请检查当前终端后继续。', reasoning: '' });
          record.running = false; record.items.forEach(item => item.thinking = false);
        }
        this.records.set(record.id, record);
      } catch { this.errors.set(name, '部分历史记录无法读取，原文件已保留'); }
    }
  }
  async list(targetKey) {
    await this.ready;
    return [...this.records.values()].filter(r => !targetKey || r.targetKey === targetKey).sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, targetKey, targetLabel, updatedAt, running }) => ({ id, title, targetKey, targetLabel, updatedAt, running }));
  }
  async open(target, id, fresh = false) {
    await this.ready;
    let record = id ? this.records.get(id) : !fresh ? this.records.get((await this.list(target.key))[0]?.id) : null;
    if (id && !record) throw Error('历史会话不存在');
    if (record && record.targetKey !== target.key) throw Error('请连接历史记录对应的服务器或本地 Shell 后继续此会话');
    if (!record) {
      record = { id: randomUUID(), targetKey: target.key, targetLabel: target.label, title: '新对话', updatedAt: Date.now(), items: [], running: false };
      this.records.set(record.id, record); await this.persist(record.id);
    }
    return record;
  }
  async get(id) { await this.ready; const r = this.records.get(id); if (!r) throw Error('历史会话不存在'); return r; }
  async forSession(target, sessionId, id, fresh = false) {
    const requested = id || (!fresh ? this.bindings.get(sessionId) : undefined);
    const record = await this.open(target, requested, !requested);
    const owner = [...this.bindings].find(([session, conversation]) => conversation === record.id && session !== sessionId);
    if (owner) throw Error('此对话已绑定另一终端。请在原终端继续，或先关闭原终端再从历史中恢复');
    if (record.running) throw Error('此对话的 AI 任务尚未结束');
    this.bindings.set(sessionId, record.id); return record;
  }
  release(sessionId) { this.bindings.delete(sessionId); }
  item(record, kind, text = '', key = randomUUID()) {
    let item = record.items.find(i => i.key === key);
    if (!item) { item = { key, kind, text, reasoning: '' }; record.items.push(item); }
    return item;
  }
  async begin(id, prompt) {
    const record = await this.get(id);
    if (record.running) throw Error('此历史会话已有任务正在运行');
    if (!record.items.some(i => i.kind === 'user')) record.title = prompt.trim().slice(0, 60);
    this.item(record, 'user', prompt.slice(0, 20000)); record.running = true; record.updatedAt = Date.now(); await this.persist(id);
  }
  event(id, event) {
    const record = this.records.get(id); if (!record) return;
    const key = event.id + ':' + (event.step || 1);
    if (event.type === 'analysis-start') this.item(record, 'assistant', '', key).thinking = true;
    else if (event.type === 'analysis-end') { const item = record.items.find(i => i.key === key); if (item) item.thinking = false; }
    else if (event.type === 'message' || event.type === 'text-delta') { const item = this.item(record, 'assistant', '', key); item.text = (item.text + event.text).slice(-100000); }
    else if (event.type === 'reasoning-delta') { const item = this.item(record, 'assistant', '', key); item.reasoning = (item.reasoning + event.text).slice(-64000); }
    else if (event.type === 'command') this.item(record, 'command', event.text);
    else if (event.reminder) this.item(record, 'notice', '命令已运行超过 5 分钟，仍在监听。');
    else return;
    record.updatedAt = Date.now();
    if (!this.timers.has(id)) this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.persist(id).catch(() => {}); }, 500));
  }
  async finish(id, error, result) {
    const r = await this.get(id); r.running = false; r.updatedAt = Date.now(); r.items.forEach(item => item.thinking = false);
    if (error) this.item(r, 'error', error);
    else if (result?.noToolsReason) this.item(r, 'notice', result.noToolsReason);
    await this.persist(id);
  }
  context(record) {
    // Restored dialogue is context only, never a queued tool call or shell result.
    let size = 0; const messages = [];
    for (const item of [...record.items].reverse()) {
      if (!['user', 'assistant'].includes(item.kind) || !item.text) continue;
      const content = item.text.slice(-12000); if (size + content.length > 48000 || messages.length >= 12) break;
      size += content.length; messages.unshift({ role: item.kind, content });
    }
    while (messages.length && messages[0].role !== 'user') messages.shift();
    return messages;
  }
  persist(id) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const record = this.records.get(id); if (!record) return Promise.resolve();
    const content = JSON.stringify(record), filename = path.join(this.directory, id + '.json');
    const write = (this.writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      const temporary = filename + '.tmp';
      await fs.promises.writeFile(temporary, content, { mode: 0o600 }); await fs.promises.rename(temporary, filename);
      this.errors.delete(id);
    }).catch(error => { this.errors.set(id, '历史保存失败：' + error.message); throw error; });
    this.writes.set(id, write); return write;
  }
  async remove(id) {
    const record = await this.get(id); if (record.running) throw Error('请先停止该会话的 AI 任务');
    clearTimeout(this.timers.get(id)); this.timers.delete(id); await this.writes.get(id)?.catch(() => {});
    await fs.promises.unlink(path.join(this.directory, id + '.json')); this.records.delete(id); this.writes.delete(id);
    for (const [session, conversation] of this.bindings) if (conversation === id) this.bindings.delete(session);
  }
  async flush() {
    await this.ready;
    await Promise.allSettled([...this.timers.keys()].map(id => this.persist(id)));
    await Promise.allSettled([...this.writes.values()]);
  }
}
module.exports = { ChatHistory };
