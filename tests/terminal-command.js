'use strict';
const assert = require('assert/strict');
const { terminalCommand } = require('../electron/terminal-command');
function fixture(shell = '/bin/bash') {
 const listeners = new Set(), writes = [];
 return { writes, emit: text => [...listeners].forEach(fn => fn(text)), listeners, environment: { shell }, input(text) { writes.push(text); }, subscribeOutput(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
(async () => {
 const t = fixture(); const run = terminalCommand(t, "cd /tmp; export DEMO='yes'; pwd", { timeout: 1000 });
 const wire = t.writes[0], token = wire.match(/777;(fanbox-[a-f0-9-]+);/)[1];
 t.emit(wire); // The echoed command must not count as completion.
 assert.equal(t.listeners.size, 1);
 t.emit('visible-output\r\n' + 'x'.repeat(70000));
 t.emit('\x1b]777;' + token.slice(0, 10)); t.emit(token.slice(10) + ';7\x07');
 const result = await run; assert.equal(result.code, 7); assert(result.completed); assert(result.truncated); assert.equal(t.listeners.size, 0);
 const delayed = fixture(), progress = []; let settled = false;
 const pending = terminalCommand(delayed, 'sleep 100', { timeout: 15, reminderAfter: 25, progressInterval: 5, onProgress: event => progress.push(event) }).then(result => { settled = true; return result; });
 await new Promise(resolve => setTimeout(resolve, 60));
 assert(!settled); assert(progress.some(event => event.longRunning)); assert.equal(progress.filter(event => event.reminder).length, 1); assert.equal(delayed.writes.length, 1); assert.equal(delayed.listeners.size, 1);
 const delayedToken = delayed.writes[0].match(/777;(fanbox-[a-f0-9-]+);/)[1];
 delayed.emit('\x1b]777;' + delayedToken + ';0\x07'); assert((await pending).completed); assert.equal(delayed.listeners.size, 0);
 const abort = new AbortController(), cancelled = fixture(); const cancelledRun = terminalCommand(cancelled, 'sleep 100', { signal: abort.signal, stopTimeout: 15 }); abort.abort(); const stopped = await cancelledRun; assert(stopped.stopped); assert(!stopped.completed); assert.equal(cancelled.writes.at(-1), '\x03'); assert.equal(cancelled.listeners.size, 0);
 const disconnect = new AbortController(), lost = fixture(); const lostRun = terminalCommand(lost, 'sleep 100', { signal: disconnect.signal }); disconnect.abort('disconnected'); assert((await lostRun).disconnected); assert.equal(lost.writes.length, 1); assert.equal(lost.listeners.size, 0);
 const cmd = fixture('cmd'); const cmdRun = terminalCommand(cmd, 'cd /d C:\\ & echo test'); const marker = cmd.writes[0].replace('^', '').match(/__(fanbox-[a-f0-9-]+)__/)[0]; cmd.emit(cmd.writes[0]); assert.equal(cmd.listeners.size, 1); cmd.emit('\r\n'+marker+'\r\n'); assert((await cmdRun).completed);
 assert.throws(() => terminalCommand(fixture(), 'echo hi\x03'), /控制字符/);
 const bash = process.platform === 'win32' ? 'D:/Program Files/Git/bin/bash.exe' : '/bin/bash';
 if (require('fs').existsSync(bash)) {
  const child = require('child_process').spawn(bash, ['--noprofile','--norc'], { stdio: ['pipe','pipe','pipe'], windowsHide: true });
  const target = { environment: { shell: '/bin/bash' }, input: text => child.stdin.write(text.replace(/\r/g, '\n')), subscribeOutput: fn => { const handler = b => fn(b.toString()); child.stdout.on('data',handler); child.stderr.on('data',handler); return () => { child.stdout.off('data',handler); child.stderr.off('data',handler); }; } };
  try { assert((await terminalCommand(target, 'cd /tmp; export FANBOX_PERSIST=retained', {timeout:5000})).completed); const retained=await terminalCommand(target, 'printf "%s" "$FANBOX_PERSIST"; pwd', {timeout:5000}); assert(retained.completed); assert(retained.output.includes('retained/tmp')); const failed=await terminalCommand(target, 'false', {timeout:5000}); assert.equal(failed.code,1); } finally { child.stdin.end(); child.kill(); }
 }
 console.log('PASS: completion markers, persistent long-command monitoring, one reminder, bounded output, Ctrl+C confirmation timeout, disconnect cleanup and real Bash execution.');
})().catch(e => {console.error(e);process.exitCode=1;});
