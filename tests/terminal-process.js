'use strict';
const assert = require('assert/strict');
const { spawn } = require('child_process');
const { inspectProcess } = require('../electron/terminal-process');
const row = (ProcessId, ParentProcessId, Name, CommandLine = '') => ({ ProcessId, ParentProcessId, Name, CommandLine });
(async () => {
  const target = { identity: { pid: 10 } }, root = row(10, 1, 'cmd.exe');
  assert.equal((await inspectProcess(target, async () => [root])).idle, true);
  const rows = [root, row(11, 10, 'cmd.exe'), row(12, 11, 'node.exe', 'node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'), row(13, 1, 'codex.exe')];
  assert.deepEqual(await inspectProcess(target, async () => rows), { name: 'claude', idle: false });
  assert.equal((await inspectProcess(target, async () => [root, row(11, 10, 'python.exe')])).idle, false);
  assert.equal((await inspectProcess(target, async () => [root, row(11, 10, 'conhost.exe')])).idle, true);
  await assert.rejects(inspectProcess(target, async () => []), /已退出/);
  await assert.rejects(inspectProcess(target, async () => { throw Error('timeout'); }), /timeout/);
  if (process.platform === 'win32') {
    const shell = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/q'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const live = { identity: { pid: shell.pid } }, start = Date.now();
      assert.equal((await inspectProcess(live)).idle, true);
      console.log('Live Windows idle inspection:', Date.now() - start, 'ms');
      // A real child must prevent shell-idle detection, even if it is not a known CLI.
      const ready = new Promise(resolve => shell.stdout.on('data', data => { if (data.toString().includes('CHILD_READY')) resolve(); }));
      shell.stdin.write('node -e "console.log(\'CHILD_READY\');setTimeout(()=>{},6000)"\r\n');
      await ready;
      assert.equal((await inspectProcess(live)).idle, false);
      await new Promise(resolve => setTimeout(resolve, 6500));
      shell.stdin.end('exit\r\n');
      await new Promise(resolve => shell.once('exit', resolve));
      await assert.rejects(inspectProcess(live), /已退出/);
    } finally { shell.kill(); }
  }
  console.log('PASS: process tree isolation, unknown busy process, missing terminal and real Windows process query');
})().catch(error => { console.error(error); process.exitCode = 1; });
