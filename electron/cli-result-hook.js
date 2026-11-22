'use strict';
// Runs only as a CLI notification hook. Never writes to the terminal or invokes a model.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function transcriptFinal(event) {
  let text='',turnAt=0,finishedAt=0;
  if(typeof event.transcript_path!=='string')return {text,turnAt,finishedAt};
  try {
    const fd=fs.openSync(event.transcript_path,'r');let data;
    try{const stat=fs.fstatSync(fd);if(!stat.isFile())return {text,turnAt,finishedAt};const length=Math.min(stat.size,4*1024*1024),buffer=Buffer.alloc(length);fs.readSync(fd,buffer,0,length,stat.size-length);data=buffer.toString('utf8');}finally{fs.closeSync(fd);}
    for(const line of data.split('\n')){
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(row.isSidechain||row.agent_id||(event.session_id&&row.sessionId&&row.sessionId!==event.session_id))continue;
      const message=row.message||row,at=Date.parse(row.timestamp||message.timestamp)||0;
      if(message.role==='user'&&(!Array.isArray(message.content)||message.content.some(c=>c?.type!=='tool_result'))){text='';turnAt=at;finishedAt=0;}
      if(row.type==='assistant'||message.role==='assistant'){
        const value=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(c=>c?.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n'):'';
        if(value){text=value;finishedAt=at;}
      }
    }
  }catch{/* Only the exact CLI-provided transcript is read; never terminal history. */}
  return {text,turnAt,finishedAt};
}
function normalize(event) {
  if(event?.hook_event_name === 'Notification' && ['elicitation_dialog','permission_prompt'].includes(event.notification_type)) return {kind:'awaiting-input',key:crypto.randomUUID(),createdAt:Date.now()};
  if(event?.hook_event_name === 'UserPromptSubmit' && !event.agent_id) return {kind:'prompt', key:crypto.randomUUID(), createdAt:Date.now()};
  if(event?.hook_event_name === 'SessionStart') return {kind:'session', key:crypto.randomUUID(), createdAt:Date.now(), sessionId:String(event.session_id||''), source:String(event.source||'')};
  if (event?.hook_event_name === 'PreToolUse' && event.tool_name === 'AskUserQuestion') return { kind: 'question', key: crypto.randomUUID(), createdAt: Date.now(), input: event.tool_input || {}, cwd: String(event.cwd || '') };
  if (event?.hook_event_name === 'PermissionRequest') return { kind: 'permission', key: crypto.randomUUID(), createdAt: Date.now(), tool: String(event.tool_name || '未知工具'), input: event.tool_input || {}, cwd: String(event.cwd || ''), agent: String(event.agent_id || '') };
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event?.hook_event_name)) return { kind: 'progress', key: crypto.randomUUID(), createdAt: Date.now(), phase: event.hook_event_name, tool: String(event.tool_name || '') };
  if (!event || event.agent_id || event.hook_event_name === 'SubagentStop') return null;
  const idle=event.hook_event_name==='Notification'&&event.notification_type==='idle_prompt';
  const type = idle?'Stop':event.hook_event_name || event.type;
  if (!['Stop', 'StopFailure', 'agent-turn-complete'].includes(type)) return null;
  let text = idle?undefined:event.last_assistant_message ?? event['last-assistant-message'];
  let transcript;
  if (type === 'StopFailure') text = event.error_details || text || event.error || 'CLI 执行失败';
  // Older CodeBuddy versions provide the exact session transcript instead of final text.
  if (type === 'Stop' && !text && typeof event.transcript_path === 'string') {
    transcript=transcriptFinal(event);text=transcript.text;
  }
  const kind = type === 'StopFailure' ? 'error' : typeof text === 'string' && text.trim() ? 'result' : 'missing';
  text = typeof text === 'string' ? text.slice(0, 100000) : '';
  const key = [event.session_id || event['thread-id'], event.prompt_id || event['turn-id'], type, text];
  return { kind:idle?'idle':kind, text, ...(idle?{turnAt:transcript?.turnAt||0,finishedAt:transcript?.finishedAt||0}:{}), createdAt: Date.now(), key: crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex') };
}
function permissionDecision(allow) {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow ? { behavior: 'allow' } : { behavior: 'deny', message: '用户拒绝、审批已取消或超时。请勿自动重试此操作。' } } };
}
function questionDecision(answer, input) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', ...(answer && typeof answer === 'object' ? { permissionDecision: 'allow', updatedInput: { ...input, answers: answer } } : { permissionDecision: 'deny', permissionDecisionReason: '用户取消或未在有效时间内回答，请等待用户说明。' }) } };
}
async function waitDecision(directory, key, timeout = 300000) {
  const reply = path.join(directory, key + '.reply'), request = path.join(directory, key + '.request');
  const until = Date.now() + timeout;
  try {
    while (Date.now() < until && fs.existsSync(path.join(directory, 'active')) && fs.existsSync(request)) {
      if (fs.existsSync(reply)) return JSON.parse(fs.readFileSync(reply, 'utf8')).value;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
  } finally { for (const file of [reply, request]) try { fs.unlinkSync(file); } catch {} }
}
if (require.main === module) {
  let permission = false, question = false, input;
  (async () => {
    const directory = process.argv[2]; let raw = process.argv[3];
    if (!raw) { raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4 * 1024 * 1024) throw Error('Hook payload too large'); } }
    const event = JSON.parse(raw); permission = event.hook_event_name === 'PermissionRequest'; question = event.hook_event_name === 'PreToolUse' && event.tool_name === 'AskUserQuestion'; input = event.tool_input || {};
    const result = normalize(event);
    if (!result || !fs.existsSync(path.join(directory, 'active'))) { if (permission || question) process.stdout.write(JSON.stringify(question ? questionDecision(null, input) : permissionDecision(false))); return; }
    const name = path.join(directory, result.key);
    if (permission || question) fs.writeFileSync(name + '.request', '1', { mode: 0o600 });
    fs.writeFileSync(name + '.tmp', JSON.stringify(result), { mode: 0o600 }); fs.renameSync(name + '.tmp', name + '.event');
    if (permission || question) { const value = await waitDecision(directory, result.key); process.stdout.write(JSON.stringify(question ? questionDecision(value, input) : permissionDecision(value === true))); }
  })().catch(() => { if (permission || question) process.stdout.write(JSON.stringify(question ? questionDecision(null, input) : permissionDecision(false))); process.exitCode = 0; });
}
module.exports = { normalize, permissionDecision, questionDecision, waitDecision };
