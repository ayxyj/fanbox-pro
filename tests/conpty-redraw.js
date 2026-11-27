'use strict';
const path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const workspace=path.resolve(__dirname,'..');
if(process.platform!=='win32'){
 console.log('SKIP native ConPTY redraw regression on non-Windows');
}else if(!process.argv.includes('--worker')){
 const executable=process.argv[2]||path.join(workspace,'node_modules/electron/dist/electron.exe');
 const child=spawn(executable,[__filename,'--worker'],{cwd:workspace,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});
 const timeout=setTimeout(()=>{child.kill();process.exitCode=1;console.error('ConPTY redraw worker timed out');},30000);
 child.on('error',error=>{clearTimeout(timeout);console.error(error);process.exitCode=1;});
 child.on('exit',code=>{clearTimeout(timeout);process.exitCode=code??1;});
}else{
 (async()=>{
  const pty=require('node-pty'),{Terminal}=require('@xterm/headless');
  const {getLocalTerminalOptions,resizePty}=require('../electron/terminal-platform');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const options=getLocalTerminalOptions();
  assert.equal(options.windowsMode,true,'Windows renderer uses the ConPTY-compatible screen resize policy');
  if(options.windowsPty?.backend!=='conpty'){console.log('SKIP native ConPTY redraw regression for WinPTY backend');return;}
  const baseline=new Terminal({cols:120,rows:20,scrollback:1000,allowProposedApi:true});
  const fixed=new Terminal({cols:120,rows:20,scrollback:1000,allowProposedApi:true,...options});
  const terminals=[baseline,fixed],chunks=[];
  const p=pty.spawn('node.exe',[path.join(__dirname,'fixtures/conpty-redraw-cli.js')],{cols:120,rows:20,cwd:workspace,name:'xterm-256color',env:{...process.env},useConpty:true});
  let exited=false,lastData=Date.now();const exit=new Promise(resolve=>p.onExit(()=>{exited=true;resolve();}));
  p.onData(data=>{lastData=Date.now();chunks.push(data);for(const terminal of terminals)terminal.write(data);});
  const flush=()=>Promise.all(terminals.map(terminal=>new Promise(resolve=>terminal.write('',resolve))));
  const lines=terminal=>{const buffer=terminal.buffer.active;return Array.from({length:buffer.length},(_,i)=>buffer.getLine(i).translateToString(true));};
  const bannerCount=terminal=>lines(terminal).filter(line=>line.includes('CLAUDE-FIXTURE-BANNER')).length;
  try{
   for(let i=0;i<300;i++){await pause(20);await flush();if(lines(fixed).some(line=>line.includes('PROMPT>')))break;}
   assert(lines(fixed).some(line=>line.includes('PROMPT>')),'offline fixture reaches its initial prompt');
   assert.equal(bannerCount(fixed),1,'fixture emits one startup banner');
   const history=lines(fixed).filter(line=>line.startsWith('HISTORY-'));
   assert(history.length>10,'fixture has historical rows before its active screen');
   assert(history.some(line=>line.length>80),'historical long lines exercise column shrink and restoration');
   assert.equal(lines(fixed).filter(line=>line==='LEGAL-REPEATED-OUTPUT').length,2,'genuine identical records are not removed');
   let reproduced=false;
   for(const [cols,rows]of [[120,40],[60,12],[180,50],[80,20],[120,40]]){
    for(const terminal of terminals)terminal.resize(cols,rows);
    const before=chunks.length;resizePty(p,cols,rows);
    for(let i=0;i<100;i++){await pause(20);if(chunks.length>before&&Date.now()-lastData>=60)break;}await flush();
    reproduced ||= bannerCount(baseline)>1;
    assert.equal(bannerCount(fixed),1,'native resize repaint must not append startup banner '+cols+'x'+rows);
    assert.deepEqual(lines(fixed).filter(line=>line.startsWith('HISTORY-')),history,'native resize keeps historical long-line characters '+cols+'x'+rows);
    assert.equal(lines(fixed).filter(line=>line==='LEGAL-REPEATED-OUTPUT').length,2,'normal repeated records survive redraw '+cols+'x'+rows);
   }
   await pause(200);await flush();const before=chunks.length;
   resizePty(p,120,40);await pause(150);await flush();
   assert.equal(chunks.length,before,'same-size resize does not provoke a native redraw');
   assert.equal(bannerCount(fixed),1);
   console.log('PASS actual ConPTY redraw: old duplicate reproduced='+reproduced+', one startup banner across column/row changes, long history restored, genuine repeated output retained, no same-size native repaint');
  }finally{
   if(!exited){p.write('q');await Promise.race([exit,pause(1500)]);}
   if(!exited)p.kill();
   for(const terminal of terminals)terminal.dispose();
  }
 })().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
}
