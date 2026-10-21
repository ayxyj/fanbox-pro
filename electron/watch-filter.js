'use strict';
const path = require('path');

// Ignore background application writes only while browsing the Windows home
// directory. Explicitly opened AppData folders and project folders stay live.
function isHomeAppDataChange(dir, filename, home, platform = process.platform) {
  if (platform !== 'win32' || !dir || !filename || !home) return false;
  const normalize = value => path.win32.resolve(value).toLowerCase();
  if (normalize(dir) !== normalize(home)) return false;
  const relative = path.win32.relative(home, path.win32.resolve(dir, String(filename)));
  return /^appdata(?:\\|$)/i.test(relative);
}
module.exports = { isHomeAppDataChange };
