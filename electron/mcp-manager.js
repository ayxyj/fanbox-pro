'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

function validateServers(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请填写 mcpServers 对象');
  if (JSON.stringify(input).length > 500000 || Object.keys(input).length > 100) throw Error('MCP 配置过大');
  const result = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name) || ['fanbox_delivery', '__proto__', 'constructor', 'prototype'].includes(name)) throw Error('MCP 名称无效或被保留：' + name);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(name + ' 配置必须是对象');
    const type = value.type || 'stdio';
    const fields = type === 'stdio' ? ['type', 'command', 'args', 'env'] : ['type', 'url', 'headers'];
    if (!['stdio', 'http', 'sse'].includes(type) || Object.keys(value).some(k => !fields.includes(k))) throw Error(name + ' 包含不支持的类型或字段（支持 stdio / http / sse）');
    const strings = object => object && typeof object === 'object' && !Array.isArray(object) && Object.entries(object).every(([k,v]) => k && !/[\0\r\n]/.test(k) && typeof v === 'string' && !v.includes('\0'));
    if (type === 'stdio') {
      if (typeof value.command !== 'string' || !value.command.trim() || /[\0\r\n]/.test(value.command)) throw Error(name + ' 缺少有效的 command');
      if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(v => typeof v !== 'string' || v.includes('\0')))) throw Error(name + ' args 必须为字符串数组');
      if (value.env !== undefined && !strings(value.env)) throw Error(name + ' env 必须为字符串键值对');
    } else {
      let url; try { url = new URL(value.url); } catch { throw Error(name + ' URL 无效'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error(name + ' 请使用 HTTP(S) URL，并通过 headers 设置认证');
      if (value.headers !== undefined && (!strings(value.headers) || Object.values(value.headers).some(v => /[\r\n]/.test(v)))) throw Error(name + ' headers 无效');
    }
    result[name] = JSON.parse(JSON.stringify(value));
  }
  return result;
}

class MCPManager {
  constructor(store) { this.store = store; this.snapshots = new Map(); }
  read() {
    const saved = this.store.data.mcp;
    if (!saved) return { mcpServers: {}, disabled: [] };
    try {
      const value = JSON.parse(this.store.vault.decryptString(Buffer.from(saved, 'base64')));
      return { mcpServers: validateServers(value.mcpServers), disabled: Array.isArray(value.disabled) ? value.disabled : [] };
    } catch { throw Error('MCP 配置无法解密或格式无效，请在原 Windows 用户下重试；原配置已保留'); }
  }
  save({ mcpServers, disabled = [] }) {
    const servers = validateServers(mcpServers);
    if (!Array.isArray(disabled) || disabled.some(name => typeof name !== 'string' || !Object.hasOwn(servers, name))) throw Error('停用服务器列表无效');
    const encrypted = this.store.encrypt(JSON.stringify({ mcpServers: servers, disabled: [...new Set(disabled)] }));
    const old = this.store.data.mcp;
    this.store.data.mcp = encrypted;
    try { this.store.persist(); } catch (error) { if (old === undefined) delete this.store.data.mcp; else this.store.data.mcp = old; throw error; }
    return { count: Object.keys(servers).length };
  }
  enabled() { const value = this.read(); return Object.fromEntries(Object.entries(value.mcpServers).filter(([name]) => !value.disabled.includes(name))); }
  prepare(id, command) {
    if (typeof command !== 'string' || !/^claude(?:\.cmd)?(?=\s|$)/i.test(command)) return command;
    // An explicit caller-owned config must never be silently replaced or duplicated.
    if (/--mcp-config(?:[=\s]|$)/.test(command)) return command;
    const mcpServers = this.enabled();
    if (!Object.keys(mcpServers).length) return command;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox-mcp-'));
    try {
      const file = path.join(directory, 'mcp.json').replaceAll('\\', '/');
      if (/["'`$%!\r\n]/.test(file)) throw Error('MCP 临时路径包含不支持的字符');
      fs.writeFileSync(file, JSON.stringify({mcpServers}), {mode: 0o600});
      if (!this.snapshots.has(id)) this.snapshots.set(id, []);
      this.snapshots.get(id).push(directory);
      return command.replace(/^claude(?:\.cmd)?/i, executable => executable + ' --mcp-config "' + file + '"');
    } catch (error) { fs.rmSync(directory, {recursive:true, force:true}); throw error; }
  }
  close(id) { for (const directory of this.snapshots.get(id) || []) { try { fs.rmSync(directory, {recursive:true, force:true}); } catch {} } this.snapshots.delete(id); }
  dispose() { for (const id of this.snapshots.keys()) this.close(id); }
}
module.exports = { MCPManager, validateServers };
