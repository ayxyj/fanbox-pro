'use strict';
const { randomUUID } = require('crypto');
const path = require('path'), fs = require('fs');
const HELP = `📱 Code Chat 桥接命令
• /claude /codex /codebuddy — 进入对应 CLI，原样发送消息
• /aiquit — 退出 CLI，恢复 AI 对话
• /projects [页码] — 列出工作目录下的项目目录
• /new [项目名] — 新建终端会话
• /list — 列出当前会话；/list 编号 切换会话
• /sel 编号|会话id — 切换聚焦会话
• /content — 查看聚焦会话最近内容
• /set_name <英文名> <中文名> [昵称] — 设置身份；修改需加 --force
• /help — 显示本帮助
• /停止 — 停止聚焦会话的任务
直接发消息 = 续聊聚焦会话；引用桥接推送 = 切到那个会话续聊。
权限请求直接点击卡片上的“批准 / 拒绝”。`;
module.exports = {
  ownRoutes(userid) { return [...this.routes.values()].filter(r => r.userid === userid); },
  focused(userid) { return this.routes.get(this.focus.get(userid)); },
  async newRoute(userid, project = '') {
    const config = this.config();
    if (!config.allowExecution) throw Error('电脑端尚未开启“允许远程操作”');
    if (this.ownRoutes(userid).length >= 30) throw Error('当前账号已打开 30 个会话，请先在电脑端关闭不用的终端');
    const cwd = project ? path.resolve(config.cwd, project) : config.cwd;
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw Error(`项目目录不存在。当前工作目录：${config.cwd}\n发送 /projects 查看可用目录；/new 项目名 使用其子目录，也支持完整目录路径`);
    const id = randomUUID(), key = JSON.stringify([config.botId, userid, id]);
    const number = (this.numbers.get(userid) || 0) + 1; this.numbers.set(userid, number);
    const route = { key, id, number, userid, project: path.basename(cwd) || cwd, cwd, generation: this.generation, mode: config.mode, busy: true, sessionId: '', conversationId: '' };
    const previous = this.focus.get(userid); this.routes.set(key, route); this.focus.set(userid, key); this.changed();
    try {
      route.sessionId = await this.createTerminal({ cwd, shell: config.shell, mode: route.mode, userid, routeKey: key, project: route.project });
      if (!this.valid(route)) throw Error('远程授权已撤销');
      if (route.mode !== 'ai') { try { await this.startCLI(route.sessionId, route.mode, cwd); } catch(error) { route.mode = 'ai'; await this.say(route, error.message + '；已保留终端并返回 AI 对话'); } }
      return route;
    } catch (error) { this.routes.delete(key); if(this.focus.get(userid) === key) { if(previous) this.focus.set(userid, previous); else this.focus.delete(userid); } throw error; }
    finally { route.busy = false; this.changed(); }
  },
  async say(route, text) { return this.send(route.userid, text, route); },
  quotedRoute(userid, quote) {
    const text = quote?.text?.content || quote?.mixed?.msg_item?.map(i => i.text?.content || '').join('\n') || '';
    const ids = [...text.matchAll(/\[CodeChat:([a-f0-9-]{36})\]/g)].map(m => m[1]).concat([...text.matchAll(/\[会话:([a-f0-9]{8})\]/g)].map(m=>m[1]));
    if (!ids.length) throw Error('引用中没有桥接会话标记，请用 /list 和 /sel 选择会话');
    if (new Set(ids).size !== 1) throw Error('引用包含多个会话，请使用 /sel 选择');
    const matches = this.ownRoutes(userid).filter(r => r.id.startsWith(ids[0]));
    const route = matches.length === 1 ? matches[0] : null;
    if (!route) throw Error('引用的会话已关闭或不属于您，消息未转发');
    return route;
  },
  async bridgeCommand(userid, text) {
    const [command, ...parts] = text.split(/\s+/), arg = text.slice(command.length).trim();
    let route = this.focused(userid);
    const cliName = text.replace(/^\//, '');
    if (['claude','codex','codebuddy'].includes(cliName)) {
      if (!route) route = await this.newRoute(userid);
      if (!this.valid(route)) throw Error('远程操作权限尚未开启');
      if (route.busy) throw Error('当前任务尚未结束，请先等待完成或发送 /停止');
      await this.startCLI(route.sessionId, cliName, route.cwd); route.mode = cliName; this.changed();
      await this.say(route, '已向终端发送启动命令：' + cliName + ' CLI。后续消息原样转发，执行中发送简洁进度，确认事项和最终结果会在这里通知。/aiquit 发送 Ctrl+C，退出后恢复 AI 对话。'); return true;
    }
    if (command === '/aiquit') {
      if (route?.busy) throw Error('CLI 尚未结束，请先发送 /停止并等待结束');
      if (route) { await this.leaveCLI(route.sessionId); route.mode = 'ai'; this.changed(); }
      await this.send(userid, '已恢复 AI 对话模式'); return true;
    }
    // CLI slash commands such as /help belong to the CLI; /bridge help remains available.
    if (route && route.mode !== 'ai' && !['/new','/list','/sel','/content','/projects','/项目','/set_name','/bridge','/停止','/状态'].includes(command)) return false;
    if (command === '/bridge') { await this.send(userid, HELP); return true; }
    if (command === '/help' || command === '/帮助') { await this.send(userid, HELP); return true; }
    if (command === '/projects' || command === '/项目') {
      if (arg && !/^[1-9]\d*$/.test(arg)) throw Error('用法：/projects [页码]，例如 /projects 2');
      const cwd = this.config().cwd, names = [];
      try {
        const entries = await fs.promises.readdir(cwd, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) names.push(entry.name);
          else if (entry.isSymbolicLink()) {
            try { if ((await fs.promises.stat(path.join(cwd, entry.name))).isDirectory()) names.push(entry.name); } catch { /* Ignore broken links. */ }
          }
        }
      } catch (error) {
        throw Error(`无法读取工作目录：${cwd}\n${error.code === 'ENOENT' || error.code === 'ENOTDIR' ? '目录不存在，请在 IM 设置中修改工作目录' : '请检查目录访问权限或磁盘连接'}`);
      }
      names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
      const page = Number(arg || 1), pages = Math.max(1, Math.ceil(names.length / 20));
      if (!Number.isSafeInteger(page) || page > pages) throw Error(`页码超出范围，共 ${pages} 页，请发送 /projects 查看`);
      const entries = names.slice((page - 1) * 20, page * 20).map(name => `/new ${name}`);
      await this.send(userid, `📁 当前工作目录：${cwd}\n项目目录（直接子目录）：${names.length} 个 · 第 ${page}/${pages} 页\n\n${entries.length ? entries.join('\n') : '当前工作目录下没有子目录。发送 /new 可直接在当前目录创建会话。'}${page < pages ? '\n\n下一页：/projects ' + (page + 1) : ''}\n\n复制上面的 /new 命令即可打开项目；/list 查看已打开的会话。`);
      return true;
    }
    if (command === '/new') { const created = await this.newRoute(userid, arg); await this.say(created, `已新建并聚焦会话 #${created.number}\n项目：${created.project}\n目录：${created.cwd}`); return true; }
    if (command === '/list' && !arg) {
      const routes = this.ownRoutes(userid).sort((a, b) => a.number - b.number);
      const listing = routes.map(r => {
        const pending = r.busy || (r.mode !== 'ai' && this.cliStatus?.(r.sessionId)?.pending);
        return `${r === route ? '▶ 当前' : '•'} #${r.number} ${r.project} · ${r.mode === 'ai' ? 'AI' : r.mode} · ${pending ? '处理中' : '等待消息'}\n切换：/sel ${r.number}\nID: ${r.id}`;
      }).join('\n\n');
      await this.send(userid, listing ? `会话列表（${routes.length} 个）\n\n${listing}\n\n发送 /sel 编号 或 /list 编号 切换，例如 /sel ${routes[0].number}。编号以列表中的 # 为准。` : '暂无终端会话，发送 /new 创建'); return true;
    }
    if (command === '/sel' || command === '/list') {
      if (command === '/list' && !/^[1-9]\d*$/.test(arg)) throw Error('用法：/list 查看会话，/list 编号 切换，例如 /list 2');
      const selected = this.ownRoutes(userid).find(r => /^\d+$/.test(arg) ? r.number === Number(arg) : r.id === arg || r.sessionId === arg);
      if (!selected || !arg) throw Error('会话不存在或不属于您，请用 /list 查看编号与 ID');
      this.focus.set(userid, selected.key); this.changed(); await this.say(selected, `已聚焦 #${selected.number} · ${selected.project}\n模式：${selected.mode === 'ai' ? 'AI' : selected.mode}\n后续消息将发送到这个会话。`); return true;
    }
    if (command === '/content') {
      if (!route) throw Error('尚未聚焦会话，请用 /new 或 /sel');
      await this.say(route, '最近终端内容（输出快照，不代表执行完成）：\n\n' + (this.target(route.sessionId).output().slice(-12000) || '（暂无输出）')); return true;
    }
    if (command === '/set_name') {
      const force = parts.includes('--force'), names = parts.filter(p => p !== '--force');
      if (names.length < 2 || names.length > 3 || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(names[0]) || names.slice(1).some(n => n.length > 64 || /[\x00-\x1f]/.test(n))) throw Error('用法：/set_name 英文名 中文名 [昵称] [--force]');
      const config = this.config();
      if (config.identities?.[userid] && !force) throw Error('已设置身份，如需修改请增加 --force');
      const next = { ...config, identities: { ...config.identities, [userid]: { english: names[0], chinese: names[1], nickname: names[2] || '' } } };
      this.store.data.im = next; try { this.store.persist(); } catch(e) { this.store.data.im = config; throw e; }
      this.changed(); await this.send(userid, `身份已保存：${names.join(' · ')}。身份仅用于展示，不影响账号权限。`); return true;
    }
    return false;
  },
  async cliProgress(route, text, taskId) {
    if (!this.valid(route) || this.cliStatus(route.sessionId)?.taskId !== taskId || !this.cliStatus(route.sessionId)?.pending) return;
    await this.client.sendMessage(route.userid, { msgtype: 'template_card', template_card: {
      card_type: 'button_interaction', task_id: 'cli_' + taskId,
      main_title: { title: '#' + route.number + ' · ' + route.project, desc: text },
      button_list: [{text:'查看状态',key:'cli:status:'+taskId,style:2},{text:'停止本次',key:'cli:stop:'+taskId,style:2}]
    } });
  },
  async cliTaskEvent(frame, event, userid) {
    const match = /^cli:(status|stop):([a-f0-9-]{36})$/.exec(event.event_key || '');
    if (!match || event.task_id !== 'cli_' + match[2]) return;
    const route = this.ownRoutes(userid).find(r=>this.cliStatus(r.sessionId)?.taskId === match[2]);
    if (!route || !this.valid(route) || !this.cliStatus(route.sessionId)?.pending) { await this.send(userid,'这条任务已结束，按钮已失效。'); return; }
    if (match[1] === 'status') await this.say(route,this.cliStatus(route.sessionId).text);
    else { this.stopCLI(route.sessionId); await this.say(route,'已请求中断本次任务，CLI 会话保留。'); }
    try {
      const current = this.cliStatus(route.sessionId), active = current?.pending && current.taskId === match[2];
      await this.client.updateTemplateCard(frame, { card_type: 'button_interaction', task_id: event.task_id,
        main_title: { title: active ? '任务状态' : '已请求中断', desc: active ? current.text : 'CLI 会话保留，本次按钮已失效' },
        button_list: active ? [{text:'查看状态',key:'cli:status:'+match[2],style:2},{text:'停止本次',key:'cli:stop:'+match[2],style:2}] : [{text:'已处理',key:event.event_key,style:4}]
      }, [userid]);
    } catch { /* The explicit status message above remains usable if the card cannot refresh. */ }

  },
  async cardEvent(frame) {
    const body = frame.body, envelope = body?.event, userid = body?.from?.userid, config = this.config();
    if (!config.enabled || body?.aibotid !== config.botId || !config.users.includes(userid) || envelope?.eventtype !== 'template_card_event') return;
    // Runtime payload nests these fields; SDK 1.0.7 declarations describe a flat shape.
    // Keep each shape intact so a malformed nested payload cannot borrow outer identifiers.
    const event = envelope.template_card_event ?? envelope;
    if ((event.event_key || '').startsWith('cli:')) return this.cliTaskEvent(frame, event, userid);
    if ((event.event_key || '').startsWith('question:')) return this.questionEvent(frame, event, userid);
    const match = /^approval:(approve|reject):([a-f0-9]{12})$/.exec(event.event_key || '');
    if (!match || event.task_id !== 'approval_' + match[2]) return;
    const pending = this.approvals.get(match[2]);
    if (pending && pending.userid !== userid) return;
    const completed = this.completedApprovals.get(match[2]);
    if (!pending && completed?.userid !== userid) { await this.send(userid, '审批已失效，请查看当前会话状态'); return; }
    let label = completed?.label || '已失效';
    if (pending) {
      const allowed = this.valid(this.routes.get(pending.routeKey));
      label = !allowed ? '授权已撤销' : match[1] === 'approve' ? '已批准' : '已拒绝';
      pending.finish(allowed && match[1] === 'approve', label);
    }
    // Consume before awaiting the acknowledgement: duplicate clicks cannot execute twice.
    try {
      // Retain the original type and all required fields. A text_notice replacement
      // requires a navigation action, which an approval result does not have.
      await this.client.updateTemplateCard(frame, {
        card_type: 'button_interaction', task_id: event.task_id,
        main_title: { title: label, desc: '本次审批已结束，无需重复点击' },
        button_list: [{ text: label, key: event.event_key, style: 4 }],
      }, [userid]);
    } catch (error) {
      // SDK errors may be raw ACK frames rather than Error instances. Never log
      // the full frame: it can contain callback identifiers and message data.
      const reason = Number.isInteger(error?.errcode) ? `企微错误码 ${error.errcode}` : /timeout/i.test(error?.message || '') ? '接口响应超时' : '连接或接口异常';
      this.lastError = `审批结果卡片更新失败：${reason}；审批决定已记录，不会重复执行`;
      this.changed();
      await this.send(userid, `${label}；本次决定已记录，无需再次批准。卡片显示暂未同步（${reason}）。`);
    }
  },
};
