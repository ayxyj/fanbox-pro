'use strict';
const assert = require('node:assert/strict');
const { createTerminalOutput } = require('../public/terminal-output');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let parsed = [], callbacks = [], acknowledgements = [];
  const renderer = createTerminalOutput((data, done) => {parsed.push(data); callbacks.push(done);},
    (count,generation) => acknowledgements.push({count,generation}));
  renderer.receive('第一段',1); renderer.receive('\x1b[31m尾段',1);
  await delay(10);
  assert.equal(parsed.length,1); assert.equal(acknowledgements.length,0,'Never ack before parsing');
  renderer.receive('next',2); await delay(10); assert.equal(parsed.length,1,'Only one write in flight');
  callbacks.shift()(); await delay(10);
  assert.equal(parsed[1],'next'); assert.equal(acknowledgements[0].generation,1);
  callbacks.shift()();
  assert.equal(acknowledgements[1].generation,2);
  renderer.receive('dispose'); renderer.dispose(); await delay(10);
  assert.equal(parsed.length,2);
  console.log('PASS terminal batching, ordering, serialized parsing, completion callbacks and disposal');
})().catch(error => {console.error(error); process.exitCode=1;});
