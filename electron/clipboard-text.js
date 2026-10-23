'use strict';
// Windows clipboard ownership can briefly be held by another process. Electron's
// writeText returns no success flag, so do not report a silent failed write as success.
async function writeClipboardText(clipboard, text, {wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    clipboard.writeText(text);
    if (clipboard.readText() === text) return true;
    if (attempt < 3) await wait(25 * (attempt + 1));
  }
  throw Error('系统剪贴板暂时不可写，请稍后重试');
}
module.exports = {writeClipboardText};
