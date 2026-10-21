'use strict';
const { Client, utils } = require('ssh2');
const { SocksClient } = require('socks');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { StringDecoder } = require('string_decoder');
const { SSHZmodem } = require('./ssh-zmodem');
const { noteInput } = require('./shell-context');
const call = (object, method, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(`SSH ${method} 请求超时`)), 30000);
  try { object[method](...args, (e, result) => { clearTimeout(timer); e ? reject(e) : resolve(result); }); }
  catch (error) { clearTimeout(timer); reject(error); }
});
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

class SSHService {
  constructor({ store, confirm, emit, ask, chooseUpload, chooseDownload }) { this.chooseUpload = chooseUpload; this.chooseDownload = chooseDownload; this.store = store; this.confirm = confirm; this.emit = emit; this.ask = ask || (async () => { throw Error('需要输入 SSH 认证信息'); }); this.sessions = new Map(); this.transfers = new Map(); }
  async proxySocket(p) {
    if (!p.proxy?.host) return undefined;
    const proxy = p.proxy, port = Number(proxy.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('代理端口无效');
    if (proxy.type === 'socks5') return (await SocksClient.createConnection({ proxy: { host: proxy.host, port, type: 5, userId: proxy.username, password: p.proxyPassword }, command: 'connect', destination: { host: p.host, port: p.port }, timeout: 20000 })).socket;
    return new Promise((resolve, reject) => {
      const destination = `${p.host.includes(':') ? '[' + p.host + ']' : p.host}:${p.port}`;
      const req = http.request({ host: proxy.host, port, method: 'CONNECT', path: destination, headers: proxy.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(proxy.username + ':' + (p.proxyPassword || '')).toString('base64') } : {} });
      req.setTimeout(20000, () => req.destroy(Error('代理连接超时')));
      req.on('error', reject); req.on('connect', (response, socket, head) => {
        if (response.statusCode !== 200) { socket.destroy(); reject(Error('HTTP 代理拒绝连接：' + response.statusCode)); return; }
        if (head.length) socket.unshift(head); resolve(socket);
      }); req.end();
    });
  }
  async connectProfile(id, chain = [], clients = [], signal, sessionId) {
    if (signal?.aborted) throw Error('SSH 连接已取消');
    if (chain.includes(id) || chain.length >= 5) throw Error('跳板机配置循环或超过 5 层');
    const p = this.store.get(id);
    if (p.auth === 'key' && fs.statSync(p.keyPath).size > 1024 * 1024) throw Error('SSH 私钥文件过大，请选择正确的私钥');
    const identity = { sessionId, name: p.name, host: p.host, port: p.port, username: p.username };
    if (p.credentialsUnavailable && p.proxy?.username) {
      const answers = await this.ask({ ...identity, instruction: '已保存的凭据无法解密，请重新输入本次连接的代理密码。', prompts: [{ prompt: '代理密码', echo: false }] }, signal);
      if (!answers?.[0]) throw Error('已取消代理认证');
      p.proxyPassword = answers[0];
    }
    let privateKey;
    if (p.auth === 'key') {
      privateKey = fs.readFileSync(p.keyPath);
      let parsed = utils.parseKey(privateKey, p.passphrase);
      if (parsed instanceof Error && /encrypted.*(?:passphrase|decrypt)/i.test(parsed.message) && !p.passphrase) {
        const answers = await this.ask({ ...identity, instruction: '私钥已加密，请输入本次连接使用的私钥口令。', prompts: [{ prompt: '私钥口令', echo: false }] }, signal);
        if (!answers?.[0]) throw Error('已取消私钥认证');
        p.passphrase = answers[0]; parsed = utils.parseKey(privateKey, p.passphrase);
      }
      if (parsed instanceof Error) throw Error(`无法读取 ${p.name} 的私钥，请检查私钥格式及口令：${parsed.message}`);
    }
    if (p.auth !== 'key' && !p.password) {
      const answers = await this.ask({ ...identity, instruction: p.credentialsUnavailable ? '已保存的凭据无法解密，原有密文已保留。请输入本次连接的密码。' : '本次连接没有可用密码。未勾选记住密码时，重启软件后需重新输入。', prompts: [{ prompt: '登录密码', echo: false }] }, signal);
      if (!answers?.[0]) throw Error('已取消 SSH 密码认证');
      p.password = answers[0];
    }
    let sock;
    if (p.jumpId) {
      const jump = await this.connectProfile(p.jumpId, [...chain, id], clients, signal, sessionId);
      sock = await call(jump, 'forwardOut', '127.0.0.1', 0, p.host, p.port);
    } else sock = await this.proxySocket(p);
    if (signal?.aborted) { sock?.destroy(); throw Error('SSH 连接已取消'); }
    const client = new Client(); clients.push(client);
    const cancelConnection = () => client.destroy();
    signal?.addEventListener('abort', cancelConnection, { once: true });
    client.once('close', () => signal?.removeEventListener('abort', cancelConnection));
    const authentication = new AbortController();
    client.once('close', () => authentication.abort());
    let keyboardPasswordUsed = false, authAttempts = 0, lastAuth = '', retryAuthentication = false;
    // Use the server's offered methods, but never replay a rejected password
    // automatically through keyboard-interactive authentication.
    const authHandler = p.auth === 'key' ? undefined : (methods, partial, next) => {
      if (methods === null) { lastAuth = 'none'; return { type: 'none', username: p.username }; }
      if (authAttempts >= 3) return false;
      retryAuthentication = lastAuth !== 'none' && !partial;
      if (!partial && methods.includes('password') && lastAuth !== 'keyboard-interactive') {
        const submit = () => { authAttempts++; lastAuth = 'password'; keyboardPasswordUsed = true; next({ type: 'password', username: p.username, password: p.password }); };
        if (!retryAuthentication) { submit(); return; }
        this.ask({ ...identity, instruction: `认证失败，请重新输入密码（第 ${authAttempts + 1}/3 次尝试）。`, prompts: [{ prompt: 'password:', echo: false }] }, authentication.signal).then(answers => {
          if (!answers?.[0]) throw Error('已取消 SSH 密码认证');
          p.password = answers[0]; submit();
        }).catch(error => { client.emit('error', error); client.end(); });
        return;
      }
      if (methods.includes('keyboard-interactive')) { authAttempts++; lastAuth = 'keyboard-interactive'; return 'keyboard-interactive'; }
      return false;
    };
    client.on('keyboard-interactive', (name, instruction, language, prompts, finish) => {
      if (!prompts.length) { finish([]); return; }
      if (!keyboardPasswordUsed && p.password && prompts.length === 1 && /^(?:[^\r\n]*['’]s )?password\s*:\s*$/i.test(prompts[0].prompt.trim())) {
        keyboardPasswordUsed = true; finish([p.password]); return;
      }
      this.ask({ ...identity, instruction: (retryAuthentication ? `认证失败，请重新输入（第 ${authAttempts}/3 次尝试）。\n` : '') + (instruction || name || '服务器要求补充认证信息'), prompts }, authentication.signal).then(answers => {
        if (!answers) { client.emit('error', Error('已取消 SSH 交互式认证')); client.end(); return; }
        finish(answers);
      }).catch(error => { client.emit('error', error); client.end(); });
    });
    // A persistent error listener also covers failures after the initial handshake.
    client.on('error', () => {});
    await new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => { if (!settled) { settled = true; if (/All configured authentication methods failed/.test(error.message)) error = Error(`SSH 认证失败：${p.username}@${p.host}:${p.port}（${p.name}）。${p.auth === 'key' ? '服务器未接受所选私钥，请检查用户名、私钥及服务器 authorized_keys。' : (authAttempts >= 3 ? '已达到本次连接 3 轮认证上限，请确认用户名、密码后重新连接。' : '服务器未接受密码或交互式认证，请检查用户名、密码及服务器登录策略。')}${p.jumpId ? ' 此连接通过跳板机建立。' : ''}`); reject(error); } };
      client.once('ready', () => { settled = true; resolve(); }); client.once('error', fail); client.once('close', () => fail(Error('SSH 连接已关闭')));
      try { client.connect({ host: p.host, port: p.port, username: p.username, sock, authHandler, tryKeyboard: true, readyTimeout: 120000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        ...(p.auth === 'key' ? { privateKey, passphrase: p.passphrase } : { password: p.password }),
        hostVerifier: (key, done) => {
          const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
          const endpoint = `${p.host}:${p.port}`, known = this.store.data.fingerprints[endpoint];
          if (known === fingerprint) { done(true); return; }
          this.confirm(known ? 'SSH 主机指纹已变化' : '首次连接 SSH 主机', `${p.name}\n${p.username}@${endpoint}\n\n当前：${fingerprint}${known ? '\n原有：' + known : ''}\n请核对服务器指纹后再信任。`).then(yes => {
            if (yes) { this.store.data.fingerprints[endpoint] = fingerprint; this.store.persist(); } done(yes);
          }).catch(() => done(false));
        } });
      } catch (e) { fail(e); }
    });
    return client;
  }
  async connect(id, profileId, cols, rows) {
    if (this.sessions.has(id)) throw Error('会话已存在');
    const clients = [], profile = this.store.get(profileId);
    const s = { id, profileId, clients, profile, abort: new AbortController(), status: 'connecting', output: '', environment: { os: 'unknown', shell: 'unknown', cwd: '', host: profile.host } };
    this.sessions.set(id, s); this.emit('remote:status', { id, status: s.status });
    try {
      s.client = await this.connectProfile(profileId, [], clients, s.abort.signal, id);
      if (s.closed) throw Error('连接已取消');
      // Bastions may consume a login on the first session/exec request.
      // Default to opening only the interactive shell; probing is explicit opt-in.
      const probe = profile.detectEnvironment === true ? await this.execClient(s.client, "printf '__FANBOX_OS__'; uname -s; printf '__FANBOX_SHELL__%s\\n' \"$SHELL\"; printf '__FANBOX_CWD__'; pwd", { timeout: 8000 }).catch(() => ({ output: '' })) : { output: '' };
      const system = probe.output.match(/__FANBOX_OS__(Linux|Darwin|FreeBSD|OpenBSD)/)?.[1];
      if (system) s.environment = { os: system.toLowerCase(), shell: probe.output.match(/__FANBOX_SHELL__([^\r\n]+)/)?.[1] || '/bin/sh', cwd: probe.output.match(/__FANBOX_CWD__([^\r\n]+)/)?.[1] || '/', host: profile.host };
      // Unknown targets remain usable as terminals, but AI execution is disabled until identified.
      s.stream = await call(s.client, 'shell', { term: profile.terminalType || 'xterm', cols, rows });
      if (s.closed) { s.stream.close(); throw Error('连接已取消'); }
      const decoder = new StringDecoder('utf8');
      const data = chunk => { const text = decoder.write(chunk); s.output = (s.output + text).slice(-32000); this.emit('pty:data', { id, data: text }); };
      if (this.chooseUpload && this.chooseDownload) s.zmodem = new SSHZmodem({ stream: s.stream, terminal: data, chooseUpload: this.chooseUpload, chooseDownload: this.chooseDownload });
      s.stream.on('data', chunk => s.zmodem ? s.zmodem.consume(chunk) : data(chunk)); s.stream.stderr.on('data', data);
      s.stream.on('error', error => this.emit('remote:status', { id, status: 'error', error: error.message }));
      s.stream.once('close', () => this.disconnect(id)); s.client.once('close', () => this.disconnect(id));
      s.status = 'connected'; this.emit('remote:status', { id, status: s.status, environment: s.environment });
      return { ok: true, cwd: s.environment.cwd, environment: s.environment, title: `${profile.name} · SSH` };
    } catch (error) { this.disconnect(id); for (const client of clients) client.end(); throw error; }
  }
  disconnect(id) {
    const s = this.sessions.get(id); if (!s || s.closed) return;
    s.closed = true;
    s.abort.abort(); s.zmodem?.close();
    for (const t of this.transfers.values()) if (t.sessionId === id) t.abort.abort();
    s.stream?.close(); for (const client of s.clients.slice().reverse()) client.end(); this.sessions.delete(id);
    this.emit('remote:status', { id, status: 'disconnected' }); this.emit('pty:exit', { id, exitCode: 0 });
  }
  get(id) { const s = this.sessions.get(id); if (!s || s.closed || s.status !== 'connected') throw Error('SSH 会话未连接'); return s; }
  async detectEnvironment(id, signal) { const s=this.get(id);if(s.zmodem?.job)throw Error('文件传输中，请完成后再操作终端');const detected=await require('./ssh-environment').detectEnvironment(s,signal);if(this.get(id)!==s)throw Error('SSH 会话已更换');s.environment={...s.environment,...detected};s.interactiveTargetUnknown=false;this.emit('remote:status',{id,status:s.status,environment:s.environment});return {...s.environment,interactiveTargetUnknown:false}; }
  input(id, data) { const s = this.get(id); if (s.zmodem?.input(data)) return; s.inputRevision=(s.inputRevision||0)+1; noteInput(s, data); s.stream.write(data); }
  resize(id, cols, rows) { this.get(id).stream.setWindow(rows, cols, 0, 0); }
  execClient(client, command, { timeout = 60000, signal, onData } = {}) {
    return new Promise((resolve, reject) => {
      let stream, output = '', truncated = false, finished = false;
      const decoder = new StringDecoder('utf8');
      const finish = (error, result) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
      const abort = () => { try { stream?.signal('TERM'); stream?.close(); } catch {} finish(Error('执行已停止或超时；远端后台进程可能仍在运行')); };
      const timer = setTimeout(abort, timeout); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      client.exec(command, (error, channel) => {
        if (error) { finish(error); return; } stream = channel;
        if (finished) { stream.close(); return; }
        const data = chunk => { const text = decoder.write(chunk), remaining = Math.max(0, 64000 - output.length); if (text.length > remaining) truncated = true; const retained = text.slice(0, remaining); if (retained) { onData?.(retained); output += retained; } };
        stream.on('data', data); stream.stderr.on('data', data); stream.on('error', finish);
        stream.on('close', (code, signal) => finish(null, { output: output + decoder.end(), code: code ?? null, signal, truncated }));
      });
    });
  }
  async exec(id, command, cwd, options) {
    const s = this.get(id);
    if (!['linux', 'darwin', 'freebsd', 'openbsd'].includes(s.environment.os)) throw Error('远端系统尚未识别，禁止 AI 执行命令');
    return this.execClient(s.client, `cd ${quote(cwd || s.environment.cwd)} && ${command}`, options);
  }
  async sftp(id) { const s = this.get(id); return s.sftp || (s.sftp = await call(s.client, 'sftp')); }
  async list(id, directory) {
    const sftp = await this.sftp(id), resolved = await call(sftp, 'realpath', directory || '.');
    const entries = await call(sftp, 'readdir', resolved);
    return { path: resolved, entries: entries.filter(e => !['.', '..'].includes(e.filename)).map(e => ({ name: e.filename, directory: e.attrs.isDirectory(), size: e.attrs.size, mtime: e.attrs.mtime })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) };
  }
  async read(id, filename) {
    const sftp = await this.sftp(id), stat = await call(sftp, 'stat', filename);
    if (stat.size > 2 * 1024 * 1024) throw Error('在线编辑仅支持 2 MB 以下文本，请下载编辑');
    const chunks = []; let size = 0;
    for await (const chunk of sftp.createReadStream(filename)) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('文件超过编辑上限'); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks); if (buffer.includes(0)) throw Error('二进制文件请下载查看');
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw Error('文件不是 UTF-8 编码，请下载后使用对应编码编辑'); }
    return { text: buffer.toString('utf8'), mtime: stat.mtime, size: stat.size, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
  }
  async write(id, filename, text, expected) {
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw Error('文本超过 2 MB');
    const sftp = await this.sftp(id), stat = await call(sftp, 'stat', filename);
    if (stat.mtime !== expected.mtime || stat.size !== expected.size || expected.hash && (await this.read(id, filename)).hash !== expected.hash) throw Error('远端文件已变化，请重新打开后再保存');
    if (!await this.confirm('覆盖远程文件', `${this.get(id).profile.host}\n${filename}`)) throw Error('已取消保存');
    // Write a sibling first: a dropped connection must not truncate the original file.
    const { Readable } = require('stream'), temp = filename + '.fanbox-' + crypto.randomUUID();
    try {
      await pipeline(Readable.from([Buffer.from(text)]), sftp.createWriteStream(temp, { flags: 'wx', mode: stat.mode & 0o777 }));
      if (expected.hash && (await this.read(id, filename)).hash !== expected.hash) throw Error('远端文件已变化，请重新打开后再保存');
      await this.rename(sftp, temp, filename);
    } catch (e) { await call(sftp, 'unlink', temp).catch(() => {}); throw e; }
    return { ok: true };
  }
  async rename(sftp, from, to) {
    try { await call(sftp, 'ext_openssh_rename', from, to); }
    catch (e) { if (e.code !== 8 && !/does not support this extended request/.test(e.message)) throw e; await call(sftp, 'rename', from, to); }
  }
  async transfer({ id, sessionId, direction, local, remote }) {
    if (this.transfers.has(id)) throw Error('传输任务已存在');
    const abort = new AbortController(), task = { sessionId, abort }; this.transfers.set(id, task);
    let sftp;
    const temp = direction === 'upload' ? remote + '.fanbox-' + crypto.randomUUID() : local + '.fanbox-' + crypto.randomUUID();
    let transferred = 0, last = 0;
    const progress = status => this.emit('remote:transfer', { id, sessionId, direction, local, remote, transferred, total: task.total, status });
    try {
      sftp = await this.sftp(sessionId);
      if (direction === 'upload') {
        const stat = fs.statSync(local); task.total = stat.size;
        try { await call(sftp, 'stat', remote); if (!await this.confirm('覆盖远程文件', `${this.get(sessionId).profile.host}\n${remote}`)) throw Error('已取消覆盖'); } catch (e) { if (e.code !== 2) throw e; }
      } else task.total = (await call(sftp, 'stat', remote)).size;
      const source = direction === 'upload' ? fs.createReadStream(local) : sftp.createReadStream(remote);
      const destination = direction === 'upload' ? sftp.createWriteStream(temp, { flags: 'wx' }) : fs.createWriteStream(temp, { flags: 'wx' });
      source.on('data', chunk => { transferred += chunk.length; if (Date.now() - last > 100) { last = Date.now(); progress('running'); } });
      progress('running'); await pipeline(source, destination, { signal: abort.signal });
      if (direction === 'upload') {
        await this.rename(sftp, temp, remote);
      } else await fs.promises.rename(temp, local);
      progress('done'); return { ok: true };
    } catch (error) {
      if (direction === 'upload') { if (sftp) await call(sftp, 'unlink', temp).catch(() => {}); } else await fs.promises.unlink(temp).catch(() => {});
      progress(abort.signal.aborted ? 'cancelled' : 'failed'); throw error;
    } finally { this.transfers.delete(id); }
  }
  cancel(id) { this.transfers.get(id)?.abort.abort(); }
}
module.exports = { SSHService, quote };
