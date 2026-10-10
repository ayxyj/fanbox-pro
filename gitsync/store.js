#!/usr/bin/env node
/**
 * gitsync-next — 数据层
 *
 * 存储布局（CONFIG_DIR/gitsync/，默认 ~/.gitsync-next/gitsync/，可用 GITSYNC_HOME 覆盖）：
 *   workspaces.json   多目录 workspace 配置（多目录配置的根）
 *   repos.json        仓库清单（含关注分支、状态缓存）
 *   tasks.json        调度任务
 *   settings.json     key-value 设置
 *   run-logs.jsonl    运行日志（追加写，按行读）
 *
 * 写入策略照抄 fanbox server.js updateConfig 的三段式原子写：
 * temp 文件 + fsync + rename，读失败回退默认值（对齐 cronLoad 容错）。
 * repos 在批次同步中会被高频回写 → persist() 防抖 200ms 合并，flush() 强制落盘。
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Windows 上路径大小写不敏感：比较 key 一律 normcase（对应 Python os.path.normcase）
function normKey(p) {
  const n = path.normalize(String(p || ''));
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return prefix + crypto.randomBytes(4).toString('hex'); }

// 原子写 JSON：temp + fsync + rename（照抄 fanbox updateConfig 三段式）
async function atomicWriteJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(JSON.stringify(data, null, 2), 'utf8');
    await fh.sync(); // 先落盘再改名，断电不留半个文件
  } finally { await fh.close(); }
  await fsp.rename(tmp, file);
}

// 读 JSON：不存在/损坏回退默认值（对齐 fanbox cronLoad 容错）
async function loadJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { return fallback; }
}

const DEFAULT_SETTINGS = { retentionDays: 30, maxLogEntries: 2000, autoSyncPaused: false };
const PERSIST_DEBOUNCE_MS = 200;

class Store {
  /**
   * @param {string} [dir] 数据目录。默认 ~/.gitsync-next/gitsync（可用 GITSYNC_HOME 覆盖整个根）。
   */
  constructor(dir) {
    const root = dir || process.env.GITSYNC_HOME
      || path.join(os.homedir(), '.gitsync-next', 'gitsync');
    this.dir = root;
    this.files = {
      workspaces: path.join(root, 'workspaces.json'),
      repos: path.join(root, 'repos.json'),
      tasks: path.join(root, 'tasks.json'),
      settings: path.join(root, 'settings.json'),
    };
    this.logFile = path.join(root, 'run-logs.jsonl');
    this.workspaces = [];
    this.repos = [];
    this.tasks = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this._timers = new Map(); // kind -> Timeout（防抖）
    this._flushing = null;    // 串行化 flush，避免并发 rename 冲突
  }

  async load() {
    const ws = await loadJson(this.files.workspaces, []);
    const rp = await loadJson(this.files.repos, []);
    const tk = await loadJson(this.files.tasks, []);
    const st = await loadJson(this.files.settings, {});
    if (!Array.isArray(ws) || !Array.isArray(rp) || !Array.isArray(tk)) {
      throw new Error('数据文件损坏（顶层不是数组），请检查 ' + this.dir);
    }
    this.workspaces = ws;
    this.repos = rp.map(r => ({ ...r, branches: (r.branches || []).slice(0, 1) }));
    this.tasks = tk;
    this.settings = { ...DEFAULT_SETTINGS, ...(st && typeof st === 'object' ? st : {}) };
  }

  // ---------- 持久化 ----------
  _schedule(kind) {
    if (this._timers.has(kind)) return;
    this._timers.set(kind, setTimeout(() => { this._timers.delete(kind); this._persistNow(kind); }, PERSIST_DEBOUNCE_MS));
  }
  _persistNow(kind) {
    const p = (this._flushing || Promise.resolve()).then(async () => {
      const data = kind === 'workspaces' ? this.workspaces
        : kind === 'repos' ? this.repos
        : kind === 'tasks' ? this.tasks : this.settings;
      await atomicWriteJson(this.files[kind], data);
    }).catch((e) => { console.error('[gitsync] persist %s 失败:', kind, e && e.message); });
    this._flushing = p;
    return p;
  }
  persist(kind) { this._schedule(kind); }
  async flush() {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
    await Promise.all(['workspaces', 'repos', 'tasks', 'settings'].map((k) => this._persistNow(k)));
  }

  // ---------- 工作区（多目录配置）----------
  findWorkspaceByPath(p) {
    const key = normKey(p);
    return this.workspaces.find((w) => normKey(w.path) === key) || null;
  }
  getWorkspace(id) { return this.workspaces.find((w) => w.id === id) || null; }
  addWorkspace({ name, path: wsPath, scanEnabled = true, excludes = [] }) {
    wsPath = path.resolve(wsPath);
    if (this.findWorkspaceByPath(wsPath)) throw new Error('workspace 已存在: ' + wsPath);
    const ws = {
      id: newId('ws'), name: name || path.basename(wsPath), path: wsPath, scanEnabled: !!scanEnabled,
      excludes: Array.isArray(excludes) ? excludes.map(String) : [],
      createTime: nowIso(), updateTime: nowIso(),
    };
    this.workspaces.push(ws);
    this.persist('workspaces');
    return ws;
  }
  updateWorkspace(id, patch) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) throw new Error('workspace 不存在: ' + id);
    if (patch.path !== undefined) {
      const np = path.resolve(patch.path);
      if (normKey(np) !== normKey(ws.path)) {
        const dup = this.findWorkspaceByPath(np);
        if (dup && dup.id !== id) throw new Error('workspace 已存在: ' + np);
      }
      ws.path = np;
    }
    if (patch.name !== undefined) ws.name = String(patch.name);
    if (patch.scanEnabled !== undefined) ws.scanEnabled = !!patch.scanEnabled;
    if (patch.excludes !== undefined) ws.excludes = Array.isArray(patch.excludes) ? patch.excludes.map(String) : [];
    ws.updateTime = nowIso();
    this.persist('workspaces');
    return ws;
  }
  deleteWorkspace(id) {
    const before = this.workspaces.length;
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    if (this.workspaces.length === before) throw new Error('workspace 不存在: ' + id);
    // 连带删除其下仓库（FK CASCADE 语义）
    this.repos = this.repos.filter((r) => r.workspaceId !== id);
    this.persist('workspaces');
    this.persist('repos');
  }

  // ---------- 仓库 ----------
  findRepoByPath(p) {
    const key = normKey(p);
    return this.repos.find((r) => normKey(r.path) === key) || null;
  }
  addRepo({ path: repoPath, workspaceId, name, branches = [], enabled = true }) {
    repoPath = path.resolve(repoPath);
    if (this.findRepoByPath(repoPath)) throw new Error('仓库已存在: ' + repoPath);
    const repo = {
      id: newId('r'), workspaceId: workspaceId || null,
      path: repoPath, name: name || path.basename(repoPath),
      enabled: enabled !== false,
      currentBranch: '', dirty: false, ahead: 0, behind: 0,
      stashCount: 0, lastSync: null, lastScan: null,
      availableBranches: [], branchesUpdatedAt: null, lastRefreshAt: null,
      branches: Array.isArray(branches) ? branches.map(String).slice(0, 1) : [], // 关注分支，空=master
      lost: false, reserved: {},
      createTime: nowIso(), updateTime: nowIso(),
    };
    this.repos.push(repo);
    this.persist('repos');
    return repo;
  }
  getRepo(id) { return this.repos.find((r) => r.id === id) || null; }
  updateRepo(id, patch) {
    const repo = this.getRepo(id);
    if (!repo) throw new Error('仓库不存在: ' + id);
    Object.assign(repo, patch);
    repo.updateTime = nowIso();
    this.persist('repos');
    return repo;
  }
  deleteRepos(ids) {
    const set = new Set(ids);
    const before = this.repos.length;
    this.repos = this.repos.filter((r) => !set.has(r.id));
    this.persist('repos');
    return before - this.repos.length;
  }
  setRepoBranches(id, branches) {
    const repo = this.getRepo(id);
    if (!repo) throw new Error('仓库不存在: ' + id);
    repo.branches = Array.isArray(branches) ? branches.map(String).filter(Boolean) : [];
    repo.updateTime = nowIso();
    this.persist('repos');
    return repo;
  }

  // ---------- 任务 ----------
  getTask(id) { return this.tasks.find((t) => t.id === id) || null; }
  saveTask(task) {
    if (!task.id) {
      task.id = newId('t');
      task.createTime = nowIso();
      this.tasks.push(task);
    } else {
      const i = this.tasks.findIndex((t) => t.id === task.id);
      if (i < 0) throw new Error('任务不存在: ' + task.id);
      task.createTime = this.tasks[i].createTime;
      this.tasks[i] = task;
    }
    task.updateTime = nowIso();
    this.persist('tasks');
    return task;
  }
  deleteTask(id) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) throw new Error('任务不存在: ' + id);
    this.persist('tasks');
  }

  // ---------- 设置 ----------
  getSetting(key, dflt) {
    return key in this.settings ? this.settings[key] : dflt;
  }
  setSetting(key, value) {
    this.settings[key] = value;
    this.persist('settings');
  }

  // ---------- 运行日志（JSONL 追加）----------
  async appendLog(entry) {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.appendFile(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
  }
  async readLogs({ taskId, repoId, limit = 50, page = 1 } = {}) {
    let lines;
    try { lines = (await fsp.readFile(this.logFile, 'utf8')).split(/\r?\n/); }
    catch { return []; }
    const all = [];
    for (let i = lines.length - 1; i >= 0; i--) { // 倒序：最新在前
      const l = lines[i].trim();
      if (!l) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (taskId !== undefined && taskId !== null && e.taskId !== taskId) continue;
      if (repoId !== undefined && repoId !== null && e.repoId !== repoId) continue;
      all.push(e);
    }
    const start = (page - 1) * limit;
    return all.slice(start, start + limit);
  }
  // 按 retentionDays / maxLogEntries 裁剪（翻译 scheduler.py _cleanup_old_logs）
  async cleanupLogs() {
    let lines;
    try { lines = (await fsp.readFile(this.logFile, 'utf8')).split(/\r?\n/).filter((l) => l.trim()); }
    catch { return; }
    const cutoff = Date.now() - Number(this.getSetting('retentionDays', 30)) * 86400 * 1000;
    const kept = [];
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      const t = e.start ? new Date(e.start).getTime() : NaN;
      if (isFinite(t) && t < cutoff) continue;
      kept.push(l);
    }
    const max = Number(this.getSetting('maxLogEntries', 2000));
    const finalLines = kept.length > max ? kept.slice(kept.length - max) : kept;
    if (finalLines.length !== lines.length) {
      // JSONL 不是 JSON，走专用原子文本写
      await this._atomicWriteText(this.logFile, finalLines.join('\n') + '\n');
    }
  }
  async _atomicWriteText(file, text) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    const fh = await fsp.open(tmp, 'w');
    try { await fh.writeFile(text, 'utf8'); await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  }
}

module.exports = { Store, normKey, newId, nowIso, atomicWriteJson, loadJson, DEFAULT_SETTINGS };
