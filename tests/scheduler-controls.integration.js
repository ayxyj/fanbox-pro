'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const {Store}=require('../gitsync/store');const {TaskScheduler}=require('../gitsync/tasks');const api=require('../gitsync/api');
const scratch=path.resolve(__dirname,'../dist/test-data');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'scheduler-controls-'));
const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const cronSource=server.slice(server.indexOf('const CRON_FILE ='),server.indexOf('const server = http.createServer'));
function cronContext(dir) {
 let tick;const commands=[];
 const context={fs,path,crypto,process:{platform:process.platform,pid:process.pid},console,CONFIG_DIR:dir,HOME:dir,global:{__fanboxAgent:{create:async options=>{commands.push(options.autorun);return {ok:true,id:'test-terminal'};}}},setInterval:fn=>{tick=fn;}};
 vm.createContext(context);vm.runInContext(cronSource,context);
 return {commands,evaluate:code=>vm.runInContext(code,context),tick:()=>tick()};
}
(async()=>{
 const store=new Store(path.join(root,'git'));await store.load();const scheduler=new TaskScheduler(store,{});api.init(store,{},scheduler);
 const output=path.join(root,'manual.txt');const task=store.saveTask({name:'pause test',enabled:true,trigger:{type:'interval',sec:60},action:{type:'shell_command',cmd:'echo MANUAL_OK > "'+output+'"',timeoutSec:10}});
 scheduler.start();
 try {
  const toggle=paused=>api.handleApi('POST','scheduler/toggle',new URLSearchParams(),{paused});
  assert.equal((await toggle(true)).obj.paused,true);assert.equal(task.enabled,true);assert.equal(task.nextRun,null);assert.equal(scheduler.nextRunInfo(),null);
  task.nextRun=Date.now()-1000;scheduler._tick();assert.equal(fs.existsSync(output),false);
  assert.equal((await scheduler._fire(task)).status,'skipped_paused');assert.equal((await scheduler.triggerNow(task.id)).status,'ok');assert.match(fs.readFileSync(output,'utf8'),/MANUAL_OK/);
  const restored=new Store(store.dir);await restored.load();assert.equal(restored.getSetting('autoSyncPaused'),true);const other=new TaskScheduler(restored,{});other.start();assert.equal(other.paused,true);assert.equal(other.store.tasks[0].nextRun,null);other.stop();
  const expired=store.saveTask({name:'expired during pause',enabled:true,trigger:{type:'at',time:new Date(Date.now()-1000).toISOString()},action:{type:'shell_command',cmd:'echo ignored'}});
  await toggle(false);assert.equal(scheduler.paused,false);assert(task.nextRun>Date.now());assert.equal(expired.enabled,false);assert.equal(expired.nextRun,null);
  const invalid=await api.handleApi('POST','scheduler/toggle',new URLSearchParams(),{paused:'false'});assert.equal(invalid.code,400);
  let calls=0;const old=scheduler._fire;scheduler._fire=()=>{calls++;return Promise.resolve();};task.nextRun=Date.now()-1;scheduler._tick();assert.equal(calls,1);scheduler._fire=old;
  task.enabled=false;assert.equal((await scheduler.triggerNow(task.id)).status,'ok');assert.equal(task.enabled,false);
  console.log('PASS auto-sync pause, resume, manual run, restart persistence and expired one-shot');
 } finally { scheduler.stop();await store.flush(); }
 const dir=path.join(root,'cron');const cron=cronContext(dir);
 const invoke=(action,body)=>cron.evaluate('cronAction('+JSON.stringify(action)+','+JSON.stringify(body)+')');
 const saved=await invoke('save',{name:'CLI quoting',agent:'claude',prompt:"I can't stop",full:true,cwd:dir,schedule:{type:'every',minutes:1},enabled:true});assert(saved.ok);const id=saved.task.id;
 assert.equal((await invoke('scheduler-toggle',{paused:true})).paused,true);
 cron.evaluate('cronTasks[0].nextRun=Date.now()-1');cron.tick();assert.equal(cron.commands.length,0);assert.equal(cron.evaluate('cronTasks[0].enabled'),true);
 assert((await invoke('run',{id})).ok);assert.equal(cron.commands.length,1);if(process.platform==='win32')assert.equal(cron.commands[0],"claude.cmd --dangerously-skip-permissions 'I can''t stop'");
 assert.equal(cron.evaluate('cronTasks[0].nextRun'),null);
 const restoredCron=cronContext(dir);assert.equal(restoredCron.evaluate('cronList().paused'),true);assert.equal(restoredCron.evaluate('cronTasks[0].enabled'),true);assert.equal(restoredCron.evaluate('cronTasks[0].nextRun'),null);
 assert.equal((await invoke('scheduler-toggle',{paused:false})).paused,false);assert(cron.evaluate('cronTasks[0].nextRun > Date.now()'));
 cron.evaluate('cronTasks[0].nextRun=Date.now()-1');cron.tick();await new Promise(r=>setTimeout(r,20));assert.equal(cron.commands.length,2);
 assert.equal((await invoke('scheduler-toggle',{paused:'false'})).ok,false);
 console.log('PASS terminal schedule pause, resume, manual run, restart persistence and Windows .cmd command');
})().catch(error=>{console.error(error);process.exitCode=1;});
