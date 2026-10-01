// AI chat, ported from AIProviders.swift + OpenRouterFallback.swift.
// Your key is stored on this PC only and sent only to the provider you pick.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

export const PROVIDERS = {
  gemini:     { name: 'Google Gemini', free: 'Free key',            base: null, keyUrl: 'https://aistudio.google.com/apikey',  def: 'gemini-2.0-flash' },
  openRouter: { name: 'OpenRouter',    free: 'Free models',          base: 'https://openrouter.ai/api/v1',  keyUrl: 'https://openrouter.ai/keys',       def: 'google/gemma-4-31b-it:free' },
  groq:       { name: 'Groq',          free: 'Free tier',            base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',   def: 'llama-3.3-70b-versatile' },
  ollama:     { name: 'Ollama (local)',free: 'Runs on this PC',      base: 'http://localhost:11434/v1',     keyUrl: 'https://ollama.com',               def: 'llama3.2' },
  openAI:     { name: 'ChatGPT',       free: 'Paid',                 base: 'https://api.openai.com/v1',     keyUrl: 'https://platform.openai.com/api-keys', def: 'gpt-4o-mini' },
  claude:     { name: 'Claude',        free: 'Paid',                 base: null, keyUrl: 'https://console.anthropic.com/settings/keys', def: 'claude-sonnet-5' },
};

const SYSTEM = "You are a helpful assistant living in the user's notch. Be concise. "
             + 'When given a screenshot, describe or reason about what is on screen as asked.';

const keyOf = (p) => load(`ai.key.${p}`, '');
export const setKey = (p, v) => save(`ai.key.${p}`, v);
const modelOf = (p) => load(`ai.model.${p}`, PROVIDERS[p].def);
const setModel = (p, v) => save(`ai.model.${p}`, v);

// ---- OpenRouter model list + fallback (ported from OpenRouterFallback.swift) ----

let modelCache = null, modelCacheAt = 0;

export async function openRouterModels() {
  if (modelCache && Date.now() - modelCacheAt < 600000) return modelCache;
  try {
    const json = await fetch('https://openrouter.ai/api/v1/models').then((r) => r.json());
    modelCache = (json.data || []).map((m) => ({
      id: m.id,
      free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
      images: (m.architecture?.input_modalities || []).includes('image'),
      textOut: JSON.stringify(m.architecture?.output_modalities || ['text']) === '["text"]',
    }));
    modelCacheAt = Date.now();
  } catch { modelCache = modelCache || []; }
  return modelCache;
}

const isChat = (id) => !['safety', 'guard', 'embed', 'moderation', 'rerank'].some((w) => id.toLowerCase().includes(w));
const rank = (id) => { const s = id.toLowerCase();
  return s.includes('gemma') ? 0 : s.includes('qwen') ? 1 : s.includes('llama') ? 2 : 3; };

export function candidates(chosen, needsImages, models) {
  if (!models.length) return [chosen];
  const known = models.find((m) => m.id === chosen);
  const out = [];
  if (!known || !needsImages || known.images) out.push(chosen);
  out.push(...models
    .filter((m) => m.free && m.textOut && m.id !== chosen && isChat(m.id) && (!needsImages || m.images))
    .map((m) => m.id)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)));
  return out.slice(0, 5);
}

const isBusy = (e) => {
  const c = e?.status ?? 0;
  return c === 429 || c === 408 || c >= 500 || (c === 404 && /no endpoints/i.test(e?.message || ''));
};

// ---- sending ----

async function sendOnce(provider, model, history) {
  const key = keyOf(provider);
  if (provider === 'gemini') {
    if (!key) throw err(0, 'Add your Google Gemini key in Settings → AI.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [...(m.image ? [{ inline_data: { mime_type: 'image/jpeg', data: m.image } }] : []), { text: m.text }],
      })),
    };
    const json = await post(url, body, { 'x-goog-api-key': key });
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
    if (!text) throw err(0, 'The model returned an empty response.');
    return text;
  }
  if (provider === 'claude') {
    if (!key) throw err(0, 'Add your Claude key in Settings → AI.');
    const body = { model, max_tokens: 2048, system: SYSTEM,
      messages: history.map((m) => ({ role: m.role,
        content: m.image ? [{ type: 'text', text: m.text },
                            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image } }]
                         : m.text })) };
    const json = await post('https://api.anthropic.com/v1/messages', body,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    const text = (json.content || []).map((c) => c.text).filter(Boolean).join('');
    if (!text) throw err(0, 'The model returned an empty response.');
    return text;
  }
  // OpenAI-compatible: OpenRouter, Groq, Ollama, OpenAI
  const base = PROVIDERS[provider].base;
  if (provider !== 'ollama' && !key) throw err(0, `Add your ${PROVIDERS[provider].name} key in Settings → AI.`);
  const messages = [{ role: 'system', content: SYSTEM }, ...history.map((m) => m.image
    ? { role: m.role, content: [{ type: 'text', text: m.text },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${m.image}` } }] }
    : { role: m.role, content: m.text })];
  const headers = { ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  if (provider === 'openRouter') { headers['HTTP-Referer'] = 'https://github.com/AdityaJainDXB/NotchApples'; headers['X-Title'] = 'Notch apple'; }
  const json = await post(`${base}/chat/completions`, { model, messages }, headers);
  const text = json.choices?.[0]?.message?.content || '';
  if (!text) throw err(0, 'The model returned an empty response.');
  return text;
}

function err(status, message) { const e = new Error(message); e.status = status; return e; }

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = json.error?.message || json.error || `Request failed (${res.status}).`;
    const raw = json.error?.metadata?.raw;
    if (raw) msg += ` (${String(raw).slice(0, 200)})`;
    throw err(res.status, msg);
  }
  return json;
}

/// Sends with retry + fallback on OpenRouter, straight through elsewhere.
export async function send(provider, model, history) {
  if (provider !== 'openRouter') return { text: await sendOnce(provider, model, history), model, note: null };

  const needsImages = history.some((m) => m.image);
  const models = await openRouterModels();
  const order = candidates(model, needsImages, models);
  const chosenCanSee = models.find((m) => m.id === model)?.images ?? true;
  const busy = [];
  let last;

  for (let i = 0; i < order.length; i++) {
    const tries = i === 0 ? 2 : 1;
    for (let t = 0; t < tries; t++) {
      try {
        const text = await sendOnce('openRouter', order[i], history);
        const note = order[i] === model ? null
          : (needsImages && !chosenCanSee && !busy.includes(model))
            ? `${model} can't read images, so ${order[i]} answered.`
            : `${model} was busy, so ${order[i]} answered.`;
        if (order[i] !== model && needsImages && !chosenCanSee) setModel('openRouter', order[i]);
        return { text, model: order[i], note };
      } catch (e) {
        last = e;
        if (!isBusy(e)) throw e;
        if (t === 0 && i === 0) await new Promise((r) => setTimeout(r, 2000));
        else busy.push(order[i]);
      }
    }
  }
  if (order.length <= 1 && last) throw last;
  throw err(429, `Every free model I tried is busy or rate-limited (${busy.slice(0, 3).join(', ')}). `
    + 'Wait a minute and ask again, add a little credit on openrouter.ai, or use Gemini — its key is free.');
}

// ---- UI ----

const SCREEN_WORDS = /\b(my screen|on screen|this screen|screenshot|what('?s| is) (on|in) (my|the) screen|look at (my|the) screen)\b/i;

export function render(root) {
  let provider = load('ai.provider', 'gemini');
  let messages = [];

  const log = el('div', { class: 'col', style: 'flex:1;overflow:auto;gap:8px;padding-right:4px' });
  const input = el('input', { class: 'field', placeholder: 'Message AI…', style: 'flex:1' });
  const sendBtn = el('button', { class: 'btn' }, '↑');
  const notice = el('div', { class: 'small dim', style: 'min-height:15px' });
  const shotToggle = el('button', { class: 'btn quiet', title: 'Attach a screenshot to the next message' }, '🖥');
  let attachScreen = false;

  const providerSel = el('select', { class: 'field', style: 'max-width:150px' },
    ...Object.entries(PROVIDERS).map(([id, p]) => el('option', { value: id, selected: id === provider }, p.name)));
  const modelField = el('input', { class: 'field', style: 'max-width:240px', value: modelOf(provider) });

  providerSel.addEventListener('change', () => {
    provider = providerSel.value; save('ai.provider', provider);
    modelField.value = modelOf(provider);
    notice.textContent = keyOf(provider) || provider === 'ollama' ? '' : `Add your ${PROVIDERS[provider].name} key in Settings → AI.`;
  });
  modelField.addEventListener('change', () => setModel(provider, modelField.value.trim()));

  shotToggle.addEventListener('click', () => {
    attachScreen = !attachScreen;
    shotToggle.style.background = attachScreen ? 'var(--accent)' : '';
    shotToggle.style.color = attachScreen ? '#0b0b0b' : '';
  });

  function bubble(role, text, extra) {
    const mine = role === 'user';
    return el('div', { style: `display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'}` },
      el('div', {
        style: `max-width:78%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;user-select:text;`
             + (mine ? 'background:var(--accent);color:#0b0b0b;font-weight:500'
                     : 'background:rgba(255,255,255,.08);border:1px solid var(--border)'),
      }, extra ? el('div', { class: 'small', style: 'opacity:.75;margin-bottom:3px' }, extra) : null, text));
  }

  async function submit() {
    const prompt = input.value.trim();
    if (!prompt) return;
    input.value = '';
    notice.textContent = '';

    let image = null;
    const wantsScreen = attachScreen || SCREEN_WORDS.test(prompt);
    if (wantsScreen) {
      try {
        image = await invoke('capture_screen');
        notice.textContent = 'Took a screenshot to answer that.';
      } catch (e) {
        notice.textContent = 'Couldn\'t take a screenshot: ' + (e?.message ?? e);
      }
      attachScreen = false; shotToggle.style.background = ''; shotToggle.style.color = '';
    }

    messages.push({ role: 'user', text: prompt, image });
    log.append(bubble('user', prompt, image ? '📎 Screenshot attached' : null));
    log.scrollTop = log.scrollHeight;

    sendBtn.disabled = true;
    const thinking = bubble('assistant', '…');
    log.append(thinking); log.scrollTop = log.scrollHeight;

    try {
      const { text, note } = await send(provider, modelField.value.trim() || modelOf(provider), messages);
      messages.push({ role: 'assistant', text });
      thinking.replaceWith(bubble('assistant', text));
      if (note) notice.textContent = note;
    } catch (e) {
      thinking.replaceWith(el('div', { class: 'err', style: 'padding:4px' }, String(e?.message ?? e)));
    } finally {
      sendBtn.disabled = false;
      log.scrollTop = log.scrollHeight;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  if (!keyOf(provider) && provider !== 'ollama') notice.textContent = `Add your ${PROVIDERS[provider].name} key in Settings → AI.`;
  log.append(el('div', { class: 'center dim small' }, 'Ask anything, or ask what\'s on your screen and a screenshot is added for you.'));

  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px;align-items:center' },
      providerSel, modelField,
      el('div', { class: 'small dim', style: 'margin-left:auto' }, PROVIDERS[provider].free)),
    log, notice,
    el('div', { style: 'display:flex;gap:8px' }, shotToggle, input, sendBtn)));

  setTimeout(() => input.focus(), 40);
}
