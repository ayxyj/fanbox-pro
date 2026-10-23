'use strict';
const { randomBytes } = require('crypto');
module.exports = {
  async askCLIQuestions(route, questions, signal) {
    if (!Array.isArray(questions) || !questions.length || questions.length > 4) return null;
    const answers = {};
    for (const q of questions) {
      if (!this.valid(route) || signal.aborted) return null;
      if (typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length > 4 || q.options.some(o => typeof o.label !== 'string')) return null;
      const answer = await this.askCLIQuestion(route, q, signal, Date.now()+240000);
      if (answer === null) return null;
      answers[q.question] = answer;
    }
    return answers;
  },
  askCLIQuestion(route, q, signal, deadline) {
    this.questions ||= new Map();
    const token = randomBytes(6).toString('hex');
    return new Promise(resolve => {
      const entry = { token, route, userid: route.userid, q, selected: new Set(q.nativeMenu ? q.selectedIndices || [] : []), busy: false, page: 0 };
      let settled = false;
      const abort = () => finish(null);
      const finish = answer => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); this.questions.delete(token); if(q.nativeMenu && signal.aborted)this.say(route,'终端问题已变化或已在本机处理，原卡片失效。').catch(()=>{}); resolve(this.valid(route) && !signal.aborted ? answer : null); };
      const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
      entry.finish = finish; this.questions.set(token, entry); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      // Serialize outbound details/card pairs per terminal. An obsolete queued
      // question must never be sent after a newer screen has replaced it.
      this.questionDeliveries ||= new WeakMap();
      const previous=this.questionDeliveries.get(route)||Promise.resolve();
      const delivery=previous.catch(()=>{}).then(async () => {
        if(settled || signal.aborted || !this.valid(route))return abort();
        const details = q.options.map((o,i) => `${i+1}. ${o.label}\n${o.description || ''}`).join('\n\n');
        await this.say(route, `${q.title || 'Claude 提问'}：${q.question}\n\n${details}\n\n${q.nativeMenu ? (q.nativeText?'请直接回复填写内容。':'')+'终端与此卡片同步，任一端操作后旧卡片可能失效。' + (q.searchable ? ' 可回复“搜索 关键词”筛选历史会话。' : '') : ''}\n${q.multiSelect ? '可多选，选好后点击提交；也可回复多个编号，如 1,3。' : (q.fixedOptions ? '点击选项或回复编号。' : '点击选项，或直接回复编号/自定义内容。')}\n指定回答：/回答 ${token} 您的答案\n4 分钟内有效。`);
        if (settled || !this.valid(route)) return abort();
        try { await this.client.sendMessage(route.userid, { msgtype: 'template_card', template_card: this.questionCard(entry) }); }
        catch { if(!settled)await this.say(route,`选项卡片发送失败，请直接按上方提示回复，或发送 /回答 ${token} 您的答案。`); }
      }).catch(() => finish(null));
      this.questionDeliveries.set(route,delivery);
    });
  },
  questionCard(entry, ended = false) {
    const { token, q, selected } = entry;
    if (q.nativeMenu) return this.nativeQuestionCard(entry, ended);
    const key = action => `question:${token}:${action}`;
    return { card_type: 'button_interaction', task_id: 'question_' + token,
      main_title: { title: ended ? '回答已提交或问题已取消' : (q.title || 'Claude 提问'), desc: q.question.slice(0,120) },
      sub_title_text: '会话 #' + entry.route.number + ' · ' + entry.route.project,
      button_list: ended ? [{text:'已处理',key:key('done'),style:4}] : [
        ...q.options.map((o,i) => ({text: `${selected.has(i) ? '✓ ' : ''}${i+1}. ${o.label}`.slice(0,20),key:key(String(i)),style:selected.has(i)?1:2})),
        ...(q.fixedOptions ? [] : [{text:q.multiSelect?'提交选择':'自定义回答',key:key(q.multiSelect?'done':'custom'),style:1}]),
        {text:'取消问题',key:key('cancel'),style:2}
      ] };
  },
  nativeQuestionCard(entry, ended=false) {
    const {token,q,page,selected}=entry,key=a=>'question:'+token+':'+a;
    const count=Math.max(1,Math.ceil(q.options.length/2)),buttons=q.options.slice(page*2,page*2+2).map((o,j)=>{const i=page*2+j;return {text:((selected.has(i)?'✓ ':'')+(i+1)+'. '+o.label).slice(0,20),key:key(i),style:selected.has(i)?1:2};});
    if(page>0)buttons.push({text:'上一组选项',key:key('prev'),style:2});
    if(page+1<count)buttons.push({text:'下一组选项',key:key('next'),style:2});
    if(q.multiSelect)buttons.push({text:'提交选择',key:key('done'),style:1});
    buttons.push({text:'取消',key:key('cancel'),style:2});
    return {card_type:'button_interaction',task_id:'question_'+token,main_title:{title:ended?'已提交或已失效':q.title,desc:q.question.slice(0,120)},sub_title_text:'会话 #'+entry.route.number+' · '+entry.route.project+' · '+(page+1)+'/'+count,button_list:ended?[{text:'已处理',key:key('done'),style:4}]:buttons};
  },
  async questionEvent(frame, event, userid) {
    const match = /^question:([a-f0-9]{12}):(\d+|done|custom|cancel|prev|next)$/.exec(event.event_key || '');
    if (!match || event.task_id !== 'question_' + match[1]) return;
    const entry = this.questions?.get(match[1]);
    if (!entry || entry.userid !== userid || !this.valid(entry.route)) { await this.send(userid,'该问题已处理、已过期或不属于当前账号。'); return; }
    if (entry.busy) return; entry.busy = true;
    try {
      const action = match[2];
      if(entry.q.nativeMenu && (action==='prev'||action==='next')) { entry.page=Math.max(0,Math.min(Math.ceil(entry.q.options.length/2)-1,entry.page+(action==='next'?1:-1))); }
      else if (/^\d+$/.test(action)) {
        const i = Number(action); if (!entry.q.options[i]) return;
        if (entry.q.multiSelect) { if(entry.selected.has(i))entry.selected.delete(i);else entry.selected.add(i); }
        else entry.finish(entry.q.nativeMenu ? {indices:[i]} : entry.q.options[i].label);
      } else if (action === 'cancel') entry.finish(entry.q.nativeMenu ? {cancel:true} : null);
      else if (action === 'done' && entry.q.multiSelect) {
        if (!entry.selected.size) { await this.send(userid,'请先选择至少一项。'); return; }
        entry.finish(entry.q.nativeMenu ? {indices:[...entry.selected].sort((a,b)=>a-b)} : [...entry.selected].sort().map(i=>entry.q.options[i].label).join(', '));
      } else if (action === 'custom' && !entry.q.fixedOptions) { await this.say(entry.route,`请发送：/回答 ${entry.token} 自定义内容`); return; }
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
    if(entry.q.nativeMenu){
      if(entry.busy)return true;
      if(entry.q.nativeText && raw.trim()!=='取消'){
        if(!raw.trim() || raw.length>4000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(raw)){await this.say(entry.route,'回答为空、过长或包含终端控制字符，请重新输入（最多 4000 字符）。');return true;}
        entry.finish({text:raw});return true;
      }
      if(entry.q.searchable && /^搜索\s+/.test(raw)){
        const search=raw.replace(/^搜索\s+/,'');
        if(!search.trim() || search.length>200 || /[\x00-\x1f\x7f]/.test(search)){await this.say(entry.route,'搜索内容为空、过长或包含控制字符，请重新输入（最多 200 字符）。');return true;}
        entry.finish({search});return true;
      }
      if(raw.trim()==='取消'){entry.finish({cancel:true});return true;}
      if(!/^\s*\d+(?:\s*[,，]\s*\d+)*\s*$/.test(raw)){await this.say(entry.route,'请回复选项编号'+(entry.q.searchable?'、搜索 关键词':'')+'，或回复取消。');return true;}
      const indices=[...new Set(raw.trim().split(/[,，]/).map(n=>Number(n.trim())-1))];
      if(indices.some(i=>!entry.q.options[i])||(!entry.q.multiSelect&&indices.length!==1)){await this.say(entry.route,'选项编号无效，请查看当前问题。');return true;}
      entry.finish({indices});return true;
    }
    let answer = raw;
    if (/^\s*\d+(?:\s*[,，]\s*\d+)*\s*$/.test(raw)) {
      const ids = [...new Set(raw.trim().split(/[,，]/).map(n=>Number(n.trim())-1))];
      if(ids.some(i=>!entry.q.options[i])||(!entry.q.multiSelect&&ids.length!==1)){await this.send(userid,'选项编号无效，请重新选择。');return true;}
      answer=ids.map(i=>entry.q.options[i].label).join(', ');
    }
    if(entry.q.fixedOptions && !entry.q.options.some(o=>o.label===answer)){await this.say(entry.route,'请点击选项或回复有效编号。');return true;}
    entry.finish(answer);await this.say(entry.route,entry.q.title ? '选择已提交。' : '回答已提交给 Claude。');return true;
  }
};
