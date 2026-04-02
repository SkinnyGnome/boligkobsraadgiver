/**
 * app.js – Main application logic
 *
 * Handles:
 *   - Rendering the settings modal
 *   - Conversation management (create, load, delete)
 *   - Sending messages and displaying responses
 *   - Markdown-lite formatting for AI responses
 */

/* -------------------------------------------------------
   Constants
   ------------------------------------------------------- */

const SYSTEM_PROMPT = `Du er en erfaren og venlig dansk køberrådgiver med speciale i boligkøb i Danmark.
Din rolle er at hjælpe brugeren med alle aspekter af boligkøb, herunder:

- Gennemgang og forklaring af tilstandsrapporter, elinstallationsrapporter og energimærker
- Forståelse af servitutter, lokalplaner og deklarationer
- Vurdering af pris og markedsværdi
- Forklaringer om boligkøbsprocessen og juridiske trin (budgivning, betinget skøde, tinglysning m.v.)
- Finansiering, realkreditlån og bankfinansiering
- Udgiftsberegning (tinglysningsafgift, renter, ejerudgifter, vedligeholdelse m.v.)
- Identifikation af røde flag og potentielle faldgruber
- Rådgivning om besigtigelse og hvad man bør tjekke

Svar altid på dansk. Vær konkret, præcis og pædagogisk.
Når du forklarer tal eller beregninger, brug gerne konkrete eksempler.
Understreg altid, at du er AI-rådgiver, og at brugeren ved vigtige beslutninger bør konsultere en autoriseret ejendomsmægler, advokat eller byggesagkyndig.`;

/* -------------------------------------------------------
   State
   ------------------------------------------------------- */

let activeConversationId = null;
let isLoading = false;

/* -------------------------------------------------------
   DOM helpers
   ------------------------------------------------------- */

const $ = id => document.getElementById(id);

function showToast(message, type = 'info', duration = 3000) {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = type;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

/* -------------------------------------------------------
   Markdown-lite renderer
   Converts a subset of Markdown to safe HTML for chat bubbles.
   ------------------------------------------------------- */

function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic *text* or _text_
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

  // Inline code `code`
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // Process line by line for headings and lists
  const lines = html.split('\n');
  const result = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headings
    if (/^### (.+)/.test(line)) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(`<strong>${line.replace(/^### /, '')}</strong>`);
      continue;
    }
    if (/^## (.+)/.test(line)) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(`<strong>${line.replace(/^## /, '')}</strong>`);
      continue;
    }
    if (/^# (.+)/.test(line)) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(`<strong>${line.replace(/^# /, '')}</strong>`);
      continue;
    }

    // Unordered list
    if (/^[-*] (.+)/.test(line)) {
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (!inUl) { result.push('<ul>'); inUl = true; }
      result.push(`<li>${line.replace(/^[-*] /, '')}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. (.+)/.test(line)) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (!inOl) { result.push('<ol>'); inOl = true; }
      result.push(`<li>${line.replace(/^\d+\. /, '')}</li>`);
      continue;
    }

    // Close open lists
    if (inUl) { result.push('</ul>'); inUl = false; }
    if (inOl) { result.push('</ol>'); inOl = false; }

    // Empty line → paragraph break
    if (line.trim() === '') {
      result.push('<br>');
    } else {
      result.push(`<p>${line}</p>`);
    }
  }

  if (inUl) result.push('</ul>');
  if (inOl) result.push('</ol>');

  // Clean up double <br> tags
  return result.join('').replace(/(<br>\s*){2,}/g, '<br>');
}

/* -------------------------------------------------------
   Conversation list (sidebar)
   ------------------------------------------------------- */

function renderConversationList() {
  const list = $('conversation-list');
  const conversations = Storage.getConversations();

  if (conversations.length === 0) {
    list.innerHTML = '<div class="no-conversations">Ingen samtaler endnu.<br>Klik "Ny samtale" for at starte.</div>';
    return;
  }

  list.innerHTML = conversations.map(conv => `
    <div class="conversation-item ${conv.id === activeConversationId ? 'active' : ''}"
         data-id="${conv.id}">
      <span class="conversation-item-text" title="${escapeAttr(conv.title)}">${escapeHtml(conv.title)}</span>
      <button class="conversation-item-delete" data-id="${conv.id}" title="Slet samtale" aria-label="Slet samtale">✕</button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* -------------------------------------------------------
   Message rendering
   ------------------------------------------------------- */

function renderMessages(messages) {
  const container = $('messages-container');
  const welcomeScreen = $('welcome-screen');

  if (!messages || messages.length === 0) {
    container.innerHTML = '';
    container.appendChild(welcomeScreen);
    welcomeScreen.style.display = 'flex';
    return;
  }

  welcomeScreen.style.display = 'none';
  container.innerHTML = '';

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    container.appendChild(createMessageEl(msg.role, msg.content));
  }

  scrollToBottom();
}

function createMessageEl(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatarEl = document.createElement('div');
  avatarEl.className = 'message-avatar';
  avatarEl.textContent = role === 'user' ? '👤' : '🏡';

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'message-bubble';

  if (role === 'assistant') {
    bubbleEl.innerHTML = renderMarkdown(content);
  } else {
    bubbleEl.textContent = content;
  }

  div.appendChild(avatarEl);
  div.appendChild(bubbleEl);
  return div;
}

function appendMessage(role, content) {
  const container = $('messages-container');
  const welcomeScreen = $('welcome-screen');
  welcomeScreen.style.display = 'none';

  const el = createMessageEl(role, content);
  container.appendChild(el);
  scrollToBottom();
  return el;
}

function showTypingIndicator() {
  const container = $('messages-container');
  const div = document.createElement('div');
  div.className = 'message assistant typing-indicator';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="message-avatar">🏡</div>
    <div class="message-bubble">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = $('typing-indicator');
  if (el) el.remove();
}

function scrollToBottom() {
  const container = $('messages-container');
  container.scrollTop = container.scrollHeight;
}

/* -------------------------------------------------------
   Chat title – auto-generate from first user message
   ------------------------------------------------------- */

function truncate(str, max = 50) {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/* -------------------------------------------------------
   Sending a message
   ------------------------------------------------------- */

async function sendMessage() {
  if (isLoading) return;

  const input = $('user-input');
  const text = input.value.trim();
  if (!text) return;

  const settings = Storage.getSettings();

  if (!settings.apiKey || !settings.apiKey.trim()) {
    showToast('Tilføj en API-nøgle i Indstillinger for at starte.', 'error', 4000);
    openSettingsModal();
    return;
  }

  // Create conversation if needed
  if (!activeConversationId) {
    const conv = Storage.createConversation(truncate(text));
    activeConversationId = conv.id;
    Storage.setActiveConversationId(conv.id);
    renderConversationList();
  }

  const conv = Storage.getConversation(activeConversationId);
  if (!conv) return;

  // Build messages array
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conv.messages,
    { role: 'user', content: text },
  ];

  // Update UI
  input.value = '';
  autoResizeTextarea(input);
  appendMessage('user', text);

  // Save user message
  conv.messages.push({ role: 'user', content: text });
  Storage.updateConversation(activeConversationId, { messages: conv.messages });

  // Update title from first message if still default
  if (conv.title === 'Ny samtale' && conv.messages.length === 1) {
    const newTitle = truncate(text);
    Storage.updateConversation(activeConversationId, { title: newTitle });
    $('chat-title').textContent = newTitle;
    renderConversationList();
  }

  // Send to API
  isLoading = true;
  $('send-btn').disabled = true;
  showTypingIndicator();

  try {
    const reply = await AIApi.sendMessage(settings, messages);
    removeTypingIndicator();
    appendMessage('assistant', reply);

    // Save assistant message
    conv.messages.push({ role: 'assistant', content: reply });
    Storage.updateConversation(activeConversationId, { messages: conv.messages });
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ **Fejl:** ${escapeHtml(err.message)}`);
  } finally {
    isLoading = false;
    $('send-btn').disabled = false;
    input.focus();
  }
}

/* -------------------------------------------------------
   Load / switch conversations
   ------------------------------------------------------- */

function loadConversation(id) {
  const conv = Storage.getConversation(id);
  if (!conv) return;

  activeConversationId = id;
  Storage.setActiveConversationId(id);
  $('chat-title').textContent = conv.title;
  renderMessages(conv.messages);
  renderConversationList();
  closeSidebar();
}

function startNewConversation() {
  activeConversationId = null;
  Storage.setActiveConversationId(null);
  $('chat-title').textContent = 'Ny samtale';
  renderMessages([]);
  renderConversationList();
  $('user-input').focus();
  closeSidebar();
}

/* -------------------------------------------------------
   Settings modal
   ------------------------------------------------------- */

function openSettingsModal() {
  const modal = $('settings-modal');
  modal.classList.remove('hidden');
  populateSettingsForm();
}

function closeSettingsModal() {
  $('settings-modal').classList.add('hidden');
}

function populateSettingsForm() {
  const settings = Storage.getSettings();
  const providerSel = $('setting-provider');

  // Populate provider list
  providerSel.innerHTML = AIApi.getProviders().map(p =>
    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
  ).join('');

  providerSel.value = settings.provider || 'openai';
  updateProviderFields(providerSel.value, settings);
}

function updateProviderFields(providerId, settings = null) {
  const s = settings || Storage.getSettings();
  const provider = AIApi.getProvider(providerId);
  if (!provider) return;

  // API key label & placeholder
  $('api-key-label').textContent = provider.keyLabel;
  $('setting-api-key').placeholder = provider.keyPlaceholder;
  $('api-key-hint').innerHTML = provider.keyHint;
  $('setting-api-key').value = s.apiKey || '';

  // Model selector
  const modelGroup = $('model-group');
  const modelSel = $('setting-model');
  if (provider.models && provider.models.length > 0) {
    modelGroup.style.display = '';
    modelSel.innerHTML = provider.models.map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');
    modelSel.value = s.model && provider.models.includes(s.model) ? s.model : provider.defaultModel;
  } else {
    modelGroup.style.display = 'none';
  }

  // Endpoint field
  const endpointGroup = $('endpoint-group');
  if (provider.requiresEndpoint) {
    endpointGroup.style.display = '';
    $('endpoint-label').textContent = provider.endpointLabel || 'Endpoint URL';
    $('setting-endpoint').placeholder = provider.endpointPlaceholder || '';
    $('setting-endpoint').value = s.endpoint || '';
  } else {
    endpointGroup.style.display = 'none';
  }

  // Deployment / model name for azure/custom
  const deploymentGroup = $('deployment-group');
  if (provider.requiresEndpoint && provider.deploymentLabel) {
    deploymentGroup.style.display = '';
    $('deployment-label').textContent = provider.deploymentLabel;
    $('setting-deployment').placeholder = provider.deploymentPlaceholder || '';
    $('setting-deployment').value = s.deployment || '';
  } else {
    deploymentGroup.style.display = 'none';
  }
}

function saveSettings() {
  const providerId = $('setting-provider').value;
  const provider = AIApi.getProvider(providerId);

  const settings = {
    provider: providerId,
    apiKey: $('setting-api-key').value.trim(),
    model: $('setting-model').value || (provider ? provider.defaultModel : ''),
    endpoint: $('setting-endpoint').value.trim(),
    deployment: $('setting-deployment').value.trim(),
  };

  if (!settings.apiKey) {
    showToast('Indtast venligst en API-nøgle.', 'error');
    return;
  }

  if (provider && provider.requiresEndpoint && !settings.endpoint) {
    showToast('Indtast venligst et endpoint-URL.', 'error');
    return;
  }

  Storage.saveSettings(settings);
  closeSettingsModal();
  updateSetupBanner();
  showToast('Indstillinger gemt ✓', 'success');
}

/* -------------------------------------------------------
   Setup banner
   ------------------------------------------------------- */

function updateSetupBanner() {
  const banner = $('setup-banner');
  if (Storage.hasApiKey()) {
    banner.style.display = 'none';
  } else {
    banner.style.display = '';
  }
}

/* -------------------------------------------------------
   Sidebar (mobile)
   ------------------------------------------------------- */

function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('active');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('active');
}

/* -------------------------------------------------------
   Textarea auto-resize
   ------------------------------------------------------- */

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* -------------------------------------------------------
   Event wiring
   ------------------------------------------------------- */

function initEvents() {
  // New chat
  $('btn-new-chat').addEventListener('click', startNewConversation);

  // Settings open/close
  $('btn-settings').addEventListener('click', openSettingsModal);
  $('btn-close-settings').addEventListener('click', closeSettingsModal);
  $('btn-cancel-settings').addEventListener('click', closeSettingsModal);
  $('btn-save-settings').addEventListener('click', saveSettings);

  // Close modal on overlay click
  $('settings-modal').addEventListener('click', e => {
    if (e.target === $('settings-modal')) closeSettingsModal();
  });

  // Provider change
  $('setting-provider').addEventListener('change', e => {
    updateProviderFields(e.target.value);
  });

  // Toggle API key visibility
  $('btn-toggle-key').addEventListener('click', () => {
    const input = $('setting-api-key');
    const btn = $('btn-toggle-key');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
      btn.title = 'Skjul nøgle';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
      btn.title = 'Vis nøgle';
    }
  });

  // Send button
  $('send-btn').addEventListener('click', sendMessage);

  // Enter to send (Shift+Enter = newline)
  $('user-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto resize textarea
  $('user-input').addEventListener('input', () => autoResizeTextarea($('user-input')));

  // Conversation list clicks (delegation)
  $('conversation-list').addEventListener('click', e => {
    const deleteBtn = e.target.closest('.conversation-item-delete');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      Storage.deleteConversation(id);
      if (activeConversationId === id) {
        startNewConversation();
      } else {
        renderConversationList();
      }
      return;
    }
    const item = e.target.closest('.conversation-item');
    if (item) {
      loadConversation(item.dataset.id);
    }
  });

  // Clear all
  $('btn-clear-all').addEventListener('click', () => {
    if (confirm('Slet alle samtaler? Dette kan ikke fortrydes.')) {
      Storage.clearAllConversations();
      startNewConversation();
      showToast('Alle samtaler slettet.', 'info');
    }
  });

  // Setup banner click → open settings
  $('setup-banner').addEventListener('click', openSettingsModal);

  // Mobile menu
  $('btn-menu').addEventListener('click', openSidebar);
  $('sidebar-overlay').addEventListener('click', closeSidebar);

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('user-input').value = chip.dataset.prompt || chip.textContent;
      autoResizeTextarea($('user-input'));
      $('user-input').focus();
    });
  });
}

/* -------------------------------------------------------
   Bootstrap
   ------------------------------------------------------- */

function init() {
  initEvents();
  updateSetupBanner();

  // Restore last active conversation
  const lastId = Storage.getActiveConversationId();
  const conversations = Storage.getConversations();

  if (lastId && conversations.find(c => c.id === lastId)) {
    loadConversation(lastId);
  } else if (conversations.length > 0) {
    loadConversation(conversations[0].id);
  } else {
    renderConversationList();
    renderMessages([]);
  }
}

document.addEventListener('DOMContentLoaded', init);
