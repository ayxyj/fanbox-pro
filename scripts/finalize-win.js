'use strict';
const fs = require('fs');
const path = require('path');
const R = require('resedit');
const { computeData } = require('app-builder-lib/out/asar/integrity');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const dist = path.resolve(__dirname, '..', 'dist') + path.sep;
  if (!dir.startsWith(dist)) throw new Error('Expected a packaged directory within dist');
  const pkg = require('../package.json');
  const verified = await require('./verify-asar').verifyAsar(path.join(dir, 'resources', 'app.asar'));
  console.log('Verified ASAR file contents:', verified);
  const name = pkg.build.productName;
  const file = path.join(dir, name + '.exe');
  const executable = R.NtExecutable.from(fs.readFileSync(file));
  const resources = R.NtExecutableResource.from(executable);
  const version = R.Resource.VersionInfo.fromEntries(resources.entries)[0];
  for (const lang of version.getAllLanguagesForStringValues()) version.setStringValues(lang, {
    ProductName: name, FileDescription: name, InternalName: name,
    OriginalFilename: name + '.exe', FileVersion: pkg.version, ProductVersion: pkg.version,
  });
  const numbers = pkg.version.split('.').map(Number);
  version.setFileVersion(...numbers, 0); version.setProductVersion(...numbers, 0);
  version.outputToResourceEntries(resources.entries);
  const icon = R.Data.IconFile.from(fs.readFileSync(path.resolve(__dirname, '..', pkg.build.win.icon)));
  R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icon.icons.map(i => i.data));
  const integrity = await computeData({ resourcesPath: path.join(dir, 'resources'), resourcesRelativePath: 'resources' });
  resources.entries = resources.entries.filter(e => e.type !== 'INTEGRITY');
  resources.entries.push({ type: 'INTEGRITY', id: 'ELECTRONASAR', lang: 1033, codepage: 1200,
    bin: Buffer.from(JSON.stringify(Object.entries(integrity).map(([file, { algorithm: alg, hash: value }]) => ({ file, alg, value })))) });
  resources.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
  console.log('Finalized metadata, icon and ASAR integrity:', file);
})().catch(error => { console.error(error); process.exitCode = 1; });
