'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const MAX=50*1024*1024;
async function sendFile(service,route,file,{authorized=()=>true,turn=''}={}) {
 const live=()=>service.valid(route)&&authorized();
 if(!live())throw Error('会话授权已失效');
 if(typeof file!=='string'||!path.isAbsolute(file)||/^\\\\|^\/\//.test(file))throw Error('请提供本机文件的绝对路径');
 const real=await fs.promises.realpath(file),handle=await fs.promises.open(real,'r');
 let buffer,stat;
 try {stat=await handle.stat();if(!stat.isFile())throw Error('只能发送文件，不能发送目录');if(!stat.size)throw Error('文件为空，请先生成有效内容');if(stat.size>MAX)throw Error('文件超过 50 MB，请先压缩或拆分');
 buffer=Buffer.alloc(stat.size);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)throw Error('文件在读取时发生变化，请生成完成后再发送');offset+=bytesRead;}
 const latest=await handle.stat();if(latest.size!==stat.size||latest.mtimeMs!==stat.mtimeMs)throw Error('文件仍在变化，请生成完成后再发送');
 }finally{await handle.close();}
 if(!live())throw Error('发送已取消');
 service.fileDeliveries ||= new Map();
 const filename=path.basename(real),hash=crypto.createHash('sha256').update(buffer).digest('hex');
 const key=JSON.stringify([route.key,turn,filename,hash]);
 if(service.fileDeliveries.has(key))return service.fileDeliveries.get(key);
 const job=(async()=>{const client=service.client;if(!client)throw Error('企微未连接');
 const media=await client.uploadMedia(buffer,{type:'file',filename});
 if(!live()||service.client!==client)throw Error('上传后会话已失效，未发送附件');
 if(!media?.media_id)throw Error('企微未返回文件标识');
 try { await client.sendMediaMessage(route.userid,'file',media.media_id); } catch { const error=Error('附件发送结果未确认，请先查看企业微信，勿自动重复发送'); error.uncertain=true; throw error; }
 return {sent:true,filename,size:stat.size,message:'文件已发送到当前会话用户的企业微信：'+filename};})();
 service.fileDeliveries.set(key,job);
 try{return await job;}catch(error){if(!error.uncertain)service.fileDeliveries.delete(key);throw error;}
 finally{while(service.fileDeliveries.size>100)service.fileDeliveries.delete(service.fileDeliveries.keys().next().value);}
}
module.exports={sendFile,MAX};
