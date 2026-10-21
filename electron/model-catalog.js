'use strict';
const { isArkCoding, authHeaders, catalogEndpoint } = require('./model-provider');
function connection(input) {
  let url;
  try { url = new URL(String(input.baseUrl || '').trim()); } catch { throw Error('请输入有效的模型服务地址'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('模型服务地址必须使用 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw Error('服务地址不能包含凭据、查询参数或片段');
  const protocol = input.protocol || 'openai';
  if (!['openai', 'anthropic'].includes(protocol)) throw Error('不支持的模型协议');
  return { baseUrl: url.href.replace(/\/+$/, ''), protocol };
}
async function listModels(config) {
  const { baseUrl, protocol } = connection(config), anthropic = protocol === 'anthropic';
  const endpoint = catalogEndpoint(baseUrl, protocol);
  const signal = AbortSignal.timeout(60000), models = new Map(), cursors = new Set();
  let after, bearerCatalog = false;
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint);
    if (anthropic && !isArkCoding(baseUrl) && !bearerCatalog) url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    let response;
    try {
      const request = headers => fetch(url, { redirect: 'error', signal, headers });
      response = await request(bearerCatalog ? { Authorization: 'Bearer ' + config.apiKey } : authHeaders({ ...config, baseUrl, protocol }));
      // Some gateways expose Claude chat but only an OpenAI-style model catalog.
      // Retry on the same endpoint only; never send keys to a discovered host.
      if (anthropic && !isArkCoding(baseUrl) && config.apiKey && !bearerCatalog && [400,401,403,404,405,422].includes(response.status)) {
        await response.body?.cancel();
        bearerCatalog = true; url.searchParams.delete('limit');
        response = await request({ Authorization: 'Bearer ' + config.apiKey });
      }
    }
    catch (error) {
      const code = error.cause?.code || error.code;
      const reason = { ECONNREFUSED:'目标端口拒绝连接', ENOTFOUND:'服务域名无法解析', EHOSTUNREACH:'无法到达目标主机', ENETUNREACH:'目标网络不可达', UND_ERR_CONNECT_TIMEOUT:'连接超时' }[code];
      throw Error(signal.aborted ? '获取模型超时，请重试' : `无法连接模型列表接口（${url.origin}${url.pathname}）${reason ? '：' + reason : '，请检查服务地址和网络'}`);
    }
    if (!response.ok) { await response.body?.cancel(); throw Error(`获取模型失败（HTTP ${response.status}），请检查地址、密钥或服务是否支持模型列表；也可手动填写模型`); }
    let text = '', bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw Error('模型列表过大，请使用手动填写'); text += decoder.decode(chunk, { stream: true }); }
    let body; try { body = JSON.parse(text + decoder.decode()); } catch { throw Error('模型列表格式无效，可手动填写模型'); }
    if (!Array.isArray(body.data)) throw Error('服务没有返回兼容的模型列表，可手动填写模型');
    for (const item of body.data) if (typeof item.id === 'string' && item.id.trim() && item.id.length <= 512) models.set(item.id, { id: item.id, name: typeof item.display_name === 'string' ? item.display_name.slice(0, 512) : item.id });
    if (models.size > 10000) throw Error('模型数量过多，请使用手动填写');
    if (!body.has_more) return [...models.values()].sort((a,b) => a.id.localeCompare(b.id));
    after = body.last_id;
    if (typeof after !== 'string' || !after || cursors.has(after)) throw Error('模型列表分页异常，请重试或手动填写');
    cursors.add(after);
  }
  throw Error('模型列表分页过多，请使用手动填写');
}
module.exports = { connection, listModels };
