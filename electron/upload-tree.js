 'use strict';
const fs = require('fs/promises'), path = require('path');
// A directory maps to the destination itself, without adding its basename.
async function uploadTree(local, remote, { check, mkdir, upload, progress = () => {} }) {
  let files = 0, directories = 0;
  const walk = async (source, destination) => {
    check();
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw Error('不支持上传符号链接：' + source);
    if (stat.isDirectory()) {
      await mkdir(destination); directories++;
      for (const entry of await fs.readdir(source)) await walk(path.join(source, entry), path.posix.join(destination, entry));
    } else if (stat.isFile()) {
      check(); await upload(source, destination); files++; progress({ files, directories, path: destination });
    } else throw Error('不支持此文件类型：' + source);
  };
  await walk(local, remote);
  return { ok: true, files, directories, remote };
}
module.exports = { uploadTree };
