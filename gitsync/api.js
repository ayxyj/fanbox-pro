#!/usr/bin/env node
'use strict';
/**
 * GitSync Next — HTTP API 路由层
 * 翻译自 gitsync(Python) 的 HTTP 入口 + PySide6 交互接口。
 * 由 server.js 挂到 /api/gs/* 前缀；统一信封 { code, obj }。
 */

const { basename, join } = require('path');
const fs = require('fs');
const git = require('./git');
const scanner = require('./scanner');
const { normKey, nowIso, atomicWriteJson } = require('./store');
const { runAction } = require('./sync-engine');
const { gsNextRun, countdownText, nextRunInfo } = require('./tasks');

let _store = null, _engine = null, _scheduler = null;
function init(store, engine, scheduler = null) { _store = store; _engine = engine; _scheduler = scheduler; }
const ok = (obj) => ({ code: 200, obj: obj || {} });
const err = (code, message, extra) => ({ code, obj: Object.assign({ error: message }, extra || {}) });
const str = (v, def = '') => (v === undefined || v === null ? def : String(v));
const bool = (v, def) => {
  if (v === undefined || v === null) return def;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return Boolean(v);
};
const int = (v, def) => { const n = parseInt(v, 10); return isFinite(n) ? n : def; };
function repoMutation(body, fn) {
  const repo = _store.getRepo(str(body.id));
  if (!repo) return err(404, 'repo 不存在');
  return _engine._chain(repo.path, () => fn(body));
}

const repoOperations = new Map();
async function dirtyMutation(body, fn) {
  const id = str(body.id);
  if (!_store.getRepo(id)) return err(404, 'repo 不存在');
  if (repoOperations.get(id)?.running) return err(409, '该仓库正在处理改动，请等待完成');
  const operation = { running: true, phase: '等待当前仓库操作完成', startedAt: Date.now() };
  repoOperations.set(id, operation);
  // Completed records are only diagnostics; keep the history bounded.
  for (const [key, value] of repoOperations) {
    if (repoOperations.size <= 100) break;
    if (!value.running) repoOperations.delete(key);
  }
  try {
    return await repoMutation(body, async () => {
      const phase = text => { operation.phase = text; };
      phase('检查仓库');
      let result;
      try { result = await fn(body, phase); }
      catch (e) { result = err(500, e.message); }
      phase('刷新当前仓库状态');
      const refreshed = await repoRefresh(body);
      // Even a failed stash apply may leave conflicts; always refresh after the command.
      if (refreshed.code === 200) result.obj.repo = refreshed.obj.repo;
      else result.obj.refreshError = refreshed.obj.error;
      operation.error = result.code !== 200 ? result.obj.error : result.obj.refreshError;
      operation.phase = operation.error ? '处理结束，请查看错误' : '已完成，仓库状态已刷新';
      return result;
    });
  } catch (e) {
    operation.error = e.message; operation.phase = '操作失败';
    return err(500, e.message);
  } finally { operation.running = false; operation.finishedAt = Date.now(); }
}

function overview() {
  const repos = _store.repos, tasks = _store.tasks;
  return ok({
    repos: { total: repos.length, enabled: repos.filter((r) => r.enabled).length,
      dirty: repos.filter((r) => r.dirty).length, lost: repos.filter((r) => r.lost).length },
    tasks: { total: tasks.length, enabled: tasks.filter((t) => t.enabled).length },
    nextRun: nextRunInfo(_store),
  });
}

function workspaceList() { return ok({ workspaces: _store.workspaces }); }
function workspaceSave(body) {
  const w = body || {};
  const id = str(w.id, null), path = str(w.path).trim();
  if (!path) return err(400, 'path 必填');
  const name = str(w.name).trim() || basename(path);
  const scanEnabled = bool(w.scanEnabled, true);
  const excludes = Array.isArray(w.excludes) ? w.excludes : [];
  if (id && _store.getWorkspace(id)) {
    try {
      const upd = _store.updateWorkspace(id, { name, path, scanEnabled, excludes });
      return ok({ workspace: upd });
    } catch (e) { return err(400, e.message); }
  }
  try { return ok({ workspace: _store.addWorkspace({ name, path, scanEnabled, excludes }) }); }
  catch (e) { return err(400, e.message); }
}
function workspaceDelete(body) {
  const id = str(body.id);
  if (!id) return err(400, 'id 必填');
  return _store.deleteWorkspace(id) ? ok({ deleted: true }) : err(404, 'workspace 不存在');
}
async function workspaceScan(body) {
  const id = str(body.id);
  const ws = _store.getWorkspace(id);
  if (!ws) return err(404, 'workspace 不存在');
  const found = await scanner.scanWorkspace(ws.path, ws.excludes || []);
  const existing = new Set(_store.repos.map((r) => normKey(r.path)));
  const added = [];
  for (const f of found) {
    const k = normKey(f);
    if (existing.has(k)) continue;
    existing.add(k);
    added.push(_store.addRepo({ path: f, workspaceId: id, name: basename(f) }));
  }
  let lostCount = 0;
  for (const r of _store.repos) {
    if (r.workspaceId !== id || r.lost) continue;
    try { if (!fs.existsSync(r.path)) { _store.updateRepo(r.id, { lost: true }); lostCount++; } }
    catch (_) { /* ignore */ }
  }
  return ok({ added: added.length, lost: lostCount, found: found.length });
}

const refreshPending = new Set(), refreshActive = new Set();
const remotePending = new Set(), remoteActive = new Set();
let remoteRefresh = null;
function queueRemoteBranches(id) {
  const repo = _store.getRepo(id);
  if (!repo || remoteActive.has(id) || (repo.remoteBranchesCheckedAt && Date.now() - Date.parse(repo.remoteBranchesCheckedAt) < 600000)) return;
  remotePending.add(id);
  if (remoteRefresh) return;
  remoteRefresh = new Promise(resolve => setTimeout(resolve, 0)).then(() => Promise.all(Array.from({length: 2}, async () => {
    while (remotePending.size) {
      const id = remotePending.values().next().value; remotePending.delete(id); remoteActive.add(id);
      const repo = _store.getRepo(id);
      try {
        if (!repo) continue;
        const remotes = await git.execGit(repo.path, ['remote']);
        let remoteBranches = [];
        if (remotes.split(/\r?\n/).includes('origin')) {
          const refs = await git.execGit(repo.path, ['ls-remote', '--heads', 'origin'], 30000);
          remoteBranches = refs.split(/\r?\n/).filter(Boolean).map(line => line.split(/\s+/)[1]?.replace(/^refs\/heads\//, '')).filter(Boolean);
        }
        if (_store.getRepo(id)) _store.updateRepo(id, {remoteBranches, remoteBranchesCheckedAt: nowIso(), remoteBranchesError: null});
      } catch(e) { if (_store.getRepo(id)) _store.updateRepo(id, {remoteBranchesCheckedAt: nowIso(), remoteBranchesError: e.message}); }
      finally { remoteActive.delete(id); }
    }
  }))).finally(() => {remoteRefresh = null;});
}
let backgroundRefresh = null;
function queueRepoRefresh() {
  for (const r of _store.repos) { queueRemoteBranches(r.id); if (!refreshActive.has(r.id) && (!r.lastRefreshAt || Date.now() - Date.parse(r.lastRefreshAt) > 60000)) refreshPending.add(r.id); }
  if (backgroundRefresh || !refreshPending.size) return;
  backgroundRefresh = new Promise(resolve => setTimeout(resolve, 0)).then(() => Promise.all(Array.from({length: 2}, async () => {
    while (refreshPending.size) {
      const id = refreshPending.values().next().value; refreshPending.delete(id);
      refreshActive.add(id);
      try { if (_store.getRepo(id)) await repoMutation({id}, repoRefresh).catch(() => null); } finally { refreshActive.delete(id); }
    }
  }))).finally(() => { backgroundRefresh = null; });
}
async function repoList(qp) {
  if (qp.get('refresh') === '1') {
    const queue = [..._store.repos];
    await Promise.all(Array.from({length: 2}, async () => {
      while (queue.length) { const id = queue.shift().id; await repoMutation({id}, repoRefresh); }
    }));
  } else if (qp.get('cached') !== '1') queueRepoRefresh();
  return ok({ repos: _store.repos, refreshing: !!backgroundRefresh });
}
function repoAdd(body) {
  const path = str(body.path).trim();
  const name = str(body.name).trim() || basename(path);
  const workspaceId = str(body.workspaceId, null);
  if (!path) return err(400, 'path 必填');
  if (!workspaceId) return err(400, 'workspaceId 必填');
  try { if (!fs.existsSync(join(path, '.git'))) return err(400, '所选目录不是 git 仓库'); }
  catch (_) { return err(400, '路径无法访问'); }
  try { return ok({ repo: _store.addRepo({ path, workspaceId, name }) }); }
  catch (e) { return err(400, e.message); }
}
function repoDelete(body) {
  const id = str(body.id);
  if (!id) return err(400, 'id 必填');
  return _store.deleteRepos([id]) ? ok({ deleted: true }) : err(404, 'repo 不存在');
}
function repoToggle(body) {
  const id = str(body.id), enabled = bool(body.enabled, null);
  if (!id) return err(400, 'id 必填');
  if (enabled === null) return err(400, 'enabled 必填');
  const r = _store.updateRepo(id, { enabled });
  return r ? ok({ repo: r }) : err(404, 'repo 不存在');
}
async function readBranches(root) {
  const out = await git.execGit(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/origin/']);
  return [...new Set(out.split(/\r?\n/).filter(Boolean).filter(ref => ref !== 'refs/remotes/origin/HEAD').map(ref => ref.replace(/^refs\/(heads|remotes\/origin)\//, '')))].sort();
}
async function repoBranches(qp) {
  const id = str(qp.get('id')), r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  try {
    if (!r.branchesUpdatedAt || qp.get('refresh') === '1') {
      const availableBranches = await readBranches(r.path);
      _store.updateRepo(id, {availableBranches, branchesUpdatedAt: nowIso()});
    }
    return ok({branches: r.availableBranches || [], current: r.currentBranch, updatedAt: r.branchesUpdatedAt});
  } catch (e) { return err(500, e.message); }
}
// 直接保存关注分支（不带 git 探测；UI 调整后写回用）
function repoBranchesSave(body) {
  const id = str(body.id);
  const branches = (Array.isArray(body.branches) ? body.branches : [body.branch || '']).map(s => String(s).trim()).filter(Boolean);
  if (branches.length > 1) return err(400, '每个仓库只允许一个关注分支');
  if (branches.some(b => b.startsWith('-') || !/^[^\s,~^:?*\[\]\\]+$/.test(b) || b.includes('..') || b.includes('@{'))) return err(400, '无效的分支名称');
  if (!id) return err(400, 'id 必填');
  const r = _store.updateRepo(id, { branches });
  return r ? ok({ repo: r }) : err(404, 'repo 不存在');
}
async function repoRefresh(body) {
  const id = str(body.id);
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');

  try {
    // All three commands validate the repository themselves; avoid another Git process
    // and overlap independent local reads. No network access is needed for this refresh.
    const [status, stashN, availableBranches] = await Promise.all([
      git.getStatus(r.path), git.stashCount(r.path), readBranches(r.path),
    ]);
    return ok({
      repo: _store.updateRepo(id, { currentBranch: status.branch || '', dirty: status.dirty,
        ahead: status.ahead, behind: status.behind, stashCount: stashN, lost: false, availableBranches, branchesUpdatedAt: nowIso(), lastRefreshAt: nowIso(), refreshError: null }),
      stashCount: stashN,
    });
  } catch (e) { _store.updateRepo(id, { lost: true, lastRefreshAt: nowIso(), refreshError: e.message }); return err(500, e.message); }
}
async function repoSync(body) {
  const id = str(body.id);
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  return ok({ result: await _engine.syncRepo(id, true, null, body.switchOnly === true) });
}
async function repoStashGet(qp) {
  const id = str(qp.get('id'));
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  try { return ok({ list: await git.stashList(await git.repoRoot(r.path)) }); }
  catch (e) { return err(500, e.message); }
}
async function repoStashPost(body, phase = () => {}) {
  const id = str(body.id), op = str(body.op), message = str(body.message, ''), index = int(body.index, -1);
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  try {
    const root = await git.repoRoot(r.path);
    phase(({push:'暂存已跟踪及未跟踪改动', apply:'应用 Stash', pop:'恢复 Stash', drop:'删除 Stash'})[op] || '处理 Stash');
    if (op === 'push') await git.stashPush(root, message);
    else if (op === 'apply') await git.stashApply(root, index);
    else if (op === 'pop') await git.stashPop(root, index);
    else if (op === 'drop') await git.stashDrop(root, index);
    else return err(400, 'op 必须为 push/apply/pop/drop');
    return ok({ ok: true });
  } catch (e) { return err(500, e.message); }
}
async function repoDiscard(body, phase = () => {}) {
  const id = str(body.id);
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  try { await git.discardAll(await git.repoRoot(r.path), phase); return ok({ ok: true }); }
  catch (e) { return err(500, e.message); }
}
async function repoCommit(body, phase = () => {}) {
  const id = str(body.id), message = str(body.message).trim();
  if (!message) return err(400, 'message 必填');
  const r = _store.getRepo(id);
  if (!r) return err(404, 'repo 不存在');
  try { await git.commitAll(await git.repoRoot(r.path), message, phase); return ok({ ok: true }); }
  catch (e) { return err(500, e.message); }
}

async function taskList() {
  const logs=await _store.readLogs({limit:Number(_store.getSetting('maxLogEntries',2000))});
  const paused=_store.getSetting('autoSyncPaused',false)===true;
  return ok({paused,tasks:_store.tasks.map(t=>({...t,nextRun:paused?null:t.nextRun,history:logs.filter(l=>l.taskId===t.id&&!l.repoId).slice(0,10)}))});
}
async function schedulerToggle(body) {
  if(typeof body?.paused !== 'boolean')return err(400,'paused 必须是布尔值');
  _store.setSetting('autoSyncPaused',body.paused);
  if(_scheduler)_scheduler.reload();
  await _store.flush();
  await atomicWriteJson(_store.files.settings,_store.settings);
  return ok({paused:body.paused});
}
function taskSave(body) {
  const t = body || {};
  const id = str(t.id, null), name = str(t.name).trim();
  if (!name) return err(400, 'name 必填');
  if (!t.trigger) return err(400, 'trigger 必填');
  if (!t.action) return err(400, 'action 必填');
  if (!['interval', 'cron', 'at'].includes(t.trigger.type) || !gsNextRun({ enabled: true, trigger: t.trigger })) return err(400, '无效的任务周期');
  if (t.action.type === 'git_sync') {
    const ids = t.action.repoIds;
    if (ids !== 'all' && ids != null && (!Array.isArray(ids) || !ids.length || ids.some(id => !_store.getRepo(id)))) return err(400, '请选择有效仓库');
    t.action.doCheckout = true;
  }
  const fields = { name, trigger: t.trigger, action: t.action, enabled: bool(t.enabled, true) };
  if (id && _store.getTask(id)) return ok({ task: _store.saveTask(Object.assign({ id }, fields)) });
  return ok({ task: _store.saveTask(fields) });
}
function taskDelete(body) {
  const id = str(body.id);
  if (!id) return err(400, 'id 必填');
  return _store.deleteTask(id) ? ok({ deleted: true }) : err(404, 'task 不存在');
}
function taskToggle(body) {
  const id = str(body.id), enabled = bool(body.enabled, null);
  if (!id) return err(400, 'id 必填');
  if (enabled === null) return err(400, 'enabled 必填');
  const t = _store.getTask(id);
  if (!t) return err(404, 'task 不存在');
  if(enabled && t.trigger?.type==='at'&&!gsNextRun({...t,enabled:true}))return err(400,'时间点已过去，请重新配置时间');
  t.enabled = enabled; t.nextRun = null;
  _store.persist('tasks');
  return ok({ task: t });
}
async function taskRun(body) {
  const id = str(body.id);
  if (!id) return err(400, 'id 必填');
  const t = _store.getTask(id);
  if (!t) return err(404, 'task 不存在');
  if (_scheduler) return ok({ result: await _scheduler.triggerNow(id) });
  const result = await runAction(_store, _engine, t);
  t.lastStatus = result.status; t.lastRunAt = nowIso();
  _store.persist('tasks');
  return ok({ result });
}
// 预览下次运行：可以是已保存 task（qp.id）也可以是临时 task（body）
async function taskPreview(qp, body) {
  let t = null;
  const id = str(qp.get('id'));
  if (id) t = _store.getTask(id);
  else if (body && body.trigger) t = { enabled: body.enabled !== false, trigger: body.trigger };
  if (!t) return err(404, 'task 不存在');
  const ts = gsNextRun(t);
  if (!ts) return ok({ nextRun: null, text: '不调度' });
  const times=[];let from=Date.now();for(let i=0;i<10;i++){const next=gsNextRun(t,from);if(!next)break;times.push(next);from=next;}
  return ok({ nextRun: new Date(ts).toISOString(), text: countdownText(ts - Date.now()), times });
}

async function logsList(qp) {
  return ok({ logs: await _store.readLogs({
    taskId: str(qp.get('taskId'), null), repoId: str(qp.get('repoId'), null), limit: int(qp.get('limit'), 100),
  }) });
}

function settingsGet() { return ok({ settings: _store.settings }); }
function settingsSave(body) {
  const s = body || {};
  for (const k of Object.keys(s)) {
    if (k === 'id' || k === 'schemaVersion') continue;
    _store.setSetting(k, s[k]);
  }
  return ok({ settings: _store.settings });
}

async function exportConfig() {
  const dir = _store.dir;
  const read = async (name, def) => {
    try { return JSON.parse(await fs.promises.readFile(join(dir, name), 'utf8')); }
    catch (_) { return def; }
  };
  return ok({
    schemaVersion: 1, exportedAt: nowIso(),
    workspaces: await read('workspaces.json', []),
    repos: await read('repos.json', []),
    tasks: await read('tasks.json', []),
    settings: await read('settings.json', {}),
  });
}
async function importConfig(body) {
  const data = body || {};
  if (!data || typeof data !== 'object') return err(400, 'payload 必填');
  const merge = bool(data.merge, false);
  if (!merge) {
    if (Array.isArray(data.workspaces)) _store.workspaces.splice(0, _store.workspaces.length, ...data.workspaces);
    else _store.workspaces.length = 0;
    if (Array.isArray(data.repos)) _store.repos.splice(0, _store.repos.length, ...data.repos);
    else _store.repos.length = 0;
    if (Array.isArray(data.tasks)) _store.tasks.splice(0, _store.tasks.length, ...data.tasks);
    else _store.tasks.length = 0;
    if (data.settings && typeof data.settings === 'object') _store.settings = Object.assign({}, data.settings);
  } else {
    const wsById = new Map(_store.workspaces.map((w) => [w.id, w]));
    if (Array.isArray(data.workspaces)) for (const w of data.workspaces) if (!wsById.has(w.id)) _store.workspaces.push(w);
    const repoById = new Map(_store.repos.map((r) => [r.id, r]));
    const repoByPath = new Set(_store.repos.map((r) => normKey(r.path)));
    if (Array.isArray(data.repos)) for (const r of data.repos) {
      if (repoById.has(r.id)) continue;
      if (repoByPath.has(normKey(r.path))) continue;
      _store.repos.push(r); repoByPath.add(normKey(r.path));
    }
    const taskById = new Map(_store.tasks.map((t) => [t.id, t]));
    if (Array.isArray(data.tasks)) for (const t of data.tasks) if (!taskById.has(t.id)) _store.tasks.push(t);
  }
  _store.persist('workspaces'); _store.persist('repos'); _store.persist('tasks'); _store.persist('settings');
  return ok({ workspaces: _store.workspaces.length, repos: _store.repos.length, tasks: _store.tasks.length });
}

const ROUTES = {
  'overview': ['GET'], 'workspace/list': ['GET'], 'workspace/save': ['POST'],
  'workspace/delete': ['POST'], 'workspace/scan': ['POST'],
  'repo/list': ['GET'], 'repo/add': ['POST'], 'repo/delete': ['POST'],
  'repo/toggle': ['POST'], 'repo/branches': ['GET'], 'repo/branches/save': ['POST'],
  'repo/refresh': ['POST'], 'repo/sync': ['POST'], 'repo/stash': ['GET', 'POST'],
  'repo/progress': ['GET'],
  'repo/discard': ['POST'], 'repo/commit': ['POST'],
  'tasks': ['GET'], 'task/save': ['POST'], 'task/delete': ['POST'],
  'scheduler/toggle': ['POST'],
  'task/toggle': ['POST'], 'task/run': ['POST'], 'task/preview': ['GET', 'POST'],
  'logs': ['GET'], 'settings': ['GET'], 'settings/save': ['POST'],
  'export': ['GET'], 'import': ['POST'],
};

async function handleApi(method, p, qp, body) {
  if (!_store || !_engine) return err(500, 'gitsync 未初始化');
  const allow = ROUTES[p];
  if (!allow) return err(404, '未知路由: ' + p);
  if (!allow.includes(method)) return err(405, '方法不允许: ' + method + ' ' + p);
  switch (p) {
    case 'overview': return overview();
    case 'workspace/list': return workspaceList();
    case 'workspace/save': return workspaceSave(body);
    case 'workspace/delete': return workspaceDelete(body);
    case 'workspace/scan': return await workspaceScan(body);
    case 'repo/list': return await repoList(qp);
    case 'repo/add': return repoAdd(body);
    case 'repo/delete': return repoDelete(body);
    case 'repo/toggle': return repoToggle(body);
    case 'repo/branches': return await repoBranches(qp);
    case 'repo/branches/save': return repoBranchesSave(body);
    case 'repo/refresh': return await repoMutation(body, repoRefresh);
    case 'repo/sync': return await repoSync(body);
    case 'repo/progress': return ok({ operation: repoOperations.get(str(qp.get('id'))) || null });
    case 'repo/stash': return method === 'GET' ? await repoStashGet(qp) : await dirtyMutation(body, repoStashPost);
    case 'repo/discard': return await dirtyMutation(body, repoDiscard);
    case 'repo/commit': return await dirtyMutation(body, repoCommit);
    case 'tasks': return taskList();
    case 'scheduler/toggle': return schedulerToggle(body);
    case 'task/save': return taskSave(body);
    case 'task/delete': return taskDelete(body);
    case 'task/toggle': return taskToggle(body);
    case 'task/run': return await taskRun(body);
    case 'task/preview': return await taskPreview(qp, body);
    case 'logs': return logsList(qp);
    case 'settings': return settingsGet();
    case 'settings/save': return settingsSave(body);
    case 'export': return await exportConfig();
    case 'import': return await importConfig(body);
  }
  return err(404, '未实现: ' + p);
}

module.exports = { init, handleApi };
