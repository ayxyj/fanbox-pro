'use strict';
const { execFile } = require('child_process');
const path = require('path');

function readProcesses() {
  // Fetch only required fields. Traverse in JS instead of repeatedly piping the
  // whole machine's processes through PowerShell's Where-Object.
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process' -OperationTimeoutSec 15 | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress";
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8'
  }, (error, stdout) => {
    if (error) {
      const reason = error.killed ? '查询超时' : '系统进程查询失败';
      return reject(Error(`无法确认终端前台进程（${reason}），未向终端发送内容，请重试`, { cause: error }));
    }
    try { const rows = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); if (!Array.isArray(rows)) throw Error(); resolve(rows); }
    catch { reject(Error('系统返回的终端进程状态无效，未向终端发送内容')); }
  }));
}

async function inspectProcess(target, read = readProcesses) {
  const pid = Number(target.identity.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('无法确认终端进程：终端进程编号无效');
  const rows = await read();
  if (!rows.some(p => p.ProcessId === pid)) throw Error('终端进程已退出，请重新创建会话');
  const byParent = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.ProcessId) || !Number.isSafeInteger(row.ParentProcessId) || typeof row.Name !== 'string') throw Error('系统返回的终端进程状态无效');
    if (!byParent.has(row.ParentProcessId)) byParent.set(row.ParentProcessId, []);
    byParent.get(row.ParentProcessId).push(row);
  }
  const visited = new Set([pid]), queue = [pid], children = [];
  for (let i = 0; i < queue.length; i++) for (const row of byParent.get(queue[i]) || []) {
    if (visited.has(row.ProcessId)) continue;
    visited.add(row.ProcessId); queue.push(row.ProcessId);
    if (!/^conhost\.exe$/i.test(row.Name)) children.push(row);
  }
  const packages = { claude: /@anthropic-ai[\\/]claude-code/i, codex: /@openai[\\/]codex/i, codebuddy: /@tencent-ai[\\/]codebuddy-code/i };
  const name = Object.keys(packages).find(n => children.some(p => p.Name.toLowerCase() === n + '.exe' || /^node\.exe$/i.test(p.Name) && packages[n].test(p.CommandLine || '')));
  return { name, idle: children.length === 0 };
}
module.exports = { inspectProcess, readProcesses };
