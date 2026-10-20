'use strict';
const assert = require('assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { requestModel } = require('../electron/model-api');
const { RemoteStore } = require('../electron/remote-store');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-model-'));
const vault = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
fs.writeFileSync(path.join(root, 'remote-workspace.json'), JSON.stringify({ ai: { baseUrl: 'https://legacy.example/v1', model: 'old', key: Buffer.from('old-key').toString('base64'), mode: 'read', interactive: false } }));
const store = new RemoteStore(root, vault);
assert.equal(store.aiList().length, 1); assert.equal(store.aiConfig(false).apiKey, 'old-key');
const first = store.aiConfig().id;
const second = store.saveAI({ name: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-fixture', apiKey: 'claude-key' });
assert.equal(store.aiConfig().id, first); store.activateAI(second); assert.equal(store.aiConfig(false).apiKey, 'claude-key'); assert(!JSON.stringify(store.aiList()).includes('claude-key'));
assert.throws(() => store.saveAI({ ...store.aiConfig(), baseUrl: 'https://another.example' }), /重新输入/);
const reloaded = new RemoteStore(root, vault); assert.equal(reloaded.aiConfig().id, second);
reloaded.deactivateAI(second); assert.equal(reloaded.aiConfig().id, undefined); assert(reloaded.aiList().every(c => !c.active));
assert.equal(new RemoteStore(root, vault).aiConfig().id, undefined, 'disabled state must survive restart');
reloaded.saveAI({ id: first, name: 'Updated', baseUrl: 'https://legacy.example/v1', model: 'old', activate: false });
assert.equal(reloaded.aiConfig().id, undefined, 'editing an inactive config must not enable it');
reloaded.activateAI(first); reloaded.activateAI(second); assert.equal(reloaded.aiList().filter(c => c.active).length, 1);
reloaded.deactivateAI(first); assert.equal(reloaded.aiConfig().id, second, 'stale deactivate must not disable another config');
reloaded.removeAI(second); assert.equal(reloaded.aiConfig().id, undefined, 'deletion must not silently enable a different provider');
reloaded.activateAI(first); assert.equal(new RemoteStore(root, vault).aiConfig().id, first);
const originalPersist = reloaded.persist;
reloaded.persist = () => { throw Error('write failure fixture'); };
assert.throws(() => reloaded.deactivateAI(first), /write failure/); assert.equal(reloaded.aiConfig().id, first);
reloaded.persist = originalPersist;
if (process.platform === 'win32') {
 const rename = fs.renameSync; let failures = 0;
 try { fs.renameSync = (...args) => { if (failures++ < 2) throw Object.assign(Error('busy fixture'), { code: 'EPERM' }); return rename(...args); }; reloaded.deactivateAI(first); }
 finally { fs.renameSync = rename; }
 assert.equal(failures, 3); assert.equal(new RemoteStore(root, vault).aiConfig().id, undefined);
 reloaded.activateAI(first);
}
const requests = [];
const server = http.createServer(async (req, res) => {
 let raw = ''; for await (const chunk of req) raw += chunk;
 const body = JSON.parse(raw); requests.push({ url: req.url, headers: req.headers, body });
 res.setHeader('Content-Type', 'application/json');
 res.end(JSON.stringify(req.url.endsWith('/messages') ? { content: body.messages.some(m => m.content.some(b => b.type === 'tool_result')) ? [{ type: 'text', text: 'Linux command completed' }] : [{ type: 'text', text: 'Inspecting Linux' }, { type: 'tool_use', id: 'tool-1', name: 'execute_command', input: { command: 'uname -a' } }] } : { choices: [{ message: { role: 'assistant', content: 'Windows ready' } }] }));
});
(async () => {
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 try {
 const baseUrl = `http://127.0.0.1:${server.address().port}`;
 const config = { protocol: 'anthropic', baseUrl, model: 'fixture', apiKey: 'fake-key' };
 const messages = [{ role: 'system', content: 'Target Linux' }, { role: 'user', content: 'inspect' }];
 const tools = [{ type: 'function', function: { name: 'execute_command', description: 'Run', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }];
 const signal = new AbortController().signal;
 const first = await requestModel(config, messages, tools, signal);
 assert.equal(first.tool_calls[0].function.name, 'execute_command'); assert.equal(requests[0].url, '/v1/messages'); assert.equal(requests[0].headers['x-api-key'], 'fake-key'); assert.equal(requests[0].headers['anthropic-version'], '2023-06-01'); assert.equal(requests[0].body.system, 'Target Linux'); assert.equal(requests[0].body.tools[0].input_schema.type, 'object');
 messages.push(first, { role: 'tool', tool_call_id: 'tool-1', content: '{"output":"Linux"}' });
 const result = await requestModel({ ...config, baseUrl: baseUrl + '/v1' }, messages, tools, signal);
 assert.equal(result.content, 'Linux command completed'); assert.equal(requests[1].body.messages.at(-1).content[0].tool_use_id, 'tool-1'); assert.equal(requests[1].url, '/v1/messages');
 await requestModel({ ...config, protocol: 'openai', baseUrl: baseUrl + '/v1' }, messages, [], signal);
 assert.equal(requests[2].url, '/v1/chat/completions'); assert.equal(requests[2].headers.authorization, 'Bearer fake-key'); assert(!requests[2].body.tools); assert(!JSON.stringify(requests[2].body).includes('anthropicContent'));
 console.log('PASS: legacy migration, multiple configs, activate/delete/reload, key isolation, OpenAI and Anthropic tools/results/auth headers.');
 } finally { server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
