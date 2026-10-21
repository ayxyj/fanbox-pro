(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.createModelPicker = ({host,initial,defaults,setDefault,remove,protocol,test}) => {
    let selected = structuredClone(initial || []), catalog = [], search = '', revision = 0;
    const results = new Map(), pending = new Set();
    host.innerHTML = '<div class="model-picker-toolbar"><strong>可选模型</strong><input data-search placeholder="搜索模型" aria-label="搜索模型"></div><div class="model-card-grid"></div><div class="model-manual"><input data-add-id placeholder="手动输入模型 ID" aria-label="手动添加模型"><button type="button" data-add>添加模型</button></div><h3>已包含的模型</h3><p class="remote-help">星标设为默认模型；检测会发送一条简短消息，可能产生少量费用。参数修改随主配置一起保存。</p><div class="model-selected-table"></div>';
    const ensure = id => { if(id && !selected.some(m=>m.id===id)){if(selected.length>=100)throw Error('最多选择 100 个模型');selected.push({id});} };
    defaults().ids.forEach(ensure);
    const feedback = message => { host.querySelector('[data-add-id]').setCustomValidity(message);host.querySelector('[data-add-id]').reportValidity(); };
    function draw() {
      const current = defaults().model;
      const shown = catalog.filter(m=>(m.id+' '+(m.name||'')).toLowerCase().includes(search.toLowerCase())).slice(0,200);
      host.querySelector('.model-card-grid').innerHTML = shown.length ? shown.map(m=>`<label class="model-choice ${selected.some(x=>x.id===m.id)?'chosen':''}"><input type="checkbox" data-model="${escape(m.id)}" ${selected.some(x=>x.id===m.id)?'checked':''}><span><strong>${escape(m.name||m.id)}</strong><small>${escape(m.id)}</small></span></label>`).join('') : '<p class="remote-help">获取列表后可勾选模型，也可手动添加。</p>';
      host.querySelector('.model-selected-table').innerHTML = '<table><thead><tr><th>默认 / 模型</th><th>参数</th><th>操作 / 测试结果</th></tr></thead><tbody>'+selected.map((m,i)=>`<tr><td><button type="button" data-default="${i}" aria-label="设为默认模型" title="设为默认模型" class="model-star ${m.id===current?'active':''}">${m.id===current?'★':'☆'}</button><strong>${escape(m.id)}</strong></td><td>${m.contextWindow?escape(m.contextWindow.toLocaleString())+' 上下文':'上下文未设置'}<br><small>${m.maxTokens?'输出 '+m.maxTokens:'输出使用服务默认值'}</small></td><td><div class="remote-actions"><button type="button" data-test="${i}" ${pending.has(m.id)?'disabled':''}>${pending.has(m.id)?'检测中…':'检测'}</button><button type="button" data-config="${i}">配置</button><button type="button" data-remove="${i}" aria-label="移除模型">移除</button></div><span class="model-test-result" role="status">${escape(results.get(m.id)||'')}</span></td></tr>`).join('')+'</tbody></table>';
      host.querySelectorAll('[data-model]').forEach(input=>input.onchange=()=>{
        try {if(input.checked){ensure(input.dataset.model);if(!defaults().model)setDefault(input.dataset.model);}else drop(input.dataset.model);draw();}catch(e){feedback(e.message);draw();}
      });
      host.querySelectorAll('[data-default]').forEach(b=>b.onclick=()=>{setDefault(selected[+b.dataset.default].id);draw();});
      host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{drop(selected[+b.dataset.remove].id);draw();});
      host.querySelectorAll('[data-config]').forEach(b=>b.onclick=()=>configure(selected[+b.dataset.config]));
      host.querySelectorAll('[data-test]').forEach(b=>b.onclick=async()=>{
        const model=structuredClone(selected[+b.dataset.test]),rev=revision;pending.add(model.id);results.delete(model.id);draw();
        try {const r=await test(model);if(rev===revision)results.set(model.id,`连接成功 · ${r.elapsedMs} ms${r.reply?' · '+r.reply:''}`);}
        catch(e){if(rev===revision)results.set(model.id,'检测失败：'+e.message);}
        finally{pending.delete(model.id);if(host.isConnected)draw();}
      });
    }
    function drop(id) { selected=selected.filter(m=>m.id!==id);remove(id,selected[0]?.id||'');results.delete(id); }
    function configure(item) {
      const dialog=document.createElement('dialog');dialog.className='remote-dialog model-parameter-dialog';
      const field=(key,label,min,max,step)=>`<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${item[key]??''}" placeholder="未设置"></label>`;
      dialog.innerHTML=`<header><strong>模型参数</strong>${fanboxUI.closeButton("data-close")}</header><form class="remote-form"><label class="full">模型 ID<input readonly value="${escape(item.id)}"></label>${field('contextWindow','上下文窗口（记录信息）',1000,10000000,1)}${field('maxTokens','最大输出 tokens',1,1000000,1)}${field('temperature','温度（可选）',0,2,.1)}<label>推理强度<select name="reasoningEffort" ${protocol()==='anthropic'?'disabled':''}>${[['','服务默认'],['low','低'],['medium','中'],['high','高']].map(([v,n])=>`<option value="${v}" ${v===item.reasoningEffort?'selected':''}>${n}</option>`).join('')}</select></label><p class="full remote-help">留空沿用现有请求默认值。推理强度仅用于支持 reasoning_effort 的 OpenAI 兼容模型；Anthropic 不发送此参数。上下文窗口仅供记录，不会扩大模型容量。</p><p class="full dialog-error"></p><footer class="remote-actions full"><button type="button" data-cancel>取消</button><button type="submit">应用参数</button></footer></form>`;
      document.body.append(dialog);dialog.showModal();
      dialog.querySelector('[data-close]').onclick=dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      dialog.querySelector('form').onsubmit=e=>{
        e.preventDefault();const form=e.currentTarget,context=Number(form.elements.contextWindow.value),max=Number(form.elements.maxTokens.value);
        if(context && max>context){dialog.querySelector('.dialog-error').textContent='最大输出不能超过上下文窗口';return;}
        for(const key of ['contextWindow','maxTokens','temperature']){const v=form.elements[key].value;if(v==='')delete item[key];else item[key]=Number(v);}
        revision++;item.reasoningEffort=form.elements.reasoningEffort.value;results.delete(item.id);draw();dialog.close();
      };
    }
    host.querySelector('[data-search]').oninput=e=>{search=e.target.value;draw();};
    host.querySelector('[data-add-id]').oninput=()=>feedback('');
    host.querySelector('[data-add]').onclick=()=>{
      const input=host.querySelector('[data-add-id]'),id=input.value.trim();
      if(!id||id.length>512){feedback('请输入有效模型 ID（最多 512 字符）');return;}
      try{ensure(id);if(!defaults().model)setDefault(id);input.value='';draw();}catch(e){feedback(e.message);}
    };
    draw();
    return {
      value:()=>structuredClone(selected),
      catalog(items){catalog=items;draw();},
      sync(){defaults().ids.forEach(ensure);draw();},
      invalidate(){revision++;results.clear();catalog=[];draw();}
    };
  };
})();
