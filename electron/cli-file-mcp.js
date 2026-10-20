'use strict';
// Per-terminal stdio MCP server. It has no WeCom credentials and cannot choose a recipient.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),readline=require('readline');
const directory=process.argv[2];
const tools=[{name:'send_file_to_wecom',description:'Send a finished local document, image, screenshot or other file to the user of this WeCom conversation as a downloadable file attachment. Use when the user asks you to send/deliver a file. Generate documents or browser screenshots yourself first, then call this tool with the absolute local file path. Do not merely print a path. Maximum 50 MB. Never send unrelated files or credentials. Recipient is bound to this conversation and cannot be changed.',inputSchema:{type:'object',properties:{path:{type:'string',description:'Absolute local file path, including filename.'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}}];
const pending=new Map();
const response=(id,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');
async function deliver(file,signal){
 if(typeof file!=='string'||file.length>32768)throw Error('Invalid file path');
 if(!fs.existsSync(path.join(directory,'active')))throw Error('会话已关闭');
 const key=crypto.randomUUID(),base=path.join(directory,key);
 fs.writeFileSync(base+'.request','1');fs.writeFileSync(base+'.tmp',JSON.stringify({kind:'attachment',key,createdAt:Date.now(),path:file}));fs.renameSync(base+'.tmp',base+'.event');
 const until=Date.now()+180000;
 try{while(Date.now()<until&&!signal.aborted&&fs.existsSync(path.join(directory,'active'))){
 if(fs.existsSync(base+'.reply')){const result=JSON.parse(fs.readFileSync(base+'.reply','utf8')).value;if(!result?.sent)throw Error(result?.error||'文件未发送');return result;}
 await new Promise(r=>setTimeout(r,150));}throw Error('发送未确认，请查看企微；不要自动重复发送');}
 finally{for(const suffix of ['.request','.reply'])try{fs.unlinkSync(base+suffix);}catch{}}
}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',async line=>{
 if(line.length>1000000)return;let r;try{r=JSON.parse(line);}catch{return response(null,null,{code:-32700,message:'Invalid JSON'});}
 if(r.method==='notifications/cancelled'){pending.get(r.params?.requestId)?.abort();return;}
 if(r.id===undefined)return;
 try{
 if(r.method==='initialize')return response(r.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fanbox-wecom-delivery',version:'1.0.0'},instructions:'Use send_file_to_wecom to deliver files requested by the current WeCom user. Screenshot capture is your responsibility.'});
 if(r.method==='ping')return response(r.id,{});
 if(r.method==='tools/list')return response(r.id,{tools});
 if(r.method==='tools/call'&&r.params?.name==='send_file_to_wecom'){
 const controller=new AbortController();pending.set(r.id,controller);
 try{const value=await deliver(r.params.arguments?.path,controller.signal);return response(r.id,{content:[{type:'text',text:JSON.stringify(value)}]});}
 catch(e){return response(r.id,{isError:true,content:[{type:'text',text:e.message}]});}finally{pending.delete(r.id);}}
 response(r.id,null,{code:-32601,message:'Unknown method/tool'});
 }catch(e){response(r.id,null,{code:-32603,message:e.message});}
}).on('close',()=>{for(const c of pending.values())c.abort();});
