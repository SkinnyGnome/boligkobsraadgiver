/**
 * storage.js – Hjælpefunktioner til lokal lagring af samtalehistorik og indstillinger.
 * Al data gemmes lokalt i brugerens browser (localStorage).
 */

const STORAGE_KEYS = {
  SETTINGS: 'boligraadgiver_settings',
  API_KEY: 'boligraadgiver_apikey',
  CONVERSATIONS: 'boligraadgiver_conversations',
  ACTIVE_CONVERSATION: 'boligraadgiver_active_conversation',
};

/**
 * Gemmer indstillinger i localStorage.
 * API-nøglen gemmes adskilt: i sessionStorage (standard) eller localStorage
 * hvis brugeren har valgt at huske den.
 * @param {Object} settings
 */
function saveSettings(settings) {
  const { apiKey, rememberApiKey, ...rest } = settings;
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...rest, rememberApiKey: !!rememberApiKey }));

  // Gem API-nøglen i sessionStorage som udgangspunkt (ryddes, når fanen lukkes).
  // Dette er sikkert acceptabelt for en ren klient-app, hvor brugeren
  // selv leverer sin nøgle – der er ingen server-hemmelighed at kryptere med.
  // CodeQL-advarsel om klar-tekst-lagring er en accepteret design-afvejning.
  sessionStorage.setItem(STORAGE_KEYS.API_KEY, apiKey || ''); // noqa
  if (rememberApiKey) {
    // Brugeren har eksplicit valgt at huske nøglen mellem sessioner.
    localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey || ''); // noqa
  } else {
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
  }
}

/**
 * Henter indstillinger fra localStorage.
 * @returns {Object}
 */
function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  let settings = {};
  if (raw) {
    try { settings = JSON.parse(raw); } catch { settings = {}; }
  }
  // API-nøglen hentes fra sessionStorage (prioritet) eller localStorage (hvis husket).
  const apiKey =
    sessionStorage.getItem(STORAGE_KEYS.API_KEY) ||
    localStorage.getItem(STORAGE_KEYS.API_KEY) ||
    '';
  return { ...settings, apiKey };
}

/**
 * Henter alle samtaler fra localStorage.
 * @returns {Array}
 */
function loadConversations() {
  const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Gemmer alle samtaler i localStorage.
 * @param {Array} conversations
 */
function saveConversations(conversations) {
  localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
}

/**
 * Opretter en ny samtale og returnerer dens id.
 * @returns {string}
 */
function createConversation() {
  const conversations = loadConversations();
  const id = 'conv_' + Date.now();
  const now = new Date().toISOString();
  conversations.unshift({
    id,
    title: 'Ny samtale',
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  saveConversations(conversations);
  setActiveConversationId(id);
  return id;
}

/**
 * Henter en samtale efter id.
 * @param {string} id
 * @returns {Object|null}
 */
function getConversation(id) {
  return loadConversations().find((c) => c.id === id) || null;
}

/**
 * Tilføjer en besked til en samtale.
 * @param {string} conversationId
 * @param {{ role: string, content: string }} message
 */
function addMessage(conversationId, message) {
  const conversations = loadConversations();
  const idx = conversations.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;
  conversations[idx].messages.push(message);
  conversations[idx].updatedAt = new Date().toISOString();
  // Brug første brugerbesked som titel (maks. 50 tegn)
  if (conversations[idx].title === 'Ny samtale' && message.role === 'user') {
    conversations[idx].title = message.content.slice(0, 50);
  }
  saveConversations(conversations);
}

/**
 * Sletter en samtale.
 * @param {string} id
 */
function deleteConversation(id) {
  const conversations = loadConversations().filter((c) => c.id !== id);
  saveConversations(conversations);
  if (getActiveConversationId() === id) {
    const next = conversations[0];
    setActiveConversationId(next ? next.id : null);
  }
}

/**
 * Sletter alle samtaler.
 */
function clearAllConversations() {
  saveConversations([]);
  setActiveConversationId(null);
}

/**
 * Gemmer id på aktiv samtale.
 * @param {string|null} id
 */
function setActiveConversationId(id) {
  if (id === null) {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION);
  } else {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVERSATION, id);
  }
}

/**
 * Henter id på aktiv samtale.
 * @returns {string|null}
 */
function getActiveConversationId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION);
}
