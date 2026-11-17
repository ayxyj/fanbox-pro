'use strict';
const { isTerminalReply } = require('./terminal-protocol');
// This is a conservative warning signal, not a parser that claims to identify a remote OS.
function noteInput(state, input) {
  if (isTerminalReply(input)) return;
  for (const char of String(input).replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, '')) {
    if (char === '\r' || char === '\n') {
      if (/(?:^|[;&|])\s*(?:[^\s]*[\\/])?(?:ssh(?:\.exe)?|gof|wcsssh)(?:\s|$)/i.test(state.inputLine || '')) { state.autoDetectAfterLogin = true; state.environmentAutoFailed = false; }
      else if (/(?:^|[;&|])\s*(?:wsl(?:\.exe)?|enter-pssession|docker\s+exec|kubectl\s+exec)(?:\s|$)/i.test(state.inputLine || '')) state.autoDetectAfterLogin = false;
      if (/(?:^|[;&|])\s*(?:&\s*)?(?:[^\s]*[\\/])?(?:ssh(?:\.exe)?|gof|wcsssh|wsl(?:\.exe)?|enter-pssession|docker\s+exec|kubectl\s+exec)(?:\s|$)/i.test(state.inputLine || '')) state.interactiveTargetUnknown = true;
      state.inputLine = '';
    } else if (char === '\x7f' || char === '\b') state.inputLine = (state.inputLine || '').slice(0, -1);
    else if (char === '\x03' || char === '\x15') state.inputLine = '';
    else if (char >= ' ') state.inputLine = ((state.inputLine || '') + char).slice(-4000);
  }
}
module.exports = { noteInput };
