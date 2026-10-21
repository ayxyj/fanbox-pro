(function(root) {
  'use strict';
  const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>40)throw Error('名称须为 1–40 个字符');return value.trim();};
  function action(value){
    if(value?.version!==1||!Array.isArray(value.keyframes)||value.keyframes.length<2||value.keyframes.length>60)throw Error('动作须为 version:1，并包含 2–60 个关键帧');
    const duration=Number(value.duration),iterations=Number(value.iterations??1);
    if(!Number.isFinite(duration)||duration<200||duration>15000||!Number.isInteger(iterations)||iterations<1||iterations>3)throw Error('时长须为 200–15000 毫秒，重复次数须为 1–3');
    let last=-1;
    const keyframes=value.keyframes.map(frame=>{
      if(!frame||typeof frame!=='object')throw Error('关键帧格式错误');
      const offset=Number(frame.offset);
      if(!Number.isFinite(offset)||offset<0||offset>1||offset<=last)throw Error('关键帧 offset 必须从 0 到 1 递增');last=offset;
      const result={offset};
      for(const [key,min,max,fallback] of [['x',-25,25,0],['y',-25,25,0],['rotate',-180,180,0],['scale',.6,1.4,1]]){
        const n=frame[key]??fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('关键帧 '+key+' 超出允许范围');result[key]=n;
      }
      return result;
    });
    if(keyframes[0].offset!==0||last!==1)throw Error('首尾关键帧 offset 须为 0 和 1');
    return {version:1,name:name(value.name),duration,iterations,keyframes};
  }
  function skin(value){
    if(value?.version!==1)throw Error('皮肤版本须为 1');
    const result={version:1,name:name(value.name)};
    for(const key of ['fur','outline','muzzle']){
      if(!/^#[a-f0-9]{6}$/i.test(value[key]||''))throw Error('配色须使用 #RRGGBB：'+key);
      result[key]=value[key];
    }
    return result;
  }
  const api={action,skin};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.fanboxPetExtensions=api;
})(globalThis);
