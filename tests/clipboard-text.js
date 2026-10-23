'use strict';
const assert=require('assert/strict');
const {writeClipboardText}=require('../electron/clipboard-text');
(async()=>{
  let value='',attempts=0;
  const busy={writeText(text){if(++attempts>=3)value=text;},readText(){return value;}};
  assert.equal(await writeClipboardText(busy,'中文\ntext',{wait:async()=>{}}),true);assert.equal(attempts,3);
  attempts=0;await assert.rejects(writeClipboardText({writeText(){attempts++;},readText(){return '';}},'blocked',{wait:async()=>{}}),/不可写/);assert.equal(attempts,4);
  console.log('PASS clipboard retries transient contention and reports persistent write failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
