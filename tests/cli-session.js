'use strict';
const assert = require('assert/strict');
const { CLISessions } = require('../electron/cli-session');
(async () => {
  const terminals = new Map(), notices = [], channels = [];
  function terminal(id) {
    const t = { identity: {}, pendingInput: '', state: { idle: true }, writes: [], listeners: new Set(), interrupts: 0,
      subscribeOutput(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      input(text) { this.writes.push(text); if (/^(claude|codex|codebuddy)\r$/.test(text)) this.state = { name: text.trim(), idle: false }; if (text === '\x03' && ++this.interrupts >= 2 && !this.stuck) this.state = { idle: true }; },
      emit(text) { for (const fn of this.listeners) fn(text); }
    }; terminals.set(id, t); return t;
  }
  const a = terminal('a'), b = terminal('b');
  const cli = new CLISessions({ target: id => terminals.get(id), inspect: async t => t.state, command: name => name, wait: async () => {}, resultChannel: (name, receive) => { const c = { args: '', receive, close() { this.closed = true; } }; channels.push(c); return c; }, notify: async (id, text) => notices.push({ id, text }) });
  await cli.start('a', 'claude'); assert.deepEqual(a.writes, ['claude\r']);
  await cli.start('b', 'codex'); assert.deepEqual(b.writes, ['codex\r']);
  const prompt = '  hello & whoami\n second line  ';
  await cli.run('a', prompt); assert.equal(a.writes[1], '\x1b[200~' + prompt + '\x1b[201~'); assert.equal(a.writes[2], '\r'); assert.equal(b.writes.length, 1);
  a.emit('\x1b[2K\r· Flowing…\r❯ prompt echo'); await new Promise(r => setTimeout(r, 25)); assert.equal(notices.length, 0);
  await assert.rejects(cli.run('a', 'second'), /上一条/);
  const result = { kind: 'result', text: '```python\ndef quicksort(a): return sorted(a)\n```', key: 'turn-1', createdAt: Date.now() };
  channels[0].receive(result); channels[0].receive(result); await new Promise(r => setImmediate(r));
  assert.equal(notices.length, 1); assert.equal(notices[0].text, result.text); assert.equal(notices[0].id, 'a');
  await cli.run('a', 'next'); a.emit('API error · Retrying in 1s · 429 You have exceeded the 5-hour usage quota'); a.emit('API error · 429 Retrying');
  await new Promise(r => setImmediate(r)); assert.equal(notices.length, 2); assert.match(notices[1].text, /额度不足/); assert(!notices[1].text.includes('Retrying'));
  channels[0].receive({ kind: 'error', text: 'rate_limit', key: 'error-1', createdAt: Date.now() }); await new Promise(r => setImmediate(r)); assert.equal(notices.length, 2);
  await assert.rejects(cli.start('a', 'codebuddy'), /正在运行/);
  a.pendingInput = 'local'; await assert.rejects(cli.run('a', 'new'), /未提交/); a.pendingInput = '';
  await assert.rejects(cli.run('a', '\x03'), /控制字符/);
  b.state = { idle: true }; const before = b.writes.length; await assert.rejects(cli.run('b', 'do not execute'), /消息未发送/); assert.equal(b.writes.length, before);
  a.stuck = true; await assert.rejects(cli.leave('a'), /尚未退出/); assert(cli.active('a'));
  a.stuck = false; await cli.leave('a'); assert(!cli.active('a')); assert.equal(a.listeners.size, 0); assert(a.writes.includes('\x03'));
  await cli.leave('b'); assert(!cli.active('b'));
  await cli.start('a', 'codebuddy'); a.emit('discard'); cli.close('a'); await new Promise(r => setTimeout(r, 25)); assert.equal(notices.length, 2);
  let checks = 0;
  cli.inspect = async t => { if (++checks > 1) throw Error('query timeout'); return t.state; };
  a.state = { idle: true };
  const written = a.writes.length;
  await cli.start('a', 'claude');
  assert(cli.active('a')); assert.equal(a.writes.length, written + 1);
  await assert.rejects(cli.run('a', 'must not reach shell'), /timeout/);
  assert.equal(a.writes.length, written + 1);
  cli.close('a');
  await assert.rejects(cli.start('a', 'claude'), /timeout/);
  assert.equal(a.writes.length, written + 1);
  console.log('Interactive CLI tests passed: native PTY commands, exact paste, isolation, output, fail-closed routing, Ctrl+C and cleanup');
})().catch(e => { console.error(e); process.exitCode = 1; });
