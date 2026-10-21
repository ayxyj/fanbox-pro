'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

class RemoteStore {
  constructor(directory, vault) {
    this.file = path.join(directory, 'remote-workspace.json');
    this.vault = vault;
    this.memory = new Map();
    this.data = { profiles: [], fingerprints: {}, ai: { mode: 'confirm', interactive: false } };
    if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    if (!this.data.aiConfigs) {
      const { mode, interactive, ...legacy } = this.data.ai;
      this.data.aiConfigs = legacy.baseUrl ? [{ ...legacy, id: randomUUID(), name: '默认配置', protocol: 'openai' }] : [];
      this.data.activeAIId = this.data.aiConfigs[0]?.id || '';
      this.data.ai = { mode: mode || 'confirm', interactive: !!interactive };
      this.persist();
    }
  }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temporary, this.file); break; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          // Windows scanners may briefly lock the destination during atomic replacement.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
        }
      }
    } finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  encrypt(value) {
    if (!this.vault.isEncryptionAvailable() || this.vault.getSelectedStorageBackend?.() === 'basic_text') throw Error('系统安全存储不可用，请取消记住凭据');
    return this.vault.encryptString(value).toString('base64');
  }
  secret(id, saved) {
    if (this.memory.has(id)) return this.memory.get(id);
    try { return saved ? JSON.parse(this.vault.decryptString(Buffer.from(saved, 'base64'))) : {}; }
    catch { throw Error('已保存的 SSH 凭据无法解密。请编辑连接，勾选“清除已有凭据”后重新填写并保存；原有密文未被删除。'); }
  }
  list() { return this.data.profiles.map(({ credentials, ...p }) => ({ ...p, hasCredentials: !!credentials || this.memory.has(p.id) })); }
  get(id) {
    const p = this.data.profiles.find(p => p.id === id);
    if (!p) throw Error('SSH 连接不存在');
    try { return { ...p, ...this.secret(id, p.credentials) }; }
    catch { return { ...p, credentialsUnavailable: true }; }
  }
  save(input) {
    const id = input.id || randomUUID(), old = this.data.profiles.find(p => p.id === id);
    if (!String(input.host || '').trim() || !String(input.username || '').trim()) throw Error('请填写主机和用户名');
    const port = Number(input.port || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('端口必须为 1–65535');
    if (input.jumpId === id) throw Error('不能将自身作为跳板机');
    if (input.policy && !['read', 'confirm', 'auto'].includes(input.policy.mode)) throw Error('无效的连接权限');
    const secrets = input.clearCredentials ? {} : this.secret(id, old?.credentials);
    for (const key of ['password', 'passphrase', 'proxyPassword']) if (input[key]) secrets[key] = String(input[key]);
    const p = { id, name: String(input.name || input.host), group: String(input.group || ''), host: String(input.host).trim(), port,
      detectEnvironment: input.detectEnvironment === undefined ? old?.detectEnvironment === true : input.detectEnvironment === true,
      shortcuts: old?.shortcuts || [], terminalType: input.terminalType || old?.terminalType || 'xterm',
      username: String(input.username).trim(), auth: input.auth === 'key' ? 'key' : 'password', keyPath: String(input.keyPath || ''),
      jumpId: input.jumpId || '', proxy: input.proxy || null, policy: input.policy ? { mode: input.policy.mode, interactive: !!input.policy.interactive } : null, remember: !!input.remember };
    if (!['xterm','xterm-256color','vt100'].includes(p.terminalType)) throw Error('无效终端类型');
    if (p.proxy && !['socks5', 'http'].includes(p.proxy.type)) throw Error('仅支持 SOCKS5 / HTTP CONNECT 代理');
    if (p.remember && Object.keys(secrets).length) p.credentials = this.encrypt(JSON.stringify(secrets));
    this.memory.set(id, secrets);
    const i = this.data.profiles.findIndex(p => p.id === id);
    if (i < 0) this.data.profiles.push(p); else this.data.profiles[i] = p;
    this.persist(); return id;
  }
  remove(id) {
    if (this.data.profiles.some(p => p.jumpId === id)) throw Error('此连接正在被其他连接用作跳板机');
    this.data.profiles = this.data.profiles.filter(p => p.id !== id); this.memory.delete(id); this.persist();
  }
  shortcuts(profileId) {
    if (!this.data.profiles.some(p => p.id === profileId)) throw Error('SSH 连接不存在');
    return this.data.profiles.find(p => p.id === profileId).shortcuts || [];
  }
  saveShortcut(input) {
    const profile = this.data.profiles.find(p => p.id === input.profileId);
    const items = this.shortcuts(input.profileId);
    const name = String(input.name || '').trim(), group = String(input.group || '').trim();
    const command = String(input.command || '').replace(/\r\n?/g, '\n');
    if (!name || name.length > 100 || group.length > 100 || !command.trim() || command.length > 32000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) throw Error('请填写名称和命令（最多 32000 字符，不含终端控制字符）');
    if (input.id && !items.some(x => x.id === input.id)) throw Error('快捷命令不存在');
    const item = { id: input.id || randomUUID(), name, group, command };
    const previous = profile.shortcuts;
    profile.shortcuts = [...items.filter(x => x.id !== item.id), item];
    try { this.persist(); } catch (e) { profile.shortcuts = previous; throw e; }
    return item.id;
  }
  deleteShortcut({ profileId, id }) {
    const profile = this.data.profiles.find(p => p.id === profileId), items = this.shortcuts(profileId);
    profile.shortcuts = items.filter(x => x.id !== id);
    try { this.persist(); } catch (e) { profile.shortcuts = items; throw e; }
  }
  renameShortcutGroup({ profileId, group, name }) {
    const profile = this.data.profiles.find(p => p.id === profileId), items = this.shortcuts(profileId);
    name = String(name || '').trim();
    if (name.length > 100) throw Error('分组名称过长');
    profile.shortcuts = items.map(x => x.group === group ? { ...x, group: name } : x);
    try { this.persist(); } catch (e) { profile.shortcuts = items; throw e; }
  }
  aiList() { return this.data.aiConfigs.map(({ key, ...p }) => ({ ...p, hasKey: !!key, active: p.id === this.data.activeAIId })); }
  aiConfig(publicOnly = true) {
    const { key, ...config } = this.data.aiConfigs.find(p => p.id === this.data.activeAIId) || {};
    if (publicOnly) return { ...this.data.ai, ...config, hasKey: !!key };
    let apiKey = '';
    try { apiKey = key ? this.vault.decryptString(Buffer.from(key, 'base64')) : ''; }
    catch { throw Error('当前 AI 配置的已保存密钥无法解密。请到右上角“设置 → AI 配置”，重新输入该配置的 API 密钥并保存。原有配置和密文未被删除。'); }
    return { ...this.data.ai, ...config, apiKey };
  }
  activateAI(id) {
    if (!this.data.aiConfigs.some(p => p.id === id)) throw Error('AI 配置不存在');
    const previous = this.data.activeAIId;
    this.data.activeAIId = id;
    try { this.persist(); } catch (error) { this.data.activeAIId = previous; throw error; }
  }
  deactivateAI(id) {
    if (!this.data.aiConfigs.some(p => p.id === id)) throw Error('AI 配置不存在');
    if (this.data.activeAIId === id) { this.data.activeAIId = ''; try { this.persist(); } catch (error) { this.data.activeAIId = id; throw error; } }
  }
  removeAI(id) {
    this.data.aiConfigs = this.data.aiConfigs.filter(p => p.id !== id);
    if (this.data.activeAIId === id) this.data.activeAIId = '';
    this.persist();
  }
  modelConnection(input) {
    const old = this.data.aiConfigs.find(p => p.id === input.id) || {};
    const config = require('./model-catalog').connection({ ...input, protocol: input.protocol || old.protocol });
    if (old.key && (old.baseUrl !== config.baseUrl || old.protocol !== config.protocol) && !input.apiKey && !input.clearKey) throw Error('更换服务地址或协议时，请重新输入密钥或清除旧密钥');
    let apiKey = input.clearKey ? '' : input.apiKey || '';
    if (!input.clearKey && !apiKey && old.key) {
      try { apiKey = this.vault.decryptString(Buffer.from(old.key, 'base64')); }
      catch { throw Error('已保存密钥无法解密，请重新输入 API 密钥'); }
    }
    return { ...config, apiKey };
  }
  saveAI(input, persist = true) {
    const id = input.id || (input.name ? randomUUID() : this.data.activeAIId || randomUUID());
    const old = this.data.aiConfigs.find(p => p.id === id) || {};
    const { baseUrl, protocol } = require('./model-catalog').connection({ ...input, protocol: input.protocol || old.protocol });
    if (old.key && (old.baseUrl !== baseUrl || old.protocol !== protocol) && !input.apiKey && !input.clearKey) throw Error('更换服务地址或协议时，请重新输入密钥或清除旧密钥');
    if (input.mode && !['read', 'confirm', 'auto'].includes(input.mode)) throw Error('无效权限');
    const config = { id, name: String(input.name || old.name || '默认配置'), protocol, baseUrl, model: String(input.model || '').trim(), key: input.clearKey ? undefined : input.apiKey ? this.encrypt(input.apiKey) : old.key };
    const slots = input.modelSlots || old.modelSlots || {};
    const allowed = ['haiku','sonnet','opus'];
    if (Object.keys(slots).some(key => !allowed.includes(key)) || Object.values(slots).some(value => typeof value !== 'string' || value.length > 512)) throw Error('无效模型用途配置');
    config.modelSlots = protocol === 'anthropic' ? Object.fromEntries(allowed.map(key => [key, (slots[key] || '').trim()])) : {};
    config.defaultRole = protocol === 'anthropic' ? input.defaultRole || old.defaultRole || 'sonnet' : '';
    if (protocol === 'anthropic' && !allowed.includes(config.defaultRole)) throw Error('无效默认模型用途');
    if (protocol === 'anthropic' && input.modelSlots) config.model = config.modelSlots[config.defaultRole];
    if (!config.model || config.model.length > 512) throw Error('请选择或填写默认用途对应的模型');
    config.selectedModels = require('./model-settings').modelSettings(input.selectedModels || old.selectedModels || []);
    for (const model of [config.model,...Object.values(config.modelSlots)].filter(Boolean)) {
      if (!config.selectedModels.some(item=>item.id===model)) config.selectedModels.push({id:model});
    }
    if (config.selectedModels.length > 100) throw Error('最多保存 100 个模型');
    const index = this.data.aiConfigs.findIndex(p => p.id === id);
    if (index < 0) this.data.aiConfigs.push(config); else this.data.aiConfigs[index] = config;
    if (input.activate || (index < 0 && this.data.aiConfigs.length === 1 && input.activate !== false)) this.data.activeAIId = id;
    if (input.mode) this.data.ai = { mode: input.mode, interactive: !!input.interactive };
    if (persist) this.persist(); return id;
  }
}
module.exports = { RemoteStore };
