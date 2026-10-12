/* GitSync Next 前端视图（侧栏 Git 同步入口接管 #file-area） */
'use strict';

const gs = {
  view: 'overview', // overview | workspaces | repos | tasks | logs
  data: { workspaces: [], repos: [], tasks: [], settings: {} },
  busy: false,
  _selectedRepos: [],
};

// 本地弹窗封装：fanbox 的 inputDialog(title, value, placeholder) / confirmDialog(msg)
// 都返回 Promise（null=false），这里包成回调风格，避免改动大量调用点。
function gsPrompt(title, label, value, cb) {
  inputDialog(title, value, label).then((v) => { if (v !== null) cb(v); });
}
function gsConfirm(msg, cb) {
  confirmDialog(msg).then((ok) => cb(ok));
}

// 复用 fanbox 风格：进入/离开 gitsyncMode 时把 #file-area 让位给视图
function setGsMode(on) {
  gsBranchTooltipCleanup?.();
  if (on) {
    state.gsMode = true;
    state.skillsMode = false;
    state.recentMode = false;
    state.cursor = -1;
    // 关掉面包屑/状态栏的常规渲染
    if (typeof renderBreadcrumb === 'function') renderBreadcrumb();
  } else {
    state.gsMode = false;
  }
  if (typeof render === 'function') render();
  if (typeof renderStatusbar === 'function') renderStatusbar();
}

function gsActive() { return state.gsMode === true; }

async function gsShow(view) {
  setGsMode(true);
  gs.view = view;
  $('#cron-entry')?.classList.toggle('active', view === 'scheduled');
  // 侧栏高亮
  document.querySelectorAll('#gs-nav-list li').forEach((li) => {
    li.classList.toggle('active', li.dataset.gsView === view);
  });
  const area = $('#file-area');
  if (view !== 'repos' || !area.querySelector('.gs-table')) area.innerHTML = '<div class="cmdk-loading">加载中…</div>';
  try {
    if (view === 'overview') await gsRenderOverview(area);
    else if (view === 'workspaces') await gsRenderWorkspaces(area);
    else if (view === 'repos') await gsRenderRepos(area);
    else if (view === 'tasks') await gsRenderTasks(area);
    else if (view === 'logs') await gsRenderLogs(area);
    else if (view === 'scheduled') await cronPanel.renderPage(area);
  } catch (e) {
    area.innerHTML = `<div class="empty-state"><div class="big">⚠</div>加载失败：${escapeHtml(String(e && e.message || e))}</div>`;
  }
  gsRefreshBadges();
}

// ============== 总览 ==============
async function gsRenderOverview(area) {
  const [ov, wss, repos, tasks] = await Promise.all([
    api('/api/gs/overview'),
    api('/api/gs/workspace/list'),
    api('/api/gs/repo/list'),
    api('/api/gs/tasks'),
  ]);
  if (ov.error) { area.innerHTML = `<div class="empty-state">${escapeHtml(ov.error)}</div>`; return; }
  const nr = ov.nextRun;
  const cards = `
    <div class="gs-wrap">
      <div class="gs-head">
        <h2 class="gs-h2">总览</h2>
        <div class="gs-head-actions">
          <button class="gs-btn" id="gs-settings-btn">设置</button>
        </div>
      </div>
      <div class="gs-stat-grid">
        <div class="gs-stat"><div class="num">${ov.repos.total}</div><div class="lbl">仓库总数</div></div>
        <div class="gs-stat"><div class="num">${ov.repos.enabled}</div><div class="lbl">已启用</div></div>
        <div class="gs-stat ${ov.repos.dirty ? 'alert' : ''}"><div class="num">${ov.repos.dirty}</div><div class="lbl">脏</div></div>
        <div class="gs-stat ${ov.repos.lost ? 'alert' : ''}"><div class="num">${ov.repos.lost}</div><div class="lbl">失联</div></div>
        <div class="gs-stat"><div class="num">${ov.tasks.enabled}<small>/${ov.tasks.total}</small></div><div class="lbl">启用任务</div></div>
        <div class="gs-stat next-run">
          <div class="num small">${nr ? escapeHtml(nr.name) : '—'}</div>
          <div class="lbl">${nr ? escapeHtml(nr.text) : '暂无任务'}</div>
        </div>
      </div>
      <div class="gs-section">
        <h3>工作区</h3>
        ${wss.workspaces.length === 0
          ? '<div class="empty-state">还没有工作区。点「工作区」新增目录。</div>'
          : `<ul class="gs-list">${wss.workspaces.map((w) => `
              <li>
                <span class="fname">${escapeHtml(w.name)}</span>
                <span class="path">${escapeHtml(w.path)}</span>
                <span class="meta">排除: ${w.excludes.length ? w.excludes.map(escapeHtml).join('、') : '—'}</span>
              </li>`).join('')}</ul>`}
      </div>
    </div>
  `;
  area.innerHTML = cards;
  area.querySelectorAll('[data-gs-jump]').forEach((b) => {
    b.onclick = () => gsShow(b.dataset.gsJump);
  });
  const $set = $('#gs-settings-btn');
  if ($set) $set.onclick = () => gsShowSettings();
}

// ============== 工作区 ==============
async function gsRenderWorkspaces(area) {
  const r = await api('/api/gs/workspace/list');
  const wss = r.workspaces || [];
  area.innerHTML = `
    <div class="gs-wrap">
      <div class="gs-head">
        <h2 class="gs-h2">工作区 <span class="gs-sub">${wss.length} 个</span></h2>
        <div class="gs-head-actions">
          <button class="gs-btn primary" id="gs-ws-add">+ 新增目录</button>
        </div>
      </div>
      ${wss.length === 0
        ? '<div class="empty-state"><div class="big">▤</div>点「+ 新增目录」开始：选定一个本地目录，自动扫描 .git 仓库加入清单。</div>'
        : `<table class="gs-table">
            <thead><tr><th>名称</th><th>路径</th><th>排除</th><th>操作</th></tr></thead>
            <tbody>${wss.map((w) => `
              <tr data-wsid="${escapeHtml(w.id)}">
                <td>${escapeHtml(w.name)}</td>
                <td class="path">${escapeHtml(w.path)}</td>
                <td class="excludes">${w.excludes.length ? w.excludes.map(escapeHtml).join('、') : '—'}</td>
                <td>
                  <button class="gs-btn" data-act="scan">扫描</button>
                  <button class="gs-btn" data-act="edit">编辑</button>
                  <button class="gs-btn danger" data-act="del">删除</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>`}
    </div>
  `;
  const $add = $('#gs-ws-add');
  if ($add) $add.onclick = () => gsWsAdd();
  area.querySelectorAll('button[data-act]').forEach((b) => {
    const tr = b.closest('tr');
    const id = tr && tr.dataset.wsid;
    b.onclick = () => {
      if (b.dataset.act === 'del') gsWsDel(id);
      else if (b.dataset.act === 'edit') gsWsEdit(id);
      else if (b.dataset.act === 'scan') gsWsScan(id);
    };
  });
}

function gsWsAdd() {
  gsPrompt('新增工作区', '目录绝对路径（如 D:\\\\code\\\\projects）：', '', async (val) => {
    if (!val) return;
    const r = await apiPost('/api/gs/workspace/save', { path: val, name: val.split(/[\\\\/]/).pop() || val, excludes: ['node_modules', '.venv'] });
    if (r.error) { toast('保存失败：' + r.error, true); return; }
    toast('已保存');
    gsShow('workspaces');
  });
}

function gsWsEdit(id) {
  // 简化版：复用 save 接口，只读 name/excludes
  api('/api/gs/workspace/list').then((r) => {
    const w = (r.workspaces || []).find((x) => x.id === id);
    if (!w) return;
    gsPrompt('编辑工作区', '名称：', w.name, async (name) => {
      if (!name) return;
      const r = await apiPost('/api/gs/workspace/save', { id, path: w.path, name, excludes: w.excludes });
      if (r.error) { toast('保存失败：' + r.error, true); return; }
      gsShow('workspaces');
    });
  });
}

function gsWsDel(id) {
  gsConfirm('删除工作区会一并删除其下所有仓库，确定？', async (ok) => {
    if (!ok) return;
    const r = await apiPost('/api/gs/workspace/delete', { id });
    if (r.error) { toast('删除失败：' + r.error, true); return; }
    gsShow('workspaces');
  });
}

async function gsWsScan(id) {
  toast('正在扫描…');
  const r = await apiPost('/api/gs/workspace/scan', { id });
  if (r.error) { toast('扫描失败：' + r.error, true); return; }
  toast(`发现 ${r.found} 个仓库；新增 ${r.added}；失联 ${r.lost}`);
  gsShow('repos');
}

// ============== 仓库 ==============
let gsBranchTooltipCleanup = null;
function gsBindBranchTooltips(area) {
  for (const branch of area.querySelectorAll('.gs-current-branch')) {
    const show = () => {
      gsBranchTooltipCleanup?.();
      const tooltip = document.createElement('div');
      tooltip.className = 'gs-branch-tooltip';
      tooltip.id = 'gs-current-branch-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = branch.dataset.branch;
      document.body.appendChild(tooltip);
      branch.setAttribute('aria-describedby', tooltip.id);
      const rect = branch.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      tooltip.style.left = Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8)) + 'px';
      tooltip.style.top = Math.max(8, rect.bottom + bounds.height + 8 <= innerHeight ? rect.bottom + 6 : rect.top - bounds.height - 6) + 'px';
      const escape = event => { if (event.key === 'Escape') hide(); };
      const hide = () => {
        tooltip.remove(); branch.removeAttribute('aria-describedby');
        window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
        document.removeEventListener('keydown', escape);
        if (gsBranchTooltipCleanup === hide) gsBranchTooltipCleanup = null;
      };
      gsBranchTooltipCleanup = hide;
      window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
      document.addEventListener('keydown', escape);
    };
    branch.addEventListener('mouseenter', show);
    branch.addEventListener('focus', show);
    branch.addEventListener('mouseleave', () => { if (document.activeElement !== branch) gsBranchTooltipCleanup?.(); });
    branch.addEventListener('blur', () => gsBranchTooltipCleanup?.());
  }
}

async function gsRenderRepos(area, snapshot) {
  const [r, wsr] = snapshot || await Promise.all([api('/api/gs/repo/list'), api('/api/gs/workspace/list')]);
  if (!gsActive() || gs.view !== 'repos') return;
  gs.repoSnapshot = [r, wsr];
  gs.repoSignature = JSON.stringify(r.repos || []);
  const repos = r.repos || [];
  const wss = wsr.workspaces || [];
  const wsMap = new Map(wss.map((w) => [w.id, w]));
  const selected = new Set(gs._selectedRepos);
  gsBranchTooltipCleanup?.();
  area.innerHTML = `
    <div class="gs-wrap gs-repos-wrap">
      <div class="gs-head">
        <h2 class="gs-h2">仓库 <span class="gs-sub">${repos.length} 个 · 选中 ${selected.size}</span></h2>
        <div class="gs-head-actions">
          <button class="gs-btn" id="gs-repo-refresh">刷新状态</button>
          <button class="gs-btn" id="gs-repo-batch-sync" ${selected.size === 0 ? 'disabled' : ''}>批量同步 (${selected.size})</button>
          <button class="gs-btn" id="gs-repo-batch-toggle" ${selected.size === 0 ? 'disabled' : ''}>批量启停</button>
          <button class="gs-btn" id="gs-repo-add">+ 手动添加</button>
        </div>
      </div>
      ${repos.length === 0
        ? '<div class="empty-state"><div class="big">▦</div>仓库列表为空。先去「工作区」扫描一个目录，或手动添加。</div>'
        : `<div class="gs-repo-table-scroll"><table class="gs-table gs-repo-table">
            <colgroup><col style="width:36px"><col><col style="width:200px"><col style="width:220px"><col style="width:180px"><col style="width:60px"><col style="width:170px"><col style="width:115px"><col style="width:170px"></colgroup>
            <thead><tr><th><input type="checkbox" id="gs-repo-chk-all"/></th><th>名称</th><th>关注分支 / 切换</th><th>当前分支</th><th>状态</th><th>Stash</th><th>上次成功同步</th><th>同步结果</th><th>操作</th></tr></thead>
            <tbody>${repos.map((r) => {
              const wsn = wsMap.get(r.workspaceId) ? wsMap.get(r.workspaceId).name : '—';
              const status = r.lost ? '<span class="gs-tag alert">失联</span>'
                : r.dirty ? '<span class="gs-tag alert">脏</span>'
                : r.enabled ? '<span class="gs-tag ok">启用</span>' : '<span class="gs-tag dim">停用</span>';
              const ab = (r.ahead || r.behind) ? `↑${r.ahead || 0} ↓${r.behind || 0}` : '';
              return `<tr data-repoid="${escapeHtml(r.id)}" class="${selected.has(r.id) ? 'selected' : ''}">
                <td><input type="checkbox" class="gs-repo-chk" ${selected.has(r.id) ? 'checked' : ''}/></td>
                <td class="gs-repo-name"><div class="fname" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div><div class="path" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</div><div class="ws-name">${escapeHtml(wsn)}</div></td>
                <td>${gsBranchSelect(r)}</td>
                <td class="mono"><span class="gs-current-branch" tabindex="0" aria-label="${escapeHtml(r.currentBranch || '—')}" data-branch="${escapeHtml(r.currentBranch || '—')}">${escapeHtml(r.currentBranch || '—')}</span></td>
                <td><div class="gs-status-line">${status}${ab ? `<span class="mono small gs-status-delta" title="${escapeHtml(ab)}">${ab}</span>` : ''}</div></td>
                <td><button class="gs-btn" data-act="stash">${r.stashCount || 0}</button></td><td class="mono small">${r.lastSync ? escapeHtml(new Date(r.lastSync).toLocaleString()) : '—'}</td><td>${gsRepoResultBadge(r)}</td>
                <td class="gs-repo-actions"><div class="gs-repo-action-group"><button class="gs-btn primary" data-act="sync">同步</button><button class="gs-btn" data-act="more" aria-label="仓库更多操作">更多 ▾</button></div></td>
              </tr>`;
            }).join('')}
            </tbody>
          </table></div>`}
    </div>
  `;
  gsBindBranchTooltips(area);
  function updateSelection() {
    area.querySelectorAll('tr[data-repoid]').forEach(tr => {
      const checked = selected.has(tr.dataset.repoid);
      tr.classList.toggle('selected', checked); tr.querySelector('.gs-repo-chk').checked = checked;
    });
    const all = area.querySelector('#gs-repo-chk-all');
    if (all) { all.checked = repos.length > 0 && selected.size === repos.length; all.indeterminate = selected.size > 0 && selected.size < repos.length; }
    area.querySelector('.gs-h2 .gs-sub').textContent = repos.length + ' 个 · 选中 ' + selected.size;
    const batch = area.querySelector('#gs-repo-batch-sync');
    batch.textContent = '批量同步 (' + selected.size + ')'; batch.disabled = !selected.size;
    area.querySelector('#gs-repo-batch-toggle').disabled = !selected.size;
  }
  area.querySelectorAll('.gs-branch-select').forEach(select => {
    select.onchange = async () => {
      const id = select.closest('tr').dataset.repoid, branch = select.value;
      const repo = repos.find(r => r.id === id), previous = (repo.branches || [])[0] || 'master';
      select.disabled = true; gs.branchChanging = true;
      try {
        const saved = await apiPost('/api/gs/repo/branches/save', {id, branches: [branch]});
        if (saved.error) { select.value = previous; throw Error(saved.error); }
        repo.branches = [branch]; toast('已保存关注分支，正在切换…');
        const response = await apiPost('/api/gs/repo/sync', {id, switchOnly: true});
        if (response.error) throw Error(response.error);
        toast(response.result.message, response.result.status !== 'ok');
        if (response.result.status === 'dirty_blocked') gsDirtyGuide(id);
      } catch (e) { toast(e.message, true); }
      finally { gs.branchChanging = false; select.disabled = false; select.blur(); await gsReloadRepoSnapshot(); }
    };
  });
  // 选择 / 批量
  const $all = $('#gs-repo-chk-all');
  if ($all) $all.onchange = () => {
    if ($all.checked) repos.forEach((r) => selected.add(r.id));
    else selected.clear();
    gs._selectedRepos = [...selected];
      updateSelection();
  };
  area.querySelectorAll('.gs-repo-chk').forEach((cb) => {
    const tr = cb.closest('tr');
    const id = tr && tr.dataset.repoid;
    cb.onchange = () => {
      if (cb.checked) selected.add(id); else selected.delete(id);
      gs._selectedRepos = [...selected];
      updateSelection();
    };
    // 点行也能切换（除点击按钮 / checkbox / 链接）
    tr.onclick = (ev) => {
      if (ev.target.closest('button, input, a, select, option')) return;
      cb.checked = !cb.checked;
      cb.onchange();
    };
    // 右键菜单
    tr.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      gsRepoContextMenu(id, ev.clientX, ev.clientY);
    };
  });
  // 按钮
  const $add = $('#gs-repo-add');
  if ($add) $add.onclick = () => gsRepoAdd();
  const $ref = $('#gs-repo-refresh');
  if ($ref) $ref.onclick = async () => { $ref.disabled = true; $ref.textContent = '刷新中…'; try { await api('/api/gs/repo/list?refresh=1'); await gsReloadRepoSnapshot(); } catch(e) { toast(e.message, true); } finally { $ref.disabled = false; $ref.textContent = '刷新状态'; } };
  const $bs = $('#gs-repo-batch-sync');
  if ($bs) $bs.onclick = () => gsRepoBatchSync([...selected]);
  const $bt = $('#gs-repo-batch-toggle');
  if ($bt) $bt.onclick = () => gsRepoBatchToggle([...selected]);
  area.querySelectorAll('button[data-act]').forEach((b) => {
    const tr = b.closest('tr');
    const id = tr && tr.dataset.repoid;
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (b.dataset.act === 'result') return gsRepoResultShow(id);
      if (b.dataset.act === 'more') { const rect = b.getBoundingClientRect(); return gsRepoContextMenu(id, Math.min(rect.left, window.innerWidth - 240), rect.bottom + 4); }
      if (b.dataset.act === 'sync') return gsRepoSyncOne(id);
      if (b.dataset.act === 'switch') return gsRepoSyncOne(id, true);
      if (b.dataset.act === 'stash') return gsStashShow(id);
      if (b.dataset.act === 'dirty') return gsDirtyGuide(id);
      if (b.dataset.act === 'refresh') { await apiPost('/api/gs/repo/refresh', { id }); return gsShow('repos'); }
      if (b.dataset.act === 'del') {
        gsConfirm('删除此仓库记录？', async (ok) => { if (!ok) return; await apiPost('/api/gs/repo/delete', { id }); gsShow('repos'); });
      }
    };
  });
}

async function gsRepoSyncOne(id, switchOnly = false) {
  toast('同步中…');
  const r = await apiPost('/api/gs/repo/sync', { id, switchOnly });
  if (r.error) { toast('同步失败：' + r.error, true); return; }
  toast(r.result.message || '同步完成', r.result.status !== 'ok');
  if (r.result.status === 'dirty_blocked') gsDirtyGuide(id);
  gsShow('repos');
}

function gsResultLabel(status) {
  return ({ok: '成功', success: '成功', dirty_blocked: '待处理', diverged: '已分叉', error: '失败', failed: '失败', partial: '部分成功'})[status] || status || '未同步';
}
function gsRepoResultBadge(repo) {
  const tone = ['ok', 'success'].includes(repo.lastStatus) ? 'ok' : repo.lastStatus ? 'alert' : 'dim';
  return '<button class="gs-result-button" data-act="result" title="查看同步记录与完整原因"><span class="gs-tag ' + tone + '">' + escapeHtml(gsResultLabel(repo.lastStatus)) + '</span><span class="gs-result-hint">记录 ›</span></button>';
}
async function gsRepoResultShow(id) {
  try {
    const [rr, lr] = await Promise.all([api('/api/gs/repo/list?cached=1'), api('/api/gs/logs?repoId=' + encodeURIComponent(id) + '&limit=50')]);
    if (rr.error || lr.error) throw Error(rr.error || lr.error);
    const repo = (rr.repos || []).find(r => r.id === id);
    if (!repo) return toast('仓库记录不存在', true);
    const logs = lr.logs || [];
    const latest = repo.lastResult;
    const stamp = value => value ? new Date(value).toLocaleString() : '—';
    const message = latest?.message || repo.lastMessage || '尚未运行同步或分支切换';
    gsModal('同步记录 · ' + escapeHtml(repo.name),
      '<div class="gs-result-summary"><span class="gs-tag ' + (repo.lastStatus === 'ok' ? 'ok' : 'alert') + '">' + escapeHtml(gsResultLabel(repo.lastStatus)) + '</span><span>最近执行：' + escapeHtml(stamp(repo.lastAttempt)) + '</span></div>' +
      '<p class="gs-result-meta">仓库：' + escapeHtml(repo.path) + '</p>' +
      '<p class="gs-result-meta">目标分支：' + escapeHtml(latest?.targetBranch || repo.branches?.[0] || 'master') + ' · 操作：' + (latest?.operation === 'switch' ? '切换分支' : '同步') + '</p>' +
      '<pre class="gs-result-message">' + escapeHtml(message) + '</pre>' +
      (latest?.failedStage ? '<p class="gs-result-meta">失败阶段：' + escapeHtml(latest.failedStage) + '</p>' : '') +
      (latest?.errorDetails ? '<h4>完整错误</h4><pre class="gs-result-message">' + escapeHtml(latest.errorDetails) + '</pre>' : '') +
      '<h4>历史记录（最近 ' + logs.length + ' 条）</h4>' +
      (logs.length ? logs.map(log => '<details class="gs-result-history"><summary><span>' + escapeHtml(stamp(log.start)) + '</span><span>' + escapeHtml(gsResultLabel(log.status)) + '</span><span>' + (log.operation === 'switch' ? '切换分支' : '同步') + '</span></summary><pre class="gs-result-message">' + escapeHtml(log.message || '') + '</pre>' + (log.logText ? '<pre class="gs-result-message">' + escapeHtml(log.logText) + '</pre>' : '') + '</details>').join('') : '<p>暂无历史记录。运行同步后自动保存。</p>') +
      '<p class="gs-result-meta">记录保存在本机，重启后仍可查看；保留期限与数量可在 Git 设置中调整。</p>');
  } catch(e) { toast(e.message, true); }
}

// 模拟 fanbox 的 popupMenuAt：点击位置弹出上下文菜单
function gsRepoContextMenu(id, x, y) {
  const show = (repo) => {
    if (!repo) return;
    const items = [
      { label: '立即同步', fn: () => gsRepoSyncOne(id) },
      { label: '切换到关注分支', fn: () => gsRepoSyncOne(id, true) },
      { label: '刷新状态', fn: async () => { await apiPost('/api/gs/repo/refresh', { id }); gsShow('repos'); } },
      { label: '查看 stash', fn: () => gsStashShow(id) },
      { label: '同步记录与原因', fn: () => gsRepoResultShow(id) },
      { sep: true },
      { label: '处理脏 · 提交', fn: () => gsDirtyCommit(id) },
      { label: '处理脏 · Stash', fn: () => gsDirtyStash(id) },
      { label: '处理脏 · 放弃改动', fn: () => gsDirtyDiscard(id), danger: true },
      { sep: true },
      { label: repo.enabled ? '停用' : '启用', fn: async () => { await apiPost('/api/gs/repo/toggle', { id, enabled: !repo.enabled }); gsShow('repos'); } },
      { label: '选择关注分支', fn: () => document.querySelector('tr[data-repoid="' + id + '"] .gs-branch-select')?.focus() },
      { sep: true },
      { label: '在终端打开', fn: async () => { try { await term.openInDir(repo.path); } catch (error) { toast('打开终端失败：' + error.message, true); } } },
      { label: '复制路径', fn: () => { navigator.clipboard.writeText(repo.path); toast('已复制'); } },
      { label: '删除', fn: () => gsConfirm('删除此仓库记录？', async (ok) => { if (!ok) return; await apiPost('/api/gs/repo/delete', { id }); gsShow('repos'); }), danger: true },
    ];
    gsPopup(x, y, items);
  };
  const cached = (gs.repoSnapshot?.[0]?.repos || []).find(repo => repo.id === id);
  if (cached) show(cached);
  else api('/api/gs/repo/list').then(r => show((r.repos || []).find(repo => repo.id === id))).catch(error => toast(error.message, true));
}

function gsPopup(x, y, items) {
  closeContextMenu();
  const old = document.getElementById('gs-popup'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'gs-popup';
  el.className = 'context-menu';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = items.map((it, i) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}">${escapeHtml(it.label)}</div>`).join('');
  document.body.appendChild(el);
  el.querySelectorAll('.ctx-item').forEach((c) => {
    c.onclick = () => { el.remove(); items[+c.dataset.i].fn(); };
  });
  setTimeout(() => {
    const close = (ev) => { if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

async function gsRepoBatchSync(ids) {
  if (ids.length === 0) return;
  toast(`批量同步 ${ids.length} 个…`);
  // 顺序跑（仓库级互斥由 sync-engine 保证）
  let ok = 0, blocked = 0, failed = 0;
  for (const id of ids) {
    try { const r = await apiPost('/api/gs/repo/sync', { id });
      if (r.error || r.result.status === 'error') failed++;
      else if (r.result.status === 'ok') ok++; else blocked++;
    } catch { failed++; }
  }
  toast(`批量完成：${ok} 成功 / ${blocked} 待处理 / ${failed} 失败`, blocked + failed > 0);
  gsShow('repos');
}

async function gsRepoBatchToggle(ids) {
  if (ids.length === 0) return;
  const r = await api('/api/gs/repo/list');
  const map = new Map((r.repos || []).map((x) => [x.id, x]));
  for (const id of ids) {
    const cur = map.get(id);
    if (!cur) continue;
    await apiPost('/api/gs/repo/toggle', { id, enabled: !cur.enabled });
  }
  toast('批量启停完成');
  gsShow('repos');
}

// ============== Stash 弹层 ==============
function gsStashShow(id) {
  api(`/api/gs/repo/stash?id=${encodeURIComponent(id)}`).then((r) => {
    if (r.error) { toast(r.error, true); return; }
    const list = r.list || [];
    const body = list.length === 0
      ? '<div class="empty-state">此仓库没有 stash。</div>'
      : `<table class="gs-table">
          <thead><tr><th>idx</th><th>ref</th><th>消息</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${list.map((s) => `<tr>
            <td class="mono">${s.idx}</td>
            <td class="mono small">${escapeHtml(s.ref || '')}</td>
            <td>${escapeHtml(s.message || '(无)')}</td>
            <td class="mono small">${escapeHtml(s.date || '')}</td>
            <td>
              <button class="gs-btn" data-act="apply" data-idx="${s.idx}">应用</button>
              <button class="gs-btn" data-act="pop" data-idx="${s.idx}">弹出</button>
              <button class="gs-btn danger" data-act="drop" data-idx="${s.idx}">删除</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`;
    gsModal('Stash 列表', `
      <div class="gs-stash-head">
        <button class="gs-btn primary" id="gs-stash-new">+ 暂存当前改动</button>
      </div>
      ${body}
    `, (root) => {
      $('#gs-stash-new', root).onclick = () => gsPrompt('暂存当前改动', '备注（可空）：', '', async (msg) => {
        if (msg === null) return;
        const r2 = await apiPost('/api/gs/repo/stash', { id, op: 'push', message: msg });
        if (r2.error) { toast(r2.error, true); return; }
        toast('已暂存');
        gsStashShow(id);
        // 关闭旧弹层，由上面的 gsStashShow 重新弹
        document.getElementById('gs-modal')?.remove();
      });
      root.querySelectorAll('button[data-act]').forEach((b) => {
        b.onclick = async () => {
          const idx = +b.dataset.idx;
          const r3 = await apiPost('/api/gs/repo/stash', { id, op: b.dataset.act, index: idx });
          if (r3.error) { toast(r3.error, true); return; }
          toast('完成');
          document.getElementById('gs-modal')?.remove();
          gsStashShow(id);
        };
      });
    });
  });
}

// ============== 脏状态处理 ==============
function gsDirtyCommit(id) {
  gsPrompt('提交当前改动', '提交信息：', 'gitsync: auto commit', async (msg) => {
    if (!msg) return;
    const r = await apiPost('/api/gs/repo/commit', { id, message: msg });
    if (r.error) { toast(r.error, true); return; }
    toast('已提交');
    gsShow('repos');
  });
}
function gsDirtyStash(id) {
  gsPrompt('暂存当前改动', '备注：', 'gitsync auto stash', async (msg) => {
    if (msg === null) return;
    const r = await apiPost('/api/gs/repo/stash', { id, op: 'push', message: msg });
    if (r.error) { toast(r.error, true); return; }
    toast('已暂存');
    gsShow('repos');
  });
}
function gsDirtyDiscard(id) {
  gsConfirm('放弃所有本地改动（reset --hard + clean -fd），不可恢复，确定？', async (ok) => {
    if (!ok) return;
    const r = await apiPost('/api/gs/repo/discard', { id });
    if (r.error) { toast(r.error, true); return; }
    toast('已放弃');
    gsShow('repos');
  });
}

// 分支选项来自持久化缓存；后台读取本地及 origin 的引用，不在打开下拉框时 fetch。
function gsBranchSelect(repo) {
  const watched = (repo.branches || [])[0] || 'master';
  const options = [...new Set([watched, ...(repo.availableBranches || []), ...(repo.remoteBranches || [])])];
  return '<select class="gs-branch-select" title="选择后保存关注分支并安全切换；未提交改动会阻止切换">' + options.map(branch => '<option value="' + escapeHtml(branch) + '"' + (branch === watched ? ' selected' : '') + '>' + escapeHtml(branch) + '</option>').join('') + '</select>';
}
async function gsReloadRepoSnapshot() {
  if (!gsActive() || gs.view !== 'repos' || gs.branchChanging) return;
  const refresh = Date.now() >= (gs.nextBackgroundRefresh || 0);
  if (refresh) gs.nextBackgroundRefresh = Date.now() + 60000;
  const r = await api('/api/gs/repo/list' + (refresh ? '' : '?cached=1'));
  if (!gsActive() || gs.view !== 'repos' || gs.branchChanging || document.activeElement?.matches('.gs-branch-select')) return;
  if (gs.repoSignature !== JSON.stringify(r.repos || [])) await gsRenderRepos($('#file-area'), [r, gs.repoSnapshot[1]]);
}
setInterval(() => { gsReloadRepoSnapshot().catch(() => {}); }, 2000);
function gsDirtyGuide(id) {
  gsModal('未提交改动：请选择处理方式', '<p>远端代码可以正常获取。提交或 stash 后，再点击同步或切换分支。</p><div class="input-actions"><button class="gs-btn" id="gs-dirty-commit">提交改动</button><button class="gs-btn" id="gs-dirty-stash">Stash 暂存</button><button class="gs-btn" id="gs-dirty-cancel">稍后处理</button></div>', root => {
    const close = () => document.getElementById('gs-modal')?.remove();
    $('#gs-dirty-commit', root).onclick = () => { close(); gsDirtyCommit(id); };
    $('#gs-dirty-stash', root).onclick = () => { close(); gsDirtyStash(id); };
    $('#gs-dirty-cancel', root).onclick = close;
  });
}

// ============== 通用 modal ==============
function gsModal(title, bodyHtml, onMount) {
  const old = document.getElementById('gs-modal'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'gs-modal';
  el.className = 'input-overlay';
  el.innerHTML = `<div class="input-dialog" style="width:min(720px,92vw);max-height:80vh;display:flex;flex-direction:column">
    <div class="input-title">${escapeHtml(title)}<button id="gs-modal-x" style="float:right;background:none;border:none;color:var(--text-dim);font-size:16px;cursor:pointer">✕</button></div>
    <div class="gs-modal-body" style="overflow:auto;flex:1;min-height:0;margin-top:8px">${bodyHtml}</div>
  </div>`;
  document.body.appendChild(el);
  $('#gs-modal-x', el).onclick = () => el.remove();
  el.addEventListener('click', (ev) => { if (ev.target === el) el.remove(); });
  if (onMount) onMount(el);
}

// ============== 设置 + 导入导出 ==============
async function gsShowSettings() {
  const [sr, tr] = await Promise.all([api('/api/gs/settings'), api('/api/gs/tasks')]);
  const settings = sr.settings || {};
  const taskCount = (tr.tasks || []).length;
  gsModal('设置', `
    <div class="gs-task-form">
      <label>日志保留天数（超过即清理）
        <input class="input-field mono" id="gs-st-ret" type="number" min="1" value="${settings.retentionDays || 30}"/>
      </label>
      <label>日志条数上限（按数量裁剪）
        <input class="input-field mono" id="gs-st-max" type="number" min="100" value="${settings.maxLogEntries || 2000}"/>
      </label>
      <hr style="border:0;border-top:1px solid var(--border);margin:6px 0"/>
      <div class="gs-task-row">
        <button class="gs-btn" id="gs-st-export">导出配置</button>
        <button class="gs-btn" id="gs-st-import">导入配置</button>
      </div>
      <p class="gs-task-preview" style="margin-top:6px">${taskCount} 个任务 · 当前配置适用于本机个人环境，导入会先清空已有数据。</p>
    </div>
    <div class="input-actions">
      <button class="gs-btn" id="gs-st-cancel">取消</button>
      <button class="gs-btn primary" id="gs-st-save">保存</button>
    </div>
  `, (root) => {
    $('#gs-st-cancel', root).onclick = () => document.getElementById('gs-modal').remove();
    $('#gs-st-save', root).onclick = async () => {
      const retentionDays = parseInt($('#gs-st-ret', root).value, 10) || 30;
      const maxLogEntries = parseInt($('#gs-st-max', root).value, 10) || 2000;
      await apiPost('/api/gs/settings/save', { retentionDays, maxLogEntries });
      toast('已保存');
      document.getElementById('gs-modal').remove();
    };
    $('#gs-st-export', root).onclick = async () => {
      const r = await api('/api/gs/export');
      if (r.error) { toast(r.error, true); return; }
      // 下载到本地
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gitsync-config-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已导出 ' + a.download);
    };
    $('#gs-st-import', root).onclick = () => {
      // 弹一个文件选择 + 二次确认
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async () => {
          let data; try { data = JSON.parse(r.result); } catch (_) { toast('JSON 解析失败', true); return; }
          gsConfirm('导入会清空现有数据（工作区/仓库/任务/设置），确定继续？', async (ok) => {
            if (!ok) return;
            const r2 = await apiPost('/api/gs/import', data);
            if (r2.error) { toast(r2.error, true); return; }
            toast('已导入：' + JSON.stringify(r2));
            document.getElementById('gs-modal').remove();
            gsRefreshBadges();
            gsShow(gs.view);
          });
        };
        r.readAsText(f);
      };
      inp.click();
    };
  });
}

function gsRepoAdd() {
  gsPrompt('手动添加仓库', '仓库目录绝对路径：', '', async (val) => {
    if (!val) return;
    // 默认挂在第一个 workspace
    const wsr = await api('/api/gs/workspace/list');
    const ws = (wsr.workspaces || [])[0];
    if (!ws) { toast('请先在工作区中添加一个目录', true); return; }
    const r = await apiPost('/api/gs/repo/add', { path: val, workspaceId: ws.id });
    if (r.error) { toast('添加失败：' + r.error, true); return; }
    gsShow('repos');
  });
}

function gsRunHistoryHtml(history) {
  const labels={started:'已启动终端',missed:'已错过',skipped_busy:'运行中，跳过',skipped_disabled:'已停用',partial:'部分成功',error:'失败',failed:'失败',ok:'成功',success:'成功'};
  return '<section class="gs-run-history"><h3>最近 10 次运行记录</h3>' + (history.length?'<table class="gs-table"><thead><tr><th>运行时间</th><th>任务</th><th>结果</th><th>详情</th></tr></thead><tbody>'+history.slice(0,10).map(h=>'<tr><td class="mono small">'+escapeHtml(new Date(h.start).toLocaleString())+'</td><td>'+escapeHtml(h.name||'—')+'</td><td>'+escapeHtml(labels[h.status]||h.status)+'</td><td><details><summary>查看</summary><pre class="gs-result-message">'+escapeHtml(h.message||'—')+'</pre></details></td></tr>').join('')+'</tbody></table>':'<p class="gs-sub">暂无运行记录。</p>')+'</section>';
}

// ============== 任务（P5：编辑器 + 倒计时）==============
async function gsRenderTasks(area) {
  const r = await api('/api/gs/tasks');
  if(!gsActive()||gs.view!=='tasks')return;
  const tasks = r.tasks || [];
  area.innerHTML = `
    <div class="gs-wrap">
      <div class="gs-head">
        <h2 class="gs-h2">自动同步 <span class="gs-sub">${tasks.length} 个</span> <span class="gs-tag ${r.paused?'dim':'ok'}">${r.paused?'已暂停':'运行中'}</span></h2>
        <div class="gs-head-actions">
          <button class="gs-btn ${r.paused?'primary':''}" id="gs-scheduler-toggle" aria-pressed="${!r.paused}">${r.paused?'启动全部':'暂停全部'}</button><button class="gs-btn" id="gs-task-refresh">刷新</button><button class="gs-btn primary" id="gs-task-add">+ 新建</button>
        </div>
      </div>
      <p class="gs-scheduler-note">${r.paused?'自动触发已暂停，仍可手动运行。':'软件运行时按计划自动执行。'} 暂停不会中止已经开始的任务。</p>
      ${tasks.length === 0
        ? '<div class="empty-state"><div class="big">◷</div>暂无任务。点「+ 新建」配置执行时间和仓库，自动同步代码。</div>'
        : `<table class="gs-table">
            <thead><tr><th></th><th>名称</th><th>触发器</th><th>动作</th><th>下次（倒计时）</th><th>上次</th><th>操作</th></tr></thead>
            <tbody>${tasks.map((t) => {
              const trig = scheduleEditor.label(scheduleEditor.fromTrigger(t.trigger));
              const act = t.action.type === 'git_sync' ? `git_sync (${t.action.repoIds || 'all'})`
                : t.action.type === 'shell_command' ? `shell: ${(t.action.cmd || '').slice(0, 30)}`
                : t.action.type || '—';
              return `<tr data-tid="${escapeHtml(t.id)}">
                <td><span class="gs-tag ${t.enabled?'ok':'dim'}">${t.enabled?'已启用':'已暂停'}</span></td>
                <td>${escapeHtml(t.name)}</td>
                <td class="mono small">${escapeHtml(trig)}</td>
                <td class="mono small">${escapeHtml(act)}</td>
                <td class="mono small next-run-cell" data-ts="${t.nextRun || 0}">${t.enabled && t.nextRun ? new Date(t.nextRun).toLocaleString() : '—'}</td>
                <td class="mono small">${escapeHtml(t.lastStatus || '—')}</td>
                <td>
                  <button class="gs-btn ${t.enabled?'':'primary'}" data-act="toggle">${t.enabled?'暂停':'启动'}</button>
                  <button class="gs-btn" data-act="run">运行</button>
                  <button class="gs-btn" data-act="edit">编辑</button>
                  <button class="gs-btn danger" data-act="del">删除</button>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>`}
      ${gsRunHistoryHtml(tasks.flatMap(t => (t.history || []).map(h => ({...h, name:t.name}))).sort((a,b) => b.start.localeCompare(a.start)).slice(0,10))}
    </div>
  `;
  $('#gs-task-refresh').onclick = () => gsShow('tasks');
  $('#gs-scheduler-toggle').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{const result=await apiPost('/api/gs/scheduler/toggle',{paused:!r.paused});if(result.error)throw Error(result.error);toast(result.paused?'自动同步已暂停':'自动同步已启动');if(gsActive()&&gs.view==='tasks')await gsRenderTasks(area);}
    catch(error){toast(error.message,true);}finally{button.disabled=false;}
  };
  const $add = $('#gs-task-add');
  if ($add) $add.onclick = () => gsTaskEdit(null);
  area.querySelectorAll('tr[data-tid]').forEach((tr) => {
    const id = tr.dataset.tid;
    tr.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.act === 'toggle') {
          b.disabled=true;
          try{const result=await apiPost('/api/gs/task/toggle',{id,enabled:!tasks.find(t=>t.id===id).enabled});if(result.error)throw Error(result.error);if(gsActive()&&gs.view==='tasks')await gsRenderTasks(area);}
          catch(error){toast(error.message,true);}finally{b.disabled=false;}
        } else if (b.dataset.act === 'run') {
          toast('运行中…');
          const r = await apiPost('/api/gs/task/run', { id });
          if (r.error) { toast(r.error, true); return; }
          toast('完成: ' + (r.result.message || r.result.status));
          gsShow('tasks');
        } else if (b.dataset.act === 'edit') {
          gsTaskEdit(id);
        } else if (b.dataset.act === 'del') {
          gsConfirm('删除此任务？', async (ok) => {
            if (!ok) return;
            await apiPost('/api/gs/task/delete', { id });
            gsShow('tasks');
          });
        }
      };
    });
  });
  // 启动倒计时刷新：每 1s 更新一次
  startCountdownTicker();
}

let _countdownTimer = null;
function startCountdownTicker() {
  if (_countdownTimer) return;
  _countdownTimer = setInterval(() => {
    document.querySelectorAll('.next-run-cell').forEach((cell) => {
      const ts = +cell.dataset.ts;
      if (!ts) return;
      const delta = ts - Date.now();
      if (delta < 0) { cell.textContent = '已过期 ' + Math.floor(-delta / 1000) + 's'; cell.style.color = 'var(--accent)'; }
      else if (delta < 60000) { cell.textContent = Math.floor(delta / 1000) + 's 后'; cell.style.color = ''; }
      else if (delta < 3600000) { cell.textContent = Math.floor(delta / 60000) + ' 分后'; cell.style.color = ''; }
      else { cell.textContent = new Date(ts).toLocaleString(); cell.style.color = ''; }
    });
  }, 1000);
}

function gsTaskEdit(id) {
  api('/api/gs/tasks').then((r) => {
    const t = id ? (r.tasks || []).find((x) => x.id === id) : null;
    const isInterval = t ? t.trigger.type === 'interval' : true;
    const isCron = t ? t.trigger.type === 'cron' : false;
    const trigSec = t && t.trigger.type === 'interval' ? t.trigger.sec : 300;
    const trigExpr = t && t.trigger.type === 'cron' ? t.trigger.expr : '0 3 * * *';
    const actionType = t ? t.action.type : 'git_sync';
    const actionRepoIds = t && t.action.type === 'git_sync' ? (t.action.repoIds || 'all') : 'all';
    const actionCmd = t && t.action.type === 'shell_command' ? (t.action.cmd || '') : '';
    const actionTimeout = t && t.action.type === 'shell_command' ? (t.action.timeoutSec || 600) : 600;
    const enabled = t ? !!t.enabled : true;
    const name = t ? t.name : '';

    const repoOpts = (() => {
      // 拉一下仓库列表：'all' / 列表
      api('/api/gs/repo/list').then((rr) => {
        const sel = document.getElementById('gs-ta-repo');
        if (!sel) return;
        const repos = rr.repos || [];
        const cur = actionRepoIds;
        sel.innerHTML = `<option value="all" ${cur === 'all' ? 'selected' : ''}>全部已启用仓库</option>`
          + repos.map((r) => `<option value="${escapeHtml(r.id)}" ${(cur === r.id || (Array.isArray(cur) && cur.includes(r.id))) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
      });
    })();

    gsModal(id ? '编辑任务' : '新建任务', `
      <div class="gs-task-form">
        <label>名称<input class="input-field" id="gs-ta-name" value="${escapeHtml(name)}" placeholder="如：每 5 分钟拉一次"/></label>
        <div class="gs-task-row">
          <div id="gs-ta-schedule-editor" style="width:100%"></div>
        </div>
        <div class="gs-task-row">
          <label>动作
            <select class="input-field" id="gs-ta-atype">
              <option value="git_sync" ${actionType === 'git_sync' ? 'selected' : ''}>自动切换并更新本地代码</option>
              <option value="shell_command" ${actionType === 'shell_command' ? 'selected' : ''}>shell_command</option>
            </select>
          </label>
          <label id="gs-ta-action-wrap">仓库
            <select class="input-field" id="gs-ta-repo" multiple size="5"></select>
          </label>
        </div>
        <div class="gs-task-shell" style="display:${actionType === 'shell_command' ? 'flex' : 'none'}">
          <label style="flex:1">命令
            <input class="input-field mono" id="gs-ta-cmd" value="${escapeHtml(actionCmd)}" placeholder="echo hello"/>
          </label>
          <label style="width:110px">超时(s)
            <input class="input-field mono" id="gs-ta-timeout" value="${actionTimeout}" type="number" min="1"/>
          </label>
        </div>
        <label class="gs-task-toggle"><input type="checkbox" id="gs-ta-enabled" ${enabled ? 'checked' : ''}/> 启用</label>

      </div>
      <div class="input-actions">
        <button class="gs-btn" id="gs-ta-cancel">取消</button>
        <button class="gs-btn primary" id="gs-ta-save">保存</button>
      </div>
    `, (root) => {
      const scheduleCtrl = scheduleEditor.mount(root.querySelector('#gs-ta-schedule-editor'), scheduleEditor.fromTrigger(t?.trigger), () => {}, 'git');
      const switchAction = () => {
        const atype = $('#gs-ta-atype', root).value;
        root.querySelector('.gs-task-shell').style.display = atype === 'shell_command' ? 'flex' : 'none';
        const wrap = $('#gs-ta-action-wrap', root);
        if (atype === 'git_sync') {
          wrap.firstChild.textContent = '仓库（按 Ctrl 可多选；选择全部则忽略单选项）';
        } else {
          wrap.firstChild.textContent = '（仅自动同步使用）';
        }
      };
      $('#gs-ta-atype', root).onchange = switchAction;


      $('#gs-ta-cancel', root).onclick = () => document.getElementById('gs-modal').remove();
      $('#gs-ta-save', root).onclick = async () => {
        const tname = $('#gs-ta-name', root).value.trim();
        const atype = $('#gs-ta-atype', root).value;
        const repoIds = Array.from($('#gs-ta-repo', root).selectedOptions, o => o.value);
        const cmd = $('#gs-ta-cmd', root).value;
        const timeout = parseInt($('#gs-ta-timeout', root).value, 10) || 600;
        const en = $('#gs-ta-enabled', root).checked;
        if (!tname) { toast('名称必填', true); return; }
        if (atype === 'git_sync' && !repoIds.length) { toast('请选择仓库', true); return; }
        const trigger = scheduleEditor.toTrigger(scheduleCtrl.get());
        let action;
        if (atype === 'git_sync') action = { type: 'git_sync', repoIds: repoIds.includes('all') ? 'all' : repoIds, doCheckout: true };
        else action = { type: 'shell_command', cmd, timeoutSec: timeout, shell: true };
        const body = { name: tname, trigger, action, enabled: en };
        if (id) body.id = id;
        const r2 = await apiPost('/api/gs/task/save', body);
        if (r2.error) { toast(r2.error, true); return; }
        toast('已保存');
        document.getElementById('gs-modal').remove();
        gsShow('tasks');
      };
    });
  });
}

// ============== 日志 ==============
async function gsRenderLogs(area) {
  const r = await api('/api/gs/logs?limit=200');
  const logs = r.logs || [];
  // 关联任务/仓库名（一次性拉）
  const [tr, rr] = await Promise.all([api('/api/gs/tasks'), api('/api/gs/repo/list')]);
  const tMap = new Map((tr.tasks || []).map((t) => [t.id, t.name]));
  const rMap = new Map((rr.repos || []).map((x) => [x.id, x.name]));
  area.innerHTML = `
    <div class="gs-wrap">
      <div class="gs-head">
        <h2 class="gs-h2">日志 <span class="gs-sub">最近 ${logs.length} 条</span></h2>
        <div class="gs-head-actions">
          <button class="gs-btn" id="gs-log-refresh">刷新</button>
        </div>
      </div>
      ${logs.length === 0
        ? '<div class="empty-state">还没有日志。跑一次手动同步或等定时任务触发一次。</div>'
        : `<table class="gs-table mono small">
            <thead><tr><th>时间</th><th>任务</th><th>仓库</th><th>状态</th><th>消息</th><th></th></tr></thead>
            <tbody>${logs.map((l) => {
              const idx = logs.indexOf(l);
              const tname = tMap.get(l.taskId) || (l.taskId || '').slice(0, 12);
              const rname = l.repoId ? (rMap.get(l.repoId) || l.repoId.slice(0, 12)) : '—';
              return `<tr data-logidx="${idx}">
                <td>${escapeHtml((l.start || '').slice(11, 19))}</td>
                <td>${escapeHtml(tname)}</td>
                <td>${escapeHtml(rname)}</td>
                <td><span class="gs-tag ${l.status === 'ok' || l.status === 'success' ? 'ok' : (l.status === 'error' || l.status === 'failed' ? 'alert' : 'dim')}">${escapeHtml(l.status || '?')}</span></td>
                <td>${escapeHtml((l.message || '').slice(0, 80))}${(l.message || '').length > 80 ? '…' : ''}</td>
                <td><button class="gs-btn small" data-act="detail">详情</button></td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>`}
    </div>
  `;
  const $r = $('#gs-log-refresh');
  if ($r) $r.onclick = () => gsShow('logs');
  area.querySelectorAll('button[data-act="detail"]').forEach((b) => {
    const tr = b.closest('tr');
    const idx = +tr.dataset.logidx;
    b.onclick = () => gsLogDetail(logs[idx], tMap, rMap);
  });
}

function gsLogDetail(l, tMap, rMap) {
  const tname = tMap.get(l.taskId) || l.taskId || '—';
  const rname = l.repoId ? (rMap.get(l.repoId) || l.repoId) : '—';
  gsModal('日志详情', `
    <table class="gs-table">
      <tr><th>任务</th><td>${escapeHtml(tname)}</td></tr>
      <tr><th>仓库</th><td>${escapeHtml(rname)}</td></tr>
      <tr><th>状态</th><td>${escapeHtml(l.status || '')}</td></tr>
      <tr><th>开始</th><td>${escapeHtml(l.start || '')}</td></tr>
      <tr><th>结束</th><td>${escapeHtml(l.end || '')}</td></tr>
      <tr><th>消息</th><td><pre class="mono small" style="white-space:pre-wrap;margin:0">${escapeHtml(l.message || '')}</pre></td></tr>
    </table>
    ${l.logText ? `<h4 style="margin-top:14px">日志原文</h4><pre class="mono small" style="background:var(--bg-3);padding:10px;border-radius:6px;max-height:240px;overflow:auto;white-space:pre-wrap">${escapeHtml(l.logText)}</pre>` : ''}
  `);
}

// ============== 侧栏徽标 ==============
async function gsRefreshBadges() {
  try {
    const ov = await api('/api/gs/overview');
    const rb = $('#gs-repos-badge');
    const tb = $('#gs-tasks-badge');
    if (rb) {
      const n = ov.repos.dirty + ov.repos.lost;
      if (n > 0) { rb.textContent = n; rb.classList.remove('hidden'); } else rb.classList.add('hidden');
    }
    if (tb) {
      const n = ov.tasks.enabled;
      if (n > 0) { tb.textContent = n; tb.classList.remove('hidden'); } else tb.classList.add('hidden');
    }
  } catch (_) { /* 静默 */ }
}

// ============== 启动绑定 ==============
function gsBind() {
  document.querySelectorAll('#gs-nav-list li').forEach((li) => {
    li.onclick = () => gsShow(li.dataset.gsView);
  });
  setInterval(gsRefreshBadges, 8000);
  gsRefreshBadges();
  // 顶栏「设置」入口（无则忽略）
  const settingsBtn = document.getElementById('gs-settings');
  if (settingsBtn) settingsBtn.onclick = () => gsShowSettings();
}

setInterval(async () => { if(gsActive()&&gs.view==='tasks'&&!document.getElementById('gs-modal')&&!gs.tasksRefreshing){gs.tasksRefreshing=true;try{await gsRenderTasks($('#file-area'));}catch{}finally{gs.tasksRefreshing=false;}} },15000);
