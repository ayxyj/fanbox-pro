/* Shared dialog controls. Attributes are supplied by application templates only. */
window.fanboxUI = Object.freeze({
  confirm({ title, description = '', command, facts = [], note = '', approveLabel = '确认', danger = false, signal }) {
    return new Promise(resolve => {
      if (signal?.aborted) { resolve(false); return; }
      const previous = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'remote-dialog ui-confirm';
      dialog.innerHTML = `<header><span class="ui-confirm-icon" aria-hidden="true">${danger ? '!' : '⌘'}</span><h2></h2>${window.fanboxUI.closeButton()}</header><section class="ui-confirm-body"><p class="ui-confirm-description"></p><dl class="ui-confirm-facts"></dl><div class="ui-confirm-command"><span>待执行的内容</span><pre tabindex="0"><code></code></pre></div><p class="ui-confirm-note"></p></section><footer><button data-cancel autofocus>取消</button><button data-approve class="${danger ? 'ui-confirm-danger' : 'ui-primary'}"></button></footer>`;
      dialog.querySelector('h2').textContent = title;
      dialog.querySelector('.ui-confirm-description').textContent = description;
      const list = dialog.querySelector('dl');
      for (const [label, value] of facts) {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = label; dd.textContent = value || '未识别'; list.append(dt, dd);
      }
      list.hidden = !facts.length;
      dialog.querySelector('.ui-confirm-command').hidden = command == null;
      dialog.querySelector('code').textContent = command ?? '';
      dialog.querySelector('.ui-confirm-note').textContent = note;
      dialog.querySelector('[data-approve]').textContent = approveLabel;
      let finished = false;
      const finish = approved => {
        if (finished) return; finished = true;
        signal?.removeEventListener('abort', abort);
        dialog.close(); dialog.remove();
        if (previous?.isConnected) previous.focus();
        resolve(approved);
      };
      const abort = () => finish(false);
      dialog.querySelector('[data-cancel]').onclick = abort;
      dialog.querySelector('.ui-dialog-close').onclick = abort;
      dialog.querySelector('[data-approve]').onclick = () => finish(true);
      dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); });
      dialog.addEventListener('close', abort);
      signal?.addEventListener('abort', abort, { once: true });
      document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
    });
  },
  secretInput(input, { saved = false, read, onError }) {
    let hasSaved = saved, loading = false, revision = 0, edited = false, revealed = "";
    const wrap = document.createElement('div'); wrap.className = 'ui-secret-field';
    input.replaceWith(wrap); wrap.append(input);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ui-secret-toggle';
    wrap.append(button);
    const draw = () => {
      const visible = input.type === 'text';
      button.title = button.ariaLabel = visible ? '隐藏密钥' : '查看密钥';
      button.setAttribute('aria-pressed', String(visible));
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' + (visible ? '<path d="M3 3l18 18"/>' : '') + '</svg>';
      input.placeholder = hasSaved ? '••••••••（已保存）' : '请输入密钥';
    };
    input.addEventListener('input', () => { edited = true; revision++; });
    button.onclick = async () => {
      if (loading) return;
      if (input.type === 'text') { input.type = 'password'; draw(); return; }
      const current = revision;
      try {
        if (!input.value && hasSaved && !edited) {
          loading = true; button.disabled = true;
          const value = await read();
          if (!input.isConnected || current !== revision) return;
          input.value = value; revealed = value;
        }
        input.type = 'text'; draw();
      } catch (e) { onError(e); }
      finally { loading = false; button.disabled = false; }
    };
    draw();
    return {
      value: () => edited || input.value !== revealed ? input.value : '',
      reset(saved) { revision++; hasSaved = saved; edited = false; revealed = ''; input.value = ''; input.type = 'password'; draw(); }
    };
  },
  closeButton(attributes = '') {
    return `<button type="button" class="ui-dialog-close" aria-label="关闭" title="关闭" ${attributes}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  }
});
