/**
 * api.js – Multi-provider AI API client
 *
 * Supports:
 *   - OpenAI           (api.openai.com)
 *   - Mistral AI       (api.mistral.ai)
 *   - Azure OpenAI     (your-resource.openai.azure.com)
 *   - Custom / OpenAI-compatible endpoints
 *
 * All calls go directly from the user's browser to the chosen API.
 * No data passes through any intermediary server.
 */

const AIApi = (() => {

  /**
   * Returns the list of supported providers with metadata.
   */
  function getProviders() {
    return [
      {
        id: 'openai',
        name: 'OpenAI',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
        defaultModel: 'gpt-4o-mini',
        keyLabel: 'API-nøgle',
        keyPlaceholder: 'sk-...',
        keyHint: 'Find din nøgle på <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>',
        requiresEndpoint: false,
      },
      {
        id: 'mistral',
        name: 'Mistral AI',
        models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-7b'],
        defaultModel: 'mistral-large-latest',
        keyLabel: 'API-nøgle',
        keyPlaceholder: 'Din Mistral API-nøgle',
        keyHint: 'Find din nøgle på <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noopener">console.mistral.ai</a>',
        requiresEndpoint: false,
      },
      {
        id: 'azure',
        name: 'Azure OpenAI (Copilot)',
        models: [],
        defaultModel: '',
        keyLabel: 'API-nøgle',
        keyPlaceholder: 'Din Azure OpenAI API-nøgle',
        keyHint: 'Find din nøgle i <a href="https://portal.azure.com" target="_blank" rel="noopener">Azure Portal</a> under din OpenAI-ressource.',
        requiresEndpoint: true,
        endpointLabel: 'Endpoint-URL',
        endpointPlaceholder: 'https://DIN-RESSOURCE.openai.azure.com/openai/deployments/DIN-MODEL/chat/completions?api-version=2024-02-01',
        deploymentLabel: 'Deployment navn (model)',
        deploymentPlaceholder: 'gpt-4o',
      },
      {
        id: 'custom',
        name: 'Brugerdefineret (OpenAI-kompatibel)',
        models: [],
        defaultModel: '',
        keyLabel: 'API-nøgle',
        keyPlaceholder: 'Din API-nøgle',
        keyHint: 'Enhver OpenAI-kompatibel API (f.eks. Ollama, LM Studio, Groq, Together AI).',
        requiresEndpoint: true,
        endpointLabel: 'Base URL',
        endpointPlaceholder: 'https://api.example.com/v1/chat/completions',
        deploymentLabel: 'Model-navn',
        deploymentPlaceholder: 'model-name',
      },
    ];
  }

  function getProvider(id) {
    return getProviders().find(p => p.id === id) || null;
  }

  /**
   * Build the fetch request options for the given provider.
   */
  function buildRequest(settings, messages) {
    const { provider, apiKey, model, endpoint, deployment } = settings;

    // Trim all values
    const key = (apiKey || '').trim();

    switch (provider) {

      case 'openai':
      case 'mistral': {
        const baseUrl = provider === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : 'https://api.mistral.ai/v1/chat/completions';
        return {
          url: baseUrl,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: (model || '').trim(),
              messages,
              temperature: 0.7,
              max_tokens: 2048,
            }),
          },
        };
      }

      case 'azure': {
        const url = (endpoint || '').trim();
        return {
          url,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': key,
            },
            body: JSON.stringify({
              messages,
              temperature: 0.7,
              max_tokens: 2048,
            }),
          },
        };
      }

      case 'custom': {
        const url = (endpoint || '').trim();
        const modelName = (deployment || model || '').trim();
        return {
          url,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              temperature: 0.7,
              max_tokens: 2048,
            }),
          },
        };
      }

      default:
        throw new Error(`Ukendt AI-udbyder: ${provider}`);
    }
  }

  /**
   * Send a chat completion request and return the assistant reply text.
   *
   * @param {object} settings  – user settings from Storage.getSettings()
   * @param {Array}  messages  – array of {role, content} objects
   * @returns {Promise<string>} – the assistant's reply
   */
  async function sendMessage(settings, messages) {
    if (!settings.provider) throw new Error('Ingen AI-udbyder valgt. Gå til Indstillinger og konfigurer din API.');
    if (!settings.apiKey || !settings.apiKey.trim()) throw new Error('Ingen API-nøgle fundet. Gå til Indstillinger og tilføj din API-nøgle.');

    const { url, options } = buildRequest(settings, messages);

    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw new Error(`Netværksfejl: ${err.message}. Tjek din internetforbindelse og at API-endpunktet er korrekt.`);
    }

    if (!response.ok) {
      let errMsg = `API-fejl ${response.status}`;
      try {
        const errData = await response.json();
        const detail = errData?.error?.message || errData?.message || JSON.stringify(errData);
        errMsg += `: ${detail}`;
      } catch {
        // ignore parse errors
      }
      throw new Error(errMsg);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Kunne ikke parse API-svar. Tjek at endpunktet er korrekt.');
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new Error('Uventet API-svar format. Tjek din model-konfiguration.');
    }
    return text;
  }

  return { getProviders, getProvider, sendMessage };
})();
