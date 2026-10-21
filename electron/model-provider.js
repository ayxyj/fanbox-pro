'use strict';
function isArkCoding(baseUrl) {
  const url = new URL(baseUrl);
  return url.hostname === 'ark.cn-beijing.volces.com' && /^\/api\/coding(?:\/v3)?\/?$/.test(url.pathname);
}
function authHeaders(config) {
  const anthropic = config.protocol === 'anthropic';
  return { ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}),
    ...(config.apiKey ? (anthropic && !isArkCoding(config.baseUrl) ? { 'x-api-key': config.apiKey } : { Authorization: 'Bearer ' + config.apiKey }) : {}) };
}
function catalogEndpoint(baseUrl, protocol) {
  if (isArkCoding(baseUrl)) return new URL('/api/coding/v3/models', baseUrl).href;
  const url = new URL(baseUrl);
  if (/\/models\/?$/.test(url.pathname)) return baseUrl.replace(/\/$/, '');
  if (url.pathname === '/') return new URL('/v1/models', url).href;
  return baseUrl + (protocol === 'anthropic' && !baseUrl.endsWith('/v1') ? '/v1/models' : '/models');
}
module.exports = { isArkCoding, authHeaders, catalogEndpoint };
