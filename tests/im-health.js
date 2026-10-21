'use strict';
const assert=require('assert/strict'),{EventEmitter}=require('events');
const {WecomService}=require('../electron/wecom-service');
class Client extends EventEmitter {connect(){}disconnect(){this.emit('disconnected','closed');}}
let decryptFails=true;
const store={data:{im:{enabled:true,botId:'fixture',secret:'encrypted',users:['alice']}},persist(){},encrypt:s=>Buffer.from(s).toString('base64'),vault:{decryptString:b=>{if(decryptFails)throw Error('fixture decrypt error');return b.toString();}}};
const service=new WecomService({store,Client,emit(){},stopAI(){},closeCLI(){}});
service.start();assert.equal(service.state().status,'error');assert.match(service.state().error,/解密/);
assert.deepEqual(store.data.im.users,['alice']);assert.equal(store.data.im.secret,'encrypted');
decryptFails=false;service.save({secret:'fresh-fixture'});
service.client.emit('authenticated');assert.equal(service.state().status,'connected');assert.equal(service.state().error,'');
const old=service.client,route={sessionId:'fixture-terminal'};service.routes.set('fixture',route);
old.emit('disconnected','new connection replaced');assert.match(service.state().error,/挤下线/);
service.reconnect();assert.notEqual(service.client,old);assert.equal(service.routes.get('fixture'),route);
old.emit('authenticated');assert.equal(service.state().status,'connecting');
service.client.emit('error',{code:'WS_AUTH_FAILURE_EXHAUSTED'});assert.equal(service.state().status,'error');
service.client.emit('authenticated');assert.equal(service.state().error,'');
assert(!JSON.stringify(service.state()).includes('fresh-fixture'));
service.stop();console.log('PASS: decrypt failure preserves settings, credential replacement, disconnect diagnosis, reconnect keeps routes, stale events ignored');
