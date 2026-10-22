'use strict';
const assert=require('assert/strict');
const {NativeInteraction}=require('../electron/cli-native-interaction');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{for(let i=0;i<300;i++){if(test())return;await delay(10);}assert.fail('terminal delivery timed out');};
(async()=>{
 const cards=[],writes=[],notices=[];let focus=0,applied=false,ignore=false,repaintOnly=false;
 const menu=()=>`Choose an action\r\n${focus===0?'❯':' '} 1. Proceed\r\n${focus===1?'❯':' '} 2. Decline\r\nEnter to confirm · Esc to cancel`;
 const watcher=new NativeInteraction({settle:10,keyDelay:15,ackTimeout:250,confirmDelay:60,target:{size:()=>({cols:100,rows:30}),validate:async()=>{await delay(20);return true;},input:key=>{
  writes.push(key);
  // Model a TUI which interprets one key event per input chunk. The old
  // "arrow + Enter" write moved focus without submitting the choice.
  if(ignore)return;
  if(key==='\x1b[B')focus=1;
  else if(key==='\x1b[A')focus=0;
  else if(key==='\r'){if(repaintOnly){watcher.output('\x1b[2J\x1b[H');setTimeout(()=>watcher.output(menu()),25);return;}applied=true;setTimeout(()=>watcher.output('\x1b[2J\x1b[HWorking…'),25);return;}
  else assert.fail('combined or unexpected key: '+JSON.stringify(key));
  watcher.output('\x1b[2J\x1b[H');setTimeout(()=>watcher.output(menu()),35);
 }},ask:(q,signal)=>new Promise(resolve=>cards.push({q,signal,resolve})),notify:text=>notices.push(text)});
 try{
  watcher.output('\x1b[2J\x1b[H'+menu());await until(()=>cards.length===1);
  // An identical output update during process validation must not cancel the answer.
  cards[0].resolve({indices:[1]});setTimeout(()=>watcher.output('\x1b[2J\x1b[H'+menu()),5);
  await until(()=>notices.some(n=>n.includes('选择已生效')));assert(applied);assert.deepEqual(writes,['\x1b[B','\r']);assert.equal(cards.length,1,'navigation redraw cannot ask again');
  // No terminal acknowledgement: stop before Enter and do not claim success.
  focus=0;applied=false;ignore=true;watcher.input('local');watcher.output('\x1b[2J\x1b[H'+menu());await until(()=>cards.length===2);
  cards[1].resolve({indices:[1]});await until(()=>notices.some(n=>n.includes('停止继续输入')));assert(!applied);assert.equal(writes.at(-1),'\x1b[B');
  for(let i=0;i<3;i++){watcher.output('\x1b[2J\x1b[H'+menu());await delay(25);}assert.equal(cards.length,2,'unacknowledged choice must not repeat cards');
  ignore=false;repaintOnly=true;watcher.retry();await until(()=>cards.length===3);cards[2].resolve({indices:[0]});await until(()=>notices.some(n=>n.includes('仍停留在原问题')));assert.equal(notices.filter(n=>n.includes('选择已生效')).length,1,'temporary blank screen is not success');assert.equal(cards.length,3);
  watcher.retry();await until(()=>cards.length===4);const before=writes.length;cards[3].resolve({indices:[1]});watcher.input('local takeover');await delay(250);assert.equal(writes.length,before);
  console.log('PASS separate key delivery, focus acknowledgement, redraw during validation, no premature Enter, no false success, duplicate suppression and local takeover');
 }finally{watcher.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
