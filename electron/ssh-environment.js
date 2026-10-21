'use strict';
const { randomBytes } = require('crypto');
function promptKind(output) {
  const text = String(output).replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  const line = text.split(/[\r\n]/).filter(s=>s.trim()).at(-1)?.trim() || '';
  if (/^PS [A-Za-z]:\\[^>\r\n]*>$/.test(line)) return 'powershell';
  if (/^[A-Za-z]:\\[^>\r\n]*>$/.test(line)) return 'cmd';
  if (/^(?:\[[^\]\r\n]+@[^\]\r\n]+\]|[\w.-]+@[\w.-]+:[^\r\n]*)\s*[#$]$/.test(line)) return 'posix';
  return null;
}
async function detectEnvironment(session, signal, timeout = 5000) {
  const kind = promptKind(session.output);
  if (!kind || session.inputLine?.trim()) throw Error('自动识别暂未完成：终端尚未停在可识别的 Shell 提示符，请先完成服务器登录。');
  const nonce = randomBytes(12).toString('hex'), marker = '__FB_' + nonce + '__';
  const command = kind === 'posix'
    ? `printf '__FB_%s__' '${nonce}'; uname -s\r`
    : kind === 'cmd' ? `echo ${marker}%OS%\r`
      : `Write-Output ('__FB_'+'${nonce}'+'__'+[System.Environment]::OSVersion.Platform)\r`;
  const revision = session.inputRevision || 0;
  return new Promise((resolve,reject)=>{
    let output='',timer,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);session.stream.off('data',read);session.stream.off('close',closed);signal?.removeEventListener('abort',abort);session.abort.signal.removeEventListener('abort',closed);error?reject(error):resolve(value);};
    const abort=()=>finish(Error('系统识别已取消'));
    const closed=()=>finish(Error('SSH 连接已关闭'));
    const read=chunk=>{
      if ((session.inputRevision||0)!==revision) return finish(Error('终端已被手动操作，自动识别已停止'));
      output=(output+chunk.toString()).slice(-16000);
      const match=output.match(new RegExp(marker+'(Linux|Darwin|FreeBSD|OpenBSD|Windows_NT|Win32NT)\\r?\\n'));
      if(!match)return;
      const os=kind==='posix'?match[1].toLowerCase():'windows';
      if(kind!=='posix'&&!['Windows_NT','Win32NT'].includes(match[1]))return;
      finish(null,{os,shell:kind==='cmd'?'cmd.exe':kind==='powershell'?'powershell.exe':'/bin/sh',cwd:'',automaticallyDetected:true});
    };
    session.stream.on('data',read);session.stream.once('close',closed);
    signal?.addEventListener('abort',abort,{once:true});session.abort.signal.addEventListener('abort',closed,{once:true});
    timer=setTimeout(()=>finish(Error('自动识别系统超时，请确认已进入目标服务器的命令行。')),timeout);
    if(signal?.aborted||session.abort.signal.aborted)return abort();
    try {session.stream.write(command);}catch(error){finish(error);}
  });
}
module.exports={promptKind,detectEnvironment};
