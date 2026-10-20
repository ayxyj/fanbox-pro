'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const { RemoteStore } = require('../electron/remote-store');
const { SSHService } = require('../electron/ssh-service');
const { ShellAI, localExec } = require('../electron/shell-ai');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-remote-test-'));
const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const vaultKey = crypto.randomBytes(32);
const vault = { isEncryptionAvailable: () => true, encryptString(text) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); }, decryptString(buffer) { const cipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, buffer.subarray(0, 12)); cipher.setAuthTag(buffer.subarray(12, 28)); return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString(); } };
const events = [], received = [], clients = new Set(); let prompts = 0, accept = true;
const store = new RemoteStore(root, vault);
const ssh = new SSHService({ store, confirm: async () => { prompts++; return accept; }, emit: (event, data) => events.push({ event, ...data }), ask: async challenge => challenge.prompts.map(p => /code/i.test(p.prompt) ? '123456' : 'secret-test') });
const files = new Map([['/hello.txt', Buffer.from('hello remote\n')], ['/large.bin', Buffer.alloc(4 * 1024 * 1024, 65)]]);
const attrs = data => ({ mode: 0o100644, uid: 1000, gid: 1000, size: data.length, atime: 100, mtime: 100 });
const server = new Server({ hostKeys: [key] }, client => {
  clients.add(client); client.on('error', error => console.error('Fixture SSH:', error.message)); client.on('close', () => clients.delete(client));
  client.on('authentication', ctx => { if (ctx.username === 'interactive' || ctx.username === 'mfa') { if (ctx.method !== 'keyboard-interactive') return ctx.reject(['keyboard-interactive']); return ctx.prompt(ctx.username === 'mfa' ? [{ prompt: 'Password:', echo: false }, { prompt: 'Verification code:', echo: false }] : [{ prompt: 'Password:', echo: false }], answers => answers[0] === 'secret-test' && (ctx.username !== 'mfa' || answers[1] === '123456') ? ctx.accept() : ctx.reject(['keyboard-interactive'])); } if (ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'secret-test') return ctx.accept(); if (ctx.method === 'publickey') { const parsed = utils.parseKey(key); if (ctx.key.data.equals(parsed.getPublicSSH()) && (!ctx.signature || parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)) return ctx.accept(); } ctx.reject(['password', 'publickey', 'keyboard-interactive']); });
  client.on('ready', () => {
    client.on('tcpip', (accept, reject, info) => { const socket = net.connect(info.destPort, info.destIP, () => { const channel = accept(); socket.pipe(channel).pipe(socket); channel.on('close', () => socket.destroy()); }); socket.on('error', reject); });
    client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept()); session.on('window-change', accept => accept?.());
      session.on('shell', accept => { const stream = accept(); stream.write('remote-ready\r\n'); stream.on('data', data => { received.push(data.toString()); stream.write(data); const marker = data.toString().match(/777;(fanbox-[a-f0-9-]+);/); if(marker) stream.write('fixture-visible-output\r\n\x1b]777;' + marker[1] + ';0\x07'); }); });
      session.on('exec', (accept, _, info) => { const stream = accept(); received.push(info.command); if (info.command.includes('__FANBOX_OS__')) { stream.write('__FANBOX_OS__Linux\n__FANBOX_SHELL__/bin/bash\n__FANBOX_CWD__/\n'); stream.exit(0); stream.end(); } else if (info.command.includes('wait-forever')) { stream.on('signal', accept => { accept?.(); stream.close(); }); } else { stream.write('fixture-command-result\n'); stream.exit(0); stream.end(); } });
      session.on('sftp', accept => {
        const sftp = accept(), handles = new Map(); let seq = 0;
        const status = (id, code) => sftp.status(id, code), OK = utils.sftp.STATUS_CODE.OK, NO = utils.sftp.STATUS_CODE.NO_SUCH_FILE;
        sftp.on('REALPATH', (id, name) => sftp.name(id, [{ filename: name === '.' ? '/' : name, longname: '', attrs: { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 100, mtime: 100 } }]));
        sftp.on('STAT', (id, name) => files.has(name) ? sftp.attrs(id, attrs(files.get(name))) : status(id, NO));
        sftp.on('OPENDIR', (id, name) => { const handle = Buffer.from(String(++seq)); handles.set(handle.toString(), { dir: true, read: false }); sftp.handle(id, handle); });
        sftp.on('READDIR', (id, handle) => { const entry = handles.get(handle.toString()); if (entry.read) return status(id, utils.sftp.STATUS_CODE.EOF); entry.read = true; sftp.name(id, [...files].map(([name, data]) => ({ filename: name.slice(1), longname: '', attrs: attrs(data) }))); });
        sftp.on('OPEN', (id, name, flags) => { if ((flags & 8) && !files.has(name)) files.set(name, Buffer.alloc(0)); if (!files.has(name)) return status(id, NO); if (flags & 16) files.set(name, Buffer.alloc(0)); const handle = Buffer.from(String(++seq)); handles.set(handle.toString(), { name }); sftp.handle(id, handle); });
        sftp.on('READ', (id, handle, offset, length) => { const handleInfo = handles.get(handle.toString()); if (!handleInfo) return status(id, utils.sftp.STATUS_CODE.FAILURE); const data = files.get(handleInfo.name); if (offset >= data.length) return status(id, utils.sftp.STATUS_CODE.EOF); sftp.data(id, data.subarray(offset, offset + length)); });
        sftp.on('WRITE', (id, handle, offset, data) => { const name = handles.get(handle.toString()).name, old = files.get(name), next = Buffer.alloc(Math.max(old.length, offset + data.length)); old.copy(next); data.copy(next, offset); files.set(name, next); status(id, OK); });
        sftp.on('CLOSE', (id, handle) => { handles.delete(handle.toString()); status(id, OK); });
        sftp.on('REMOVE', (id, name) => { files.delete(name); status(id, OK); });
        sftp.on('RENAME', (id, from, to) => { files.set(to, files.get(from)); files.delete(from); status(id, OK); });
        sftp.on('EXTENDED', id => status(id, utils.sftp.STATUS_CODE.OP_UNSUPPORTED));
      });
    });
  });
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let model, proxy, socks;
(async () => { try {
  const { noteInput } = require('../electron/shell-context');
  const switched = {}; for (const char of 'ssh tester@host\r') noteInput(switched, char); assert(switched.interactiveTargetUnknown); noteInput(switched, 'exit\r'); assert(switched.interactiveTargetUnknown);
  const normal = {}; noteInput(normal, 'echo ssh\r'); assert(!normal.interactiveTargetUnknown); noteInput(normal, 'ssh tester'); noteInput(normal, '\x03echo ok\r'); assert(!normal.interactiveTargetUnknown);
  await listen(server); const port = server.address().port;
  const profile = store.save({ name: 'fixture', host: '127.0.0.1', port, username: 'tester', password: 'secret-test', remember: true });
  assert(!fs.readFileSync(store.file, 'utf8').includes('secret-test'));
  assert.equal(new RemoteStore(root, vault).get(profile).password, 'secret-test');
  assert(!JSON.stringify(store.list()).includes('secret-test'));
  for (const username of ['interactive', 'mfa']) { const id = store.save({ host: '127.0.0.1', port, username, password: 'secret-test' }); await ssh.connect('auth-' + username, id, 80, 24); }
  const ephemeral = store.save({ host: '127.0.0.1', port, username: 'tester' }); await ssh.connect('auth-missing-password', ephemeral, 80, 24);
  const connected = await ssh.connect('ssh-test', profile, 80, 24); assert.equal(connected.environment.os, 'linux'); assert.equal(prompts, 1);
  ssh.resize('ssh-test', 100, 30); ssh.input('ssh-test', 'hello\r'); await new Promise(r => setTimeout(r, 40)); assert(received.includes('hello\r'));
  assert.equal((await ssh.exec('ssh-test', 'echo hello', '/', {})).code, 0);
  assert((await ssh.list('ssh-test', '/')).entries.some(e => e.name === 'hello.txt'));
  const text = await ssh.read('ssh-test', '/hello.txt'); assert.equal(text.text, 'hello remote\n');
  await ssh.write('ssh-test', '/hello.txt', 'edited remotely', text); assert.equal(files.get('/hello.txt').toString(), 'edited remotely');
  await assert.rejects(ssh.write('ssh-test', '/hello.txt', 'overwrite', text), /已变化/);
  const local = path.join(root, 'download.txt'); await ssh.transfer({ id: 'download', sessionId: 'ssh-test', direction: 'download', remote: '/hello.txt', local }); assert.equal(fs.readFileSync(local, 'utf8'), 'edited remotely');
  await ssh.transfer({ id: 'upload', sessionId: 'ssh-test', direction: 'upload', remote: '/uploaded.txt', local }); assert.equal(files.get('/uploaded.txt').toString(), 'edited remotely');
  const pending = ssh.transfer({ id: 'cancel', sessionId: 'ssh-test', direction: 'download', remote: '/large.bin', local: path.join(root, 'cancel.bin') }); setTimeout(() => ssh.cancel('cancel'), 20); await assert.rejects(pending); assert(!fs.existsSync(path.join(root, 'cancel.bin')));
  const jump = store.save({ name: 'via-jump', host: '127.0.0.1', port, username: 'tester', password: 'secret-test', jumpId: profile }); await ssh.connect('jump-test', jump, 80, 24); assert.equal(ssh.get('jump-test').environment.os, 'linux');
  await assert.rejects(async () => store.remove(profile), /跳板机/);
  proxy = http.createServer(); proxy.on('connect', (req, socket, head) => { const upstream = net.connect(port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream).pipe(socket); }); upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy()); }); await listen(proxy);
  const proxied = store.save({ host: '127.0.0.1', port, username: 'tester', password: 'secret-test', proxy: { type: 'http', host: '127.0.0.1', port: proxy.address().port } }); await ssh.connect('proxy-test', proxied, 80, 24);

  const keyPath = path.join(root, 'test.key'); fs.writeFileSync(keyPath, key); const keyProfile = store.save({ host: '127.0.0.1', port, username: 'tester', auth: 'key', keyPath }); await ssh.connect('key-test', keyProfile, 80, 24);
  socks = net.createServer(socket => {
    let stage = 0, buffered = Buffer.alloc(0);
    const handshake = chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (stage === 0) { if (buffered.length < 2 + buffered[1]) return; buffered = buffered.subarray(2 + buffered[1]); socket.write(Buffer.from([5, 0])); stage = 1; }
      if (stage === 1 && buffered.length >= 4) {
        const length = buffered[3] === 1 ? 10 : buffered[3] === 3 ? 7 + buffered[4] : 22; if (buffered.length < length) return;
        const leftover = buffered.subarray(length); socket.removeListener('data', handshake); stage = 2;
        const upstream = net.connect(port, '127.0.0.1', () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); if (leftover.length) upstream.write(leftover); socket.pipe(upstream).pipe(socket); });
        upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
      }
    }; socket.on('data', handshake); socket.on('error', () => {});
  }); await listen(socks);
  const socksProfile = store.save({ host: '127.0.0.1', port, username: 'tester', password: 'secret-test', proxy: { type: 'socks5', host: '127.0.0.1', port: socks.address().port } }); await ssh.connect('socks-test', socksProfile, 80, 24);
  await assert.rejects(ssh.exec('ssh-test', 'wait-forever', '/', { timeout: 50 }), /停止或超时/);
  const encryptedKey = path.join(root, 'encrypted.key'); fs.writeFileSync(encryptedKey, crypto.createPrivateKey(key).export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'secret-test' }));
  const encryptedProfile = store.save({ host: '127.0.0.1', port, username: 'tester', auth: 'key', keyPath: encryptedKey }); await ssh.connect('encrypted-key-test', encryptedProfile, 80, 24);
  const ask = ssh.ask; ssh.ask = (_, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled prompt')), { once: true }));
  const pendingLogin = ssh.connect('cancel-login', ephemeral, 80, 24); setTimeout(() => ssh.disconnect('cancel-login'), 20); await assert.rejects(pendingLogin, /cancelled prompt/); ssh.ask = ask;
  const originalAsk = ssh.ask; let rejectedPrompts = 0; ssh.ask = async challenge => { rejectedPrompts++; return challenge.prompts.map(() => 'still-wrong'); };
  const rejected = store.save({ host: '127.0.0.1', port, username: 'tester', password: 'wrong' }); await assert.rejects(ssh.connect('bad-password', rejected, 80, 24)); assert(!ssh.sessions.has('bad-password')); assert.equal(rejectedPrompts, 2, 'each retry must request fresh input, maximum three submissions'); ssh.ask = originalAsk;
  let retryPrompts = 0; ssh.ask = async challenge => { if (challenge.instruction.includes('认证失败')) retryPrompts++; return challenge.prompts.map(p => /code/i.test(p.prompt) ? '123456' : 'secret-test'); };
  await ssh.connect('retry-password', rejected, 80, 24); assert.equal(retryPrompts, 1); ssh.disconnect('retry-password');
  const interactiveWrong = store.save({ host: '127.0.0.1', port, username: 'interactive', password: 'wrong' }); retryPrompts = 0; await ssh.connect('retry-interactive', interactiveWrong, 80, 24); assert.equal(retryPrompts, 1); ssh.disconnect('retry-interactive'); ssh.ask = originalAsk;
  store.data.fingerprints[`127.0.0.1:${port}`] = 'changed'; accept = false; await assert.rejects(ssh.connect('changed-host', profile, 80, 24)); accept = true; store.data.fingerprints = {};
  let toolName = 'execute_command', modelRequests = [], rounds = 0;
  model = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; const request = JSON.parse(body); modelRequests.push(request); const message = ++rounds % 2 ? { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolName === 'execute_command' ? { command: 'echo fixture' } : { input: 'hello\r', expectedEnvironment: 'fixture Linux bash' }) } }] } : { role: 'assistant', content: '执行完成' }; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] })); }); await listen(model);
  const target = id => ({ subscribeOutput: fn => { const stream = ssh.get(id).stream, handler = b => fn(b.toString()); stream.on('data', handler); return () => stream.off('data', handler); }, profileId: profile, environment: ssh.get(id).environment, input: text => ssh.input(id, text), output: () => ssh.get(id).output });
  const ai = new ShellAI({ store, ssh, target, confirm: async () => accept, emit: () => {}, auditFile: path.join(root, 'audit.jsonl') });
  const config = mode => store.saveAI({ baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'fixture', apiKey: 'test-key', mode, interactive: true });
  config('read'); rounds = 0; const before = received.length; await assert.rejects(ai.run({ id: 'read', sessionId: 'ssh-test', prompt: 'test' }), /仅读取/); assert.equal(received.length, before); assert(!modelRequests.at(-1).tools);
  config('confirm'); rounds = 0; accept = false; assert((await ai.run({ id: 'deny', sessionId: 'ssh-test', prompt: 'test' })).stopped); assert.equal(received.length, before);
  accept = true; config('auto'); rounds = 0; await ai.run({ id: 'auto', sessionId: 'ssh-test', prompt: 'test' }); assert(received.at(-1).includes('echo fixture')); assert(modelRequests.at(-1).messages[0].content.includes('linux'));
  store.saveAI({ ...store.aiConfig(), interactive: false }); toolName = 'terminal_input'; rounds = 0; await assert.rejects(ai.run({ id: 'interactive-denied', sessionId: 'ssh-test', prompt: 'test' }), /交互式/);
  store.saveAI({ ...store.aiConfig(), interactive: true }); rounds = 0; await ai.run({ id: 'interactive', sessionId: 'ssh-test', prompt: 'test' });

  toolName = 'execute_command'; rounds = 0; config('confirm'); ai.confirm = async () => { config('read'); return true; }; await assert.rejects(ai.run({ id: 'revoked', sessionId: 'ssh-test', prompt: 'test' }), /权限已撤销/);
  config('auto'); rounds = 0; const unknownAI = new ShellAI({ store, ssh, target: id => ({ ...target(id), environment: { ...target(id).environment, os: 'unknown' } }), confirm: async () => true, emit: () => {}, auditFile: path.join(root, 'audit.jsonl') }); await assert.rejects(unknownAI.run({ id: 'unknown', sessionId: 'ssh-test', prompt: 'test' }), /目标系统未识别/);
  if (process.platform === 'win32') { const stopped = await localExec('Start-Sleep -Seconds 30', { os: 'windows', shell: 'powershell', cwd: root }, { timeout: 150 }); assert(stopped.stopped); }
  assert(!fs.readFileSync(store.file, 'utf8').includes('test-key')); assert(!fs.readFileSync(path.join(root, 'audit.jsonl'), 'utf8').includes('echo fixture'));
  if (process.platform === 'win32') for (const shell of ['cmd', 'powershell']) { const result = await localExec('echo local-fixture', { os: 'windows', shell, cwd: root }); assert.equal(result.code, 0); assert(result.output.includes('local-fixture')); }
  console.log('PASS: encrypted credentials, SSH authentication/fingerprint, terminal/resize, exec, SFTP listing/edit/conflict/upload/download/cancel, jump host, HTTP/SOCKS5 proxies, private key, keyboard-interactive, MFA, missing password prompt, remote timeout, AI read/confirm/auto/interactive/revoked/unknown-target permissions, local CMD/PowerShell and cancellation.');
} finally { for (const id of ssh.sessions.keys()) ssh.disconnect(id); for (const client of clients) client.end(); server.close(); proxy?.close(); socks?.close(); model?.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
