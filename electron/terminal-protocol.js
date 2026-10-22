'use strict';
// xterm sends these reports through the same channel as keyboard input.
// They must reach the PTY without taking over an interaction or dirtying inputLine.
const isTerminalReply = text => typeof text === 'string' && /^(?:\x1b\[[IO]|\x1b\[[?>=]?[\d;]*[cRn]|\x1b\[\??\d+;\d+\$y|\x1b\[\d+(?:;\d+)*t|\x1bP[01]\$r[ -~]*?\x1b\\|\x1b\][^\x07]*(?:\x07|\x1b\\))+$/.test(text);
module.exports = { isTerminalReply };
