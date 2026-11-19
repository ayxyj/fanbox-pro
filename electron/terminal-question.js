'use strict';
const {randomUUID}=require('crypto');
function cleanQuestion(menu) {
 if(!menu)return null;
 if(!['choice','multi','input','resume'].includes(menu.kind)||typeof menu.question!=='string'||!menu.question.trim()||menu.question.length>3000||typeof menu.footer!=='string'||menu.footer.length>4000||typeof menu.multi!=='boolean'||!Array.isArray(menu.options)||menu.options.length>100||!Number.isInteger(menu.selected))throw Error('问题数据无效');
 const options=menu.options.map(o=>{
  if(!o||typeof o.label!=='string'||o.label.length>16000||typeof o.description!=='string'||o.description.length>800||typeof o.checked!=='boolean'||!Number.isInteger(o.row)||o.row<0||o.row>=1000)throw Error('选项数据无效');
  return {label:o.label,description:o.description,checked:o.checked,row:o.row,...(Number.isSafeInteger(o.number)?{number:o.number}:{})};
 });
 if(options.length?(menu.selected<0||menu.selected>=options.length):!(['input','resume'].includes(menu.kind)&&menu.selected>=-1&&menu.selected<=0))throw Error('选项焦点无效');
 return {kind:menu.kind,question:menu.question,footer:menu.footer,options,selected:menu.selected,multi:menu.multi};
}
function createTerminalQuestions({getWindow,hasTerminal,timeout=5000}) {
 const pending=new Map();
 return {
  request(id,customContext) {
   const win=getWindow();
   if(typeof id!=='string'||!hasTerminal(id))return Promise.reject(Error('终端已关闭，无法读取问题'));
   if(!win||win.isDestroyed())return Promise.reject(Error('终端窗口不可用，无法读取问题'));
   if(pending.size>=100)return Promise.reject(Error('终端问题读取繁忙，请稍后重试'));
   return new Promise((resolve,reject)=>{
    const requestId=randomUUID(),finish=(error,value)=>{if(!pending.delete(requestId))return;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('终端问题读取超时，请确认本机窗口正常运行')),timeout);
    pending.set(requestId,{id,finish});
    try{win.webContents.send('pty:question-request',{id,requestId,customContext:typeof customContext==='string'?customContext.slice(0,3000):''});}catch{finish(Error('终端问题读取失败'));}
   });
  },
  receive(sender,data) {
   const win=getWindow(),entry=pending.get(data?.requestId);
   if(!win||sender!==win.webContents||!entry||entry.id!==data.id)return false;
   if(!hasTerminal(entry.id)||data.error)entry.finish(Error('终端已关闭或问题暂不可读取'));
   else try{entry.finish(null,{menu:cleanQuestion(data.menu),idle:data.idle===true});}catch{entry.finish(Error('终端问题数据无效，未向终端输入'));}
   return true;
  },
  close(){for(const entry of [...pending.values()])entry.finish(Error('终端窗口已关闭'));},
 };
}
module.exports={createTerminalQuestions,cleanQuestion};
