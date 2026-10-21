'use strict';
function modelSettings(items) {
  if (!Array.isArray(items) || items.length > 100) throw Error('最多保存 100 个模型');
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 512 || seen.has(item.id.trim())) throw Error('模型 ID 为空、重复或过长');
    const result = {id:item.id.trim()}; seen.add(result.id);
    for (const [key,min,max] of [['contextWindow',1000,10000000],['maxTokens',1,1000000],['temperature',0,2]]) {
      if (item[key] === '' || item[key] == null) continue;
      const n = Number(item[key]);
      if (!Number.isFinite(n) || n < min || n > max || (key !== 'temperature' && !Number.isInteger(n))) throw Error('模型参数无效：' + key);
      result[key] = n;
    }
    if (result.contextWindow && result.maxTokens > result.contextWindow) throw Error('最大输出不能超过上下文窗口');
    if (item.reasoningEffort) {
      if (!['low','medium','high'].includes(item.reasoningEffort)) throw Error('推理强度无效');
      result.reasoningEffort = item.reasoningEffort;
    }
    return result;
  });
}
async function testModel(config, model) {
  const selectedModels = modelSettings([model]);
  const started = Date.now();
  const result = await require('./model-api').requestModel({...config,model:model.id,selectedModels},
    [{role:'user',content:'Reply with OK only.'}], [], new AbortController().signal);
  return {ok:true,elapsedMs:Date.now()-started,reply:String(result.content || '').slice(0,300)};
}
module.exports = { modelSettings, testModel };
