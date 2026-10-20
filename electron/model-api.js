'use strict';
const { authHeaders } = require('./model-provider');
// Canonical tool messages are translated at the protocol boundary only.
async function requestModel(config, messages, tools, signal, onDelta) {
  const anthropic = config.protocol === 'anthropic';
  let payload;
  if (anthropic) {
    const converted = [];
    for (const m of messages.filter(m => m.role !== 'system')) {
      const role = m.role === 'tool' ? 'user' : m.role;
      const content = m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] : m.anthropicContent || [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.tool_calls || []).map(t => ({ type: 'tool_use', id: t.id, name: t.function.name, input: JSON.parse(t.function.arguments) })),
      ];
      if (converted.at(-1)?.role === role) converted.at(-1).content.push(...content);
      else converted.push({ role, content });
    }
    payload = { model: config.model, max_tokens: 4096, system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: converted,
      ...(tools.length ? { tool_choice: { type: 'auto' }, tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) } : {}) };
  } else {
    payload = { model: config.model, messages: messages.map(({ anthropicContent, finishReason, reasoning, ...m }) => m), ...(tools.length ? { tools, tool_choice: 'auto' } : {}) };
  }
  if (onDelta) payload.stream = true;
  const base = config.baseUrl.replace(/\/$/, '');
  const endpoint = anthropic ? base + (base.endsWith('/v1') ? '/messages' : '/v1/messages') : base + '/chat/completions';
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    headers: { 'Content-Type': 'application/json', ...authHeaders(config) }, body: JSON.stringify(payload) });
  if (!response.ok) throw Error(`模型服务返回 HTTP ${response.status}`);
  const body = response.headers.get('content-type')?.includes('text/event-stream') ? await readStream(response, anthropic, onDelta) : await response.json();
  if (!anthropic) {
    if (!body.choices?.[0]?.message) throw Error('模型返回格式不兼容');
    return { ...body.choices[0].message, finishReason: body.choices[0].finish_reason, reasoning: body.choices[0].message.reasoning_content || '' };
  }
  if (!Array.isArray(body.content)) throw Error('Claude 返回格式不兼容');
  return { role: 'assistant', finishReason: body.stop_reason, reasoning: body.content.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('\n'), content: body.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), anthropicContent: body.content,
    tool_calls: body.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })) };
}
async function readStream(response, anthropic, onDelta) {
  const decoder = new TextDecoder(), blocks = [], calls = new Map();
  let pending = '', total = 0, content = '', reasoning = '', finished = false, finishReason;
  const emit = (type, text) => { if (text) onDelta?.(type, text); };
  const accept = event => {
    if (event === '[DONE]') { finished = true; return; }
    const item = JSON.parse(event);
    if (item.error || item.type === 'error') throw Error('模型流式响应出错，请检查模型服务后重试');
    if (anthropic) {
      const index = item.index;
      if (item.type === 'content_block_start') {
        blocks[index] = { ...item.content_block }; const b = blocks[index];
        if (b.type === 'text') emit('text', b.text);
        if (b.type === 'thinking') emit('reasoning', b.thinking);
      } else if (item.type === 'content_block_delta') {
        const b = blocks[index], d = item.delta; if (!b) throw Error('模型流式数据顺序无效');
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; emit('text', d.text); }
        else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + d.thinking; emit('reasoning', d.thinking); }
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') b.partialJSON = (b.partialJSON || '') + d.partial_json;
      } else if (item.type === 'content_block_stop') {
        const b = blocks[index]; if (b?.partialJSON !== undefined) { b.input = JSON.parse(b.partialJSON); delete b.partialJSON; }
      } else if (item.type === 'message_delta') finishReason = item.delta?.stop_reason;
      else if (item.type === 'message_stop') finished = true;
    } else {
      const choice = item.choices?.[0]; if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const d = choice.delta || {};
      if (d.content) { content += d.content; emit('text', d.content); }
      if (d.reasoning_content) { reasoning += d.reasoning_content; emit('reasoning', d.reasoning_content); }
      for (const part of d.tool_calls || []) {
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
    }
  };
  for await (const chunk of response.body) {
    total += chunk.length; if (total > 4 * 1024 * 1024) throw Error('模型响应过大，已停止');
    pending += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(pending))) {
      const frame = pending.slice(0, boundary.index); pending = pending.slice(boundary.index + boundary[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) accept(data);
    }
  }
  if (!finished) throw Error('模型响应中途断开，未执行未完成的工具调用，请重试');
  if (anthropic) return { content: blocks.filter(Boolean), stop_reason: finishReason };
  return { choices: [{ finish_reason: finishReason, message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.size ? { tool_calls: [...calls.values()] } : {}) } }] };
}
module.exports = { requestModel };

