#!/usr/bin/env node
/**
 * gitsync-next — workspace 扫描器
 *
 * 翻译自 gitsync(Python) 的 core/scanner.py：递归找含 .git 的目录（.git 为目录或文件均认，
 * 兼容 worktree），命中即收集且不再深入；excludes 为目录名剪枝列表。
 *
 * 必须 fs.promises 异步递归（有界并发），不得用同步 readdir——这里跑在 fanbox 的
 * utilityProcess 里，同步遍历大目录会卡住整个后端（含文件浏览）。
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');

const CONCURRENCY = 8; // 目录级并发：太低扫得慢，太高 fd 爆
const { normKey } = require('./store');

/**
 * @param {string} root 扫描根目录
 * @param {string[]} [excludes] 要剪枝的目录名（大小写不敏感）
 * @returns {Promise<string[]>} 仓库路径列表（已排序）
 */
async function scanWorkspace(root, excludes = []) {
  const excl = new Set((excludes || []).map((e) => normKey(e)));
  const found = [];
  const queue = [path.resolve(root)];
  let dead = false;

  async function worker() {
    while (queue.length && !dead) {
      const dir = queue.shift();
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { continue; } // 无权限/已删除：跳过该目录
      let hasGit = false;
      const subdirs = [];
      for (const ent of entries) {
        if (ent.name === '.git') { hasGit = true; break; } // 命中仓库：收集且不深入
      }
      if (hasGit) { found.push(dir); continue; }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (ent.name === 'node_modules' || ent.name === '.git' || excl.has(normKey(ent.name))) continue;
        subdirs.push(path.join(dir, ent.name));
      }
      queue.push(...subdirs);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // 排序保证多次扫描结果稳定（对应 Python normcase+lowercase 排序）
  found.sort((a, b) => normKey(a) < normKey(b) ? -1 : normKey(a) > normKey(b) ? 1 : 0);
  return found;
}

module.exports = { scanWorkspace };
