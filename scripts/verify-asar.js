'use strict';
const path = require('path'), crypto = require('crypto');
const {readAsar} = require('app-builder-lib/out/asar/asar');
async function verifyAsar(archive) {
  const filesystem = await readAsar(archive);
  let count = 0;
  async function visit(node, parts = []) {
    for (const [name, entry] of Object.entries(node.files || {})) {
      if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw Error('Invalid ASAR path');
      const relative = [...parts, name];
      if (entry.files) { await visit(entry, relative); continue; }
      if (entry.link) continue;
      const file = path.join(...relative), contents = await filesystem.readFile(file);
      if (contents.length !== entry.size) throw Error('ASAR size mismatch: ' + file);
      if (entry.integrity?.algorithm !== 'SHA256' || crypto.createHash('sha256').update(contents).digest('hex') !== entry.integrity.hash) throw Error('ASAR integrity mismatch: ' + file);
      count++;
    }
  }
  await visit(filesystem.header);
  return count;
}
if (require.main === module) verifyAsar(path.resolve(process.argv[2])).then(count => console.log('Verified ASAR file contents:', count)).catch(error => {console.error(error);process.exitCode=1;});
module.exports = {verifyAsar};
