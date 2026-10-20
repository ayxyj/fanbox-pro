'use strict';
const { randomBytes } = require('crypto');
module.exports = {
  async askCLIQuestions(route, questions, signal) {
    if (!Array.isArray(questions) || !questions.length || questions.length > 4) return null;
    const answers = {}, deadline = Date.now() + 240000;
    for (const q of questions) {
      if (!this.valid(route) || signal.aborted || Date.now() >= deadline) return null;
      if (typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length > 4 || q.options.some(o => typeof o.label !== 'string')) return null;
      const answer = await this.askCLIQuestion(route, q, signal, deadline);
      if (answer === null) return null;
      answers[q.question] = answer;
    }
    return answers;
  },
  askCLIQuestion(route, q, signal, deadline) {
    this.questions ||= new Map();
    const token = randomBytes(6).toString('hex');
    return new Promise(resolve => {
      const entry = { token, route, userid: route.userid, q, selected: new Set(), busy: false };
      let settled = false;
      const abort = () => finish(null);
      const finish = answer => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); this.questions.delete(token); resolve(this.valid(route) && !signal.aborted ? answer : null); };
      const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
      entry.finish = finish; this.questions.set(token, entry); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      (async () => {
        const details = q.options.map((o,i) => `${i+1}. ${o.label}\n${o.description || ''}`).join('\n\n');
        await this.say(route, `Claude 提问：${q.question}\n\n${details}\n\n${q.multiSelect ? '可多选，选好后点击提交；也可回复多个编号，如 1,3。' : '点击选项，或直接回复编号/自定义内容。'}\n指定回答：/回答 ${token} 您的答案\n4 分钟内有效。`);
        if (settled || !this.valid(route)) return abort();
        await this.client.sendMessage(route.userid, { msgtype: 'template_card', template_card: this.questionCard(entry) });
      })().catch(() => finish(null));
    });
  },
  questionCard(entry, ended = false) {
    const { token, q, selected } = entry;
    const key = action => `question:${token}:${action}`;
    return { card_type: 'button_interaction', task_id: 'question_' + token,
      main_title: { title: ended ? '回答已提交或问题已取消' : 'Claude 提问', desc: q.question.slice(0,120) },
      sub_title_text: '会话 #' + entry.route.number + ' · ' + entry.route.project,
      button_list: ended ? [{text:'已处理',key:key('done'),style:4}] : [
        ...q.options.map((o,i) => ({text: `${selected.has(i) ? '✓ ' : ''}${i+1}. ${o.label}`.slice(0,20),key:key(String(i)),style:selected.has(i)?1:2})),
        {text:q.multiSelect?'提交选择':'自定义回答',key:key(q.multiSelect?'done':'custom'),style:1},
        {text:'取消问题',key:key('cancel'),style:2}
      ] };
  },
  async questionEvent(frame, event, userid) {
    const match = /^question:([a-f0-9]{12}):(\d+|done|custom|cancel)$/.exec(event.event_key || '');
    if (!match || event.task_id !== 'question_' + match[1]) return;
    const entry = this.questions?.get(match[1]);
    if (!entry || entry.userid !== userid || !this.valid(entry.route)) { await this.send(userid,'该问题已处理、已过期或不属于当前账号。'); return; }
    if (entry.busy) return; entry.busy = true;
    try {
      const action = match[2];
      if (/^\d+$/.test(action)) {
        const i = Number(action); if (!entry.q.options[i]) return;
        if (entry.q.multiSelect) { if(entry.selected.has(i))entry.selected.delete(i);else entry.selected.add(i); }
        else entry.finish(entry.q.options[i].label);
      } else if (action === 'cancel') entry.finish(null);
      else if (action === 'done' && entry.q.multiSelect) {
        if (!entry.selected.size) { await this.send(userid,'请先选择至少一项。'); return; }
        entry.finish([...entry.selected].sort().map(i=>entry.q.options[i].label).join(', '));
      } else if (action === 'custom') { await this.say(entry.route,`请发送：/回答 ${entry.token} 自定义内容`); return; }
      try { await this.client.updateTemplateCard(frame,this.questionCard(entry,!this.questions.has(entry.token)),[userid]); }
      catch { await this.send(userid,this.questions.has(entry.token)?'选择已记录，卡片显示暂未更新。':'回答已记录，卡片显示暂未更新。'); }
    } finally { entry.busy = false; }
  },
  async answerQuestionText(userid, route, text) {
    const explicit = /^\/回答\s+([a-f0-9]{12})\s+([\s\S]+)$/.exec(text);
    let entries = [...(this.questions?.values() || [])].filter(e => e.userid === userid && this.valid(e.route) && (explicit ? e.token === explicit[1] : e.route === route));
    if (!entries.length) { if(explicit){await this.send(userid,'该问题已处理或已过期。');return true;} return false; }
    if (entries.length > 1) { await this.send(userid,'当前有多个待回答问题，请按问题提示使用 /回答 编号 内容。');return true; }
    const entry = entries[0], raw = explicit ? explicit[2] : text;
    let answer = raw;
    if (/^\s*\d+(?:\s*[,，]\s*\d+)*\s*$/.test(raw)) {
      const ids = [...new Set(raw.trim().split(/[,，]/).map(n=>Number(n.trim())-1))];
      if(ids.some(i=>!entry.q.options[i])||(!entry.q.multiSelect&&ids.length!==1)){await this.send(userid,'选项编号无效，请重新选择。');return true;}
      answer=ids.map(i=>entry.q.options[i].label).join(', ');
    }
    entry.finish(answer);await this.say(entry.route,'回答已提交给 Claude。');return true;
  }
};
