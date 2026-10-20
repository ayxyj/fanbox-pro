'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { RemoteStore } = require('../electron/remote-store');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-recovery-'));
const vault = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => {
  if (value.toString() === 'broken') throw Error('decryptString ciphertext');
  return value.toString();
} };
try {
  const store = new RemoteStore(directory, vault);
  const id = store.save({ host: 'localhost', username: 'test', password: 'old', remember: true });
  store.memory.clear(); store.data.profiles[0].credentials = Buffer.from('broken').toString('base64');
  const ai = store.saveAI({ name: 'Test', baseUrl: 'https://example.com/v1', apiKey: 'old', model: 'test' });
  store.data.aiConfigs[0].key = Buffer.from('broken').toString('base64'); store.persist();
  const original = fs.readFileSync(store.file, 'utf8');
  assert.equal(store.get(id).credentialsUnavailable, true);
  assert.equal(store.get(id).password, undefined);
  assert.equal(store.list().length, 1);
  assert.equal(store.aiList().length, 1);
  assert.throws(() => store.aiConfig(false), /设置 → AI 配置/);
  assert.throws(() => store.save({ id, host: 'localhost', username: 'test', remember: true }), /清除已有凭据/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), original, 'failed reads must preserve ciphertext');
  store.save({ id, host: 'localhost', username: 'test', clearCredentials: true, password: 'new', remember: true });
  store.saveAI({ id: ai, baseUrl: 'https://example.com/v1', apiKey: 'new-key', model: 'test' });
  const reloaded = new RemoteStore(directory, vault);
  assert.equal(reloaded.get(id).password, 'new');
  assert.equal(reloaded.aiConfig(false).apiKey, 'new-key');
  console.log('PASS: unreadable credentials preserve configuration, SSH allows fresh input, AI gives recovery instructions, explicit replacement survives reload.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
