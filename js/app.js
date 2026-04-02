/**
 * app.js – Hovedlogik for Boligkøbsrådgiveren.
 * Håndterer chat-grænsefladen, indstillingsmodalen og samtalehistorik.
 */

/* ── System-prompt ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `Du er en erfaren og venlig dansk boligkøbsrådgiver med dyb indsigt i det danske ejendomsmarked. Du hjælper potentielle boligkøbere med at træffe velovervejede beslutninger.

Du kan rådgive om:
- Prisfastsættelse og markedsanalyse i Danmark
- Boliglån, realkreditlån og finansiering (herunder banker og realkreditinstitutter som Nykredit, Totalkredit, BRFkredit, Realkredit Danmark)
- Besigtigelse og teknisk gennemgang af boliger
- Tilstandsrapporter, elinstallationsrapporter og ejerskifteforsikring
- Juridiske aspekter ved bolighandel i Danmark (skøde, tinglysning, overtagelsesdato)
- Ejendomsskatter, grundskyld og boligafgift
- Andelsboliger, ejerlejligheder, villaer og rækkehuse
- Bydele, infrastruktur og lokalmiljø i danske byer og kommuner
- Forhandling af pris og handelsvilkår
- Typiske fejl og faldgruber ved boligkøb

Svar altid på dansk og brug klart, letforståeligt sprog. Vær konkret og giv praktiske råd. Hvis du mangler oplysninger for at give et præcist svar, så stil opklarende spørgsmål.`;

/* ── DOM-referencer ──────────────────────────────────────────────────────── */

const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const conversationList = document.getElementById('conversation-list');
const newConversationBtn = document.getElementById('new-conversation-btn');
const settingsBtn = document.getElementById('settings-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsCancel = document.getElementById('settings-cancel');
const settingsForm = document.getElementById('settings-form');
const providerSelect = document.getElementById('provider-select');
const modelInput = document.getElementById('model-input');
const apiKeyInput = document.getElementById('api-key-input');
const rememberApiKeyInput = document.getElementById('remember-api-key-input');
const azureEndpointGroup = document.getElementById('azure-endpoint-group');
const azureEndpointInput = document.getElementById('azure-endpoint-input');
const emptyState = document.getElementById('empty-state');
const startFirstChatBtn = document.getElementById('start-first-chat-btn');

/* ── Tilstand ────────────────────────────────────────────────────────────── */

let activeConversationId = null;
let isLoading = false;

/* ── Init ────────────────────────────────────────────────────────────────── */

function init() {
  renderConversationList();

  const savedId = getActiveConversationId();
  activateFirstOrEmpty(savedId);

  const settings = loadSettings();
  applySettingsToForm(settings);
  updateProviderVisibility();
}

/**
 * Åbner den foretrukne samtale, eller den første tilgængelige, eller viser tomt tilstand.
 * @param {string|null} [preferredId]
 */
function activateFirstOrEmpty(preferredId) {
  const conversations = loadConversations();
  if (preferredId && conversations.find((c) => c.id === preferredId)) {
    loadConversation(preferredId);
  } else if (conversations.length > 0) {
    loadConversation(conversations[0].id);
  } else {
    activeConversationId = null;
    showEmptyState();
  }
}

/* ── Samtaler ────────────────────────────────────────────────────────────── */

function renderConversationList() {
  const conversations = loadConversations();
  conversationList.innerHTML = '';

  conversations.forEach((conv) => {
    const item = document.createElement('button');
    item.className = 'conversation-item' + (conv.id === activeConversationId ? ' active' : '');
    item.dataset.id = conv.id;

    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = conv.title;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conversation-delete';
    deleteBtn.setAttribute('aria-label', 'Slet samtale');
    deleteBtn.innerHTML = '&times;';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Er du sikker på, at du vil slette denne samtale?')) {
        deleteConversation(conv.id);
        activateFirstOrEmpty();
        renderConversationList();
      }
    });

    item.appendChild(title);
    item.appendChild(deleteBtn);
    item.addEventListener('click', () => loadConversation(conv.id));
    conversationList.appendChild(item);
  });
}

function loadConversation(id) {
  activeConversationId = id;
  setActiveConversationId(id);
  renderConversationList();

  const conv = getConversation(id);
  if (!conv) return;

  emptyState.hidden = true;
  chatMessages.hidden = false;
  chatMessages.innerHTML = '';

  conv.messages.forEach((msg) => {
    if (msg.role !== 'system') renderMessage(msg.role, msg.content);
  });
  scrollToBottom();
}

function startNewConversation() {
  const id = createConversation();
  activeConversationId = id;
  emptyState.hidden = true;
  chatMessages.hidden = false;
  chatMessages.innerHTML = '';
  renderConversationList();
  messageInput.focus();
}

function showEmptyState() {
  chatMessages.hidden = true;
  emptyState.hidden = false;
}

/* ── Beskeder ────────────────────────────────────────────────────────────── */

function renderMessage(role, content) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;

  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  return bubble;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
  if (isLoading) return;

  const text = messageInput.value.trim();
  if (!text) return;

  const settings = loadSettings();
  if (!settings.apiKey) {
    alert('Angiv venligst din API-nøgle i indstillingerne før du sender en besked.');
    openSettings();
    return;
  }

  if (!activeConversationId) {
    startNewConversation();
  }

  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Tilføj brugerbesked
  addMessage(activeConversationId, { role: 'user', content: text });
  renderMessage('user', text);
  renderConversationList();
  scrollToBottom();

  // Vis indlæsningsindikator
  isLoading = true;
  sendButton.disabled = true;
  const loadingBubble = renderMessage('assistant', '');
  loadingBubble.classList.add('loading');
  loadingBubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  scrollToBottom();

  try {
    const conv = getConversation(activeConversationId);
    const history = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conv.messages.filter((m) => m.role !== 'system'),
    ];

    let fullResponse = '';

    loadingBubble.classList.remove('loading');
    loadingBubble.innerHTML = '';

    await sendChatRequest(
      {
        provider: settings.provider || 'openai',
        apiKey: settings.apiKey,
        model: settings.model || undefined,
        endpoint: settings.azureEndpoint || undefined,
        messages: history,
      },
      (chunk) => {
        fullResponse += chunk;
        loadingBubble.textContent = fullResponse;
        scrollToBottom();
      },
    );

    addMessage(activeConversationId, { role: 'assistant', content: fullResponse });
    renderConversationList();
  } catch (err) {
    loadingBubble.classList.remove('loading');
    loadingBubble.innerHTML = '';
    loadingBubble.classList.add('error');
    loadingBubble.textContent = `Fejl: ${err.message}`;
  } finally {
    isLoading = false;
    sendButton.disabled = false;
    scrollToBottom();
  }
}

/* ── Indstillinger ───────────────────────────────────────────────────────── */

function openSettings() {
  const settings = loadSettings();
  applySettingsToForm(settings);
  settingsModal.hidden = false;
  settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  settingsModal.hidden = true;
  settingsModal.setAttribute('aria-hidden', 'true');
}

function applySettingsToForm(settings) {
  providerSelect.value = settings.provider || 'openai';
  modelInput.value = settings.model || '';
  apiKeyInput.value = settings.apiKey || '';
  rememberApiKeyInput.checked = !!settings.rememberApiKey;
  azureEndpointInput.value = settings.azureEndpoint || '';
  updateProviderVisibility();
}

function updateProviderVisibility() {
  const isAzure = providerSelect.value === 'azure';
  azureEndpointGroup.hidden = !isAzure;
}

/* ── Hændelseslyttere ────────────────────────────────────────────────────── */

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
});

newConversationBtn.addEventListener('click', startNewConversation);

settingsBtn.addEventListener('click', openSettings);

settingsClose.addEventListener('click', closeSettings);

settingsCancel.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const settings = {
    provider: providerSelect.value,
    model: modelInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    rememberApiKey: rememberApiKeyInput.checked,
    azureEndpoint: azureEndpointInput.value.trim(),
  };
  saveSettings(settings);
  closeSettings();
});

providerSelect.addEventListener('change', updateProviderVisibility);

clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Er du sikker på, at du vil slette al samtalehistorik?')) {
    clearAllConversations();
    activateFirstOrEmpty();
    renderConversationList();
  }
});

startFirstChatBtn.addEventListener('click', startNewConversation);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsModal.hidden) closeSettings();
});

/* ── Start ───────────────────────────────────────────────────────────────── */

init();
