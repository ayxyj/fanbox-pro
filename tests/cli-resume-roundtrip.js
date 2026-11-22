'use strict';
const assert=require('assert/strict');
const {NativeInteraction,parseMenu}=require('../electron/cli-native-interaction');
const {WecomService}=require('../electron/wecom-service');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(test,message)=>{for(let i=0;i<250;i++){if(test())return;await delay(5);}assert.fail(message||'resume timed out');};
async function scenario(mode){
 const route={key:'r',id:'11111111-1111-1111-1111-111111111111',userid:'alice',number:1,project:'fixture',mode:'claude',sessionId:'t',generation:0};
 const sent=[],cards=[],writes=[];let age=15,focus=0,start=0,shown=true,chosen=null,seq=0,removed=false,filtered=false,releaseUpdate,order=null,loading=false;
 const names=Array.from({length:6},(_,i)=>'Session '+i);if(mode==='duplicate')names[2]=names[0];
 const visible=()=>filtered?[2]:order||Array.from({length:3},(_,i)=>start+i).filter(i=>!(removed&&i===2));
 const screen=()=>['Resume session','Search sessions','fixture project','',...visible().flatMap(i=>[(i===focus?'❯':' ')+' '+names[i],`  ${age} seconds ago · ${mode==='duplicate'?800:800+i} bytes`,'']),'Ctrl+A to show all projects · Type to search · Esc to cancel'];
 const service=new WecomService({store:{data:{im:{enabled:true,allowExecution:true,botId:'bot',users:['alice']}},persist(){}},emit(){}});
 service.routes.set('r',route);service.focus.set('alice','r');service.client={disconnect(){},sendMessage:async(u,b)=>{sent.push(b.markdown?.content||'');if(b.template_card)cards.push(b.template_card);},updateTemplateCard:async()=>{if(mode==='slow-card'&&!releaseUpdate)await new Promise(resolve=>releaseUpdate=resolve);}};
 const watcher=new NativeInteraction({settle:5,keyDelay:1,ackTimeout:120,confirmDelay:5,target:{readQuestion:async()=>({menu:shown&&!loading?parseMenu(screen()):null,idle:!shown}),validate:async()=>true,input:key=>{writes.push(key);if(mode==='reorder'&&['\x1b[B','\x1b[A'].includes(key))focus=order[order.indexOf(focus)+(key==='\x1b[B'?1:-1)];else if(key==='\x1b[B')focus++;else if(key==='\x1b[A')focus--;else if(key==='\r'){chosen=focus;shown=false;}else if(key==='\x1b')shown=false;else if(key==='\x15'){}else if(key==='Session 2'){filtered=true;focus=2;}else assert.fail('unexpected resume key');if(mode==='scroll'&&focus>=2)start=1;if(mode==='page')start=Math.max(0,focus-1);if(mode==='takeover'&&key==='\x1b[B')watcher.input('local takeover');}},ask:(q,signal)=>service.askCLIQuestion(route,q,signal,Date.now()+10000),notify:text=>service.say(route,text)});
 const click=async(token,action)=>service.cardEvent({headers:{req_id:mode==='shared-id'?'same-card-id':'resume-'+(++seq)},body:{aibotid:'bot',from:{userid:'alice'},msgtype:'event',event:{eventtype:'template_card_event',template_card_event:{task_id:'question_'+token,event_key:'question:'+token+':'+action}}}});
 try{
  await watcher.refresh();await until(()=>cards.length===1);let entry=[...service.questions.values()][0];assert(entry.q.searchable);let choice='2';
  const pageUpdate=click(entry.token,'next');if(mode!=='slow-card')await pageUpdate;else await until(()=>entry.page===1);
  assert.equal(writes.length,0,'WeCom card paging must not move terminal focus');
  if(mode==='search'||mode==='page'){
   if(mode==='search')await service.answerQuestionText('alice',route,'搜索 Session 2');else await click(entry.token,'3');
   await until(()=>cards.length===2);entry=[...service.questions.values()][0];assert(entry);choice='0';assert(!writes.includes('\r'),'navigation cannot submit a session');
  }
  if(mode==='age')age++;
  if(mode==='focus')focus=1;
  if(mode==='missing')removed=true;
  if(['append','reorder','subset'].includes(mode)){order=mode==='append'?[0,1,2,3]:mode==='subset'?[1,2,3]:[2,0,1];if(mode==='subset')focus=1;await watcher.refresh();assert(service.questions.has(entry.token),'compatible list refresh cannot expire the card');}
  if(mode==='resize'){watcher.resize(120,35);assert(service.questions.has(entry.token),'resize while awaiting a resume answer cannot immediately expire the card');}
  if(mode==='transient'){loading=true;await watcher.refresh();await delay(220);assert(service.questions.has(entry.token),'brief resume redraw cannot expire the card');loading=false;await watcher.refresh();}
  const selectionUpdate=click(entry.token,choice);if(mode!=='slow-card')await selectionUpdate;
  await until(()=>chosen!==null||sent.some(t=>/停止继续输入|无法确定|已失效|无法定位|问题已变化/.test(t)),mode+' did not acknowledge the click');
  if(mode==='missing'||mode==='duplicate'){assert.equal(chosen,null);assert.equal(writes.length,0,'missing or ambiguous sessions must not receive keys');}
  else if(mode==='takeover'){assert.equal(chosen,null);assert(!writes.includes('\r'),'local takeover revokes remote confirmation');}
  else {assert.equal(chosen,2,mode+': the clicked session must actually be confirmed');assert.equal(writes.filter(k=>k==='\r').length,1);}
  releaseUpdate?.();await Promise.all([pageUpdate,selectionUpdate]);
 }finally{releaseUpdate?.();watcher.close();service.stop();}
}
(async()=>{
 const wrapped=parseMenu(['Resume session','Search sessions','','❯ A long session title','  continued on another row','  15 seconds ago · 800 bytes','','  Second session title','  also wraps here','  3 minutes ago · 900 bytes','Enter to select · Esc to cancel']);
 assert(wrapped);assert.equal(wrapped.options.length,2);assert.equal(wrapped.selected,0);assert.equal(wrapped.options[0].label,'A long session title continued on another row');assert.equal(wrapped.options[1].label,'Second session title also wraps here');
 const narrow=parseMenu(['Resume session','','❯ First title','  15 seconds ago ·','  800 bytes','  Second title','  3 minutes ago · 900 bytes','Enter to select · Esc to cancel']);assert(narrow);assert.equal(narrow.options.length,2);assert.equal(narrow.options[0].description,'15 seconds ago · 800 bytes');assert.equal(narrow.options[1].label,'Second title');
 for(const mode of ['append','reorder','subset','resize','transient','age','focus','scroll','missing','duplicate','shared-id','slow-card','takeover','search','page'])await scenario(mode);
 console.log('PASS actual WeCom resume callbacks, wrapped titles, metadata clock updates, fresh focus, scrolling viewport, one Enter, missing/ambiguous sessions fail closed');
})().catch(e=>{console.error(e);process.exitCode=1;});
