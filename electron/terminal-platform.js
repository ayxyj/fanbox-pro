'use strict';
const os=require('os');
// xterm 5.5 and ConPTY both reflowing the active screen can push redraws into
// scrollback. Let Windows own wrapping/repainting instead of doing it twice.
// Historical long lines retain their original widths and characters.
// Omit buildNumber deliberately: modern-build mode re-enables client reflow.
// See https://github.com/xtermjs/xterm.js/issues/5319
function getLocalTerminalOptions(platform=process.platform,release=os.release()) {
  if(platform!=='win32')return {};
  const build=Number(/^(?:\d+)\.(?:\d+)\.(\d+)/.exec(release)?.[1])||0;
  return {windowsMode:true,windowsPty:{backend:build>=18309?'conpty':'winpty'}};
}
const sizes=new WeakMap();
function resizePty(pty,cols,rows) {
  if(!pty||!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<1||cols>10000||rows>10000)return false;
  const last=Number.isInteger(pty.cols)&&Number.isInteger(pty.rows)?pty:sizes.get(pty);
  if(last?.cols===cols&&last?.rows===rows)return false;
  pty.resize(cols,rows);sizes.set(pty,{cols,rows});return true;
}
module.exports={getLocalTerminalOptions,resizePty};
