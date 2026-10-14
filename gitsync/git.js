#!/usr/bin/env node
/**
 * gitsync-next — Git 操作层
 *
 * 全部通过 execFile 调本机 git CLI（对齐 fanbox server.js execGit 风格，零依赖）。
 * 语义翻译自 gitsync(Python) 的 core/git_ops.py：
 *   失败 reject GitError {message, repoPath, stderr}（对应 GitOpError）。
 *
 * Windows 注意：
 *   - 统一加 -c core.quotepath=false，否则中文路径被输出成带引号的八进制转义；
 *   - env 固定 GIT_PAGER=cat（分页器会把输出挂住）；
 *   - execFile 带 windowsHide，不闪控制台窗口。
 */
'use strict';

const { execFile } = require('child_process');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 120000; // large working trees and commit hooks
const NETWORK_TIMEOUT_MS = 120000; // fetch/pull 走网络，放宽

class GitError extends Error {
  constructor(message, repoPath, stderr) {
    super(message);
    this.name = 'GitError';
    this.repoPath = repoPath;
    this.stderr = stderr || '';
  }
}

// 统一入口：git -C <repoPath> -c core.quotepath=false <args...>
function git(repoPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, '-c', 'core.quotepath=false', ...args], {
      cwd: repoPath,
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', ...(args[0] === 'status' ? { GIT_OPTIONAL_LOCKS: '0' } : {}), LC_ALL: 'C.UTF-8' },
    }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').trim().slice(-300);
        reject(new GitError('git ' + args[0] + ' 失败: ' + (tail || err.message), repoPath, stderr));
      } else resolve(String(stdout || ''));
    });
  });
}

// 仓库根目录；不是仓库 → null（不抛错，探测用）
async function repoRoot(repoPath) {
  try {
    const out = await git(repoPath, ['rev-parse', '--show-toplevel'], 8000);
    const root = out.trim();
    return root || null;
  } catch { return null; }
}

/**
 * 工作区状态（翻译 get_status）。
 * @returns {{branch, detached, dirty, changedFiles:[{code,path}], upstream, ahead, behind}}
 *   ahead/behind 来自 ## 行的 [ahead N, behind M]（相对上游的本地缓存，fetch 前可能过期）。
 */
async function getStatus(repoPath) {
  const out = await git(repoPath, ['status', '--porcelain=v1', '--branch']);
  const lines = out.split('\n');
  const head = lines[0] || '';
  let branch = '';
  let detached = false;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  if (head.startsWith('## ')) {
    const rest = head.slice(3);
    if (rest.startsWith('HEAD (no branch)')) {
      detached = true;
    } else {
      const dotdot = rest.indexOf('...');
      if (dotdot >= 0) {
        branch = rest.slice(0, dotdot);
        upstream = rest.slice(dotdot + 3).split(' ')[0];
      } else {
        branch = rest.split(' ')[0];
      }
    }
    const m = head.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/);
    if (m) {
      ahead = m[1] ? parseInt(m[1], 10) : 0;
      behind = (m[2] ? parseInt(m[2], 10) : 0) || (m[3] ? parseInt(m[3], 10) : 0);
    }
  }
  const changedFiles = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(' -> ')) rest = rest.split(' -> ')[1]; // 重命名取新名
    rest = rest.replace(/^"|"$/g, '');
    changedFiles.push({ code: code.trim(), path: rest }); // 相对仓库根的路径
  }
  return { branch, detached, dirty: changedFiles.length > 0, changedFiles, upstream, ahead, behind };
}

async function currentBranch(repoPath) {
  const st = await getStatus(repoPath);
  return st.detached ? null : st.branch;
}

// 远端分支的最新 commit 数（fetch 前后各跑一次取差值 = 本次拉到的新提交数）
async function remoteRefCount(repoPath, branch) {
  if (!branch) return null;
  try {
    const out = await git(repoPath, ['rev-list', '--count', 'origin/' + branch]);
    return parseInt(out.trim(), 10);
  } catch { return null; } // 无该远端分支
}

/**
 * fetch（永远做，含 --prune）。branches 非空时只拉关注分支的显式 refspec。
 * @returns {{newCommits:number}} 本次 fetch 拉到的当前分支新提交数（detached/无上游 → 0）
 */
async function fetch(repoPath, branches) {
  const cur = await currentBranch(repoPath);
  const before = await remoteRefCount(repoPath, cur);
  const args = ['fetch', 'origin', '--prune'];
  if (Array.isArray(branches) && branches.length > 0) {
    for (const b of branches) args.push('+refs/heads/' + b + ':refs/remotes/origin/' + b);
  }
  try {
    await git(repoPath, args, NETWORK_TIMEOUT_MS);
  } catch (e) {
    // fetch 失败多为本机凭据问题：换一句人话，附 stderr 尾部
    const hint = /couldn't find remote ref/.test(e.stderr)
      ? '远端 origin 不存在关注分支，请修改分支设置'
      : 'fetch 失败，请检查 origin、网络及本机 Git 认证';
    throw new GitError(hint + ': ' + e.stderr.slice(-200), repoPath, e.stderr);
  }
  const after = await remoteRefCount(repoPath, cur);
  const newCommits = (before !== null && after !== null && after > before) ? after - before : 0;
  return { newCommits };
}

// 相对 origin/<branch> 的 ahead/behind（精确值，fetch 后调用）
async function aheadBehind(repoPath, branch) {
  if (!branch) return { ahead: 0, behind: 0 };
  try {
    const out = await git(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...origin/' + branch]);
    const [ahead, behind] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch { return { ahead: 0, behind: 0 }; } // 无上游
}

async function pull(repoPath, branch) {
  await git(repoPath, ['pull', 'origin', branch], NETWORK_TIMEOUT_MS);
}

/**
 * 切换分支（翻译 switch_branch）：本地存在 → checkout；不存在 → 从 origin 建跟踪分支。
 * 脏工作区切换可能失败，由 git 自己报错。
 */
async function switchBranch(repoPath, target) {
  let exists = false;
  try { await git(repoPath, ['rev-parse', '--verify', 'refs/heads/' + target]); exists = true; } catch { exists = false; }
  if (exists) await git(repoPath, ['checkout', target]);
  else await git(repoPath, ['checkout', '--track', '-b', target, 'origin/' + target]);
}

// ---------- stash（翻译 stash_list / StashPanel 语义）----------
async function stashList(repoPath) {
  let out;
  try { out = await git(repoPath, ['stash', 'list', '--format=%gd%x00%gs%x00%ci']); }
  catch { return []; }
  const entries = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [ref, message, date] = line.split('\x00');
    const m = (ref || '').match(/\{(\d+)\}/);
    entries.push({ idx: m ? parseInt(m[1], 10) : entries.length, ref, message: message || '', date: date || '' });
  }
  return entries;
}
async function stashCount(repoPath) {
  return (await stashList(repoPath)).length;
}
async function stashPush(repoPath, message) {
  const args = ['stash', 'push', '-u'];
  if (message) args.push('-m', message);
  await git(repoPath, args, WRITE_TIMEOUT_MS);
}
async function stashApply(repoPath, idx) {
  await git(repoPath, ['stash', 'apply', 'stash@{' + idx + '}'], WRITE_TIMEOUT_MS);
}
async function stashPop(repoPath, idx) {
  await git(repoPath, ['stash', 'pop', 'stash@{' + idx + '}'], WRITE_TIMEOUT_MS);
}
async function stashDrop(repoPath, idx) {
  await git(repoPath, ['stash', 'drop', 'stash@{' + idx + '}'], WRITE_TIMEOUT_MS);
}

// 危险操作：放弃全部本地改动（reset --hard + clean -fd），API 层必须二次确认
async function discardAll(repoPath, phase = () => {}) {
  phase('还原已跟踪文件');
  await git(repoPath, ['reset', '--hard'], WRITE_TIMEOUT_MS);
  phase('清理未跟踪文件');
  await git(repoPath, ['clean', '-fd'], WRITE_TIMEOUT_MS);
}

async function commitAll(repoPath, message, phase = () => {}) {
  phase('暂存改动（git add）');
  await git(repoPath, ['add', '-A'], WRITE_TIMEOUT_MS);
  phase('创建提交（含 Git hooks）');
  await git(repoPath, ['commit', '-m', message || 'gitsync: auto commit'], WRITE_TIMEOUT_MS);
}

module.exports = {
  GitError, repoRoot, getStatus, currentBranch, fetch, aheadBehind, pull, switchBranch,
  stashList, stashCount, stashPush, stashApply, stashPop, stashDrop, discardAll, commitAll,
  execGit: git,
};
