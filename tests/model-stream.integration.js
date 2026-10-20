'use strict';
const assert = require('assert/strict'), http = require('http');
const { requestModel } = require('../electron/model-api');
const requests = [];
const server = http.createServer(async (req,res) => {
 let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests.push(body);res.setHeader('Content-Type','text/event-stream');
 let frames;
 if(req.url.endsWith('/messages')) frames=[
 {type:'message_start',message:{content:[]}},
 {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},
 {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'核对目标。'}},
 {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'fixture-signature'}},
 {type:'content_block_stop',index:0},
 {type:'content_block_start',index:1,content_block:{type:'text',text:''}},
 {type:'content_block_delta',index:1,delta:{type:'text_delta',text:'正在检查。'}},
 {type:'content_block_stop',index:1},
 {type:'content_block_start',index:2,content_block:{type:'tool_use',id:'call-1',name:'execute_command',input:{}}},
 {type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"command":"pwd'}},
 {type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'"}'}},
 {type:'content_block_stop',index:2},
 {type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}
 ];
 else frames=[
 {choices:[{delta:{reasoning_content:'核对目标。'}}]},
 {choices:[{delta:{content:'正在检查。'}}]},
 {choices:[{delta:{tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'execute_command',arguments:'{"command":"'}}]}}]},
 {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'pwd"}'}}]},finish_reason:'tool_calls'}]},'[DONE]'
 ];
 if(body.model==='truncated')frames=frames.slice(0,-1);
 const data=Buffer.from(frames.map(frame=>'data: '+(typeof frame==='string'?frame:JSON.stringify(frame))+'\r\n\r\n').join(''));
 for(let i=0;i<data.length;i+=7){res.write(data.subarray(i,i+7));await new Promise(r=>setTimeout(r,1));}res.end();
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 const baseUrl=`http://127.0.0.1:${server.address().port}/v1`, signal=new AbortController().signal;
 for(const protocol of ['openai','anthropic']){
  const deltas=[], messages=[{role:'system',content:'Target Linux'},{role:'user',content:'Inspect'}];
  const message=await requestModel({protocol,baseUrl,model:'fixture'},messages,[],signal,(type,text)=>deltas.push({type,text}));
  assert.equal(message.content,'正在检查。');assert.equal(message.reasoning,'核对目标。');assert.equal(message.tool_calls[0].function.arguments,'{"command":"pwd"}');assert(deltas.some(d=>d.type==='reasoning'));assert(requests.at(-1).stream);
  if(protocol==='anthropic'){assert.equal(message.anthropicContent[0].signature,'fixture-signature');messages.push(message,{role:'tool',tool_call_id:'call-1',content:'{"output":"/"}'});await requestModel({protocol,baseUrl,model:'fixture'},messages,[],signal,()=>{});assert.equal(requests.at(-1).messages[1].content[0].signature,'fixture-signature');}
  await assert.rejects(requestModel({protocol,baseUrl,model:'truncated'},messages,[],signal,()=>{}),/中途断开/);
 }
 console.log('PASS: OpenAI/Claude SSE, UTF-8 and frame splitting, analysis/text deltas, tool JSON assembly, signed analysis preservation, incomplete stream rejection.');
}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
