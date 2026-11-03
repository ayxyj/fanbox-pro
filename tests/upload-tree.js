'use strict';
const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),os=require('os');
const {uploadTree}=require('../electron/upload-tree');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fanbox-upload-'));
 await fs.mkdir(path.join(root,'子目录','empty'),{recursive:true});
 await fs.writeFile(path.join(root,'a.txt'),'one'); await fs.writeFile(path.join(root,'子目录','b.txt'),'two');
 const dirs=[],files=[];
 const callbacks={check(){},mkdir:async r=>dirs.push(r),upload:async(l,r)=>files.push(r)};
 const result=await uploadTree(root,'/root/docs',callbacks);
 assert.equal(result.files,2);assert.equal(result.directories,3);
 assert(dirs.includes('/root/docs/子目录/empty'));assert(files.includes('/root/docs/子目录/b.txt'));assert(files.includes('/root/docs/a.txt'));
 await assert.rejects(uploadTree(root,'/root/docs',{...callbacks,check(){throw Error('revoked');}}),/revoked/);
 console.log('PASS: recursive upload, nested Unicode files, empty directories, direct destination mapping and revoked permission');
})().catch(e=>{console.error(e);process.exitCode=1;});
