#!/usr/bin/env node
/**
 * gitsync-next — 任务调度器
 *
 * 翻译自 gitsync(Python) 的 core/scheduler.py（APScheduler → 零依赖 setInterval）：
 *   - 5s tick（interval 任务有秒级精度需求，比 fanbox cron 的 20s 细）
 *   - fire 前先排好下一次 nextRun，防调度重入
 *   - 任务级互斥：runningTasks Set；同任务在跑 → 写 skipped_busy 日志后跳过
 *   - 错过的记 missed 不补跑（启动结算）
 *   - 日志清理：启动时 + 每日 03:00（retentionDays/maxLogEntries，见 store.cleanupLogs）
 */
'use strict';

const { cronNext } = require('./cron-expr');
const { runAction } = require('./sync-engine');
const { nowIso } = require('./store');

const TICK_MS = 5000;

// 任务的下一次执行时刻（ms）；null = 不再执行
function gsNextRun(task, fromMs = Date.now()) {
  const trig = task.trigger || {};
  if (!task.enabled) return null;
  if (trig.type === 'at') { const ts=new Date(trig.time).getTime(); return Number.isFinite(ts)&&ts>fromMs?ts:null; }
  if (trig.type === 'interval') {
    const sec = Number(trig.sec);
    if (!isFinite(sec) || sec < 1) return null;
    return fromMs + sec * 1000;
  }
  if (trig.type === 'cron') {
    const n = cronNext(trig.expr, fromMs);
    return n === undefined ? null : n;
  }
  return null; // adhoc 等
}

// 倒计时文本（翻译 next_run_info）："1h05m 后" / "3m20s 后" / "已过期 Xs"
function countdownText(inMs) {
  const delta = inMs / 1000;
  if (delta < 0) return `已过期 ${Math.floor(-delta)}s`;
  const total = Math.floor(delta);
  let m = Math.floor(total / 60);
  const s = total % 60;
  const h = Math.floor(m / 60);
  m = m % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m 后`;
  return `${m}m${String(s).padStart(2, '0')}s 后`;
}

class TaskScheduler {
  constructor(store, engine) {
    this.store = store;
    this.engine = engine;
    this.runningTasks = new Set(); // taskId -> 正在跑
    this._timer = null;
    this._started = false;
    this._lastCleanupDay = null;
  }

  start() {
    if (this._started) return;
    this._started = true;
    // 启动结算：错过的记一笔 missed 不补跑，然后从现在起重排
    for (const t of this.store.tasks) {
      if (!this.paused && t.enabled && t.nextRun && t.nextRun < Date.now() - 60000) {
        this.store.appendLog({
          taskId: t.id, repoId: null, start: nowIso(), end: nowIso(),
          status: 'missed', message: '应用未运行，错过本次触发', logText: '',
        }).catch(() => {});
      }
      t.nextRun = this.paused ? null : gsNextRun(t);
      if(!this.paused && t.trigger?.type==='at'&&!t.nextRun)t.enabled=false;
    }
    this.store.persist('tasks');
    this.store.cleanupLogs().catch((e) => console.error('[gitsync] 日志清理失败:', e && e.message));
    this._timer = setInterval(() => this._tick(), TICK_MS);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (!this._started) return;
    clearInterval(this._timer);
    this._started = false;
  }

  // UI 增删改任务后调：重算所有 nextRun
  reload() {
    for (const t of this.store.tasks) {
      t.nextRun = this.paused ? null : gsNextRun(t);
      if(!this.paused && t.enabled && t.trigger?.type==='at' && !t.nextRun)t.enabled=false;
    }
    this.store.persist('tasks');
  }

  get paused() { return this.store.getSetting('autoSyncPaused', false) === true; }

  _tick() {
    const now = Date.now();
    // 每日 03:00 清一次日志（跨天判一次即可）
    const d = new Date();
    const dayKey = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (d.getHours() === 3 && this._lastCleanupDay !== dayKey) {
      this._lastCleanupDay = dayKey;
      this.store.cleanupLogs().catch(() => {});
    }
    if (this.paused) return;
    for (const t of this.store.tasks) {
      if (!t.enabled) continue;
      if (t.nextRun === undefined || t.nextRun === null) { t.nextRun = gsNextRun(t); continue; }
      if (t.nextRun <= now) {
        t.nextRun = gsNextRun(t, now); // 先排下一次，防重入
        this.store.persist('tasks');
        this._fire(t); // 不 await：tick 不被慢任务卡住
      }
    }
  }

  // 触发一次任务（翻译 _job_func）：任务级互斥
  _fire(task, manual = false) {
    if(this.paused && !manual) return Promise.resolve({ status:'skipped_paused',message:'自动同步已暂停' });
    if (this.runningTasks.has(task.id)) {
      this.store.appendLog({
        taskId: task.id, repoId: null, start: nowIso(), end: nowIso(),
        status: 'skipped_busy', message: '同任务上一次触发仍在跑,本次跳过', logText: '',
      }).catch(() => {});
      return Promise.resolve({ status: 'skipped_busy', message: '同任务上一次触发仍在跑,本次跳过' });
    }
    // 再读一次：任务可能已被禁用或删除
    const fresh = this.store.getTask(task.id);
    if (!fresh || (!manual && !fresh.enabled)) {
      return Promise.resolve({ status: 'skipped_disabled', message: '任务已停用或删除' });
    }
    this.runningTasks.add(fresh.id);
    return runAction(this.store, this.engine, fresh)
      .then((r) => {
        if(fresh.trigger?.type==='at'){fresh.enabled=false;fresh.nextRun=null;}
        fresh.lastStatus = r.status;
        fresh.lastRunAt = nowIso();
        this.store.persist('tasks');
        return r;
      })
      .finally(() => this.runningTasks.delete(fresh.id));
  }

  // 立即触发（翻译 trigger_now）：走同一互斥，返回执行结果
  triggerNow(taskId) {
    const t = this.store.getTask(taskId);
    if (!t) return Promise.reject(new Error('任务不存在: ' + taskId));
    return this._fire(t, true);
  }

  // 最近的 enabled interval/cron 任务（翻译 next_run_info）
  nextRunInfo() {
    return nextRunInfo(this.store);
  }
}

// 独立版本：api.js 拿不到 scheduler 实例，从 store 算
function nextRunInfo(store) {
  if (store.getSetting('autoSyncPaused',false) === true) return null;
  let soonest = null;
  for (const t of store.tasks) {
    if (!t.enabled) continue;
    if (t.trigger && ['interval','cron','at'].includes(t.trigger.type) && t.nextRun) {
      if (!soonest || t.nextRun < soonest.nextRun) soonest = t;
    }
  }
  if (!soonest) return null;
  const inMs = soonest.nextRun - Date.now();
  return { name: soonest.name, inMs, text: countdownText(inMs) };
}

module.exports = { TaskScheduler, gsNextRun, countdownText, nextRunInfo };
