'use strict';
const assert = require('assert/strict'), http = require('http');
const { connection, listModels } = require('../electron/model-catalog');
const { RemoteStore } = require('../electron/remote-store');
(async () => {
  const requests = [];
  const server = http.createServer((req,res) => {
    requests.push({url:req.url,auth:req.headers.authorization,key:req.headers['x-api-key'],version:req.headers['anthropic-version']});
    if(req.url.startsWith('/bad/')) { res.writeHead(401);return res.end('secret should not be echoed'); }
    if(req.url.startsWith('/redirect/')) { res.writeHead(302,{location:'/v1/models'});return res.end(); }
    res.setHeader('Content-Type','application/json');
    if(req.url.startsWith('/claude/'))return res.end(JSON.stringify(req.url.includes('after_id=') ? {data:[{id:'c2',display_name:'Claude two'}],has_more:false} : {data:[{id:'c1'}],has_more:true,last_id:'c1'}));
    res.end(JSON.stringify({data:[{id:'model-b'},{id:'model-a'},{id:'model-a'},{}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal(connection({baseUrl:'http://192.168.1.8:8000/v1/'}).baseUrl,'http://192.168.1.8:8000/v1');
    assert.throws(()=>connection({baseUrl:'file:///tmp/a'}),/HTTP/);
    assert.throws(()=>connection({baseUrl:'http://name:pass@example.com/v1'}),/凭据/);
    assert.deepEqual((await listModels({baseUrl:base+'/v1',apiKey:'fixture'})).map(m=>m.id),['model-a','model-b']);
    assert.equal(requests[0].auth,'Bearer fixture');
    assert.deepEqual((await listModels({baseUrl:base+'/claude',protocol:'anthropic',apiKey:'fixture-c'})).map(m=>m.id),['c1','c2']);
    assert.equal(requests[1].key,'fixture-c');assert.equal(requests[1].version,'2023-06-01');assert(requests[2].url.includes('after_id=c1'));
    await assert.rejects(listModels({baseUrl:base+'/bad'}),error=>error.message.includes('401')&&!error.message.includes('secret'));
    await assert.rejects(listModels({baseUrl:base+'/redirect'}),/无法连接/);
    const { authHeaders, catalogEndpoint } = require('../electron/model-provider');
    const ark={baseUrl:'https://ark.cn-beijing.volces.com/api/coding',protocol:'anthropic',apiKey:'fixture-ark'};
    assert.equal(authHeaders(ark).Authorization,'Bearer fixture-ark');assert.equal(authHeaders(ark)['x-api-key'],undefined);
    assert.equal(authHeaders({...ark,baseUrl:'https://api.anthropic.com'})['x-api-key'],'fixture-ark');
    assert.equal(authHeaders({...ark,baseUrl:'https://ark.cn-beijing.volces.com.attacker.test/api/coding'}).Authorization,undefined);
    assert.equal(catalogEndpoint(ark.baseUrl,'anthropic'),'https://ark.cn-beijing.volces.com/api/coding/v3/models');
    const originalFetch=global.fetch;
    try { global.fetch=async(url,options)=>{assert.equal(String(url),'https://ark.cn-beijing.volces.com/api/coding/v3/models');assert.equal(options.headers.Authorization,'Bearer fixture-ark');return new Response(JSON.stringify({data:[{id:'fixture-model'}]}));};assert.equal((await listModels(ark))[0].id,'fixture-model'); }
    finally{global.fetch=originalFetch;}
    const store=Object.assign(Object.create(RemoteStore.prototype),{data:{aiConfigs:[],activeAIId:'',ai:{}},persist(){},encrypt:s=>Buffer.from(s).toString('base64'),vault:{decryptString:b=>b.toString()}});
    const id=store.saveAI({name:'service',baseUrl:'http://192.168.1.8/v1',protocol:'anthropic',apiKey:'fixture',modelSlots:{haiku:'one',sonnet:'two',opus:'three'},defaultRole:'sonnet',activate:true});
    assert.equal(store.data.aiConfigs.length,1);assert.equal(store.aiConfig().model,'two');assert(!JSON.stringify(store.aiList()).includes('fixture'));
    const saved=store.data.aiConfigs[0];assert.equal(store.modelConnection({id,baseUrl:saved.baseUrl,protocol:'anthropic'}).apiKey,'fixture');
    assert.throws(()=>store.modelConnection({id,baseUrl:'http://other.test/v1'}),/重新输入/);
    store.saveAI({id,baseUrl:saved.baseUrl,protocol:'anthropic',modelSlots:{haiku:'one',sonnet:'two',opus:'one'},defaultRole:'opus'});
    assert.equal(store.data.aiConfigs.length,1);assert.equal(store.aiConfig().model,'one');
    assert.throws(()=>store.saveAI({id,baseUrl:saved.baseUrl,protocol:'anthropic',modelSlots:{haiku:'one'},defaultRole:'opus'}),/默认用途/);
    store.saveAI({id,baseUrl:saved.baseUrl,protocol:'openai',apiKey:'fixture',model:'openai-model'});
    assert.equal(store.data.aiConfigs.length,1);assert.deepEqual(store.aiConfig().modelSlots,{});assert.equal(store.aiConfig().model,'openai-model');
    console.log('PASS: HTTP, auth, pagination, secrets, single service with role mapping, repeated models, default role and OpenAI');

  } finally {server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
