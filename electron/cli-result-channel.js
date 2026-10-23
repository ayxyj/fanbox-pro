'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
function nodeRuntime() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const file = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  throw Error('CLI 结果通知需要 Node.js，请安装 Node.js 并重启软件');
}
function createResultChannel(name, onResult, { runtime = nodeRuntime(), interval = 500, mcpServers = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-cli-result-'));
  const helper = path.join(directory, 'notify.cjs'), settings = path.join(directory, 'settings.json');
  // All generated command arguments are paths, never user messages. Reject shell metacharacters.
  const safe = value => { const v = value.replaceAll('\\', '/'); if (/["'`$%!\r\n]/.test(v)) throw Error('CLI 通知路径包含不支持的字符'); return v; };
  let args;
  try {
    const paths = [runtime, helper, directory].map(safe);
    fs.copyFileSync(path.join(__dirname, 'cli-result-hook.js'), helper);
    fs.writeFileSync(path.join(directory, 'active'), '1');
    const mcpScript = path.join(directory, 'file-mcp.cjs'), mcpConfig = path.join(directory, 'mcp.json');
    fs.copyFileSync(path.join(__dirname, 'cli-file-mcp.js'), mcpScript);
    fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { ...(name === 'claude' ? require('./mcp-manager').validateServers(mcpServers) : {}), fanbox_delivery: { command: runtime, args: [mcpScript, directory] } } }), { mode: 0o600 });
    if (name === 'codex') args = ' -c "notify=[' + paths.map(p => "'" + p + "'").join(',') + ']"';
    else {
      const command = paths.map(p => '"' + p + '"').join(' ');
      const hook = [{ hooks: [{ type: 'command', command, timeout: 10 }] }];
      fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: hook, ...(name === 'claude' ? { UserPromptSubmit: hook, StopFailure: hook, SessionStart: hook, PreToolUse: [ { matcher: 'Read|Glob|Grep|Write|Edit|NotebookEdit|Bash|PowerShell|WebFetch|WebSearch|Agent|Task', hooks: [{ type: 'command', command, timeout: 10 }] }], PostToolUse: hook, PostToolUseFailure: hook } : {}) } }));
      args = ' --settings "' + safe(settings) + '"';
    }
    if (name === 'codex') args += ` -c "mcp_servers.fanbox_delivery.command='${safe(runtime)}'" -c "mcp_servers.fanbox_delivery.args=['${safe(mcpScript)}','${safe(directory)}']" -c "mcp_servers.fanbox_delivery.tool_timeout_sec=200"`;
    else args += ' --mcp-config "' + safe(mcpConfig) + '"';
  } catch (error) { for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file)); fs.rmdirSync(directory); throw error; }
  let closed = false, reading = false;
  const poll = async () => {
    if (closed || reading) return; reading = true;
    try {
      const events=[];
      for (const file of await fs.promises.readdir(directory)) {
        if (!/^[a-f0-9-]+\.event$/.test(file)) continue;
        const full = path.join(directory, file);
        let event; try { if ((await fs.promises.stat(full)).size <= 700000) event = JSON.parse(await fs.promises.readFile(full, 'utf8')); } catch {} finally { await fs.promises.unlink(full).catch(() => {}); }
        if (event) events.push(event);
      }
      // UUID filenames do not preserve hook order. A quick local turn may submit
      // and finish between polls, so establish its task before delivering Stop.
      events.sort((a,b)=>(a.createdAt-b.createdAt) || (a.kind==='prompt'?-1:b.kind==='prompt'?1:0));
      for(const event of events)if(!closed)await onResult(event);
    } finally { reading = false; }
  };
  const timer = setInterval(() => poll().catch(() => {}), interval); timer.unref?.();
  return { args, directory, poll, hasRequest(key) { return !closed && /^[a-f0-9-]{36}$/.test(key) && fs.existsSync(path.join(directory, key + '.request')); }, respond(key, allow) {
    if (closed || !/^[a-f0-9-]{36}$/.test(key) || !fs.existsSync(path.join(directory, key + '.request'))) return false;
    const reply = path.join(directory, key + '.reply');
    fs.writeFileSync(reply + '.tmp', JSON.stringify({ value: allow }), { mode: 0o600 });
    fs.renameSync(reply + '.tmp', reply); return true;
  }, close() {
    if (closed) return;
    closed = true; clearInterval(timer);
    // Only remove files from the private directory created above. A late hook sees no active marker.
    try { fs.unlinkSync(path.join(directory, 'active')); } catch {}
    for (const file of fs.readdirSync(directory)) { try { fs.unlinkSync(path.join(directory, file)); } catch {} }
    try { fs.rmdirSync(directory); } catch {}
  } };
}
module.exports = { createResultChannel };
