const state = { chats: [], activeChat: null, streaming: false, controller: null, config: null };
const $ = (id) => document.getElementById(id);

const chatList = $("chatList"), conversation = $("conversation"), input = $("input"), sendBtn = $("sendBtn");

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

function highlight(code, lang) {
  let out = esc(code);
  out = out.replace(/(&quot;.*?&quot;|&#039;.*?&#039;|&quot;[^\n]*?&quot;)/g, '<span class="tok-string">$1</span>');
  const keywordSets = {
    python: /\b(def|class|import|from|return|if|elif|else|for|while|in|is|and|or|not|True|False|None|try|except|with|as|async|await|yield|raise|lambda)\b/g,
    js: /\b(const|let|var|function|return|if|else|for|while|new|class|extends|import|from|export|async|await|try|catch|throw|true|false|null|undefined)\b/g,
    javascript: /\b(const|let|var|function|return|if|else|for|while|new|class|extends|import|from|export|async|await|try|catch|throw|true|false|null|undefined)\b/g,
    json: /(&quot;[^&]+?&quot;)(?=\s*:)/g,
    html: /(&lt;\/?[a-zA-Z][^&]*?&gt;)/g,
    css: /\b(display|position|color|background|margin|padding|width|height|flex|grid)\b/g
  };
  const re = keywordSets[(lang || '').toLowerCase()];
  if (re) out = out.replace(re, '<span class="tok-keyword">$1</span>');
  out = out.replace(/(^|\n)(\s*[#\/\/].*)/g, '$1<span class="tok-comment">$2</span>');
  return out;
}

function markdown(text) {
  const blocks = [];
  let source = String(text || '').replace(/\r\n/g, '\n');
  source = source.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const id = blocks.length;
    blocks.push(`<div class="code-wrap"><div class="code-head"><span>${esc(lang || 'code')}</span><button class="copy-code" data-code="${encodeURIComponent(code)}">Copy</button></div><pre><code>${highlight(code, lang)}</code></pre></div>`);
    return `\n@@CODE${id}@@\n`;
  });
  source = esc(source);
  source = source.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
  source = source.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  source = source.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  source = source.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  source = source.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  source = source.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  source = source.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  source = source.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  source = source.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  source = source.split(/\n{2,}/).map(part => {
    if (/^<(h[1-3]|ul|blockquote|div)/.test(part.trim())) return part;
    return part.trim() ? `<p>${part.replace(/\n/g, '<br>')}</p>` : '';
  }).join('');
  source = source.replace(/@@CODE(\d+)@@/g, (_, i) => blocks[Number(i)]);
  return source;
}

function scrollBottom() { conversation.scrollTop = conversation.scrollHeight; }

function renderSidebar() {
  chatList.innerHTML = state.chats.length ? state.chats.map(c => `
    <div class="chat-row ${c.id === state.activeChat ? 'active' : ''}" data-id="${c.id}">
      <span class="chat-title">${esc(c.title)}</span>
      <button class="chat-menu" data-menu="${c.id}" aria-label="Chat actions">•••</button>
    </div>`).join('') : '<div style="color:var(--muted);font-size:13px;padding:8px">No chats yet</div>';
}

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadConfig() {
  state.config = await api('/api/config');
  $('modelSelect').innerHTML = state.config.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('modelSelect').value = state.config.default_model;
  $('modelLabel').textContent = state.config.default_model;
}

async function loadChats() {
  state.chats = await api('/api/chats');
  renderSidebar();
  if (!state.activeChat && state.chats[0]) await openChat(state.chats[0].id);
}

function clearConversation() {
  conversation.innerHTML = `<div class="welcome" id="welcome"><div class="welcome-mark">F</div><h1>How can I help?</h1><p>Ask anything. Your chats stay available in this browser.</p></div>`;
}

async function openChat(id) {
  const data = await api(`/api/chats/${id}`);
  state.activeChat = id;
  renderSidebar();
  conversation.innerHTML = '';
  for (const m of data.messages) appendMessage(m.role, m.content);
  if (!data.messages.length) clearConversation();
  $('modelSelect').value = data.chat.model;
  $('modelLabel').textContent = data.chat.model;
  $('sidebar').classList.remove('open');
  scrollBottom();
}

function appendMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  if (role === 'user') wrap.innerHTML = `<div class="bubble">${esc(content)}</div>`;
  else wrap.innerHTML = `<div class="assistant-content">${markdown(content)}</div>`;
  conversation.appendChild(wrap);
  wrap.querySelectorAll('.copy-code').forEach(btn => btn.onclick = async () => { await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code)); btn.textContent = 'Copied'; setTimeout(() => btn.textContent = 'Copy', 1200); });
  return wrap;
}

function addStreamingMessage() {
  const wrap = document.createElement('div');
  wrap.className = 'message assistant';
  wrap.innerHTML = `<div class="assistant-content"><span class="typing"><i></i><i></i><i></i></span></div>`;
  conversation.appendChild(wrap);
  return wrap;
}

function setStreaming(on) {
  state.streaming = on;
  if (on) {
    sendBtn.innerHTML = '<span class="stop-icon">■</span>';
    sendBtn.setAttribute('aria-label', 'Stop generating');
  } else {
    sendBtn.innerHTML = '<span>↑</span>';
    sendBtn.setAttribute('aria-label', 'Send');
  }
  input.disabled = false;
}

async function sendMessage(e) {
  if (e) e.preventDefault();
  if (state.streaming) { state.controller?.abort(); return; }
  const text = input.value.trim();
  if (!text) return;
  if (!state.activeChat) {
    const c = await api('/api/chats', { method: 'POST', body: JSON.stringify({ model: $('modelSelect').value }) });
    state.activeChat = c.id;
    state.chats.unshift(c);
    renderSidebar();
  }
  const welcome = $('welcome'); if (welcome) welcome.remove();
  appendMessage('user', text);
  input.value = ''; resizeInput(); scrollBottom();
  const assistant = addStreamingMessage();
  const contentEl = assistant.querySelector('.assistant-content');
  let answer = '';
  setStreaming(true);
  state.controller = new AbortController();
  try {
    const res = await fetch(`/api/chats/${state.activeChat}/messages`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, signal: state.controller.signal,
      body: JSON.stringify({ content: text, model: $('modelSelect').value })
    });
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});
      const events = buffer.split('\n\n'); buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find(x => x.startsWith('data: '));
        if (!line) continue;
        const data = JSON.parse(line.slice(6));
        if (data.type === 'token') { answer += data.text; contentEl.innerHTML = markdown(answer); scrollBottom(); }
        if (data.type === 'error') throw new Error(data.message);
      }
    }
    contentEl.innerHTML = markdown(answer || '');
    contentEl.querySelectorAll('.copy-code').forEach(btn => btn.onclick = async () => { await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code)); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1200); });
    await loadChats();
  } catch (err) {
    if (err.name !== 'AbortError') contentEl.innerHTML = `<p style="color:#c62828">Error: ${esc(err.message)}</p>`;
  } finally {
    setStreaming(false); state.controller = null; scrollBottom();
  }
}

function resizeInput() { input.style.height='auto'; input.style.height = Math.min(input.scrollHeight,180) + 'px'; }

async function createNewChat() {
  if (state.streaming) return;
  const c = await api('/api/chats', {method:'POST', body:JSON.stringify({model:$('modelSelect').value})});
  state.chats.unshift(c); state.activeChat = c.id; renderSidebar(); clearConversation();
}

let pendingDelete = null;
function confirmDelete(id) {
  pendingDelete = id; $('modalBackdrop').classList.remove('hidden');
}
function closeModal() { pendingDelete=null; $('modalBackdrop').classList.add('hidden'); }

async function deleteChat() {
  if (!pendingDelete) return;
  const id = pendingDelete; closeModal();
  await api(`/api/chats/${id}`, {method:'DELETE'});
  if (state.activeChat === id) { state.activeChat = null; clearConversation(); }
  await loadChats();
}

async function renameChat(id) {
  const chat = state.chats.find(c => c.id === id); if (!chat) return;
  const title = prompt('Rename chat', chat.title);
  if (title === null) return;
  await api(`/api/chats/${id}`, {method:'PATCH', body:JSON.stringify({title})});
  await loadChats();
}

chatList.addEventListener('click', async e => {
  const menu = e.target.closest('[data-menu]');
  if (menu) { e.stopPropagation(); const id=menu.dataset.menu; const action=prompt('Type rename or delete'); if(action?.toLowerCase()==='rename') await renameChat(id); else if(action?.toLowerCase()==='delete') confirmDelete(id); return; }
  const row = e.target.closest('.chat-row'); if (row) await openChat(row.dataset.id);
});

$('newChatBtn').onclick = createNewChat;
$('composer').onsubmit = sendMessage;
input.addEventListener('input', resizeInput);
input.addEventListener('keydown', e => { if(e.key==='Enter' && !e.shiftKey){e.preventDefault(); sendMessage();} });
$('openSidebar').onclick=()=> $('sidebar').classList.add('open');
$('closeSidebar').onclick=()=> $('sidebar').classList.remove('open');
$('modalCancel').onclick=closeModal; $('modalConfirm').onclick=deleteChat;
$('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};

function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('fable-theme', dark ? 'dark' : 'light');
  $('themeIcon').textContent = dark ? '☀' : '☾'; $('themeText').textContent = dark ? 'Light mode' : 'Dark mode'; $('topTheme').textContent = dark ? '☀' : '☾';
}
function toggleTheme(){setTheme(!document.documentElement.classList.contains('dark'))}
$('themeBtn').onclick=toggleTheme; $('topTheme').onclick=toggleTheme;
$('modelSelect').onchange=()=>{$('modelLabel').textContent=$('modelSelect').value}; $('modelSwitch').onclick=()=>{$('modelSelect').focus();$('modelSelect').click()};

if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
setTheme(localStorage.getItem('fable-theme') === 'dark');
(async()=>{try{await loadConfig();await loadChats();}catch(e){conversation.innerHTML=`<div class="welcome"><h1>Fable failed to start</h1><p>${esc(e.message)}</p></div>`;}})();
