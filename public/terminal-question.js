'use strict';
(function(root){
const customOption = label => /^(?:Type something|Other|Custom answer|Chat about this|输入|自定义)/i.test(label.replace(/^(?:\[[ x]\]|[☐☑☒✓✔])\s*/i,''));
function terminalIdle(lines,cursorY) {
 if(lines.some(l=>/esc(?:ape)?\s+(?:to\s+)?(?:interrupt|stop)/i.test(l)))return false;
 const prompt=l=>/^\s*[❯>›]\s*$/.test(l||'');
 if(prompt(lines[cursorY]))return true;
 const row=lines.findLastIndex(prompt);if(row<0)return false;
 // Ink can leave its physical cursor on the footer rather than the input row.
 // Only known footer lines may follow an empty prompt; arbitrary output cannot.
 return lines.slice(row+1).every(l=>!l.trim()||/^\s*[─━]+\s*$/.test(l)||/(?:\?\s+for shortcuts|shift\+tab|(?:auto|plan|default|manual) mode|accept edits|bypass permissions)/i.test(l));
}
function parseMenu(lines, fingerprint = JSON.stringify) {
 lines=lines.map(line=>line.replace(/^\s*│ ?/,'').replace(/\s*│\s*$/,''));
 let footer = lines.findLastIndex(l => /(?:enter.*(?:select|confirm|submit)|space.*(?:select|toggle)|esc.*(?:cancel|back|exit))/i.test(l));
 // The workspace trust dialog has no keyboard-help footer in some Claude versions.
 if (footer < 0 && lines.some(l=>/Quick safety check:|Do you trust (?:the files in )?this folder/i.test(l)) && lines.some(l=>/Yes, I trust this folder/i.test(l)) && lines.some(l=>/No, exit/i.test(l))) footer=lines.findLastIndex(l=>l.trim())+1;
 if (footer < 0) return null;
 const tail = lines.slice(footer + 1).filter(line=>!/^\s*[─━┌┐└┘╭╮╰╯]+\s*$/.test(line)).join('').trim();
 if (tail) return null;
 const body=lines.slice(0,footer), resume=body.some(l=>/(?:Resume|Continue|Search).*session|Select a conversation/i.test(l));
 let options=[];let selected=-1,contextStart=0,optionsEnd=body.length;
 for(let row=0;row<body.length;row++){
  const line=body[row];
  const numbered=line.match(/^\s*([❯>›])?\s*(\d+)[.)]\s+(.*\S)\s*$/);
  if(numbered){if(numbered[1])selected=options.length;options.push({label:numbered[3],row,number:Number(numbered[2]),checked:/^(?:[☑☒✓✔]|\[x\])/i.test(numbered[3])});}
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
 }else if(body.some(l=>/^\s*[❯>›]?\s*(?:\[[ x]\]|[☐☑☒])\s+\S/i.test(l))){
  for(let row=0;row<body.length;row++){
   const match=body[row].match(/^\s*([❯>›])?\s*(\[[ x]\]|[☐☑☒])\s+(.+\S|\S)\s*$/i);
   if(!match)continue;if(match[1])selected=options.length;
   options.push({label:match[3],row,checked:/x|☑|☒/i.test(match[2]),description:''});
  }
  if(selected<0)return null;
 }else if(/enter.*submit/i.test(lines.slice(Math.max(0,footer-2),footer+1).join(' '))&&body.some(l=>/[?？]|(?:type|enter).*answer/i.test(l))&&body.some(l=>/^\s*[❯>›]\s*$/.test(l))){
  const row=body.findIndex(l=>/^\s*[❯>›]\s*$/.test(l));
  selected=0;options=[{label:'Type something.',row,checked:false,description:''}];
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
  const heading=body.findIndex(l=>/^\s*(?:Resume|Continue|Search).*session|^\s*Select a conversation/i.test(l));
  let previous=heading,focused=0;
  for(let row=1;row<body.length;row++){
    if(!metadata(body[row]))continue;
    let start=row-1;
    while(start>previous+1&&body[start-1].trim())start--;
    const marks=body.slice(start,row).flatMap((l,i)=>/^\s*[❯>›]\s+\S/.test(l)?[i]:[]);if(marks.length>1)return null;const mark=marks[0]??-1;
    if(mark>=0){start+=mark;selected=options.length;focused++;}
    else if(!options.length&&body.slice(start,row).some(l=>/(?:Resume|Continue|Search).*session|Select a conversation/i.test(l)))start=row-1;
    const label=body.slice(start,row).map(l=>l.replace(/^\s*[❯>›]\s*/, '').trim()).join(' ').trim();
    let end=row;
    if(!/bytes|[KMGT]B|messages?/i.test(body[row])&&/^\s*(?:[·•]\s*)?\d+(?:[.,]\d+)?\s*(?:bytes?|[KMGT]B|messages?)(?:\s*·.*)?\s*$/i.test(body[row+1]||''))end++;
    if(label)options.push({label,description:body.slice(row,end+1).map(l=>l.trim()).join(' '),row:start,checked:false});
    previous=end;row=end;
  }
  if(options.length&&focused!==1)return null;
  if(!options.length&&!body.some(l=>/No (?:conversations|sessions).*found/i.test(l)))return null;
 }else return null;
 if((!options.length&&!resume)||options.length>100)return null;
 const first=options[0]?.row ?? body.length;
 const context=body.slice(Math.max(contextStart,first-12),first).filter(l=>l.trim()&&!/^\s*[─━╭╮╰╯│]+\s*$/.test(l)).map(l=>l.replace(/((?:API[_ ]?KEY|TOKEN|SECRET|PASSWORD)\s*[:=]).*/ig,'$1 [已隐藏]')).join('\n').trim().slice(-3000);
 if(!context)return null;
 const help=lines.slice(Math.max(0,footer-2),footer+1).join(' '),multi=options.some(o=>/^\s*[❯>›]?\s*(?:\d+[.)]\s*)?(?:\[[ x]\]|[☐☑☒])\s+\S/i.test(body[o.row]))||/space.*(?:select|toggle)|select.*space/i.test(help);
 const menu={kind:resume?'resume':multi?'multi':options.length===1&&customOption(options[selected]?.label||'')&&/enter.*submit/i.test(help)?'input':'choice',question:context,options,selected,footer:help,multi};
 menu.fingerprint=fingerprint(menu);return menu;
}

if(typeof module!=='undefined')module.exports={parseMenu,customOption,terminalIdle};else Object.assign(root,{parseTerminalMenu:parseMenu,terminalCustomOption:customOption,terminalIdle});
})(typeof window==='undefined'?globalThis:window);
