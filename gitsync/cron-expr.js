#!/usr/bin/env node
/**
 * gitsync-next — 5 字段 cron 表达式解析
 *
 * 从 fanbox server.js 原样抽出（行为零变化）：支持 *, -, step/n；周日 0 或 7 都认。
 * server.js 的 fanbox cron 与 gitsync 的任务调度共用这一份解析器。
 */
'use strict';

// 5 字段 cron（分 时 日 月 周，本地时区）。支持 *, -, step/n；周日 0 或 7 都认
function cronField(spec, min, max) {
  if (spec === '*') return null; // null = 不限
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) return undefined; // 解析失败
    const step = m[3] ? parseInt(m[3], 10) : 1;
    if (!step) return undefined;
    let lo, hi;
    if (m[1] === '*') { lo = min; hi = max; }
    else { lo = parseInt(m[1], 10); hi = m[2] ? parseInt(m[2], 10) : (m[3] ? max : lo); }
    if (lo < min || hi > max + (max === 6 ? 1 : 0) || lo > hi) return undefined; // 周允许 7
    for (let v = lo; v <= hi; v += step) set.add(max === 6 && v === 7 ? 0 : v);
  }
  return set;
}

// 下一次命中时刻（ms）；表达式非法返回 undefined，一年内无命中返回 null
function cronNext(expr, fromMs) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const [fMin, fHour, fDom, fMon, fDow] = [
    cronField(parts[0], 0, 59), cronField(parts[1], 0, 23), cronField(parts[2], 1, 31),
    cronField(parts[3], 1, 12), cronField(parts[4], 0, 6),
  ];
  if ([fMin, fHour, fDom, fMon, fDow].some((f) => f === undefined)) return undefined;
  // 经典 cron 语义：日、周都有限定时，任一命中即可
  const dayOk = (d) => {
    const dom = !fDom || fDom.has(d.getDate());
    const dow = !fDow || fDow.has(d.getDay());
    return fDom && fDow ? (dom || dow) : (dom && dow);
  };
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (!fMon || fMon.has(d.getMonth() + 1)) {
      if (dayOk(d)) {
        if ((!fHour || fHour.has(d.getHours())) && (!fMin || fMin.has(d.getMinutes()))) return d.getTime();
      } else { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); i += 1439; continue; } // 整天不匹配就跳天
    } else { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); i += 1439; continue; }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

module.exports = { cronField, cronNext };
