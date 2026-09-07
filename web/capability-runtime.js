(()=>{
  const cache=new Map();
  const nativeFetch=window.fetch.bind(window);
  const $=id=>document.getElementById(id);
  const fmt=n=>n>=1000000?`${Math.round(n/1000000)}M`:n>=100000?`${Math.round(n/1000)}K`:n>=1000?`${Math.round(n/1000)}K`:String(n);
  const known={
    'claude-fable-5':{max_output:128000},
    'claude-fable-5.1':{max_output:128000}
  };
  function mergeKnown(model,cap){const k=known[model]||{};return cap?{...k,...cap,max_output:Number(cap.max_output||0)<8192&&k.max_output?k.max_output:(cap.max_output||k.max_output)}:k}
  async function capability(model){if(!model)return null;if(cache.has(model))return cache.get(model);try{const r=await nativeFetch(`/api/model/${encodeURIComponent(model)}`);if(!r.ok)throw Error();const data=mergeKnown(model,await r.json());cache.set(model,data);return data}catch{const fallback=known[model]||null;if(fallback)cache.set(model,fallback);return fallback}}
  function current(){return localStorage.getItem('fable-model')||$('settingsModel')?.value||''}
  function updateScale(max){const spans=document.querySelectorAll('.token-scale span');if(spans.length<2)return;const values=[256,1024,4096,16384,32768,max].map(v=>Math.min(v,max));spans.forEach((el,i)=>el.textContent=fmt(values[Math.min(i,values.length-1)]))}
  function apply(cap){if(!cap)return;const max=Math.max(256,Number(cap.max_output)||4096);const saved=Math.min(max,Math.max(256,Number(localStorage.getItem('fable-max-tokens'))||4096));const input=$('maxTokens'),range=$('tokenRange'),out=$('tokenValue');if(input){input.max=max;input.value=saved}if(range){range.max=max;range.value=saved;range.step=max>=10000?256:1}if(out)out.value=saved;if($('tokenLimitLabel'))$('tokenLimitLabel').textContent=`up to ${fmt(max)}`;updateScale(max);$('reasoningSetting')?.classList.add('hidden');$('composerReasoningWrap')?.classList.add('hidden')}
  async function refresh(){const cap=await capability(current());apply(cap);return cap}
  const originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){originalSetItem.call(this,k,v);if(k==='fable-model')setTimeout(refresh,0)};
  window.fetch=async function(input,init={}){const url=typeof input==='string'?input:(input?.url||'');if(init?.method==='POST'&&url.includes('/api/chats/')&&url.endsWith('/messages')&&typeof init.body==='string'){try{const body=JSON.parse(init.body);delete body.reasoning_effort;const model=body.model||current(),cap=await capability(model);if(cap){const desired=Number(localStorage.getItem('fable-max-tokens'))||Number(body.max_tokens)||4096;body.max_tokens=Math.min(Math.max(1,desired),Number(cap.max_output)||500000);init={...init,body:JSON.stringify(body)}}}catch{}}return originalFetch(input,init)};
  document.addEventListener('change',e=>{if(e.target.id==='settingsModel')setTimeout(refresh,30)});
  let last='';setInterval(()=>{const m=current();if(m&&m!==last){last=m;refresh()}},1000);
  window.addEventListener('DOMContentLoaded',()=>setTimeout(refresh,100));
})();
