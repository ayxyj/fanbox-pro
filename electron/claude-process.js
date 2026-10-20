'use strict';
const { execFile } = require('child_process');
async function isClaude(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  // Inspect descendants, not terminal titles or user-controlled shell output.
  const script = `$all=Get-CimInstance Win32_Process; $ids=@(${pid}); $found=@(); for($depth=0;$depth -lt 8;$depth++){ $children=@($all | Where-Object { $ids -contains [int]$_.ParentProcessId }); if(!$children.Count){break}; $found += $children; $ids=@($children | ForEach-Object {[int]$_.ProcessId}) }; $found | Select-Object Name,CommandLine | ConvertTo-Json -Compress`;
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) return resolve(false);
    try { const value = JSON.parse(stdout); resolve([].concat(value || []).some(p => /^claude\.exe$/i.test(p.Name) || /^node\.exe$/i.test(p.Name) && /@anthropic-ai[\\/]claude-code[\\/].*cli\.js/i.test(p.CommandLine || ''))); } catch { resolve(false); }
  }));
}
module.exports = { isClaude };
