(()=>{
  const cache=new Map();
  const nativeFetch=window.fetch.bind(window);
  const $=id=>document.getElementById(id);
  const fmt=n=>n>=100000?`${Math.round(n/1000)}K`:n>=1000?`${Math.round(n/1000)}K`:String(n);
  async function capability(model){
    if(!model)return null;
    if(cache.has(model))return cache.get(model);
    try{const r=await nativeFetch(`/api/model/${encodeURIComponent(model)}`);if(!r.ok)throw Error();const data=await r.json();cache.set(model,data);return data}catch{return null}
  }
  function current(){return localStorage.getItem('fable-model')||$('settingsModel')?.value||''}
  function apply(cap){
    if(!cap)return;
    const max=Math.max(1,Number(cap.max_output)||4096);
    const saved=Math.min(max,Math.max(256,Number(localStorage.getItem('fable-max-tokens'))||4096));
    const input=$('maxTokens'),range=$('tokenRange'),out=$('tokenValue');
    if(input){input.max=max;input.value=saved}
    if(range){range.max=max;range.value=Math.min(saved,max);range.step=max>=10000?256:1}
    if(out)out.value=saved;
    if($('tokenLimitLabel'))$('tokenLimitLabel').textContent=`up to ${fmt(max)}`;
    if($('tokenScaleMax'))$('tokenScaleMax').textContent=fmt(max);
    const card=$('reasoningSetting'),grid=$('effortGrid');
    if(!card||!grid)return;
    if(cap.reasoning&&Array.isArray(cap.reasoning_levels)&&cap.reasoning_levels.length){
      card.classList.remove('hidden');
      const selected=localStorage.getItem(`fable-reasoning-${cap.id}`)||cap.reasoning_default||cap.reasoning_levels[0];
      grid.innerHTML=cap.reasoning_levels.map(level=>`<button class="effort-btn ${level===selected?'active':''}" data-runtime-effort="${level}">${level.charAt(0).toUpperCase()+level.slice(1)}</button>`).join('');
    }else{card.classList.add('hidden');grid.innerHTML=''}
  }
  async function refresh(){const cap=await capability(current());apply(cap);return cap}
  const originalSetItem=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){originalSetItem.call(this,k,v);if(k==='fable-model')setTimeout(refresh,0)};
  const originalFetch=window.fetch;
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input?.url||'');
    if(init?.method==='POST'&&url.includes('/api/chats/')&&url.endsWith('/messages')&&typeof init.body==='string'){
      try{
        const body=JSON.parse(init.body),model=body.model||current(),cap=await capability(model);
        if(cap){body.max_tokens=Math.min(Number(body.max_tokens)||4096,Number(cap.max_output)||500000);if(cap.reasoning&&cap.reasoning_levels?.length){const effort=localStorage.getItem(`fable-reasoning-${model}`)||cap.reasoning_default||cap.reasoning_levels[0];if(effort)body.reasoning_effort=effort}else delete body.reasoning_effort;init={...init,body:JSON.stringify(body)};
        }
      }catch{}
    }
    return originalFetch(input,init);
  };
  document.addEventListener('click',e=>{const modelBtn=e.target.closest('[data-model]');if(modelBtn)setTimeout(refresh,30);const effort=e.target.closest('[data-runtime-effort]');if(effort){const model=current();localStorage.setItem(`fable-reasoning-${model}`,effort.dataset.runtimeEffort);refresh()}});
  document.addEventListener('change',e=>{if(e.target.id==='settingsModel')setTimeout(refresh,30)});
  let last='';setInterval(()=>{const m=current();if(m&&m!==last){last=m;refresh()}},500);
  window.addEventListener('DOMContentLoaded',()=>setTimeout(refresh,100));
})();
