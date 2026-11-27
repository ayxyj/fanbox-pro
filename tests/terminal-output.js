'use strict';
const assert = require('node:assert/strict');
const { createTerminalOutput } = require('../public/terminal-output');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let parsed = [], callbacks = [], acknowledgements = [];
  const renderer = createTerminalOutput((data, done) => {parsed.push(data); callbacks.push(done);},
    (count,generation) => acknowledgements.push({count,generation}));
  renderer.receive('第一段',1);
  assert.deepEqual(parsed,['第一段'],'An idle renderer submits the first chunk immediately');
  renderer.receive('\x1b[31m',1); renderer.receive('尾段',1);
  assert.equal(acknowledgements.length,0,'Never ack before parsing');
  renderer.receive('next',2); await delay(10); assert.equal(parsed.length,1,'Only one write in flight');
  let flushed=false;const flush=renderer.flush().then(value=>{flushed=value;});await delay(5);assert.equal(flushed,false,'Question reads must wait for queued output');
  callbacks.shift()(); await delay(10);
  assert.equal(parsed[1],'\x1b[31m尾段'); assert.equal(acknowledgements[0].generation,1);
  callbacks.shift()();
  await delay(10);
  assert.equal(parsed[2],'next'); assert.equal(acknowledgements[1].generation,1);
  callbacks.shift()();
  await flush;assert.equal(flushed,true,'Flush completes after both generations parse');
  assert.equal(acknowledgements[2].generation,2);
  renderer.receive('in flight'); renderer.receive('dispose'); const cancelledFlush=renderer.flush();
  renderer.dispose();assert.equal(await cancelledFlush,false);callbacks.shift()(); await delay(10);
  assert.equal(parsed.length,4);
  console.log('PASS terminal batching, ordering, serialized parsing, completion callbacks and disposal');
})().catch(error => {console.error(error); process.exitCode=1;});
