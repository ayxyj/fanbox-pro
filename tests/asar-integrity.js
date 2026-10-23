'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const asar=require('@electron/asar');
const {verifyAsar}=require('../scripts/verify-asar');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fanbox-asar-test-'));
  try {
    const source=path.join(root,'source'),archive=path.join(root,'app.asar');fs.mkdirSync(source);
    fs.writeFileSync(path.join(source,'main.js'),'console.log("verified");\n');
    await asar.createPackage(source,archive);
    assert.equal(await verifyAsar(archive),1);
    const data=fs.readFileSync(archive);data[data.length-2]^=1;fs.writeFileSync(archive,data);
    await assert.rejects(verifyAsar(archive),/integrity mismatch/);
    console.log('PASS ASAR verification accepts valid files and rejects corrupted payloads');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
