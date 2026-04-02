/**
 * api.js – AI API-klient der understøtter OpenAI, Mistral og Azure OpenAI.
 * Brugeren angiver selv sin API-nøgle – ingen data sendes til en mellemserver.
 */

const PROVIDERS = {
  OPENAI: 'openai',
  MISTRAL: 'mistral',
  AZURE: 'azure',
};

/**
 * Sender en chat-anmodning til den valgte AI-udbyder.
 *
 * @param {Object} config
 * @param {string} config.provider  – 'openai' | 'mistral' | 'azure'
 * @param {string} config.apiKey    – Brugerens API-nøgle
 * @param {string} [config.model]   – Modelnavn (valgfrit)
 * @param {string} [config.endpoint]– Brugerdefineret endpoint (kræves til Azure)
 * @param {Array}  config.messages  – Beskedhistorik [{ role, content }, ...]
 * @param {function(string): void} onChunk – Callback kaldt for hvert streamingtekst-stykke
 * @returns {Promise<string>} – Det fulde svar fra AI
 */
async function sendChatRequest({ provider, apiKey, model, endpoint, messages }, onChunk) {
  switch (provider) {
    case PROVIDERS.OPENAI:
      return _openaiRequest({ apiKey, model: model || 'gpt-4o', messages }, onChunk);
    case PROVIDERS.MISTRAL:
      return _mistralRequest({ apiKey, model: model || 'mistral-large-latest', messages }, onChunk);
    case PROVIDERS.AZURE:
      return _azureRequest({ apiKey, endpoint, model, messages }, onChunk);
    default:
      throw new Error(`Ukendt udbyder: ${provider}`);
  }
}

/* ── OpenAI ──────────────────────────────────────────────────────────────── */

async function _openaiRequest({ apiKey, model, messages }, onChunk) {
  const url = 'https://api.openai.com/v1/chat/completions';
  return _streamRequest(
    url,
    {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    { model, messages, stream: true },
    _parseOpenAIChunk,
    onChunk,
  );
}

/* ── Mistral ─────────────────────────────────────────────────────────────── */

async function _mistralRequest({ apiKey, model, messages }, onChunk) {
  const url = 'https://api.mistral.ai/v1/chat/completions';
  return _streamRequest(
    url,
    {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    { model, messages, stream: true },
    _parseOpenAIChunk, // Mistral bruger samme format som OpenAI
    onChunk,
  );
}

/* ── Azure OpenAI ────────────────────────────────────────────────────────── */

async function _azureRequest({ apiKey, endpoint, model, messages }, onChunk) {
  if (!endpoint) throw new Error('Azure endpoint er påkrævet.');
  // Forventet format: https://<ressource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-01
  const url = endpoint.includes('chat/completions')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/openai/deployments/${model || 'gpt-4o'}/chat/completions?api-version=2024-02-01`;
  return _streamRequest(
    url,
    {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    { messages, stream: true },
    _parseOpenAIChunk,
    onChunk,
  );
}

/* ── Generisk streaming-hjælper ──────────────────────────────────────────── */

async function _streamRequest(url, headers, body, parseChunk, onChunk) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      errorMsg = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      // ignorer parse-fejl
    }
    throw new Error(errorMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // gem ufærdig linje til næste iteration

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const chunk = parseChunk(json);
          if (chunk) {
            fullText += chunk;
            onChunk(chunk);
          }
        } catch {
          // ignorer ugyldigt JSON-stykke
        }
      }
    }
  }

  return fullText;
}

function _parseOpenAIChunk(json) {
  return json?.choices?.[0]?.delta?.content || '';
}
