const cronPanel = {
  data: null, editing: null, ov: null,
  WD: ['日', '一', '二', '三', '四', '五', '六'],
  async syncBadge() {
    try { this.data = await api('/api/cron'); } catch { return; }
    const n = (this.data.tasks || []).filter((t) => t.enabled).length;
    const el = $('#cron-count'); if (!el) return;
    el.textContent = n; el.classList.toggle('hidden', !n);
  },
  async show() { return gsShow('scheduled'); },
  async renderPage(area) {
    this.ov=area;this.editing=null;
    area.innerHTML='<div class="gs-wrap gs-scheduled-wrap"><div class="gs-head"><h2 class="gs-h2">定时任务 <span class="gs-tag" id="cron-scheduler-status"></span></h2><div class="gs-head-actions"><button class="gs-btn" id="cron-scheduler-toggle">暂停全部</button><button class="gs-btn" id="cron-refresh">刷新</button><button class="gs-btn primary" id="cron-new-head">+ 新建</button></div></div><p class="gs-scheduler-note" id="cron-scheduler-note"></p><div class="cron-body"></div></div>';
    area.querySelector('#cron-scheduler-toggle').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{const result=await apiPost('/api/cron/scheduler-toggle',{paused:!this.data?.paused});if(!result.ok)throw Error(result.error);toast(result.paused?'定时任务已暂停':'定时任务已启动');await this.reload();}
      catch(error){toast(error.message,true);}finally{button.disabled=false;}
    };
    area.querySelector('#cron-refresh').onclick=()=>this.reload();
    area.querySelector('#cron-new-head').onclick=()=>{this.editing={};this.render();};
    await this.reload();
  },
  async reload() {
    try { this.data = await api('/api/cron'); } catch { this.data = { tasks: [] }; }
    if (this.ov && gsActive() && gs.view==='scheduled') this.render();
    this.syncBadgeLocal();
  },
  syncBadgeLocal() {
    const n = ((this.data && this.data.tasks) || []).filter((t) => t.enabled).length;
    const el = $('#cron-count'); if (el) { el.textContent = n; el.classList.toggle('hidden', !n); }
  },
  agentLabel(t) { return t.agent === 'codex' ? 'Codex' : t.agent === 'shell' ? 'Shell' : 'Claude Code'; },
  schedLabel(s) {
    if (!s) return '';
    if (s.type === 'at') return '一次 · ' + this.fmtAbs(new Date(s.time).getTime());
    if (s.type === 'every') { const m = Number(s.minutes) || 0; return m % 60 === 0 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`; }
    if (s.type === 'cron') {
      const p = String(s.expr || '').trim().split(/\s+/);
      if (p.length === 5) {
        const [mi, h, dom, mon, dow] = p;
        const hm = () => `${h}:${mi.padStart(2, '0')}`;
        if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return `每天 ${hm()}`;
        if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*' && /^\d$/.test(dow)) return `每周${this.WD[+dow % 7]} ${hm()}`;
        if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `每小时的第 ${+mi} 分钟`;
        if (/^\d+$/.test(mi) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === '*' && dow === '*') return `每月 ${+dom} 日 ${hm()}`;
      }
      return 'cron · ' + s.expr;
    }
    return '';
  },
  fmtAbs(ms) {
    if (!ms || !isFinite(ms)) return '—';
    const d = new Date(ms); const now = new Date();
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return `今天 ${hm}`;
    const tomorrow = new Date(now.getTime() + 86400000);
    if (sameDay(d, tomorrow)) return `明天 ${hm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  },
  lastBadge(t) {
    const h = (t.history || [])[0];
    if (!h) return '';
    if (h.missed) return `<i class="cron-last warn">上次到点时 FanBox 没开着，跳过了</i>`;
    if (h.ok) return `<i class="cron-last ok">上次 ${fmtTime(h.t)} ✓</i>`;
    return `<i class="cron-last bad" title="${escapeHtml(h.error || '')}">上次失败 ✗</i>`;
  },
  render() {
    if(!this.ov||!gsActive()||gs.view!=='scheduled')return;
    const body=this.ov.querySelector('.cron-body'); if(!body)return;
    const paused=this.data?.paused===true;
    const toggle=this.ov.querySelector('#cron-scheduler-toggle');toggle.textContent=paused?'启动全部':'暂停全部';toggle.classList.toggle('primary',paused);toggle.setAttribute('aria-pressed',String(!paused));
    const status=this.ov.querySelector('#cron-scheduler-status');status.textContent=paused?'已暂停':'运行中';status.className='gs-tag '+(paused?'dim':'ok');
    this.ov.querySelector('#cron-scheduler-note').textContent=(paused?'自动触发已暂停，仍可手动运行。':'软件运行时按计划打开终端执行。')+' 暂停不会中止已经开始的任务。运行记录表示终端启动结果。';
    if(this.editing!=null)return this.renderForm(body);
    const tasks=this.data?.tasks||[];
    body.innerHTML=tasks.length?'<div class="gs-task-table-scroll"><table class="gs-table"><thead><tr><th>状态</th><th>名称</th><th>时间配置</th><th>执行方式 / 目录</th><th>下次运行</th><th>操作</th></tr></thead><tbody>'+tasks.map(t=>'<tr class="cron-row" data-id="'+escapeHtml(t.id)+'"><td><span class="gs-tag '+(t.enabled?'ok':'dim')+'">'+(t.enabled?'已启用':'已暂停')+'</span></td><td>'+escapeHtml(t.name)+'</td><td>'+escapeHtml(this.schedLabel(t.schedule))+'</td><td>'+escapeHtml(this.agentLabel(t))+'<div class="path" title="'+escapeHtml(t.cwd||'')+'">'+escapeHtml(t.cwd||'—')+'</div></td><td>'+escapeHtml(t.enabled&&t.nextRun?new Date(t.nextRun).toLocaleString():'—')+'</td><td class="gs-task-actions"><button class="gs-btn '+(t.enabled?'':'primary')+'" data-act="toggle">'+(t.enabled?'暂停':'启动')+'</button><button class="gs-btn" data-act="run">运行</button><button class="gs-btn" data-act="edit">编辑</button><button class="gs-btn danger" data-act="del">删除</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state">暂无定时任务，点击“新建”配置。</div>';
    body.innerHTML+=gsRunHistoryHtml(tasks.flatMap(t=>(t.history||[]).map(h=>({name:t.name,start:new Date(h.t).toISOString(),status:h.missed?'missed':h.ok?'started':'error',message:h.error|| (h.missed?'软件未运行，跳过本次执行':h.ok?'已启动终端'+(h.term?' · '+h.term:''):'启动失败')}))).sort((a,b)=>b.start.localeCompare(a.start)).slice(0,10));
    body.querySelectorAll('.cron-row').forEach(row=>{
      const t=tasks.find(t=>t.id===row.dataset.id);
      row.querySelector('[data-act=toggle]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const r=await apiPost('/api/cron/toggle',{id:t.id,enabled:!t.enabled});if(!r.ok)toast(r.error,true);await this.reload();}catch(error){toast(error.message,true);}finally{button.disabled=false;}};
      row.querySelector('[data-act=run]').onclick=async()=>{const r=await apiPost('/api/cron/run',{id:t.id});toast(r.ok?'已启动终端':r.error,!r.ok);await this.reload();};
      row.querySelector('[data-act=edit]').onclick=()=>{this.editing=t;this.render();};
      row.querySelector('[data-act=del]').onclick=()=>gsConfirm('删除此定时任务？',async ok=>{if(ok){await apiPost('/api/cron/delete',{id:t.id});await this.reload();}});
    });
  },
  // 编辑表单：六种时间预设 → schedule 对象；保存前实时预告接下来 3 次执行
  presetOf(s) {
    if (!s || !s.type) return 'daily';
    if (s.type === 'at') return 'once';
    if (s.type === 'every') return 'every';
    const l = this.schedLabel(s);
    if (l.startsWith('每天')) return 'daily';
    if (l.startsWith('每周')) return 'weekly';
    if (l.startsWith('每小时')) return 'hourly';
    return 'cron';
  },
  renderForm(body) {
    const t = this.editing;
    const s = t.schedule || {};
    const p = String((s.expr || '')).trim().split(/\s+/);
    const pad = (n) => String(n).padStart(2, '0');
    const time0 = p.length === 5 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) ? `${pad(p[1])}:${pad(p[0])}` : '09:00';
    const preset = this.presetOf(s);
    body.innerHTML = `<div class="cron-form">
      <label class="cron-fl">想让它干什么<textarea id="cr-prompt" class="input-field" rows="3" placeholder="白话写就行，如：把灵感箱里的碎片整理进对应选题；Shell 模式则填要执行的命令">${escapeHtml(t.prompt || '')}</textarea></label>
      <div class="cron-grid">
        <label class="cron-fl">谁来干<select id="cr-agent" class="input-field">
          <option value="claude" ${t.agent === 'codex' || t.agent === 'shell' ? '' : 'selected'}>Claude Code</option>
          <option value="codex" ${t.agent === 'codex' ? 'selected' : ''}>Codex</option>
          <option value="shell" ${t.agent === 'shell' ? 'selected' : ''}>Shell 命令</option>
        </select></label>
        <label class="cron-fl">在哪个目录<input id="cr-cwd" class="input-field" value="${escapeHtml(t.cwd || state.cwd || state.home || '')}" /></label>
      </div>
      <label class="cron-check" id="cr-full-wrap"><input type="checkbox" id="cr-full" ${t.full ? 'checked' : ''} /> 全自动：跳过所有确认（无人值守时用，agent 会直接改文件、跑命令）</label>
      <div id="cr-schedule-editor"></div>
      <label class="cron-fl">名称（可不填）<input id="cr-name" class="input-field" value="${escapeHtml(t.name || '')}" placeholder="不填就取任务内容开头" /></label>
      <div class="cron-form-foot">
        <button class="cron-add" id="cr-save">保存</button>
        <button class="cron-btn" id="cr-cancel">取消</button>
      </div>
    </div>`;
    const editor=scheduleEditor.mount(body.querySelector('#cr-schedule-editor'),s);
    const buildSchedule=()=>editor.get();
    body.querySelector('#cr-agent').onchange = () => { body.querySelector('#cr-full-wrap').style.display = body.querySelector('#cr-agent').value === 'shell' ? 'none' : ''; };
    body.querySelector('#cr-agent').onchange();
    body.querySelector('#cr-cancel').onclick = () => { this.editing = null; this.render(); };
    body.querySelector('#cr-save').onclick = async () => {
      const payload = {
        id: t.id, name: body.querySelector('#cr-name').value, cwd: body.querySelector('#cr-cwd').value,
        agent: body.querySelector('#cr-agent').value, prompt: body.querySelector('#cr-prompt').value,
        full: body.querySelector('#cr-full').checked, schedule: buildSchedule(),
        enabled: t.enabled !== false,
      };
      const r = await apiPost('/api/cron/save', payload);
      if (!r.ok) { toast(r.error || '保存失败', true); return; }
      this.editing = null;
      toast('已保存');
      this.reload();
    };

  },
};

$('#cron-entry').onclick = () => cronPanel.show();
cronPanel.syncBadge();
setInterval(() => { if(gsActive()&&gs.view==='scheduled'&&cronPanel.editing==null)cronPanel.reload();else cronPanel.syncBadge(); }, 15000);
if (window.fanboxSchedule) window.fanboxSchedule.onCreate(async ({ reqId, cwd, command }) => {
  try { if (document.getElementById('terminal-panel').classList.contains('hidden')) term.open(); const session = await term.newTab(cwd, command); if (!session || session.dead) throw Error('内嵌终端启动失败'); window.fanboxSchedule.created({ reqId, ok: true, id: session.id }); }
  catch (e) { window.fanboxSchedule.created({ reqId, ok: false, error: e.message }); }
});
