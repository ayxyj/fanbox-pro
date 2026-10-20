'use strict';
// Human-readable phases are derived only from tool events, never terminal output or model guesses.
const groups = { Read:'读取项目文件', Glob:'查找项目文件', Grep:'检索项目内容', Write:'修改文件', Edit:'修改文件', NotebookEdit:'修改文件', Bash:'执行命令', PowerShell:'执行命令', WebFetch:'查询资料', WebSearch:'查询资料', Agent:'分析子任务', Task:'分析子任务' };
class CLIProgress {
  constructor({ send, now = Date.now }) { this.send = send; this.now = now; this.started = now(); this.lastSent = 0; this.lastText = ''; this.current = ''; this.paused = false; this.closed = false; }
  event(event) {
    if (event.phase === 'PostToolUseFailure') this.current = '最近一次工具调用未成功，等待 CLI 后续处理';
    else if (event.phase === 'PostToolUse') this.current = '已完成一项工具调用，继续处理';
    else this.current = groups[event.tool] ? '正在' + groups[event.tool] : '正在处理任务';
  }
  tick() {
    if (this.closed || this.paused || this.now() - this.started < 20000 || this.lastSent && this.now() - this.lastSent < 30000) return;
    const text = this.current || '仍在执行，尚未收到最终结果';
    if (text === this.lastText) return;
    this.lastSent = this.now(); this.lastText = text; this.send(text);
  }
  close() { this.closed = true; }
}
module.exports = { CLIProgress };
