'use strict';
const { randomUUID } = require('crypto');

// Run in the already-open PTY, retaining its directory, variables and SSH connection.
// Completion is acknowledged by the shell, never inferred from a quiet terminal.
function terminalCommand(target, command, { signal, timeout = 60000, reminderAfter = 300000, progressInterval = 1000, stopTimeout = 10000, onProgress } = {}) {
  if (target.pendingInput?.trim()) throw Error('终端有尚未提交的输入，请先处理后再让 AI 执行');
  if (!target.subscribeOutput) throw Error('当前终端不支持输出监听');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(command)) throw Error('命令包含终端控制字符');
  const token = 'fanbox-' + randomUUID(), shell = target.environment.shell;
  let payload, completion;
  if (/^(?:.*\/)?(?:bash|zsh|sh|dash|ksh)$/.test(shell)) {
    const quoted = "'" + command.replace(/'/g, "'\\''") + "'";
    payload = `eval ${quoted}; printf '\\033]777;${token};%s\\007' "$?"\r`;
    completion = new RegExp('\x1b\\]777;' + token + ';(-?\\d+)\x07');
  } else if (shell === 'powershell') {
    payload = `. { ${command} }; Write-Host ('__' + '${token};' + [int](-not $?) + '__')\r`;
    completion = new RegExp('__' + token + ';([01])__');
  } else if (shell === 'cmd' && !command.includes('\n')) {
    payload = `${command} & echo __${token.replace('-', '^-')}__\r`;
    completion = new RegExp('__' + token + '__');
  } else {
    throw Error('当前 Shell 暂不支持可靠的命令完成检测，请使用交互输入或手动执行');
  }
  return new Promise((resolve, reject) => {
    let output = '', tail = '', truncated = false, finished = false, unsubscribe = () => {}, stopTimer, stopping = false;
    const started = Date.now(); let lastOutput = started, reminded = false;
    const finish = (result, error) => {
      if (finished) return; finished = true; clearInterval(timer); clearTimeout(stopTimer); unsubscribe(); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve({ output, truncated, ...result });
    };
    const abort = () => {
      if (signal?.reason === 'disconnected') { finish({ disconnected: true, completed: false }); return; }
      stopping = true;
      onProgress?.({ elapsed: Date.now() - started, stopping: true });
      stopTimer = setTimeout(() => finish({ stopped: true, completed: false, note: 'Interrupt sent, completion not confirmed. Inspect terminal before continuing.' }), stopTimeout);
      try { target.input('\x03'); } catch { finish({ stopped: true, completed: false }); }
    };
    const timer = setInterval(() => {
      if (stopping) return;
      const elapsed = Date.now() - started, idle = Date.now() - lastOutput;
      const reminder = !reminded && elapsed >= reminderAfter; if (reminder) reminded = true;
      onProgress?.({ elapsed, idle, longRunning: elapsed >= timeout, reminder, waitingInput: /(?:password\s*:|passphrase[^\r\n]*:|\[y\/n\]|\(yes\/no[^)]*\)|密码[^\r\n]*[:：])\s*$/i.test(tail.slice(-500)) });
    }, progressInterval);
    unsubscribe = target.subscribeOutput(text => {
      lastOutput = Date.now();
      tail = (tail + text).slice(-128000);
      if (output.length + text.length > 64000) truncated = true;
      output = (output + text).slice(-64000);
      const observed = ['cmd', 'powershell'].includes(shell) ? tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]/g, '') : tail;
      const match = observed.match(completion);
      if (match) { output = output.replace(completion, ''); finish({ completed: true, stopped: stopping, code: match[1] === undefined ? null : Number(match[1]), note: 'Executed in the existing visible terminal. CMD exit code is unavailable.' }); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { finish({ stopped: true, completed: false }); return; }
    try { target.input(payload); } catch (error) { finish(null, error); }
  });
}
module.exports = { terminalCommand };
