'use strict';
const { Terminal } = require('@xterm/headless');
const { createHash } = require('crypto');
const customOption = label => /^(?:Type something|Other|Custom answer|Chat about this|输入|自定义)/i.test(label.replace(/^(?:\[[ x]\]|[☐☑☒✓✔])\s*/i,''));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { isTerminalReply: reply } = require('./terminal-protocol');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const menuKey = menu => menu && hash({kind:menu.kind,question:menu.question,options:menu.options.map(o=>o.label.replace(/^(?:\[[ x]\]|[☐☑☒✓✔])\s*/i,''))});
function parseMenu(lines){return require('../public/terminal-question').parseMenu(lines,hash);}
class NativeInteraction {
 constructor({target,ask,name='claude',notify=()=>{},onMenu=()=>{},onDismiss=()=>{},onIdle=()=>{},settle=400,keyDelay=100,ackTimeout=3000,confirmDelay=200}){
  Object.assign(this,{target,ask,name,notify,onMenu,onDismiss,onIdle,settle,keyDelay,ackTimeout,confirmDelay});this.revision=0;this.closed=false;this.lastFingerprint=null;
  const size=target.size?.()||{};this.screen=new Terminal({cols:size.cols||80,rows:size.rows||24,scrollback:0,allowProposedApi:true});
 }
 lines(){const b=this.screen.buffer.active;return Array.from({length:this.screen.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true)||'');}
 output(text){if(this.closed)return;if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=null;this.refresh();},1000);clearTimeout(this.timer);this.screen.write(text,()=>{if(this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),this.settle);});}
 resize(cols,rows){if(this.closed)return;this.invalidate();this.lastFingerprint=null;this.revision++;this.screen.resize(cols,rows);clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),this.settle);}
 input(text){if(reply(text||''))return;const menu=this.menu();if(text==='\r'&&menu&&customOption(menu.options[menu.selected]?.label||''))this.customContext=menu.question;this.revision++;this.invalidate();this.submittedKey=null;this.lastFingerprint=null;clearTimeout(this.timer);}
 invalidate(){if(this.current){const entry=this.current;this.current=null;this.lastFingerprint=null;entry.controller.abort();}}
 retry(){if(this.closed||this.current?.processing)return false;this.invalidate();this.submittedKey=null;this.lastFingerprint=null;if(this.target.readQuestion)return (async()=>{if(this.refreshing)await this.refreshing;await this.refresh();return !this.readError&&!!this.current;})();this.refresh();return !!this.current;}
 menu(){if(this.target.readQuestion)return this.observedMenu||null;const lines=this.lines();let menu=parseMenu(lines);
  if(!menu&&this.customContext&&lines.some(l=>/enter.*submit/i.test(l))){menu={kind:'input',question:this.customContext,options:[],selected:0,multi:false,footer:lines.at(-1)};menu.fingerprint=hash(menu);}return menu;
 }
 async readQuestion(){
  const data=await this.target.readQuestion(this.customContext);
  if(this.closed)return;
  if(!data||typeof data.idle!=='boolean'||!Object.hasOwn(data,'menu'))throw Error('Question reader unavailable');
  const menu=require('./terminal-question').cleanQuestion(data?.menu);
  this.observedMenu=menu?{...menu,fingerprint:hash(menu)}:null;this.observedIdle=data?.idle===true;this.readError=false;
 }
 refresh(){
  if(!this.target.readQuestion)return this.refreshCurrent();
  if(this.closed||this.current?.processing)return;
  if(this.refreshing){this.refreshAgain=true;return this.refreshing;}
  const revision=this.revision;
  this.refreshing=this.readQuestion().then(()=>{if(this.closed)return;if(revision===this.revision)this.refreshCurrent();else this.refreshAgain=true;}).catch(()=>{if(!this.closed){this.readError=true;this.invalidate();this.lastFingerprint=null;}}).finally(()=>{this.refreshing=null;if(this.refreshAgain&&!this.closed){this.refreshAgain=false;clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),this.settle);}});
  return this.refreshing;
 }
 refreshCurrent(){
  clearTimeout(this.maxTimer);this.maxTimer=null;
  if(this.closed||this.current?.processing)return;const lines=this.lines(),menu=this.menu();
  // TUIs often clear first and repaint the same menu in the next output chunk.
  // Dismiss only after a sustained disappearance; apply() still checks the live
  // screen before sending keys while this grace period is active.
  if(!menu&&this.current){this.missingSince ||= Date.now();const remaining=Math.max(100,this.settle)-(Date.now()-this.missingSince);if(remaining>0){clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),remaining);return;}}
  this.missingSince=null;
  if(!menu){this.submittedKey=null;const idle=this.target.readQuestion?this.observedIdle:/^\s*[❯>](?:\s|$)/.test(lines[this.screen.buffer.active.cursorY]||'')&&!lines.some(l=>/esc to interrupt/i.test(l));if(idle)this.customContext=null;this.onDismiss();this.invalidate();this.lastFingerprint=null;if(idle)this.onIdle();return;}
  this.onMenu(menu);
  // Repainting or moving the visible rows does not introduce the next question.
  // Keep one live card; apply() still validates the latest screen before typing.
  if(this.current){if(menuKey(this.current.menu)===menuKey(menu)){this.current.menu=menu;return;}this.invalidate();}
  if(menuKey(menu)===this.submittedKey)return;
  this.submittedKey=null;
  if(this.current||menu.fingerprint===this.lastFingerprint)return;
  this.lastFingerprint=menu.fingerprint;const controller=new AbortController(),entry={controller,menu};this.current=entry;
  const options=(menu.kind==='input'?[]:menu.options).map(o=>({label:o.label,description:o.description}));
  if(menu.kind==='resume')options.push({label:'〔终端下一屏〕'},{label:'〔终端上一屏〕'});
  const q={title:this.name+(menu.kind==='resume'?' 历史会话选择':' 等待处理'),question:menu.question,options,multiSelect:menu.multi,nativeMenu:true,fixedOptions:true,searchable:menu.kind==='resume',nativeText:menu.kind==='input',selectedIndices:menu.options.flatMap((o,i)=>o.checked?[i]:[])};
  Promise.resolve().then(()=>this.ask(q,controller.signal)).then(answer=>{
   if(!answer){if(this.current===entry){this.current=null;this.notify('终端仍在等待处理。问题已过期或发送未完成，可发送 /retry 重新获取当前问题，也可在本机处理。');}return;}
   return this.apply(entry,answer);
  }).catch(()=>{if(this.current===entry){this.current=null;this.notify('交互转发未完成，可发送 /retry 重试当前问题。');}});
 }
 async apply(entry,answer){
  if(!answer||this.closed||entry.controller.signal.aborted||this.current!==entry)return;
  entry.processing=true;
  const revision=this.revision,menu=entry.menu,key=menuKey(menu),steps=[];
  const live=()=>!this.closed&&!entry.controller.signal.aborted&&this.current===entry&&revision===this.revision;
  const flush=()=>this.target.readQuestion?this.readQuestion():new Promise(resolve=>this.screen.write('',resolve));
  const waitFor=async test=>{const end=Date.now()+this.ackTimeout;do{if(!live())return false;await flush();if(test(this.menu()))return true;await delay(this.keyDelay);}while(Date.now()<end);return false;};
  let navigation=false;
  if(answer.cancel){steps.push({key:'\x1b'});this.customContext=null;}
  else if(menu.kind==='input'&&typeof answer.text==='string'){if(!answer.text.trim()||answer.text.length>4000||/[\x00-\x08\x0b-\x1f\x7f]/.test(answer.text))throw Error('Invalid answer');steps.push({key:'\x1b[200~'+answer.text+'\x1b[201~'},{key:'\r'});}
  else if(answer.search!==undefined && menu.kind==='resume'){
   const value=String(answer.search);if(!value||value.length>200||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid search');
   steps.push({key:'\x15'},{key:value});navigation=true;
  }else{
   const ids=answer.indices;if(!Array.isArray(ids)||!ids.length||ids.some(i=>!Number.isInteger(i)||i<0||i>=menu.options.length+(menu.kind==='resume'?2:0)))throw Error('Invalid selection');
   let selected=menu.selected;
   const move=i=>{while(selected!==i){const delta=i>selected?1:-1;selected+=delta;steps.push({key:delta>0?'\x1b[B':'\x1b[A',selected});}};
   if(menu.kind==='resume'&&ids.length===1&&ids[0]>=menu.options.length){for(let i=0;i<Math.max(1,menu.options.length);i++)steps.push({key:ids[0]===menu.options.length?'\x1b[B':'\x1b[A'});navigation=true;}
   else if(menu.multi){const desired=new Set(ids);
    for(let i=0;i<menu.options.length;i++){if(!!menu.options[i].checked===desired.has(i))continue;move(i);steps.push({key:' ',checked:i,value:desired.has(i)});}steps.push({key:'\r',selected,desired});
   }else{
    if(ids.length!==1)throw Error('Invalid selection');if(customOption(menu.options[ids[0]].label))this.customContext=menu.question;move(ids[0]);steps.push({key:'\r',selected});
   }
  }
  try {
   await flush();if(!live())return;if(this.target.validate&&!await this.target.validate())throw Error('Terminal changed');
   await flush();if(!live()||this.menu()?.fingerprint!==menu.fingerprint)throw Error('Menu changed');
   for(const step of steps){
    if(!live())return;
    if(step.key==='\r' && step.selected!==undefined && !await waitFor(m=>menuKey(m)===key&&m.selected===step.selected))throw Error('Focus not acknowledged');
    if(step.key==='\r' && this.target.validate && !await this.target.validate())throw Error('Terminal changed');
    if(step.key==='\r' && step.selected!==undefined){await flush();const actual=this.menu();if(menuKey(actual)!==key||actual.selected!==step.selected)throw Error('Menu changed before confirmation');if(step.desired&&actual.options.some((o,i)=>!!o.checked!==step.desired.has(i)))throw Error('Selection changed before confirmation');}
    if(!live())return;
    this.target.input(step.key);await delay(this.keyDelay);
    if(step.selected!==undefined && step.key!=='\r' && !await waitFor(m=>menuKey(m)===key&&m.selected===step.selected))throw Error('Navigation not acknowledged');
    if(step.checked!==undefined && !await waitFor(m=>menuKey(m)===key&&!!m.options[step.checked].checked===step.value))throw Error('Toggle not acknowledged');
   }
   // A clear-screen repaint is not an acknowledgement: the original menu may
   // return on the following chunk. Require a sustained transition first.
   let differentSince=0;
   const changed=await waitFor(m=>{if(menuKey(m)===key){differentSince=0;return false;}differentSince ||= Date.now();return Date.now()-differentSince>=this.confirmDelay;});
   if(!live())return;
   this.notify(changed?(navigation?'终端列表已更新，请查看新选项。':answer.cancel?'终端已离开原问题，取消已生效。':'已确认终端离开原问题，选择已生效。'):'已发送按键，但终端仍停留在原问题，尚未确认生效。请发送 /retry 重试，或在本机处理。');
  }catch{if(live())this.notify('终端尚未确认选择生效，已停止继续输入。请发送 /retry 重试，或在本机处理。');}
  finally{if(this.current===entry){this.submittedKey=key;this.invalidate();this.lastFingerprint=menu.fingerprint;this.refresh();}}
 }
 close(){this.closed=true;clearTimeout(this.maxTimer);clearTimeout(this.timer);this.invalidate();this.screen.dispose();}
}
module.exports={NativeInteraction,parseMenu,isTerminalReply:reply};
