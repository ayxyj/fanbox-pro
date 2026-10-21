'use strict';
const assert=require('assert/strict'),http=require('http');
const {modelSettings,testModel}=require('../electron/model-settings');
const {requestModel}=require('../electron/model-api');
(async()=>{
 assert.throws(()=>modelSettings([{id:'a',temperature:3}]),/参数/);assert.throws(()=>modelSettings([{id:'a'},{id:'a'}]),/重复/);assert.throws(()=>modelSettings([{id:'a',contextWindow:1000,maxTokens:2000}]),/超过/);
 const requests=[];const server=http.createServer((req,res)=>{let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{requests.push({url:req.url,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/messages')?{content:[{type:'text',text:'OK'}]}:{choices:[{message:{role:'assistant',content:'OK'}}]}));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const config={baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',protocol:'openai',apiKey:'fixture'};const model={id:'one',maxTokens:32,temperature:.5,reasoningEffort:'low',contextWindow:200000};
 const result=await testModel(config,model);assert.equal(result.reply,'OK');assert(result.elapsedMs>=0);assert.equal(requests[0].body.max_tokens,32);assert.equal(requests[0].body.reasoning_effort,'low');assert.equal(requests[0].body.tools,undefined);assert.equal(requests[0].body.stream,undefined);
 await requestModel({...config,protocol:'anthropic',model:'one',selectedModels:[model]},[{role:'user',content:'Hi'}],[],new AbortController().signal);assert.equal(requests[1].body.temperature,.5);assert.equal(requests[1].body.reasoning_effort,undefined);assert.equal(requests[1].body.max_tokens,32);
 console.log('PASS: model settings validation, short no-tool test, OpenAI and Anthropic parameters');
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
