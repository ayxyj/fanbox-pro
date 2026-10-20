'use strict';
const assert = require('assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { ShellAI } = require('../electron/shell-ai');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-long-ai-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) { for (let i = 0; i < 200; i++) { if (test()) return; await sleep(10); } throw Error('Fixture condition timeout'); }
let requests = 0;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests++;
  const message = body.messages.some(m => m.role === 'tool') ? { role: 'assistant', content: '任务完成' } : { role: 'assistant', content: '正在执行', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'execute_command', arguments: JSON.stringify({ command: 'sleep 100' }) } }] };
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const listeners = new Set(), writes = [], events = [];
  const target = { identity: 'same-terminal', pendingInput: '', environment: { os: 'linux', shell: '/bin/bash', host: 'fixture' }, input: text => writes.push(text), output: () => '', subscribeOutput: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const store = { aiConfig: () => ({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'openai', model: 'fixture', mode: 'auto', interactive: true }) };
  const ai = new ShellAI({ store, target: () => target, confirm: async () => true, emit: (_, event) => events.push(event), auditFile: path.join(directory, 'audit') });
  const complete = () => { const token = writes.at(-1).match(/777;(fanbox-[a-f0-9-]+);/)[1]; for (const fn of listeners) fn('\x1b]777;' + token + ';0\x07'); };
  try {
    const run = ai.run({ id: 'first', sessionId: 'session', prompt: 'run' });
    await until(() => writes.length === 1);
    ai.takeover('first'); assert.equal(writes.length, 1, 'takeover never interrupts the command');
    complete(); await sleep(30);
    assert.equal(requests, 1, 'completion while paused must not request another model action');
    assert(ai.runs.has('first')); assert.equal(listeners.size, 0);
    target.pendingInput = 'manual input'; assert.throws(() => ai.resume('first'), /尚未提交/);
    target.pendingInput = ''; ai.resume('first'); await run;
    assert.equal(requests, 2); assert.equal(writes.length, 1); assert.equal(ai.runs.size, 0);
    assert(events.some(e => e.phase === 'completed' && e.paused));
    writes.length = 0;
    const disconnected = ai.run({ id: 'lost', sessionId: 'another', prompt: 'run' });
    const rejected = assert.rejects(disconnected, /连接已断开/);
    await until(() => writes.length === 1); ai.stop('lost', 'disconnected'); await rejected;
    assert.equal(writes.length, 1); assert.equal(listeners.size, 0); assert.equal(ai.runs.size, 0);
    console.log('PASS: same-terminal execution, takeover without interruption, paused completion, validated resume, no duplicate command, disconnect cleanup.');
  } finally { for (const id of ai.runs.keys()) ai.stop(id, 'disconnected'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
