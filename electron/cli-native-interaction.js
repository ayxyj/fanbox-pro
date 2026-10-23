'use strict';
const { Terminal } = require('@xterm/headless');
const { createHash } = require('crypto');
const customOption = label => /^(?:Type something|Other|Custom answer|Chat about this|输入|自定义)/i.test(label.replace(/^(?:\[[ x]\]|[☐☑✓✔])\s*/i,''));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { isTerminalReply: reply } = require('./terminal-protocol');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const menuKey = menu => menu && hash({kind:menu.kind,question:menu.question,options:menu.options.map(o=>o.label.replace(/^(?:\[[ x]\]|[☐☑✓✔])\s*/i,''))});
function parseMenu(lines) {
 let footer = lines.findLastIndex(l => /(?:enter.*(?:select|confirm|submit)|space.*(?:select|toggle)|esc.*(?:cancel|back|exit))/i.test(l));
 // The workspace trust dialog has no keyboard-help footer in some Claude versions.
 if (footer < 0 && lines.some(l=>/Quick safety check:|Do you trust (?:the files in )?this folder/i.test(l)) && lines.some(l=>/Yes, I trust this folder/i.test(l)) && lines.some(l=>/No, exit/i.test(l))) footer=lines.findLastIndex(l=>l.trim())+1;
 if (footer < 0) return null;
 const tail = lines.slice(footer + 1).join('').trim();
 if (tail) return null;
 const body=lines.slice(0,footer), resume=body.some(l=>/(?:Resume|Continue|Search).*session|Select a conversation/i.test(l));
 let options=[];let selected=-1,contextStart=0,optionsEnd=body.length;
 for(let row=0;row<body.length;row++){
  const line=body[row];
  const numbered=line.match(/^\s*([❯>›])?\s*(\d+)\.\s+(.*\S)\s*$/);
  if(numbered){if(numbered[1])selected=options.length;options.push({label:numbered[3],row,number:Number(numbered[2]),checked:/^[☑✓✔]|\[x\]/i.test(numbered[3])});}
 }
 // Only recognize a numbered menu with a real focused item and contiguous numbering.
 if(options.length){
  // A question wizard may leave several numbered blocks on screen. Only the
  // block containing the actual terminal focus is answerable now.
  const groups=[];for(const option of options){const group=groups.at(-1);if(!group||option.number!==group.at(-1).number+1)groups.push([option]);else group.push(option);}
  const focused=groups.filter(group=>group.some(o=>/^\s*[❯>›]/.test(body[o.row])));
  if(focused.length!==1)return null;
  options=focused[0];selected=options.findIndex(o=>/^\s*[❯>›]/.test(body[o.row]));
  const groupIndex=groups.indexOf(options);contextStart=groupIndex?groups[groupIndex-1].at(-1).row+1:0;
  if(groups[groupIndex+1]){
   // Stop descriptions at the paragraph introducing the next block.
   optionsEnd=groups[groupIndex+1][0].row;
   while(optionsEnd>options.at(-1).row+1&&body[optionsEnd-1].trim())optionsEnd--;
  }
  if(selected<0 || options.some((o,i)=>i&&o.number!==options[i-1].number+1))return null;
  options.forEach((o,i)=>{o.description=body.slice(o.row+1,options[i+1]?.row??optionsEnd).filter(l=>!/^\s*[─━]+\s*$/.test(l)).join(' ').trim().slice(0,800);});
 }else if(body.some(l=>/Accessing workspace:|Quick safety check:/i.test(l))){
  // Claude 2.1.306 uses unnumbered trust options, with "No, exit" first.
  // Preserve the actual order and focus instead of assuming Yes is the default.
  for(let row=0;row<body.length;row++){
   const match=body[row].match(/^\s*([❯>›])?\s*(Yes, I trust this folder|No, exit)\s*$/i);
   if(!match)continue;if(match[1])selected=options.length;
   options.push({label:match[2],row,checked:false,description:''});
  }
  if(options.length!==2 || selected<0)return null;
 }else if(resume){
  // Claude 2.1.x renders each session title followed by an age/size metadata row.
  // Project labels and metadata have the same indentation as titles: never count
  // them as selectable entries or remote arrow navigation would choose the wrong session.
  const metadata=l=>/(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|just now|yesterday|today).*·|·.*(?:bytes|[KMGT]B|messages?)/i.test(l);
  const focused=body.findIndex((l,i)=>/^\s*[❯>›]\s+\S/.test(l)&&metadata(body[i+1]||''));
  for(let row=0;row<body.length-1;row++){
    if(!body[row].trim()||metadata(body[row])||!metadata(body[row+1]))continue;
    if(row===focused)selected=options.length;
    options.push({label:body[row].replace(/^\s*[❯>›]\s*/, '').trim(),description:body[row+1].trim(),row,checked:false});
  }
  if(selected<0&&options.length)return null;
  if(!options.length&&!body.some(l=>/No (?:conversations|sessions).*found/i.test(l)))return null;
 }else return null;
 if((!options.length&&!resume)||options.length>100)return null;
 const first=options[0]?.row ?? body.length;
 const context=body.slice(Math.max(contextStart,first-12),first).filter(l=>l.trim()&&!/^\s*[─━╭╮╰╯│]+\s*$/.test(l)).map(l=>l.replace(/((?:API[_ ]?KEY|TOKEN|SECRET|PASSWORD)\s*[:=]).*/ig,'$1 [已隐藏]')).join('\n').trim().slice(-3000);
 if(!context)return null;
 const help=lines[footer]||'',multi=/space.*(?:select|toggle)|select.*space/i.test(help);
 const menu={kind:resume?'resume':customOption(options[selected]?.label||'')&&/enter.*submit/i.test(help)?'input':multi?'multi':'choice',question:context,options,selected,footer:help,multi};
 menu.fingerprint=hash(menu);return menu;
}
class NativeInteraction {
 constructor({target,ask,notify=()=>{},onMenu=()=>{},onDismiss=()=>{},onIdle=()=>{},settle=400,keyDelay=100,ackTimeout=3000,confirmDelay=200}){
  Object.assign(this,{target,ask,notify,onMenu,onDismiss,onIdle,settle,keyDelay,ackTimeout,confirmDelay});this.revision=0;this.closed=false;this.lastFingerprint=null;
  const size=target.size?.()||{};this.screen=new Terminal({cols:size.cols||80,rows:size.rows||24,scrollback:0,allowProposedApi:true});
 }
 lines(){const b=this.screen.buffer.active;return Array.from({length:this.screen.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true)||'');}
 output(text){if(this.closed)return;clearTimeout(this.timer);this.screen.write(text,()=>{if(this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),this.settle);});}
 resize(cols,rows){if(this.closed)return;this.invalidate();this.lastFingerprint=null;this.revision++;this.screen.resize(cols,rows);clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),this.settle);}
 input(text){if(reply(text||''))return;const menu=parseMenu(this.lines());if(text==='\r'&&menu&&customOption(menu.options[menu.selected]?.label||''))this.customContext=menu.question;this.revision++;this.invalidate();this.submittedKey=null;this.lastFingerprint=null;clearTimeout(this.timer);}
 invalidate(){if(this.current){const entry=this.current;this.current=null;this.lastFingerprint=null;entry.controller.abort();}}
 retry(){if(this.closed||this.current?.processing)return false;this.invalidate();this.submittedKey=null;this.lastFingerprint=null;this.refresh();return !!this.current;}
 menu(){const lines=this.lines();let menu=parseMenu(lines);
  if(!menu&&this.customContext&&lines.some(l=>/enter.*submit/i.test(l))){menu={kind:'input',question:this.customContext,options:[],selected:0,multi:false,footer:lines.at(-1)};menu.fingerprint=hash(menu);}return menu;
 }
 refresh(){
  if(this.closed||this.current?.processing)return;const lines=this.lines(),menu=this.menu();
  if(!menu){this.submittedKey=null;if(lines.some(l=>/^\s*[❯>]\s*$/.test(l)))this.customContext=null;this.onDismiss();this.invalidate();this.lastFingerprint=null;if(/^\s*[❯>](?:\s|$)/.test(lines[this.screen.buffer.active.cursorY]||'')&&!lines.some(l=>/esc to interrupt/i.test(l)))this.onIdle();return;}
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
  const q={title:menu.kind==='resume'?'Claude 历史会话选择':'Claude 等待处理',question:menu.question,options,multiSelect:menu.multi,nativeMenu:true,fixedOptions:true,searchable:menu.kind==='resume',nativeText:menu.kind==='input',selectedIndices:menu.options.flatMap((o,i)=>o.checked?[i]:[])};
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
  const flush=()=>new Promise(resolve=>this.screen.write('',resolve));
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
    for(let i=0;i<menu.options.length;i++){if(!!menu.options[i].checked===desired.has(i))continue;move(i);steps.push({key:' ',checked:i,value:desired.has(i)});}steps.push({key:'\r',selected});
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
    if(step.key==='\r' && step.selected!==undefined){await flush();const actual=this.menu();if(menuKey(actual)!==key||actual.selected!==step.selected)throw Error('Menu changed before confirmation');}
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
 close(){this.closed=true;clearTimeout(this.timer);this.invalidate();this.screen.dispose();}
}
module.exports={NativeInteraction,parseMenu,isTerminalReply:reply};
