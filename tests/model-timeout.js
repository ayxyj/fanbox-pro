'use strict';
const assert=require('assert/strict'),http=require('http');const {requestModel}=require('../electron/model-api');
(async()=>{
 const server=http.createServer((req,res)=>{let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{const {model}=JSON.parse(raw);res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();if(model==='silent')return;let count=0;const timer=setInterval(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:'a'}}]})+'\n\n');if(++count===12){clearInterval(timer);res.end('data: [DONE]\n\n');}},50);res.on('close',()=>clearInterval(timer));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const config={baseUrl:'http://127.0.0.1:'+server.address().port,model:'stream',responseIdleTimeoutMs:200};
 try{const reply=await requestModel(config,[{role:'user',content:'test'}],[],new AbortController().signal,()=>{});assert.equal(reply.content,'a'.repeat(12),'Streaming must outlive total timeout');
 await assert.rejects(requestModel({...config,model:'silent'},[],[],new AbortController().signal,()=>{}),/没有返回新数据/);
 const abort=new AbortController();const pending=requestModel({...config,model:'silent'},[],[],abort.signal,()=>{});setTimeout(()=>abort.abort(),30);await assert.rejects(pending,/已停止/);
 console.log('PASS: ongoing stream extends idle deadline, stalled body localized, user stop distinct');
 }finally{server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
