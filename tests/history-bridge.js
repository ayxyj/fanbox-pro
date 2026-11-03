'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../electron/preload'), 'utf8');
const start = source.indexOf("contextBridge.exposeInMainWorld('fanboxRemote',");
const end = source.indexOf('\n});', start) + 4;
let bridge; const calls = [], listeners = [];
vm.runInNewContext(source.slice(start, end), {
 contextBridge: { exposeInMainWorld(name, value) { bridge = value; } },
 ipcRenderer: { invoke(channel, args) { calls.push({channel,args}); return Promise.resolve({ok:true}); }, on(channel) { listeners.push(channel); }, removeListener() {} }
});
(async () => {
 for (const action of ['history-all','history-preview','history-open','history-remove']) await bridge.call(action, {id:'fixture'});
 assert.deepEqual(calls.map(c=>c.channel), ['remote:history-all','remote:history-preview','remote:history-open','remote:history-remove']);
 bridge.on('history-changed', ()=>{}); assert.deepEqual(listeners, ['remote:history-changed']);
 await assert.rejects(bridge.call('untrusted-action'), /Unknown remote action/);
 console.log('PASS: history list, preview, restore and refresh cross the preload bridge; unknown actions remain blocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
