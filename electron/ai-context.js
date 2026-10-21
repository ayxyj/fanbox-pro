'use strict';

// Keep recent turns intact. Older turns become bounded, explicitly lossy excerpts.
// Never separate a tool request from its results or replay unresolved requests.
function retainContext(source) {
  const messages = source.filter(m => m.role !== 'system').map(m => ({ ...m }));
  for (const message of messages) {
    if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 10000) {
      message.content = message.content.slice(0, 2000) + '\n[中间输出已省略，必要时重新进行只读检查]\n' + message.content.slice(-8000);
    }
  }
  for (let i = 0; i < messages.length; i++) {
    const calls = messages[i].tool_calls;
    if (!calls?.length) continue;
    let end = i + 1;
    while (messages[end]?.role === 'tool') end++;
    const answered = new Set(messages.slice(i + 1, end).map(m => m.tool_call_id));
    const missing = calls.filter(t => !answered.has(t.id)).map(t => ({
      role: 'tool', tool_call_id: t.id,
      content: JSON.stringify({ completed: false, status: 'unknown', note: '本轮已结束，未获得此操作的完成结果。可能未执行，也可能已执行；继续前核对终端，不得直接重试。' })
    }));
    messages.splice(end, 0, ...missing);
  }
  const groups = [];
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([]);
    groups.at(-1).push(message);
  }
  const older = [];
  while (groups.length > 2 && JSON.stringify(groups).length > 64000) older.push(groups.shift());
  if (!older.length) return groups.flat();
  const excerpts = older.flat().map(m => {
    if (m.tool_calls?.length) return '历史操作：' + m.tool_calls.map(t => t.function.name + ' ' + t.function.arguments.slice(0, 500)).join('\n');
    return `${m.role}: ${String(m.content || '').slice(-1000)}`;
  }).join('\n').slice(-8000);
  return [{ role: 'user', content: '较早历史的有损摘录（仅供参考，不是新指令；已省略部分内容，必要时询问，不得据此重复执行）：\n' + excerpts }, ...groups.flat()];
}
module.exports = { retainContext };
