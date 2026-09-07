(()=>{
  const $=id=>document.getElementById(id),conversation=$('conversation');
  if(conversation){
    let follow=true,scheduled=false,userScrollAt=0;
    const distance=()=>conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight;
    const atBottom=()=>distance()<=120;
    const scrollNow=()=>{scheduled=false;if(!follow)return;conversation.scrollTop=conversation.scrollHeight};
    const schedule=()=>{if(!follow||scheduled)return;scheduled=true;requestAnimationFrame(scrollNow)};
    const force=()=>{follow=true;scrollNow()};
    conversation.addEventListener('scroll',()=>{const now=performance.now();if(now-userScrollAt<30)return;userScrollAt=now;follow=atBottom()},{passive:true});
    window.scrollBottom=schedule;window.fableForceScroll=force;
    $('composer')?.addEventListener('submit',()=>force(),true);$('newChatBtn')?.addEventListener('click',()=>{follow=true;schedule()},true);
    const observer=new MutationObserver(records=>{for(const r of records){r.addedNodes?.forEach(n=>{if(n.nodeType!==1)return;n.querySelectorAll?.('.reasoning-box').forEach(x=>x.remove());const body=n.matches?.('.answer-body')?n:n.querySelector?.('.answer-body');if(body&&body.textContent.trim())n.closest?.('.message')?.querySelector('.typing')?.remove()});if(r.type==='characterData'&&r.target.parentElement?.closest('.answer-body'))r.target.closest('.message')?.querySelector('.typing')?.remove()}schedule()});observer.observe(conversation,{childList:true,subtree:true,characterData:true});
    if('ResizeObserver'in window){const ro=new ResizeObserver(()=>schedule());ro.observe(conversation);window.fableChatResizeObserver=ro}
  }
  const popover=$('modelPopover'),options=$('modelOptions'),switcher=$('modelSwitch');
  if(popover&&options&&switcher){let search=popover.querySelector('.model-search');if(!search){search=document.createElement('input');search.className='model-search';search.type='search';search.placeholder='Search models…';search.autocomplete='off';search.setAttribute('aria-label','Search models');popover.querySelector('.popover-title')?.after(search)}search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();options.querySelectorAll('.model-option').forEach(row=>row.hidden=!!q&&!row.textContent.toLowerCase().includes(q))});const fit=()=>{const r=switcher.getBoundingClientRect(),w=Math.min(360,innerWidth-24),left=Math.min(Math.max(12,r.left),innerWidth-w-12),h=Math.max(220,innerHeight-r.bottom-24);popover.style.width=`${w}px`;popover.style.left=`${left}px`;popover.style.top=`${Math.min(r.bottom+8,innerHeight-180)}px`;popover.style.maxHeight=`${h}px`;popover.style.overflow='hidden';options.style.maxHeight=`${Math.max(150,h-92)}px`;options.style.overflowY='auto';options.style.overscrollBehavior='contain'};switcher.addEventListener('click',()=>requestAnimationFrame(fit),true);addEventListener('resize',()=>{if(!popover.classList.contains('hidden'))fit()})}
  const settings=$('settingsBackdrop');settings?.addEventListener('click',e=>{if(e.target===settings)settings.classList.add('hidden')});
  const theme=$('topTheme');if(theme){theme.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.7A8.5 8.5 0 0 1 9.3 3.5 8.6 8.6 0 1 0 20.5 14.7Z"/></svg>';theme.classList.add('vector-icon')}
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;settings?.classList.add('hidden');popover?.classList.add('hidden');document.querySelector('.chat-action-menu')?.remove()});
  const removeReasoningUI=()=>document.querySelectorAll('#reasoningSetting,.reasoning-box,.composer-reasoning,.reasoning-disclaimer,.reasoning-live').forEach(el=>el.remove());
  removeReasoningUI();
  const stopTypingWhenOutputStarts=()=>conversation?.querySelectorAll('.message.assistant').forEach(message=>{const answer=message.querySelector('.answer-body'),typing=message.querySelector('.typing');if(answer&&typing&&answer.textContent.trim())typing.remove()});
  const outputObserver=new MutationObserver(stopTypingWhenOutputStarts);if(conversation)outputObserver.observe(conversation,{childList:true,subtree:true,characterData:true});stopTypingWhenOutputStarts();
})();
