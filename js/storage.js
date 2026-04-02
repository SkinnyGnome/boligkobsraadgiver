/**
 * storage.js – Local storage utilities
 * All user data (settings, conversations) is stored in localStorage.
 * No data is ever sent to any server except directly to the AI API.
 */

const Storage = (() => {
  const KEYS = {
    SETTINGS: 'bkr_settings',
    CONVERSATIONS: 'bkr_conversations',
    ACTIVE_CONV: 'bkr_active_conversation',
  };

  // ---------- Settings ----------

  function getSettings() {
    try {
      const raw = localStorage.getItem(KEYS.SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  function hasApiKey() {
    const s = getSettings();
    return Boolean(s.apiKey && s.apiKey.trim());
  }

  // ---------- Conversations ----------

  function getConversations() {
    try {
      const raw = localStorage.getItem(KEYS.CONVERSATIONS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveConversations(convs) {
    localStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(convs));
  }

  function getConversation(id) {
    return getConversations().find(c => c.id === id) || null;
  }

  function createConversation(title) {
    const conv = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: title || 'Ny samtale',
      createdAt: new Date().toISOString(),
      messages: [],
    };
    const convs = getConversations();
    convs.unshift(conv);
    saveConversations(convs);
    return conv;
  }

  function updateConversation(id, updates) {
    const convs = getConversations();
    const idx = convs.findIndex(c => c.id === id);
    if (idx !== -1) {
      convs[idx] = { ...convs[idx], ...updates };
      saveConversations(convs);
      return convs[idx];
    }
    return null;
  }

  function deleteConversation(id) {
    const convs = getConversations().filter(c => c.id !== id);
    saveConversations(convs);
  }

  function clearAllConversations() {
    saveConversations([]);
    localStorage.removeItem(KEYS.ACTIVE_CONV);
  }

  // ---------- Active conversation ----------

  function getActiveConversationId() {
    return localStorage.getItem(KEYS.ACTIVE_CONV);
  }

  function setActiveConversationId(id) {
    if (id) {
      localStorage.setItem(KEYS.ACTIVE_CONV, id);
    } else {
      localStorage.removeItem(KEYS.ACTIVE_CONV);
    }
  }

  return {
    getSettings,
    saveSettings,
    hasApiKey,
    getConversations,
    getConversation,
    createConversation,
    updateConversation,
    deleteConversation,
    clearAllConversations,
    getActiveConversationId,
    setActiveConversationId,
  };
})();
