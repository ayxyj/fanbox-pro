'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process'),readline=require('readline');
const {sendFile,MAX}=require('../electron/wecom-files');const {createResultChannel}=require('../electron/cli-result-channel');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fanbox-file-test-')),doc=path.join(root,'架构报告.md'),picture=path.join(root,'网页截图.png');fs.writeFileSync(doc,'# 架构报告\n测试内容');fs.writeFileSync(picture,Buffer.from([137,80,78,71,13,10,26,10]));let valid=true,uploadCount=0;const delivered=[];
 const route={key:'route-a',userid:'alice'},service={valid:r=>r===route&&valid,client:{uploadMedia:async(buffer,options)=>{uploadCount++;assert.equal(options.type,'file');return{media_id:'media-'+options.filename};},sendMediaMessage:async(...args)=>delivered.push(args)}};
 const channel=createResultChannel('claude',async event=>{if(event.kind!=='attachment')return;try{channel.respond(event.key,await sendFile(service,route,event.path,{turn:'one',authorized:()=>channel.hasRequest(event.key)}));}catch(e){channel.respond(event.key,{error:e.message});}},{runtime:process.execPath,interval:20});
 const child=spawn(process.execPath,[path.join(channel.directory,'file-mcp.cjs'),channel.directory],{windowsHide:true,stdio:['pipe','pipe','pipe']});const pending=new Map();let seq=0;
 readline.createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id);});
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('MCP timeout')),5000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{
 assert((await request('initialize',{})).result.capabilities.tools);const listed=await request('tools/list',{});assert.equal(listed.result.tools[0].name,'send_file_to_wecom');
 for(const file of [doc,doc,picture]){const r=await request('tools/call',{name:'send_file_to_wecom',arguments:{path:file}});assert(!r.result.isError,JSON.stringify(r));}
 assert.equal(uploadCount,2);assert.equal(delivered.length,2);assert(delivered.every(([user,type])=>user==='alice'&&type==='file'));
 await assert.rejects(sendFile(service,route,root),/目录/);await assert.rejects(sendFile(service,route,'relative.md'),/绝对/);
 const big=path.join(root,'big.bin');fs.writeFileSync(big,'');fs.truncateSync(big,MAX+1);await assert.rejects(sendFile(service,route,big),/50 MB/);fs.unlinkSync(big);
 valid=false;await assert.rejects(sendFile(service,route,doc),/授权/);valid=true;
 let authorized=true;const old=service.client.uploadMedia;service.client.uploadMedia=async()=>{authorized=false;return{media_id:'revoked'};};await assert.rejects(sendFile(service,route,doc,{turn:'two',authorized:()=>authorized}),/失效/);assert.equal(delivered.length,2);service.client.uploadMedia=old;
 channel.close();const stopped=await request('tools/call',{name:'send_file_to_wecom',arguments:{path:doc}});assert(stopped.result.isError);
 console.log('PASS: MCP discovery and real stdio file call, Unicode document/image file delivery, dedupe, path/size checks, recipient isolation and revocation');
 }finally{child.stdin.end();child.kill();try{channel.close();}catch{}for(const file of fs.readdirSync(root))fs.unlinkSync(path.join(root,file));fs.rmdirSync(root);}
})().catch(e=>{console.error(e);process.exitCode=1;});
