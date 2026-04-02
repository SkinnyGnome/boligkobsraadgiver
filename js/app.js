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
   Bolig Rapport – state & helpers
   ------------------------------------------------------- */

const MAX_FILE_SIZE_BYTES  = 5 * 1024 * 1024; // 5 MB
const MAX_PROMPT_CHARS     = 80000;            // max chars for a single AI request (~20K tokens)
const CHUNK_SIZE           = 24000;            // chars per chunk when splitting large documents
const BOLIG_DOCS           = ['tilstandsrapport', 'elattest', 'energimaerke', 'salgsopstilling'];

const boligFileContents = {
  tilstandsrapport: null,
  elattest:         null,
  energimaerke:     null,
  salgsopstilling:  null,
};

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Kunne ikke læse "${file.name}"`));
    reader.readAsText(file, 'UTF-8');
  });
}

/** Returns true if extracted text looks like readable content (not binary garbage). */
function isReadableText(text) {
  if (!text || text.trim().length < 30) return false;
  const printable = (text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g) || []).length;
  return printable / text.length > 0.65;
}

function openBoligModal() {
  closeSidebar();
  $('bolig-modal').classList.remove('hidden');
  setTimeout(() => $('bolig-address').focus(), 50);
}

function closeBoligModal() {
  $('bolig-modal').classList.add('hidden');
}

function resetBoligModal() {
  $('bolig-address').value = '';
  BOLIG_DOCS.forEach(doc => {
    boligFileContents[doc] = null;
    $(`file-${doc}`).value = '';
    $(`preview-${doc}`).style.display = 'none';
    $(`zone-${doc}`).querySelector('.file-upload-trigger').style.display = '';
  });
  $('opt-flags').checked        = true;
  $('opt-forhandling').checked  = true;
  $('opt-prisoverslag').checked = true;
}

async function handleFileUpload(doc, file) {
  if (!file) return;
  if (file.size > MAX_FILE_SIZE_BYTES) {
    showToast('Filen er for stor (maks. 5 MB).', 'error');
    return;
  }
  try {
    const text = await readFileAsText(file);
    if (!isReadableText(text)) {
      showToast(`"${file.name}": Filen indeholder ikke læsbar tekst. Brug en TXT-fil eller en digital (ikke-skannet) PDF.`, 'error', 5000);
      return;
    }
    boligFileContents[doc] = text;
    $(`name-${doc}`).textContent = file.name;
    $(`preview-${doc}`).style.display = 'flex';
    $(`zone-${doc}`).querySelector('.file-upload-trigger').style.display = 'none';
    showToast(`"${file.name}" klar ✓`, 'success', 2000);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function removeBoligFile(doc) {
  boligFileContents[doc] = null;
  $(`file-${doc}`).value = '';
  $(`preview-${doc}`).style.display = 'none';
  $(`zone-${doc}`).querySelector('.file-upload-trigger').style.display = '';
}

function buildDisplayMessage(address, fileContents, options) {
  const uploaded = [
    fileContents.tilstandsrapport && 'Tilstandsrapport',
    fileContents.elattest         && 'Elattest',
    fileContents.energimaerke     && 'Energimærkerapport',
    fileContents.salgsopstilling  && 'Salgsopstilling',
  ].filter(Boolean);

  const selected = [
    options.inkluderFlag         && '🚦 Røde/Gule/Grønne flag',
    options.inkluderForhandling  && '💬 Prisforhandlingsstrategi',
    options.inkluderPrisoverslag && '🔧 Prisoverslag for udbedring',
  ].filter(Boolean);

  let msg = `📄 Generer Køberrapport\n\nAdresse: ${address}`;
  if (uploaded.length > 0) msg += `\nDokumenter: ${uploaded.join(', ')}`;
  if (selected.length > 0) msg += `\nInkluder: ${selected.join(', ')}`;
  return msg;
}

function buildKoeberrapportPrompt(address, fileContents, options) {
  const parts = [];

  parts.push(`Generer en detaljeret og struktureret KØBERRAPPORT for følgende bolig:\n\n**Adresse:** ${address}\n`);

  const docMeta = [
    ['tilstandsrapport', 'Tilstandsrapport'],
    ['elattest',         'Elinstallationsrapport (Elattest)'],
    ['energimaerke',     'Energimærkerapport'],
    ['salgsopstilling',  'Salgsopstilling'],
  ];
  const uploaded = docMeta.filter(([k]) => fileContents[k] && fileContents[k].trim());

  if (uploaded.length > 0) {
    parts.push(`\n---\n## Dokumenter til analyse\n`);
    for (const [key, label] of uploaded) {
      const content = fileContents[key];
      parts.push(`\n### ${label}\n${content}\n`);
    }
    parts.push(`\n---\n`);
  }

  parts.push(`\n## Rapporten skal indeholde følgende afsnit:\n`);

  parts.push(`\n**1. Overordnet vurdering**\nSamlet vurdering af ejendommen på ${address} baseret på tilgængelige informationer.\n`);

  if (uploaded.length > 0) {
    parts.push(`\n**2. Dokumentanalyse**\nGrundigt gennemgang af de uploadede dokumenter:\n- Tilstandsrapportens karakterer (K1/K2/K3) og de vigtigste fund\n- Elinstallationsproblemer og anbefalinger fra elattest\n- Energiforbrug, mærke og forbedringsforslag fra energimærket\n- Nøgletal og vilkår fra salgsopstillingen\n`);
  } else {
    parts.push(`\n**2. Dokumenttjekliste**\nHvad bør køber tjekke i tilstandsrapport, elattest og energimærke for denne type ejendom?\n`);
  }

  parts.push(`\n**3. Juridiske forhold og servitutter**\nHvad bør undersøges vedrørende servitutter, deklarationer og juridiske bindinger for ${address}? Henvis til tinglysning.dk og BBR-registret. Nævn typiske servituttyper for denne type ejendom og hvad man særligt skal være opmærksom på.\n`);

  parts.push(`\n**4. Lokalplan, kommuneplan og byggeplaner**\nHvad bør undersøges for ${address} vedrørende:\n- Gældende lokalplan og anvendelsesbestemmelser\n- Muligheder og begrænsninger for til- og ombygning\n- Fremtidige byggeprojekter eller udviklingsplaner i nærområdet\nHenvis til planinfo.dk og kommunens hjemmeside.\n`);

  parts.push(`\n**5. Nærområde og beliggenhed**\nVurder nærområdet til ${address}:\n- Infrastruktur, veje og trafikforhold\n- Offentlig transport (bus, tog, metro)\n- Skoler, daginstitutioner og dagligvareindkøb\n- Generel attraktivitet og prisniveau i området\n`);

  if (options.inkluderFlag) {
    parts.push(`\n**6. 🔴🟡🟢 Røde, Gule og Grønne flag**\nLav en overskuelig liste:\n- 🔴 **RØDE FLAG** – Alvorlige problemer der kræver øjeblikkelig handling eller professionel inspektion\n- 🟡 **GULE FLAG** – Opmærksomhedspunkter der bør undersøges nærmere inden køb\n- 🟢 **GRØNNE FLAG** – Positive aspekter og styrker ved boligen\n`);
  }

  if (options.inkluderForhandling) {
    parts.push(`\n**7. 💬 Prisforhandlingsstrategi**\nKonkrete råd til prisforhandling${uploaded.length > 0 ? ' baseret på dokumentfundene' : ''}:\n- Hvilke specifikke punkter kan bruges som forhandlingsargumenter?\n- Hvad er et realistisk forhandlingsrum? (angiv gerne i kr. eller %)\n- Anbefalet fremgangsmåde og timing for forhandlingen\n`);
  }

  if (options.inkluderPrisoverslag) {
    parts.push(`\n**8. 🔧 Prisoverslag for udbedring af fejl og mangler**\n${uploaded.length > 0 && fileContents.tilstandsrapport ? 'Baseret på tilstandsrapporten og eventuelle andre dokumenter: angiv' : 'Angiv'} estimerede omkostninger for at udbedre de identificerede fejl og mangler:\n- Akutte udbedringer (skal gøres nu)\n- Anbefalede udbedringer (inden for 1-3 år)\n- Optionelle forbedringer (energi, komfort, øget værdi)\nAngiv priser i DKK med reference til SKAFOR-prisguiden eller tilsvarende branchestandarder.\n`);
  }

  parts.push(`\n---\nStrukturér rapporten klart med tydelige overskrifter og brug gerne tabeller eller punktlister for overblik. Afslut med en samlet anbefaling til køber.\n\n⚠️ Rapporten er baseret på AI-analyse og bør altid suppleres med professionel rådgivning fra en autoriseret ejendomsmægler, byggesagkyndig og advokat inden køb.\n`);

  return parts.join('');
}

async function generateKoeberrapport() {
  const address = ($('bolig-address').value || '').trim();

  if (!address) {
    showToast('Angiv venligst en adresse.', 'error');
    $('bolig-address').focus();
    return;
  }

  const settings = Storage.getSettings();
  if (!settings.apiKey || !settings.apiKey.trim()) {
    showToast('Tilføj en API-nøgle i Indstillinger for at generere rapport.', 'error', 4000);
    closeBoligModal();
    openSettingsModal();
    return;
  }

  const options = {
    inkluderFlag:         $('opt-flags').checked,
    inkluderForhandling:  $('opt-forhandling').checked,
    inkluderPrisoverslag: $('opt-prisoverslag').checked,
  };

  // Initial report uses Tilstandsrapport + Elinstallationsrapport + Salgsopstilling only.
  // Energimærkerapport is offered as a separate follow-up to keep token usage low.
  const deferredEnergimærke = boligFileContents.energimaerke;
  const initialFileContents = {
    tilstandsrapport: boligFileContents.tilstandsrapport,
    elattest:         boligFileContents.elattest,
    energimaerke:     null,
    salgsopstilling:  boligFileContents.salgsopstilling,
  };

  const displayMsg = buildDisplayMessage(address, initialFileContents, options);
  const title      = truncate(`Køberrapport: ${address}`);

  // Create new conversation
  const conv = Storage.createConversation(title);
  activeConversationId = conv.id;
  Storage.setActiveConversationId(conv.id);
  $('chat-title').textContent = title;
  renderMessages([]);
  renderConversationList();
  closeBoligModal();
  closeSidebar();

  // Show concise user message in the chat
  appendMessage('user', displayMsg);
  conv.messages.push({ role: 'user', content: displayMsg });
  Storage.updateConversation(activeConversationId, { messages: conv.messages });

  // Send to AI – with automatic chunking if documents are too large
  isLoading = true;
  $('send-btn').disabled = true;
  showTypingIndicator();

  try {
    const reply = await sendKoeberrapportToAI(settings, address, initialFileContents, options);
    removeTypingIndicator();
    appendMessage('assistant', reply);
    conv.messages.push({ role: 'assistant', content: reply });
    Storage.updateConversation(activeConversationId, { messages: conv.messages });

    // If an Energimærkerapport was uploaded, offer it as an optional follow-up
    if (deferredEnergimærke) {
      offerEnergyAnalysis(settings, address, conv.id, deferredEnergimærke);
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ **Fejl:** ${escapeHtml(err.message)}`);
  } finally {
    isLoading = false;
    $('send-btn').disabled = false;
  }

  // Reset modal state and UI for next use
  resetBoligModal();
}

/**
 * Send the køberrapport request to the AI.
 * If the total prompt exceeds MAX_PROMPT_CHARS, large documents are first
 * analysed in chunks so the AI reads the full content, and the resulting
 * summaries are used when building the final report prompt.
 */
async function sendKoeberrapportToAI(settings, address, fileContents, options) {
  const docMeta = [
    ['tilstandsrapport', 'Tilstandsrapport'],
    ['elattest',         'Elinstallationsrapport'],
    ['energimaerke',     'Energimærkerapport'],
    ['salgsopstilling',  'Salgsopstilling'],
  ];

  // Estimate total document chars
  let totalDocChars = 0;
  for (const [key] of docMeta) {
    if (fileContents[key]) totalDocChars += fileContents[key].length;
  }

  // Conservative fixed estimate for the prompt template (address + sections + options)
  const TEMPLATE_SIZE_ESTIMATE = 5000;

  if (TEMPLATE_SIZE_ESTIMATE + totalDocChars < MAX_PROMPT_CHARS) {
    // Everything fits – send all document content in a single request
    updateTypingStatus('Genererer køberrapport…');
    return await AIApi.sendMessage(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildKoeberrapportPrompt(address, fileContents, options) },
    ]);
  }

  // Total content is too large for one request – process uploaded documents
  // SEQUENTIALLY (one at a time) to avoid hitting the tokens-per-minute rate
  // limit.  Within each document, all chunks are still parallel for speed.
  const uploadedDocs = docMeta.filter(([key]) => fileContents[key]);
  const processedContents = {};
  for (const [key, label] of uploadedDocs) {
    updateTypingStatus(`Analyserer ${label}…`);
    try {
      processedContents[key] = await processDocumentInChunks(settings, label, address, fileContents[key]);
    } catch (err) {
      processedContents[key] = `[Analyse af ${label} mislykkedes: ${err?.message || 'Ukendt fejl'}]`;
    }
  }

  // Build and send the final report using the processed (summarised) content
  updateTypingStatus('Genererer køberrapport…');
  return await AIApi.sendMessage(settings, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildKoeberrapportPrompt(address, processedContents, options) },
  ]);
}

/**
 * Split a large document into CHUNK_SIZE pieces, analyse all chunks in parallel,
 * and return the combined AI-generated summaries in original order.
 * Using Promise.all means all chunks are dispatched simultaneously so the total
 * wait equals the slowest chunk, not the sum of all chunks.
 */
async function processDocumentInChunks(settings, docLabel, address, content) {
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }

  const chunkResults = await Promise.allSettled(chunks.map((chunk, i) => {
    const chunkPrompt =
      `Du analyserer del ${i + 1} af ${chunks.length} af dokumentet "${docLabel}" ` +
      `for boligen på ${address}.\n\n` +
      `Uddrag alle vigtige oplysninger fra denne del: fund, karakterer (K1/K2/K3), ` +
      `problemer, anbefalinger og relevante tal.\n\n${chunk}`;
    return AIApi.sendMessage(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: chunkPrompt },
    ]).then(summary => `[Del ${i + 1}/${chunks.length}]\n${summary}`);
  }));

  const summaries = chunkResults.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : `[Del ${i + 1}/${chunks.length}]\n[Analyse mislykkedes: ${result.reason?.message || 'Ukendt fejl'}]`
  );

  return summaries.join('\n\n');
}

/**
 * Append a follow-up offer to the chat asking whether the user wants an
 * energy analysis from the uploaded Energimærkerapport.  The offer is shown
 * as an assistant message with a single action button.  Clicking the button
 * triggers addEnergyAnalysis() for the same conversation.
 */
function offerEnergyAnalysis(settings, address, convId, energimaerkeContent) {
  const container = $('messages-container');
  const wrap = document.createElement('div');
  wrap.className = 'message assistant';
  wrap.innerHTML = `
    <div class="message-avatar">🏡</div>
    <div class="message-bubble">
      <p>🌿 <strong>Energimærkerapport uploadet.</strong> Ønsker du en detaljeret energianalyse med forbedringsforslagene tilføjet til rapporten?</p>
      <button class="btn-energy-analysis" type="button">📊 Ja, tilføj energianalyse</button>
    </div>
  `;
  container.appendChild(wrap);
  scrollToBottom();

  wrap.querySelector('.btn-energy-analysis').addEventListener('click', async () => {
    wrap.remove();
    await addEnergyAnalysis(settings, address, convId, energimaerkeContent);
  });
}

/**
 * Send the Energimærkerapport to the AI as a follow-up in the existing
 * conversation and append the energy analysis to the chat.
 */
async function addEnergyAnalysis(settings, address, convId, energimaerkeContent) {
  if (isLoading) return;

  const conv = Storage.getConversation(convId);
  if (!conv) return;

  const displayMsg = '📊 Tilføj energianalyse';
  appendMessage('user', displayMsg);

  isLoading = true;
  $('send-btn').disabled = true;
  showTypingIndicator();
  updateTypingStatus('Analyserer energimærkerapport…');

  const energiPrompt =
    `Tilføj en energianalyse til køberrapporten for ${address} baseret på energimærkerapporten:\n\n` +
    `### Energimærkerapport\n${energimaerkeContent}\n\n` +
    `Beskriv: nuværende energimærke og estimeret varmeforbrug, de vigtigste energiforbedrende tiltag, ` +
    `estimerede besparelser og investeringer samt en prioriteret handlingsplan.`;

  try {
    const reply = await AIApi.sendMessage(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conv.messages,
      { role: 'user', content: energiPrompt },
    ]);
    removeTypingIndicator();
    appendMessage('assistant', reply);
    conv.messages.push({ role: 'user', content: displayMsg });
    conv.messages.push({ role: 'assistant', content: reply });
    Storage.updateConversation(convId, { messages: conv.messages });
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ **Fejl:** ${escapeHtml(err.message)}`);
  } finally {
    isLoading = false;
    $('send-btn').disabled = false;
  }
}

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

function updateTypingStatus(text) {
  const indicator = $('typing-indicator');
  if (!indicator) return;
  const bubble = indicator.querySelector('.message-bubble');
  if (!bubble) return;
  bubble.innerHTML = `
    <div class="typing-dots"><span></span><span></span><span></span></div>
    <span class="typing-status">${escapeHtml(text)}</span>
  `;
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

  // Bolig rapport modal
  $('btn-bolig-rapport').addEventListener('click', openBoligModal);
  $('btn-close-bolig').addEventListener('click', closeBoligModal);
  $('btn-cancel-bolig').addEventListener('click', closeBoligModal);
  $('btn-generate-report').addEventListener('click', generateKoeberrapport);
  $('bolig-modal').addEventListener('click', e => {
    if (e.target === $('bolig-modal')) closeBoligModal();
  });

  // File upload inputs
  BOLIG_DOCS.forEach(doc => {
    $(`file-${doc}`).addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await handleFileUpload(doc, file);
    });
  });

  // File remove buttons (event delegation on modal body)
  $('bolig-modal').addEventListener('click', e => {
    const btn = e.target.closest('.file-remove-btn');
    if (btn) removeBoligFile(btn.dataset.doc);
  });

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
