'use strict';
const { randomUUID } = require('crypto');
const { promptKind } = require('./ssh-environment');

// Run in the already-open PTY, retaining its directory, variables and SSH connection.
// Completion is acknowledged by the shell, never inferred from a quiet terminal.
function terminalCommand(target, command, { signal, timeout = 60000, reminderAfter = 300000, progressInterval = 1000, stopTimeout = 10000, onProgress } = {}) {
  if (target.pendingInput?.trim()) throw Error('终端有尚未提交的输入，请先处理后再让 AI 执行');
  if (!target.subscribeOutput) throw Error('当前终端不支持输出监听');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(command)) throw Error('命令包含终端控制字符');
  const token = 'fanbox-' + randomUUID(), shell = target.environment.shell;
  let payload, completion;
  if (/^(?:.*\/)?(?:bash|zsh|sh|dash|ksh)$/.test(shell)) {
    // Keep multiline commands on one physical terminal input line.
    const quoted = "'" + command.replace(/'/g, "'\\''") + "'";
    const encoded = Array.from(Buffer.from(command, 'utf8'), byte => '\\' + byte.toString(8).padStart(3, '0')).join('');
    const wireQuoted = /[\r\n]/.test(command) ? `"$(printf '%b' '${encoded}')"` : quoted;
    payload = `eval ${wireQuoted}; printf '\\033]777;${token};%s\\007' "$?"\r`;
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
      if (signal?.reason === 'stop') { finish({ stopped: true, detached: true, completed: false, note: 'AI monitoring stopped. Terminal handed back to user; remote process status is unknown.' }); return; }
      stopping = true;
      onProgress?.({ elapsed: Date.now() - started, stopping: true });
      stopTimer = setTimeout(() => finish({ stopped: true, completed: false, note: 'Interrupt sent, completion not confirmed. Inspect terminal before continuing.' }), stopTimeout);
      try { target.input('\x03'); } catch { finish({ stopped: true, completed: false }); }
    };
    const timer = setInterval(() => {
      if (stopping) return;
      const elapsed = Date.now() - started, idle = Date.now() - lastOutput;
      if (idle >= 1000 && promptKind(tail)) {
        finish({ pending: true, completed: false, promptObserved: true, note: 'A shell prompt is visible, but the command completion marker is missing. The foreground shell may have changed. Verify target and result before continuing.' });
        return;
      }
      const reminder = !reminded && elapsed >= reminderAfter; if (reminder) reminded = true;
      onProgress?.({ elapsed, idle, longRunning: elapsed >= timeout, reminder, waitingInput: /(?:please select[^\r\n]*[:：]|password\s*:|passphrase[^\r\n]*:|\[y\/n\]|\(yes\/no[^)]*\)|密码[^\r\n]*[:：])\s*$/i.test(tail.slice(-500)) });
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
// Observe interactive login/menu output without waiting for the parent shell to exit.
function terminalInput(target, input, { signal, onProgress, timeout = 60000, reminderAfter = 300000, progressInterval = 1000, settleDelay = 500 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', updated = Date.now(), finished = false, unsubscribe = () => {};
    const started = Date.now();
    let reminded = false;
    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ output, completed: false, ...result });
    };
    const abort = () => finish({ stopped: true, detached: true, disconnected: signal?.reason === 'disconnected' });
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const waitingInput = /(?:please select[^\r\n]*[:：]|password\s*:|passphrase[^\r\n]*:|\(yes\/no[^)]*\)|\[y\/n\]|密码[^\r\n]*[:：])\s*$/i.test(output);
      const promptObserved = !!promptKind(output);
      if (output && Date.now() - updated >= settleDelay && (waitingInput || promptObserved)) {
        finish({ waitingInput, promptObserved, note: 'Observed terminal state only. Verify the menu selection and actual target with the user before further input. Exit code is unknown.' });
      } else {
        const reminder = !reminded && elapsed >= reminderAfter;
        if (reminder) reminded = true;
        onProgress?.({ elapsed, idle: Date.now() - updated, waitingInput, longRunning: elapsed >= timeout, reminder });
      }
    }, progressInterval);
    unsubscribe = target.subscribeOutput(text => { output = (output + text).slice(-16000); updated = Date.now(); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { target.input(input); } catch (error) { finish({}, error); }
  });
}
module.exports = { terminalCommand, terminalInput };
