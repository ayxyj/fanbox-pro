'use strict';
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShellAI, requiresRmConfirmation } = require('../electron/shell-ai');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-permissions-'));
let scenario;
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const message = body.messages.some(item => item.role === 'tool')
    ? { role: 'assistant', content: '完成' }
    : { role: 'assistant', tool_calls: [{ id: 'tool', type: 'function', function: { name: scenario.action, arguments: JSON.stringify(scenario.args) } }] };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message }] }));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const text of ['rm -rf a', 'sudo rm a', '/bin/rm a', 'echo ok && rm a', "sh -c 'rm a'"]) assert(requiresRmConfirmation(text), text);
    for (const text of ['echo rm', "echo 'rm'", 'gof app', '2\r', 'ls -la']) assert(!requiresRmConfirmation(text), text);
    for (const test of [
      { mode: 'auto', action: 'execute_command', args: { command: 'echo ok' }, confirmations: 0 },
      { mode: 'auto', action: 'terminal_input', args: { input: '2\r', expectedEnvironment: 'menu' }, confirmations: 0 },
      { mode: 'auto', action: 'execute_command', args: { command: 'sudo rm a' }, confirmations: 1 },
      { mode: 'auto', action: 'terminal_input', args: { input: 'rm a\r', expectedEnvironment: 'shell' }, confirmations: 1 },
      { mode: 'confirm', action: 'terminal_input', args: { input: '2\r', expectedEnvironment: 'menu' }, confirmations: 1 },
      { mode: 'auto', action: 'terminal_input', args: { input: 'gof app\r', expectedEnvironment: 'shell' }, confirmations: 0, login: true }
    ]) {
      scenario = test;
      const listeners = new Set(), writes = [];
      let confirmations = 0, detections = 0;
      const target = {
        identity: 'fixture', environment: { os: 'linux', shell: '/bin/bash', host: 'fixture' },
        output: () => '[user@new-host ~]$ ',
        subscribeOutput: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        detectEnvironment: async () => { detections++; target.environment = { os: 'linux', shell: '/bin/sh', host: 'new-host', interactiveTargetUnknown: false }; return target.environment; },
        input: text => {
          writes.push(text);
          if (test.login) Object.assign(target.environment, { interactiveTargetUnknown: true, autoDetectAfterLogin: true });
          const token = text.match(/777;(fanbox-[a-f0-9-]+);/);
          setImmediate(() => { for (const fn of listeners) fn(token ? '\x1b]777;' + token[1] + ';0\x07' : '[user@new-host ~]$ '); });
        }
      };
      const ai = new ShellAI({
        store: { aiConfig: () => ({ baseUrl: 'http://127.0.0.1:' + server.address().port, model: 'fixture', mode: test.mode, interactive: true }) },
        target: () => target, confirm: async () => { confirmations++; return false; },
        emit() {}, auditFile: path.join(directory, 'audit')
      });
      await ai.run({ sessionId: 'fixture', prompt: 'test' });
      assert.equal(confirmations, test.confirmations);
      assert.equal(writes.length, test.confirmations ? 0 : 1);
      assert.equal(detections, test.login ? 1 : 0);
      assert.equal(listeners.size, 0);
    }
    console.log('PASS: auto execution, menu input, rm approval, confirm mode, post-login detection');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
