'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const result = spawnSync(process.execPath, [
  require.resolve('node-gyp/bin/node-gyp.js'),
  'rebuild',
  `--target=${require('electron/package.json').version}`,
  '--dist-url=https://www.electronjs.org/headers',
  '--arch=x64',
], {
  cwd: path.dirname(require.resolve('node-pty/package.json')),
  stdio: 'inherit',
});

if (result.error) console.error(result.error.message);
process.exit(result.status === null ? 1 : result.status);
