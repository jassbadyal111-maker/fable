(() => {
  const $=id=>document.getElementById(id), conversation=$('conversation'), settings=$('settingsBackdrop');

  async function openSettingsSafe(){
    const app=window.fableState, id=localStorage.getItem('fable-model')||app?.config?.default_model||'';
    const model=app?.config?.models?.find(m=>m.id===id);
    try{if(id){const r=await fetch(`/api/model/${encodeURIComponent(id)}`,{headers:{Accept:'application/json'}});if(r.ok){const cap=await r.json();if(model)Object.assign(model,cap)}}}catch{}
    try{window.updateModelControls?.()}catch{}
    const max=$('maxTokens'),range=$('tokenRange'),value=$('tokenValue'),select=$('settingsModel'),prompt=$('systemPrompt');
    const active=app?.config?.models?.find(m=>m.id===id)||model;
    if(active){const cap=Math.max(256,Number(active.max_output)||Number(max?.max)||32768),stored=Number(localStorage.getItem('fable-max-tokens')),n=Number.isFinite(stored)?Math.min(Math.max(stored,256),cap):Math.min(4096,cap);if(max){max.max=cap;max.value=n}if(range){range.max=cap;range.value=n;range.step=cap>=10000?256:1}if(value)value.value=n;if(select)select.value=active.id}
    if(prompt)prompt.value=localStorage.getItem('fable-system-prompt')??(app?.config?.default_system_prompt||'');
    settings?.classList.remove('hidden');document.body.classList.add('settings-open');$('settingsClose')?.focus();
  }
  function closeSettingsSafe(){settings?.classList.add('hidden');document.body.classList.remove('settings-open')}
  $('settingsBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openSettingsSafe()},true);
  $('settingsClose')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();closeSettingsSafe()},true);
  settings?.addEventListener('click',e=>{if(e.target===settings)closeSettingsSafe()});

  const popover=$('modelPopover'),options=$('modelOptions'),switcher=$('modelSwitch');
  if(popover&&options&&switcher){
    let search=popover.querySelector('.model-search');
    if(!search){search=document.createElement('input');search.className='model-search';search.type='search';search.placeholder='Search models…';search.autocomplete='off';search.setAttribute('aria-label','Search models');popover.querySelector('.popover-title')?.after(search)}
    search.oninput=()=>{const q=search.value.trim().toLowerCase();options.querySelectorAll('.model-option').forEach(row=>row.hidden=!!q&&!row.textContent.toLowerCase().includes(q))};
    const fit=()=>{const r=switcher.getBoundingClientRect(),w=Math.min(360,innerWidth-24),left=Math.min(Math.max(12,r.left),innerWidth-w-12),h=Math.max(220,innerHeight-r.bottom-24);popover.style.width=`${w}px`;popover.style.left=`${left}px`;popover.style.top=`${Math.min(r.bottom+8,innerHeight-180)}px`;popover.style.maxHeight=`${h}px`;popover.style.overflow='hidden';options.style.maxHeight=`${Math.max(150,h-92)}px`;options.style.overflowY='auto';options.style.overscrollBehavior='contain'};
    switcher.addEventListener('click',()=>requestAnimationFrame(fit),true);addEventListener('resize',()=>{if(!popover.classList.contains('hidden'))fit()});
  }

  if(conversation){
    let follow=true,programmatic=false,lastUserScroll=0;const threshold=120;
    const distance=()=>conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight;
    const atBottom=()=>distance()<=threshold;
    const jump=()=>{if(!follow)return;programmatic=true;conversation.scrollTop=conversation.scrollHeight;requestAnimationFrame(()=>{programmatic=false})};
    const force=()=>{follow=true;programmatic=true;conversation.scrollTop=conversation.scrollHeight;requestAnimationFrame(()=>{programmatic=false})};
    conversation.addEventListener('scroll',()=>{if(programmatic)return;const now=performance.now();if(now-lastUserScroll<24)return;lastUserScroll=now;follow=atBottom()},{passive:true});
    window.scrollBottom=jump;window.fableForceScroll=force;$('composer')?.addEventListener('submit',force,true);$('newChatBtn')?.addEventListener('click',()=>follow=true,true);
    let raf=0;const tick=()=>{if(follow)jump();raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);
    const observer=new MutationObserver(()=>{if(follow)jump()});observer.observe(conversation,{childList:true,subtree:true,characterData:true});
    if('ResizeObserver'in window){const ro=new ResizeObserver(()=>{if(follow)jump()});ro.observe(conversation);window.fableChatResizeObserver=ro}
    addEventListener('beforeunload',()=>cancelAnimationFrame(raf));
  }

  const theme=$('topTheme');if(theme){theme.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.7A8.5 8.5 0 0 1 9.3 3.5 8.6 8.6 0 1 0 20.5 14.7Z"/></svg>';theme.classList.add('vector-icon')}
  const settingsIcon=$('settingsBtn');if(settingsIcon){const old=settingsIcon.querySelector('span');if(old)old.outerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm8.2 3.6c0-.6-.1-1.2-.2-1.8l1.7-1.3-1.9-3.2-2 .8a8.5 8.5 0 0 0-3.1-1.8L14.4 2h-3.8l-.3 2.7a8.5 8.5 0 0 0-3.1 1.8l-2-.8-1.9 3.2L5 10.2A8 8 0 0 0 4.8 12c0 .6.1 1.2.2 1.8l-1.7 1.3 1.9 3.2 2-.8a8.5 8.5 0 0 0 3.1 1.8l.3 2.7a8.5 8.5 0 0 0 3.8 0l.3-2.7a8.5 8.5 0 0 0 3.1-1.8l2 .8 1.9 3.2-2 .8a8.5 8.5 0 0 0 3.1-1.8l2 .8 1.9-3.2-1.7-1.3c.1-.6.2-1.2.2-1.8Z"/></svg>';settingsIcon.classList.add('vector-icon')}
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(settings&&!settings.classList.contains('hidden'))closeSettingsSafe();popover?.classList.add('hidden');document.querySelector('.chat-action-menu')?.remove()});

  // Reasoning UI is intentionally removed from the product surface.
  const removeReasoningUI=()=>document.querySelectorAll('#reasoningSetting,.reasoning-box,.composer-reasoning,.reasoning-disclaimer,.reasoning-live').forEach(el=>el.remove());
  removeReasoningUI();

  // Keep the three-dot typing indicator only until the first real output token appears.
  const stopTypingWhenOutputStarts=()=>{
    if(!conversation)return;
    conversation.querySelectorAll('.message.assistant').forEach(message=>{
      const answer=message.querySelector('.answer-body');
      const typing=message.querySelector('.typing');
      if(answer&&typing&&answer.textContent.trim())typing.remove();
    });
  };
  const outputObserver=new MutationObserver(stopTypingWhenOutputStarts);
  outputObserver.observe(conversation,{childList:true,subtree:true,characterData:true});
  stopTypingWhenOutputStarts();
})();
