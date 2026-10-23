'use strict';
(() => {
  if (!window.fanboxRemote) return;
  let dialog;
  const api = async (action, args) => {
    const result = await window.fanboxRemote.call(action, args);
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  async function open() {
    if (dialog?.open) { dialog.focus(); return; }
    dialog = document.createElement('dialog');
    dialog.className = 'remote-dialog mcp-settings';
    dialog.style.cssText = 'width:min(780px,90vw);max-height:85vh;overflow:auto';
    dialog.innerHTML = '<header><strong>软件 MCP 管理</strong><button type="button" data-close aria-label="关闭">✕</button></header><p>应用于 FanBox 启动的本地 Claude 会话及企业微信启动的 Claude。保存后对新启动的会话生效，全局 Claude 配置继续保留。</p><p>支持 stdio、HTTP、SSE。填入完整的 mcpServers JSON；环境变量和认证请求头会加密保存。保存不会运行服务器，请仅添加可信配置。</p><label>服务器配置<textarea data-json spellcheck="false" aria-label="MCP JSON 配置" style="display:block;width:100%;box-sizing:border-box;min-height:250px;font-family:monospace"></textarea></label><details><summary>查看配置示例</summary><pre></pre></details><fieldset><legend>启用的服务器（取消勾选即可停用）</legend><div data-servers></div></fieldset><p data-status role="status"></p><footer><button type="button" data-refresh>更新服务器列表</button><button type="button" data-save>保存配置</button><button type="button" data-cancel>取消</button></footer>';
    document.body.append(dialog);
    const current = dialog, editor = current.querySelector('[data-json]'), servers = current.querySelector('[data-servers]'), status = current.querySelector('[data-status]');
    current.querySelector('pre').textContent = JSON.stringify({mcpServers:{example:{type:'stdio',command:'npx',args:['-y','your-mcp-package'],env:{API_KEY:'填写密钥'}},remote_example:{type:'http',url:'https://example.com/mcp',headers:{Authorization:'Bearer 填写密钥'}}}}, null, 2);
    let disabled = new Set(), dirty = false;
    const parse = () => {
      const value = JSON.parse(editor.value);
      if (!value || typeof value !== 'object' || Array.isArray(value) || !value.mcpServers || typeof value.mcpServers !== 'object' || Array.isArray(value.mcpServers) || Object.keys(value).some(key => key !== 'mcpServers')) throw Error('请填写只包含 mcpServers 的 JSON 对象');
      return value.mcpServers;
    };
    const render = () => {
      const value = parse(); servers.replaceChildren();
      for (const name of Object.keys(value)) {
        const label = document.createElement('label'), box = document.createElement('input');
        label.style.cssText = 'display:block;margin:6px 0'; box.type = 'checkbox'; box.checked = !disabled.has(name);
        box.onchange = () => { dirty = true; box.checked ? disabled.delete(name) : disabled.add(name); };
        label.append(box, document.createTextNode(' ' + name)); servers.append(label);
      }
      if (!Object.keys(value).length) servers.textContent = '暂未配置服务器。';
      return value;
    };
    const close = () => {
      if (dirty && !window.confirm('尚未保存 MCP 配置，确定放弃修改？')) return;
      editor.value = ''; current.close(); current.remove(); if (dialog === current) dialog = null;
    };
    current.querySelector('[data-close]').onclick = close;
    current.querySelector('[data-cancel]').onclick = close;
    current.oncancel = event => { event.preventDefault(); close(); };
    editor.oninput = () => { dirty = true; };
    current.querySelector('[data-refresh]').onclick = () => { try { render(); status.textContent = '服务器列表已更新。'; } catch (error) { status.textContent = error.message; } };
    const save = current.querySelector('[data-save]'); save.disabled = true; editor.disabled = true;
    save.onclick = async () => {
      save.disabled = true;
      try {
        const mcpServers = render();
        await api('mcp-save', {mcpServers, disabled:[...disabled].filter(name => Object.hasOwn(mcpServers,name))});
        dirty = false; status.textContent = '已保存。请重新启动 Claude 会话以加载最新配置。';
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; }
    };
    current.showModal();
    try {
      const value = await api('mcp-read');
      if (!current.isConnected) return;
      disabled = new Set(value.disabled); editor.value = JSON.stringify({mcpServers:value.mcpServers}, null, 2); render();
      save.disabled = false; editor.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  window.fanboxRemote.on('mcp-settings', () => open().catch(error => window.alert(error.message)));
  if (window.remoteUI) window.remoteUI.mcpSettings = open;
})();
