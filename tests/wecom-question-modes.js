const assert = require('assert/strict');
const questions = require('../electron/wecom-questions');
(async () => {
  const route = {userid:'u',number:1,project:'test'};
  const service = {...questions, valid:()=>true, say:async()=>{}, send:async()=>{}};
  for (const separator of [' ', ',', '，', '、']) {
    let answer;
    service.questions = new Map([['test', {userid:'u',route,q:{nativeMenu:true,multiSelect:true,options:[{label:'A'},{label:'B'},{label:'C'}]},finish:value=>answer=value}]]);
    await service.answerQuestionText('u', route, `1${separator}3`);
    assert.deepEqual(answer,{indices:[0,2]});
  }
  const entry = {token:'test',route,q:{question:'Choose',fixedOptions:true,multiSelect:true,options:[{label:'A'}]},selected:new Set()};
  assert(service.questionCard(entry).button_list.some(b=>b.text==='提交选择'));
  entry.q = {nativeMenu:true,nativeText:true,title:'Input',question:'Describe',options:[]};entry.page=0;
  assert(service.questionCard(entry).button_list.some(b=>b.text==='填写回答'));
  console.log('PASS multi-select separators, fixed-option submit, text answer entry');
})().catch(error=>{console.error(error);process.exitCode=1;});
