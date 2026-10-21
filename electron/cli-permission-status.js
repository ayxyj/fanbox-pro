'use strict';

// Read only a fresh footer containing Claude's cycle hint. Ordinary prose and
// historical output must never be treated as confirmation of a mode change.
function permissionStatus(output) {
  const text = output.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[(\d*)C/g, ' ')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const pattern = /\b(accept\s*edits\s*on|bypass\s*permissions\s*on|plan\s*mode\s*on|auto\s*mode\s*on|default\s*mode|normal\s*mode)\s*\(\s*shift\s*\+\s*tab\s*to\s*cycle\s*\)/gi;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return null;
  const raw = matches.at(-1)[1].replace(/\s+/g, ' ').toLowerCase();
  const labels = {
    accepteditson: '自动接受编辑', bypasspermissionson: '跳过权限确认',
    planmodeon: '计划模式', automodeon: '自动模式',
    defaultmode: '默认权限模式', normalmode: '普通权限模式'
  };
  return { raw, label: labels[raw.replace(/\s/g, '')] };
}

function watchPermissionStatus(target, { timeout = 3000, settle = 350 } = {}) {
  let buffer = '', stableTimer, deadline, unsubscribe, finish, done = false;
  const promise = new Promise(resolve => {
    finish = value => {
      if (done) return;
      done = true; clearTimeout(stableTimer); clearTimeout(deadline);
      unsubscribe?.(); resolve(value);
    };
    deadline = setTimeout(() => finish(null), timeout);
    unsubscribe = target.subscribeOutput(text => {
      if (done) return;
      buffer = (buffer + text).slice(-16000);
      clearTimeout(stableTimer);
      const status = permissionStatus(buffer);
      if (status) stableTimer = setTimeout(() => finish(status), settle);
    });
  });
  return { promise, cancel: () => finish(null) };
}
module.exports = { permissionStatus, watchPermissionStatus };
