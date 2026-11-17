"use strict";
const { execFile } = require('child_process');
function cronField(spec, min, max) {
  if (spec === '*') return null; // null = 不限
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) return undefined; // 解析失败
    const step = m[3] ? parseInt(m[3], 10) : 1;
    if (!step) return undefined;
    let lo, hi;
    if (m[1] === '*') { lo = min; hi = max; }
    else { lo = parseInt(m[1], 10); hi = m[2] ? parseInt(m[2], 10) : (m[3] ? max : lo); }
    if (lo < min || hi > max + (max === 6 ? 1 : 0) || lo > hi) return undefined; // 周允许 7
    for (let v = lo; v <= hi; v += step) set.add(max === 6 && v === 7 ? 0 : v);
  }
  return set;
}
function cronParse(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if(parts.length !== 5) throw Error('Cron 需要五个字段：分 时 日 月 周');
  const ranges = [[0,59],[0,23],[1,31],[1,12],[0,6]];
  const fields = parts.map((p,i)=>cronField(p,...ranges[i]));
  if(fields.some(f=>f===undefined)) throw Error('Cron 表达式无效，请检查范围和步长');
  return fields;
}
function cronMatches(expr,d) {
  const [mi,h,day,mon,week]=cronParse(expr), match=(f,v)=>!f||f.has(v);
  const dayOK=day&&week ? match(day,d.getDate())||match(week,d.getDay()) : match(day,d.getDate())&&match(week,d.getDay());
  return match(mi,d.getMinutes())&&match(h,d.getHours())&&match(mon,d.getMonth()+1)&&dayOK;
}
class WecomWake {
  constructor(store) {
    this.store = store; this.busy = false; this.lastSlot = '';
    this.timer = setInterval(() => this.tick(), 15000); this.timer.unref();
  }
  config() {
    const saved=this.store.data.wecomWake || {};
    const legacy=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(saved.time || '');
    return { enabled:false, scheduled:false, ...saved, cron:saved.cron || (legacy ? `${Number(legacy[2])} ${Number(legacy[1])} * * *` : '*/5 * * * *') };
  }
  setVisible(visible) {
    const old=this.store.data.wecomWake;
    this.store.data.wecomWake={...this.config(),visible};
    try { this.store.persist(); } catch(e) { this.store.data.wecomWake=old; throw e; }
  }
  save(input) {
    if(typeof input.enabled !== 'boolean' || typeof input.scheduled !== 'boolean') throw Error('唤醒设置无效');
    cronParse(input.cron);
    const old=this.store.data.wecomWake;
    this.store.data.wecomWake={enabled:input.enabled,scheduled:input.scheduled,cron:input.cron.trim(),visible:this.config().visible === true};
    try { this.store.persist(); } catch(e) { this.store.data.wecomWake=old; throw e; }
    return this.config();
  }
  tick() {
    const c=this.config(), d=new Date(), slot=Math.floor(d.getTime()/60000);
    if(!c.enabled || !c.scheduled || slot===this.lastSlot) return;
    try { if(!cronMatches(c.cron,d)) return; } catch { return; }
    this.lastSlot=slot;
    this.run().catch(()=>{});
  }
  async run() {
    if (!this.config().enabled) throw Error('请先在宠物面板启用企微唤醒');
    if (process.platform !== 'win32') throw Error('企微唤醒仅支持 Windows');
    if(this.busy) throw Error('正在唤醒，请稍后');
    this.busy = true;
    const script = `$ErrorActionPreference = "Stop"
try {
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FanboxWake {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
 public static Point Position() { Point p; if(!GetCursorPos(out p)) throw new Exception("WAKE_DESKTOP_UNAVAILABLE"); return p; }
 [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public MouseInput mouse; }
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,Input[] inputs,int size);
 public static void Move(int x,int y) {
   Input input=new Input(); input.type=0; input.mouse.dx=x; input.mouse.dy=y; input.mouse.flags=0x2001;
   if(SendInput(1,new Input[]{input},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("Mouse input blocked");
 }
}
"@
$session=(Get-Process -Id $PID).SessionId
$all=@(Get-Process WXWork -ErrorAction SilentlyContinue)
if(!$all.Count){throw 'WAKE_NOT_RUNNING'}
$mine=@($all | Where-Object {$_.SessionId -eq $session})
if(!$mine.Count){throw 'WAKE_OTHER_SESSION'}
$moved=$false
for($i=0;$i -lt 3;$i++) {
 $before=[FanboxWake]::Position()
 [FanboxWake]::Move(45,0)
 Start-Sleep -Milliseconds 300
 $after=[FanboxWake]::Position()
 if($before.X -ne $after.X -or $before.Y -ne $after.Y){$moved=$true}
 [FanboxWake]::Move(-45,0)
 Start-Sleep -Milliseconds 300
 $back=[FanboxWake]::Position()
 if($after.X -ne $back.X -or $after.Y -ne $back.Y){$moved=$true}
}
if(!$moved){throw 'WAKE_CURSOR_UNCHANGED'}
Write-Output 'WAKE_OK'
} catch {
 Write-Output ('WAKE_ERROR:' + $_.Exception.Message)
 exit 1
}
`;
    try {
      await new Promise((resolve,reject) => execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000},(error,stdout) => {
        if(!error) return resolve(stdout);
        const messages = {
          WAKE_NOT_RUNNING:'当前机器没有运行企业微信，请先打开并登录。',
          WAKE_OTHER_SESSION:'企业微信运行在另一个 Windows 会话，请在企业微信所在的同一会话启动 FanBox。',
          WAKE_CURSOR_UNCHANGED:'已尝试鼠标输入，但未检测到光标位移。VDI 锁屏或断开可能阻止了输入，请连接并解锁后重试。',
          WAKE_DESKTOP_UNAVAILABLE:'当前桌面不可操作，请连接并解锁远程桌面后重试。',
          'Mouse input blocked':'Windows 拒绝模拟鼠标输入，请确认桌面已解锁，并让 FanBox 与企业微信使用相同的运行权限。'
        };
        const key=Object.keys(messages).find(k=>String(stdout).includes(k));
        reject(Error(key ? messages[key] : error.killed ? '唤醒超时，请重试；若持续失败，请检查远程桌面状态。' : '唤醒程序执行失败，请确认 Windows PowerShell 可正常运行。'));
      }));
      return '已检测到光标位移，请在手机确认企微在线状态。';
    } finally { this.busy = false; }
  }
}
module.exports = { WecomWake, cronParse, cronMatches };
