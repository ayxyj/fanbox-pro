#!/usr/bin/env node
/**
 * gitsync-next — 同步引擎 + 动作执行
 *
 * 逐条翻译自 gitsync(Python) 的 core/sync_engine.py 与 core/action_runner.py：
 *   - 串行批次编排：单仓失败不中断
 *   - 脏仓库照常 fetch 但不切换（dirty_blocked，不自动 stash——以原版代码语义为准）
 *   - 关注分支默认 master；干净时切换并仅快进更新
 *   - 每次重新探测状态；失败不会覆盖上次成功同步时间
 *   - 手动与定时操作均写日志
 *   - 任务级互斥在 tasks.js（runningTasks），仓库级互斥在此（repoChains promise 链，
 *     Node 单线程下等价 Python 的 threading.Lock per-repo）
 */
'use strict';

const { spawn } = require('child_process');
const git = require('./git');
const { normKey, nowIso } = require('./store');

class SyncEngine {
  constructor(store) {
    this.store = store;
    this.repoChains = new Map(); // normKey(path) -> Promise（尾链，串行化同仓库的所有操作）
  }

  // 仓库级互斥：把 fn 挂到该仓库的 promise 链尾部
  _chain(repoPath, fn) {
    const key = normKey(repoPath);
    const prev = this.repoChains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn); // 上一环的失败不连累本环
    this.repoChains.set(key, run.catch(() => {}));
    return run;
  }

  // 保证 runBatch 写日志时有合法 task id（翻译 _ensure_task_id）：
  // 有效 id 原样返回；否则插一行 adhoc 任务（enabled=false，不被调度）
  _ensureTaskId(taskId) {
    if (taskId && this.store.getTask(taskId)) return taskId;
    const t = this.store.saveTask({
      name: 'adhoc-sync-' + nowIso().replace(/[:.]/g, '-'),
      trigger: { type: 'adhoc' },
      action: { type: 'git_sync' },
      enabled: false,
    });
    return t.id;
  }

  /**
   * 同步单个仓库（翻译 sync_repo）。
   * @param {string|null} taskId 有值=批处理上下文（落单仓 run_log）；null=UI 手动；同样写日志
   */
  async syncRepo(repoId, doCheckout = true, taskId = null, switchOnly = false) {
    const repo = this.store.getRepo(repoId);
    if (!repo) return { repoId, status: 'error', message: '仓库记录不存在' };
    return this._chain(repo.path, async () => {
      const start = nowIso();
      const target = (repo.branches && repo.branches[0]) || 'master';
      const result = { repoId, repoName: repo.name, targetBranch: target, branch: null, status: 'ok', newCommits: 0, ahead: 0, behind: 0, message: '' };
      let fetched = false, stage = '校验分支';
      try {
        await git.execGit(repo.path, ['check-ref-format', '--branch', target]);
        stage = '读取工作区状态';
        let status = await git.getStatus(repo.path);
        result.branch = status.branch;
        stage = '获取远端分支';
        const fr = await git.fetch(repo.path, [target]);
        fetched = true;
        result.newCommits = fr.newCommits;
        // Recheck after network operations: user may have edited while fetching.
        stage = '检查未提交改动';
        status = await git.getStatus(repo.path);
        if (status.dirty) {
          result.status = 'dirty_blocked';
          result.message = '已 fetch；存在未提交改动，请提交或 stash 后重新同步，未切换或更新本地代码';
        } else {
          stage = '切换分支';
          if (status.branch !== target || status.detached) await git.switchBranch(repo.path, target);
          result.branch = target;
          if (!switchOnly) {
            stage = '快进更新本地代码';
            const ab = await git.aheadBehind(repo.path, target);
            if (ab.ahead && ab.behind) {
              result.status = 'diverged';
              result.message = '本地与 origin/' + target + ' 已分叉，请手动处理；未合并或覆盖';
            } else {
              await git.execGit(repo.path, ['merge', '--ff-only', 'refs/remotes/origin/' + target]);
              result.message = ab.ahead ? '远端已获取；本地领先，保留本地提交' : '已切换到 ' + target + ' 并更新本地代码';
            }
          } else result.message = '已切换到关注分支 ' + target;
        }
      } catch (e) {
        result.status = 'error';
        result.message = e.message || String(e);
        result.errorDetails = String(e.stderr || e.message || e).slice(-65536);
        result.failedStage = stage;
      }
      const patch = { lastStatus: result.status, lastMessage: result.message, lastAttempt: nowIso() };
      if (fetched) patch.lastFetch = nowIso();
      if (result.status === 'ok' && !switchOnly) patch.lastSync = nowIso();
      try {
        const status = await git.getStatus(repo.path);
        const ab = await git.aheadBehind(repo.path, status.branch);
        Object.assign(patch, { currentBranch: status.branch, dirty: status.dirty, stashCount: await git.stashCount(repo.path), lost: false, ahead: ab.ahead, behind: ab.behind });
        result.branch = status.branch;
        result.ahead = ab.ahead; result.behind = ab.behind;
      } catch { patch.lost = true; }
      const end = nowIso();
      const detail = {...result, start, end, operation: switchOnly ? 'switch' : 'sync', repoPath: repo.path, durationSec: (Date.parse(end) - Date.parse(start)) / 1000};
      patch.lastResult = detail;
      this.store.updateRepo(repoId, patch);
      await this.store.appendLog({ taskId, repoId, repoName: repo.name, repoPath: repo.path, targetBranch: target, operation: detail.operation, start, end, status: result.status, message: result.message,
        logText: ['操作=' + detail.operation, 'target=' + target, '当前分支=' + result.branch, 'ahead=' + result.ahead + ' behind=' + result.behind, '耗时=' + detail.durationSec + 's', result.failedStage ? '失败阶段=' + result.failedStage : '', result.errorDetails || ''].filter(Boolean).join('\n') });
      await this.store.flush();
      return result;
    });
  }

  /**
   * 串行跑一批仓库（翻译 run_batch）。repoIds=null 表示全部 enabled 仓库。
   * 空批次 → status='no_op'（区分「批次成功」和「根本没事干」）。
   */
  async runBatch(taskId, repoIds, doCheckout) {
    const start = nowIso();
    let ids = repoIds;
    if (ids === null || ids === undefined) {
      ids = this.store.repos.filter((r) => r.enabled).map((r) => r.id);
    }
    if (!ids || ids.length === 0) {
      const tid = this._ensureTaskId(taskId);
      const end = nowIso();
      await this.store.appendLog({ taskId: tid, repoId: null, start, end, status: 'no_op', message: '无可同步仓库', logText: '' });
      return { taskId: tid, start, end, status: 'no_op', message: '无可同步仓库', results: [] };
    }
    const tid = this._ensureTaskId(taskId);
    const results = [];
    for (const rid of ids) results.push(await this.syncRepo(rid, doCheckout, tid));
    const end = nowIso();
    const ok = results.filter((r) => r.status === 'ok').length;
    const blocked = results.filter((r) => ['dirty_blocked', 'diverged'].includes(r.status)).length;
    const errors = results.filter((r) => r.status === 'error').length;
    let status;
    if (errors === 0 && blocked === 0) status = 'success';
    else if (ok + blocked + errors === 0) status = 'failed';
    else status = 'partial';
    const message = `${ok} 成功 / ${blocked} 待处理 / ${errors} 失败`;
    const logText = results.map((r) =>
      `${r.repoName}: [${r.status}] ${r.message} (新提交 ${r.newCommits}, ahead ${r.ahead}, behind ${r.behind})`).join('\n');
    // task 级汇总日志由 runAction 统一写，此处不写
    return { taskId: tid, start, end, status, message, results, logText };
  }
}

/**
 * 执行任务动作（翻译 ActionRunner.run）。
 * action.type: 'git_sync' | 'shell_command'
 * 返回 {status, message, exitCode, durationSec, repoResults}，并写 task 级汇总日志（repoId=null）。
 */
async function runAction(store, engine, task) {
  const t0 = Date.now();
  let result;
  const action = task.action || {};
  if (action.type === 'git_sync') {
    const repoIds = action.repoIds; // null | 'all' | [id...]
    let actual = null;
    if (repoIds === 'all' || repoIds === null || repoIds === undefined) actual = null;
    else if (Array.isArray(repoIds)) actual = repoIds;
    else if (typeof repoIds === 'string') actual = [repoIds];
    else result = { status: 'error', message: 'repoIds 字段类型非法: ' + JSON.stringify(repoIds) };
    if (!result) {
      const batch = await engine.runBatch(task.id, actual, true);
      result = { status: batch.status, message: batch.message, exitCode: null, repoResults: batch.results };
    }
  } else if (action.type === 'shell_command') {
    result = await runShell(action);
  } else {
    result = { status: 'error', message: '未实现的 action type: ' + action.type, exitCode: null, repoResults: [] };
  }
  result.durationSec = (Date.now() - t0) / 1000;
  // 任务级汇总行（repoId=null）
  try {
    await store.appendLog({
      taskId: task.id, repoId: null, start: new Date(t0).toISOString(), end: nowIso(),
      status: result.status, message: result.message, logText: '',
    });
  } catch (e) { console.error('[gitsync] task 级日志写入失败:', e && e.message); }
  return result;
}

// shell_command 执行（翻译 _run_shell_command）：shell:true、超时 kill、输出只留尾部 1MB
function runShell(cfg) {
  return new Promise((resolve) => {
    const cmd = cfg.cmd;
    if (!cmd || typeof cmd !== 'string') {
      resolve({ status: 'error', message: 'shell_command 必须 cmd 字符串', exitCode: null, repoResults: [] });
      return;
    }
    const timeout = Number(cfg.timeoutSec) > 0 ? Number(cfg.timeoutSec) : 600;
    const maxOut = Number(cfg.maxOutputBytes) > 0 ? Number(cfg.maxOutputBytes) : 1048576;
    const cwd = cfg.cwd || undefined;
    let child;
    try {
      child = spawn(cmd, {
        shell: cfg.shell !== false,
        cwd,
        windowsHide: true, // 对应 Python CREATE_NO_WINDOW
        env: process.env,
      });
    } catch (e) {
      resolve({ status: 'error', message: '启动子进程失败: ' + (e && e.message), exitCode: null, repoResults: [] });
      return;
    }
    let out = Buffer.alloc(0);
    let err = Buffer.alloc(0);
    const cap = (buf, chunk) => {
      const merged = Buffer.concat([buf, chunk]);
      return merged.length > maxOut ? merged.subarray(merged.length - maxOut) : merged; // 只留尾部
    };
    child.stdout.on('data', (c) => { out = cap(out, c); });
    child.stderr.on('data', (c) => { err = cap(err, c); });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      try { child.kill(); } catch { /* */ }
      // 给 kill 后的输出收尾 5s，然后按超时返回
      setTimeout(() => finish(null), 5000);
    }, timeout * 1000);
    function finish(code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === null) {
        resolve({
          status: 'timeout',
          message: `已超时 ${timeout}s;stdout ${out.length}B stderr ${err.length}B`,
          exitCode: null, repoResults: [],
        });
        return;
      }
      const s = out.toString('utf8');
      const e = err.toString('utf8');
      if (code === 0) {
        resolve({ status: 'ok', exitCode: 0, message: 'exit 0; stdout 末尾: ' + JSON.stringify(s.slice(-200)), repoResults: [] });
      } else {
        resolve({
          status: 'error', exitCode: code,
          message: `exit ${code}; stderr 末尾: ${JSON.stringify(e.slice(-200))}; stdout 末尾: ${JSON.stringify(s.slice(-200))}`,
          repoResults: [],
        });
      }
    }
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status: 'error', message: '子进程错误: ' + e.message, exitCode: null, repoResults: [] });
    });
    child.on('close', (code) => finish(code));
  });
}

module.exports = { SyncEngine, runAction };
