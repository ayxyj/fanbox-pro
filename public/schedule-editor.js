'use strict';
const scheduleEditor = {
  fromTrigger(trigger = {}) { return trigger.type === 'interval' ? {type:'every', minutes:Number(trigger.sec)/60} : {...trigger}; },
  toTrigger(schedule) { return schedule.type === 'every' ? {type:'interval',sec:Number(schedule.minutes)*60} : {...schedule}; },
  label(schedule) { return cronPanel.schedLabel(schedule); },
  mount(root, initial = {}, onChange = () => {}, mode = 'terminal') {
    const p=String(initial.expr || '').trim().split(/\s+/), pad=n=>String(n).padStart(2,'0');
    const time=p.length===5 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) ? pad(p[1])+':'+pad(p[0]) : '09:00';
    let preset=initial.type==='at'?'once':initial.type==='every'?'every':'cron';
    if(!initial.type) preset='daily';
    else if(initial.type==='cron') { if(p[2]==='*'&&p[3]==='*'&&/^\d+$/.test(p[0])) { if(p[1]==='*'&&p[4]==='*')preset='hourly'; else if(/^\d+$/.test(p[1]))preset=p[4]==='*'?'daily':/^\d$/.test(p[4])?'weekly':'cron'; } }
    root.innerHTML='<div class="cron-grid"><label class="cron-fl">什么时候<select class="input-field" data-schedule="preset">'+[['daily','每天'],['weekly','每周'],['hourly','每小时'],['every','每隔一段时间'],['once','某个时间点，一次'],['cron','cron 表达式']].map(([v,l])=>'<option value="'+v+'"'+(v===preset?' selected':'')+'>'+l+'</option>').join('')+'</select></label><div class="cron-fl" data-schedule="fields"></div></div><div class="cron-preview schedule-preview"></div>';
    const fields=root.querySelector('[data-schedule="fields"]'), select=root.querySelector('[data-schedule="preset"]');
    const input=(key,type,value,attrs='')=>'<input class="input-field" data-schedule="'+key+'" type="'+type+'" value="'+escapeHtml(String(value))+'" '+attrs+'>';
    const get=key=>root.querySelector('[data-schedule="'+key+'"]')?.value;
    function build() {
      const pr=get('preset'), [h,m]=(get('time')||'09:00').split(':').map(Number);
      if(pr==='daily')return {type:'cron',expr:m+' '+h+' * * *'};
      if(pr==='weekly')return {type:'cron',expr:m+' '+h+' * * '+get('dow')};
      if(pr==='hourly')return {type:'cron',expr:get('minute')+' * * * *'};
      if(pr==='every')return {type:'every',minutes:Number(get('number'))*Number(get('unit'))};
      if(pr==='once')return {type:'at',time:get('at')};
      return {type:'cron',expr:get('expr')};
    }
    let timer, revision=0;
    function preview() {
      onChange(build());clearTimeout(timer);const rev=++revision;
      timer=setTimeout(async()=>{let result;try { if(mode==='git'){const r=await apiPost('/api/gs/task/preview',{trigger:scheduleEditor.toTrigger(build()),enabled:true});result=r.error||!r.nextRun?{ok:false,error:r.error||'时间规则无法解析或时间点已过期'}:{ok:true,times:r.times||[]};}else result=await apiPost('/api/cron/preview',{schedule:build()}); }catch {result=null;}if(rev!==revision||!root.isConnected)return;
        const el=root.querySelector('.schedule-preview');
        el.innerHTML=result?.ok ? '<strong>接下来 '+result.times.length+' 次运行时间</strong><ol>'+result.times.map(t=>'<li>'+escapeHtml(new Date(t).toLocaleString())+'</li>').join('')+'</ol>' : '<span class="bad-t">'+escapeHtml(result?.error||'无法解析时间规则')+'</span>';
      },250);
    }
    function renderFields() {
      const pr=get('preset');
      if(pr==='daily')fields.innerHTML=input('time','time',time);
      else if(pr==='weekly')fields.innerHTML='<span class="cron-inline"><select class="input-field" data-schedule="dow">'+['日','一','二','三','四','五','六'].map((d,i)=>'<option value="'+i+'"'+(p[4]==i?' selected':'')+'>周'+d+'</option>').join('')+'</select>'+input('time','time',time)+'</span>';
      else if(pr==='hourly')fields.innerHTML='<span class="cron-inline">第 '+input('minute','number',/^\d+$/.test(p[0])?p[0]:0,'min="0" max="59" style="width:80px"')+' 分钟</span>';
      else if(pr==='every'){const m=Number(initial.minutes)||120,seconds=m<1;fields.innerHTML='<span class="cron-inline">每 '+input('number','number',seconds?m*60:m%60===0?m/60:m,'min="1" style="width:90px"')+'<select class="input-field" data-schedule="unit"><option value="60"'+(!seconds&&m%60===0?' selected':'')+'>小时</option><option value="1"'+(!seconds&&m%60!==0?' selected':'')+'>分钟</option>'+ (seconds?'<option value="0.016666666666666666" selected>秒（已有配置）</option>':'') +'</select></span>';}
      else if(pr==='once'){let date='';if(initial.time){const d=new Date(initial.time);if(Number.isFinite(d.getTime()))date=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());}fields.innerHTML=input('at','datetime-local',date);}
      else fields.innerHTML=input('expr','text',initial.expr||'0 9 * * *','placeholder="分 时 日 月 周"');
      fields.querySelectorAll('input,select').forEach(el=>{el.oninput=preview;el.onchange=preview;});preview();
    }
    select.onchange=renderFields;renderFields();return {get:build};
  }
};
