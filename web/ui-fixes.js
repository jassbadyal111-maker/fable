window.addEventListener('DOMContentLoaded',()=>{
  const $=id=>document.getElementById(id);
  const max=$('maxTokens'),range=$('tokenRange'),value=$('tokenValue'),settings=$('settingsBackdrop');
  if(max&&range){
    const persist=()=>{
      const cap=Number(max.max)||500000;
      const n=Math.max(1,Math.min(cap,Number(max.value)||256));
      localStorage.setItem('fable-max-tokens',String(n));
      max.value=n; range.value=Math.min(Number(range.max)||cap,n); if(value)value.value=n;
    };
    max.addEventListener('change',persist);
    range.addEventListener('change',persist);
  }
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    document.querySelectorAll('.model-popover:not(.hidden)').forEach(x=>x.classList.add('hidden'));
    if(settings&&!settings.classList.contains('hidden'))settings.classList.add('hidden');
    const sidebar=$('sidebar'),backdrop=$('drawerBackdrop');
    if(sidebar?.classList.contains('open')){sidebar.classList.remove('open');backdrop?.classList.remove('show')}
  });
});
