(() => {
  const $ = id => document.getElementById(id);
  const conversation = $('conversation');
  const settings = $('settingsBackdrop');

  function openSettingsSafe() {
    try { window.updateModelControls?.(); } catch (_) {}
    const model = window.currentModel?.();
    const max = $('maxTokens'), range = $('tokenRange'), value = $('tokenValue');
    const prompt = $('systemPrompt'), modelSelect = $('settingsModel');
    if (model) {
      const cap = Math.max(256, Number(model.max_output) || 32768);
      const stored = Number(localStorage.getItem('fable-max-tokens'));
      const n = Number.isFinite(stored) ? Math.min(Math.max(stored, 256), cap) : Math.min(4096, cap);
      if (max) { max.max = cap; max.value = n; }
      if (range) { range.max = cap; range.value = n; }
      if (value) value.value = n;
      if (modelSelect) modelSelect.value = model.id;
    }
    if (prompt) prompt.value = localStorage.getItem('fable-system-prompt') ?? (window.state?.config?.default_system_prompt || '');
    settings?.classList.remove('hidden');
    document.body.classList.add('settings-open');
    $('settingsClose')?.focus();
  }
  function closeSettingsSafe() {
    settings?.classList.add('hidden');
    document.body.classList.remove('settings-open');
  }
  $('settingsBtn')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openSettingsSafe(); }, true);
  $('settingsClose')?.addEventListener('click', closeSettingsSafe, true);
  settings?.addEventListener('click', e => { if (e.target === settings) closeSettingsSafe(); });

  const popover = $('modelPopover'), modelOptions = $('modelOptions'), modelSwitch = $('modelSwitch');
  if (popover && modelOptions && modelSwitch) {
    const search = document.createElement('input');
    search.className = 'model-search'; search.type = 'search'; search.placeholder = 'Search models…';
    search.autocomplete = 'off'; search.setAttribute('aria-label', 'Search models');
    popover.querySelector('.popover-title')?.after(search);
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      modelOptions.querySelectorAll('.model-option').forEach(row => { row.hidden = !!q && !row.textContent.toLowerCase().includes(q); });
    });
    const fitPicker = () => {
      const r = modelSwitch.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
      const maxHeight = Math.max(220, window.innerHeight - r.bottom - 24);
      popover.style.width = `${width}px`;
      popover.style.left = `${left}px`;
      popover.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 180)}px`;
      popover.style.maxHeight = `${maxHeight}px`;
      popover.style.overflow = 'hidden';
      modelOptions.style.maxHeight = `${Math.max(150, maxHeight - 92)}px`;
      modelOptions.style.overflowY = 'auto';
      modelOptions.style.overscrollBehavior = 'contain';
    };
    modelSwitch.addEventListener('click', () => requestAnimationFrame(fitPicker), true);
    window.addEventListener('resize', () => { if (!popover.classList.contains('hidden')) fitPicker(); });
  }

  if (conversation) {
    let follow = true;
    const threshold = 96;
    const atBottom = () => conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= threshold;
    conversation.addEventListener('scroll', () => { follow = atBottom(); }, { passive: true });
    const smartScroll = () => { if (follow) conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'auto' }); };
    window.scrollBottom = smartScroll;
    window.fableForceScroll = () => { follow = true; conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' }); };
    $('composer')?.addEventListener('submit', () => window.fableForceScroll?.(), true);
    $('newChatBtn')?.addEventListener('click', () => { follow = true; }, true);
    const observer = new MutationObserver(() => { if (follow) requestAnimationFrame(smartScroll); });
    observer.observe(conversation, { childList: true, subtree: true, characterData: true });
  }

  const icons = {
    settingsBtn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm8.2 3.6c0-.6-.1-1.2-.2-1.8l1.7-1.3-1.9-3.2-2 .8a8.5 8.5 0 0 0-3.1-1.8L14.4 2h-3.8l-.3 2.7a8.5 8.5 0 0 0-3.1 1.8l-2-.8-1.9 3.2L5 10.2A8 8 0 0 0 4.8 12c0 .6.1 1.2.2 1.8l-1.7 1.3 1.9 3.2 2-.8a8.5 8.5 0 0 0 3.1 1.8l.3 2.7h3.8l.3-2.7a8.5 8.5 0 0 0 3.1-1.8l2 .8 1.9-3.2-1.7-1.3c.1-.6.2-1.2.2-1.8Z"/></svg>',
    topTheme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.7A8.5 8.5 0 0 1 9.3 3.5 8.6 8.6 0 1 0 20.5 14.7Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 13-7-3.5 14-3.1-6.1L5 12Z"/></svg>'
  };
  const settingsIcon = $('settingsBtn');
  if (settingsIcon) { const old = settingsIcon.querySelector('span'); if (old) old.outerHTML = icons.settingsBtn; settingsIcon.classList.add('vector-icon'); }
  const theme = $('topTheme'); if (theme) { theme.innerHTML = icons.topTheme; theme.classList.add('vector-icon'); }
  window.addEventListener('load', () => { const send = $('sendBtn'); if (send && !window.state?.streaming) send.innerHTML = icons.send; });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (settings && !settings.classList.contains('hidden')) closeSettingsSafe();
    popover?.classList.add('hidden');
  });
})();
