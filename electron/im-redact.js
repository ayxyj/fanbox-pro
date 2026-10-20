'use strict';
// Redact common credential forms in IM messages; keep original commands in the local terminal.
function redact(text) {
 return String(text || '').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[私钥已隐藏]')
 .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [已隐藏]')
 .replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[API Key 已隐藏]')
 .replace(/((?:[A-Za-z0-9_]*(?:api[_-]?key|password|passwd|secret|access[_-]?token|auth[_-]?token)|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[已隐藏]');
}
module.exports={redact};
