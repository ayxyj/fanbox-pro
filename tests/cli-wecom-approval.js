'use strict';
const assert = require('assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { CLISessions } = require('../electron/cli-session');
const { WecomService } = require('../electron/wecom-service');
const { createResultChannel } = require('../electron/cli-result-channel');
const tick = () => new Promise(r => setTimeout(r, 20));
(async () => {
  const route = { key: 'r', userid: 'alice', number: 1, project: 'fixture' }, cards = [];
  const service = Object.assign(Object.create(WecomService.prototype), {
    approvals: new Map(), completedApprovals: new Map(), routes: new Map([['r', route]]),
    config: () => ({ enabled: true, botId: 'bot', users: ['alice'] }), valid: r => r === route,
    say: async () => {}, send: async () => {}, changed() {},
    client: { sendMessage: async (user, body) => cards.push(body.template_card), updateTemplateCard: async () => {} }
  });
  const terminal = { identity: {}, state: { idle: true }, input() { this.state = { name: 'claude' }; }, subscribeOutput: () => () => {} };
  let channel;
  const cli = new CLISessions({ target: () => terminal, inspect: async () => terminal.state, command: n => n, wait: async () => {},
    resultChannel: (name, receive) => channel = createResultChannel(name, receive, { runtime: process.execPath, interval: 20 }),
    confirmPermission: (id, request, signal) => service.confirm(route, '发送文件', request.tool, { signal, timeout: 30000 })
  });
  await cli.start('t', 'claude');
  try {
    for (const action of ['approve', 'reject']) {
      const child = spawn(process.execPath, [path.join(channel.directory, 'notify.cjs'), channel.directory], { windowsHide: true });
      const result = new Promise((resolve, reject) => {
        let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d); child.on('error', reject);
        child.on('close', code => { try { assert.equal(code, 0, err); resolve(JSON.parse(out)); } catch (e) { reject(e); } });
      });
      result.catch(() => {});
      child.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'mcp__fanbox_delivery__send_file_to_wecom', tool_input: { path: 'C:\\fixture.png' } }));
      const until = Date.now() + 30000;
      while (!cards.length && Date.now() < until) await tick();
      const card = cards.shift(); assert(card, 'approval card received');
      // Switching to WeCom and terminal queries must preserve the request.
      cli.userInput('t', '\x1b[O'); cli.userInput('t', '\x1b[?2026;2$y'); cli.userInput('t', '\x1b[I');
      assert.equal(service.approvals.size, 1);
      const token = card.task_id.slice('approval_'.length);
      await service.cardEvent({ body: { aibotid: 'bot', from: { userid: 'alice' }, event: { eventtype: 'template_card_event', template_card_event: { task_id: card.task_id, event_key: `approval:${action}:${token}` } } } });
      assert.equal((await result).hookSpecificOutput.decision.behavior, action === 'approve' ? 'allow' : 'deny');
    }
    console.log('PASS: real file permission hook -> WeCom card -> focus/status events -> allow/deny reply to Claude');
  } finally { cli.close('t'); }
})().catch(error => { console.error(error); process.exitCode = 1; });
