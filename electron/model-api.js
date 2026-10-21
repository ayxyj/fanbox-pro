'use strict';
const { authHeaders } = require('./model-provider');
// Canonical tool messages are translated at the protocol boundary only.
async function requestModel(config, messages, tools, signal, onDelta) {
  const timeout = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => timeout.abort(), config.responseIdleTimeoutMs || 300000);
  };
  touch();
  try {
    return await requestModelResponse(config, messages, tools, AbortSignal.any([signal, timeout.signal]), onDelta, touch);
  } catch (error) {
    if (signal.aborted) throw Error('模型请求已停止');
    if (timeout.signal.aborted) throw Error('模型服务长时间没有返回新数据，已停止等待。此前已执行的命令不会重试，请先查看终端结果再继续。');
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw Error('模型连接超时或中断，请检查网络后继续；此前已执行的命令不会自动重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
async function requestModelResponse(config, messages, tools, signal, onDelta, touch) {
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
  const settings = config.selectedModels?.find(item=>item.id===config.model);
  if (settings?.maxTokens) payload.max_tokens = settings.maxTokens;
  if (settings?.temperature != null) payload.temperature = settings.temperature;
  if (!anthropic && settings?.reasoningEffort) payload.reasoning_effort = settings.reasoningEffort;
  const base = config.baseUrl.replace(/\/$/, '');
  const endpoint = anthropic ? base + (base.endsWith('/v1') ? '/messages' : '/v1/messages') : base + '/chat/completions';
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) }, body: JSON.stringify(payload) });
  } catch (error) {
    if (signal.aborted) throw Error('模型请求已取消');
    const code = error.cause?.code;
    const reasons = {UNABLE_TO_VERIFY_LEAF_SIGNATURE:'HTTPS 证书链无法验证，请核对服务协议和证书',DEPTH_ZERO_SELF_SIGNED_CERT:'服务器使用自签名证书',ECONNREFUSED:'服务端口拒绝连接',ENOTFOUND:'服务域名无法解析'};
    throw Error('模型连接失败：' + (reasons[code] || '请检查服务地址、网络或超时设置'));
  }
  touch();
  if (!response.ok) { await response.body?.cancel(); throw Error(`模型服务返回 HTTP ${response.status}`); }
  let body;
  if (response.headers.get('content-type')?.includes('text/event-stream')) body = await readStream(response, anthropic, onDelta, touch);
  else {
    const decoder = new TextDecoder(); let text = '', total = 0;
    for await (const chunk of response.body) {
      touch(); total += chunk.length;
      if (total > 4 * 1024 * 1024) throw Error('模型响应过大，已停止');
      text += decoder.decode(chunk, {stream:true});
    }
    body = JSON.parse(text + decoder.decode());
  }
  if (!anthropic) {
    if (!body.choices?.[0]?.message) throw Error('模型返回格式不兼容');
    return { ...body.choices[0].message, finishReason: body.choices[0].finish_reason, reasoning: body.choices[0].message.reasoning_content || '' };
  }
  if (!Array.isArray(body.content)) throw Error('Claude 返回格式不兼容');
  return { role: 'assistant', finishReason: body.stop_reason, reasoning: body.content.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('\n'), content: body.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), anthropicContent: body.content,
    tool_calls: body.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })) };
}
async function readStream(response, anthropic, onDelta, touch) {
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
    touch();
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

