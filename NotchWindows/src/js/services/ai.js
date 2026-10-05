// AI, ported from AIProviders.swift, OpenRouterFallback.swift and AIExtras.swift.
// Your keys stay on this PC and go only to the provider you pick. Requests go
// through the native side, so every provider works (no CORS problems), including
// a local Ollama. Used by the AI tab, the command palette, clipboard actions and
// automations.

import { load, save, uid } from '../store.js';
import { getJSON, HttpError } from '../native.js';
import { canUse } from '../features.js';

export const PROVIDERS = {
  gemini:     { name: 'Google Gemini', free: 'Free key', keyUrl: 'https://aistudio.google.com/apikey', def: 'gemini-3.8-flash', images: true, pdf: true },
  openRouter: { name: 'OpenRouter', free: 'Free models', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', def: 'meta-llama/llama-3.3-70b-instruct:free', images: true },
  groq:       { name: 'Groq', free: 'Free tier', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', def: 'openai/gpt-oss-120b' },
  ollama:     { name: 'Ollama (this PC)', free: 'Runs on this PC', base: 'http://localhost:11434/v1', keyUrl: 'https://ollama.com/download', def: 'llama3.2', noKey: true },
  openAI:     { name: 'ChatGPT', free: 'Paid', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', def: 'gpt-4o-mini', images: true },
  claude:     { name: 'Claude', free: 'Paid', keyUrl: 'https://console.anthropic.com/settings/keys', def: 'claude-sonnet-5', images: true, pdf: true },
  deepSeek:   { name: 'DeepSeek', free: 'Paid, low cost', base: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', def: 'deepseek-chat' },
};

const BASE_SYSTEM = "You are a helpful assistant living in the user's notch on their Windows PC. Be concise and use Markdown when it helps. "
  + 'When given a screenshot, describe or reason about what is on screen as asked.';

export const keyOf = (p) => load(`ai.key.${p}`, '');
export const setKey = (p, v) => save(`ai.key.${p}`, v.trim());
export const modelOf = (p) => load(`ai.model.${p}`, PROVIDERS[p]?.def || '');
export const setModel = (p, v) => save(`ai.model.${p}`, v.trim());
export const provider = () => { const p = load('ai.provider', 'gemini'); return PROVIDERS[p] ? p : 'gemini'; };
export const setProvider = (p) => save('ai.provider', p);
export const ready = (p = provider()) => PROVIDERS[p].noKey || !!keyOf(p);

// ---- model lists (live, cached 10 minutes) ----

const modelCache = new Map();

export async function listModels(p) {
  const hit = modelCache.get(p);
  if (hit && Date.now() - hit.at < 600_000) return hit.list;
  let list = [];
  try {
    if (p === 'gemini' && keyOf(p)) {
      const j = await getJSON('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': keyOf(p) } });
      list = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
    } else if (p === 'openRouter') {
      const j = await getJSON('https://openrouter.ai/api/v1/models');
      list = (j.data || []).map((m) => ({ id: m.id, label: m.name || m.id,
        free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
        images: (m.architecture?.input_modalities || []).includes('image'),
        textOut: JSON.stringify(m.architecture?.output_modalities || ['text']) === '["text"]' }));
    } else if (p === 'claude' && keyOf(p)) {
      const j = await getJSON('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': keyOf(p), 'anthropic-version': '2023-06-01' } });
      list = (j.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
    } else if (PROVIDERS[p].base && (keyOf(p) || PROVIDERS[p].noKey)) {
      const j = await getJSON(`${PROVIDERS[p].base}/models`, { headers: keyOf(p) ? { Authorization: `Bearer ${keyOf(p)}` } : {}, timeout: 8000 });
      list = (j.data || []).map((m) => ({ id: m.id, label: m.id }));
    }
  } catch { list = hit?.list || []; }
  modelCache.set(p, { at: Date.now(), list });
  return list;
}

// ---- personas and saved prompts (Pro) ----

export const BUILT_IN_PERSONAS = [
  { id: 'tutor', name: 'Tutor', instructions: 'Act as a patient tutor: explain step by step, check understanding, and end with one short practice question.' },
  { id: 'concise', name: 'Concise', instructions: 'Answer as briefly as possible: a sentence or a short list, no preamble.' },
  { id: 'code', name: 'Code reviewer', instructions: 'Act as a senior engineer reviewing code: point out bugs, risks and simpler alternatives, with corrected snippets.' },
  { id: 'writing', name: 'Writing coach', instructions: "Help improve writing: keep the author's voice, suggest clearer wording, and explain the main changes briefly." },
];
export const personas = () => load('ai.personas', BUILT_IN_PERSONAS);
export const activePersona = () => (canUse('personas') ? personas().find((p) => p.id === load('ai.activePersona', '')) : null);
export const savedPrompts = () => load('ai.savedPrompts', [
  { title: 'Summarise my clipboard', text: '/summarize' },
  { title: "Explain like I'm 12", text: "Explain this like I'm 12: " },
]);

export function systemPrompt() {
  const p = activePersona();
  return BASE_SYSTEM + (p ? `\n\nStanding instructions from the user (persona "${p.name}"): ${p.instructions}` : '');
}

// ---- slash commands (Pro) ----

export const SLASH = {
  '/summarize': { help: 'Summarise text (or your clipboard)', template: (t) => `Summarise this in a few short bullet points:\n\n${t}` },
  '/explain': { help: 'Explain something clearly', template: (t) => `Explain this clearly and simply:\n\n${t}` },
  '/eli5': { help: "Explain like I'm 5", template: (t) => `Explain this like I'm five years old:\n\n${t}` },
  '/fix': { help: 'Fix spelling and grammar', template: (t) => `Fix the spelling and grammar of this text. Reply with the corrected text only:\n\n${t}` },
  '/translate': { help: '/translate fr: text', template: (t) => { const m = t.match(/^([a-z-]{2,10})\s*:\s*([\s\S]*)$/i); return m ? `Translate this into ${m[1]}. Reply with the translation only:\n\n${m[2]}` : `Translate this into English. Reply with the translation only:\n\n${t}`; } },
  '/code': { help: 'Write code', template: (t) => `Write code for this. Reply with a short explanation and the code:\n\n${t}` },
  '/web': { help: 'Search the web and answer with sources', web: true, template: (t) => t },
};

/// Expands "/summarize …" into a prompt. Empty text uses the clipboard.
export async function expandSlash(input) {
  const m = input.match(/^(\/\w+)\s*([\s\S]*)$/);
  if (!m || !SLASH[m[1]] || !canUse('slashCommands')) return { prompt: input, web: false };
  let rest = m[2].trim();
  if (!rest && m[1] !== '/web') {
    const { items } = await import('./clipboard.js');
    rest = items().find((i) => i.kind === 'text')?.text || '';
  }
  return { prompt: SLASH[m[1]].template(rest), web: !!SLASH[m[1]].web, command: m[1] };
}

// ---- web search (Pro) ----

/// Top results from DuckDuckGo's HTML page: [{ title, url, snippet }].
export async function webSearch(query) {
  const { http } = await import('../native.js');
  const r = await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'Accept-Language': navigator.language || 'en' } });
  const doc = new DOMParser().parseFromString(r.text, 'text/html');
  const out = [];
  for (const res of doc.querySelectorAll('.result')) {
    const a = res.querySelector('a.result__a');
    if (!a) continue;
    let url = a.getAttribute('href') || '';
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(url) || url.includes('duckduckgo.com/y.js')) continue;
    out.push({ title: a.textContent.trim(), url, snippet: res.querySelector('.result__snippet')?.textContent.trim() || '' });
    if (out.length >= 6) break;
  }
  return out;
}

// ---- sending ----

function err(status, message) { return new HttpError(status, message); }

/// One request. `messages`: [{ role: 'user'|'assistant', text, images: [{ mime, data }], pdf: { name, data } }]
async function sendOnce(p, model, messages, system) {
  const key = keyOf(p);
  if (!PROVIDERS[p].noKey && !key) throw err(0, `Add your ${PROVIDERS[p].name} key in Settings → AI.`);

  if (p === 'gemini') {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [
        ...(m.images || []).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
        ...(m.pdf ? [{ inline_data: { mime_type: 'application/pdf', data: m.pdf.data } }] : []),
        { text: m.text || ' ' }] })),
    };
    const j = await getJSON(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', json: body, headers: { 'x-goog-api-key': key }, timeout: 120000 });
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text).filter(Boolean).join('');
    if (!text) throw err(0, j.promptFeedback?.blockReason ? `Gemini declined to answer (${j.promptFeedback.blockReason}).` : 'The model returned an empty answer.');
    return text;
  }

  if (p === 'claude') {
    const body = { model, max_tokens: 4096, system, messages: messages.map((m) => ({ role: m.role,
      content: [
        ...(m.images || []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
        ...(m.pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.pdf.data } }] : []),
        { type: 'text', text: m.text || ' ' }] })) };
    const j = await getJSON('https://api.anthropic.com/v1/messages', { method: 'POST', json: body, timeout: 120000,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    const text = (j.content || []).map((c) => c.text).filter(Boolean).join('');
    if (!text) throw err(0, 'The model returned an empty answer.');
    return text;
  }

  // OpenAI-compatible: OpenRouter, Groq, Ollama, ChatGPT, DeepSeek.
  if (messages.some((m) => m.pdf)) throw err(0, 'PDFs work with Gemini and Claude. Switch provider, or paste the text.');
  const body = { model, messages: [{ role: 'system', content: system }, ...messages.map((m) => (m.images?.length
    ? { role: m.role, content: [{ type: 'text', text: m.text || ' ' }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] }
    : { role: m.role, content: m.text || ' ' }))] };
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  if (p === 'openRouter') { headers['HTTP-Referer'] = 'https://github.com/AdityaJainDXB/NotchApples'; headers['X-Title'] = 'Notch apple'; }
  let j;
  try {
    j = await getJSON(`${PROVIDERS[p].base}/chat/completions`, { method: 'POST', json: body, headers, timeout: 180000 });
  } catch (e) {
    if (p === 'ollama' && !e.status) throw err(0, "Ollama isn't running on this PC. Install it from ollama.com and run a model (for example `ollama run llama3.2`).");
    throw e;
  }
  const text = j.choices?.[0]?.message?.content || '';
  if (!text) throw err(0, 'The model returned an empty answer.');
  return text;
}

// ---- OpenRouter retry and fallback (ported from OpenRouterFallback.swift) ----

const isChat = (id) => !['safety', 'guard', 'embed', 'moderation', 'rerank'].some((w) => id.toLowerCase().includes(w));
const rank = (id) => { const s = id.toLowerCase(); return s.includes('gemma') ? 0 : s.includes('qwen') ? 1 : s.includes('llama') ? 2 : 3; };

export function candidates(chosen, needsImages, models) {
  if (!models.length) return [chosen];
  const known = models.find((m) => m.id === chosen);
  const out = [];
  if (!known || !needsImages || known.images) out.push(chosen);
  out.push(...models.filter((m) => m.free && m.textOut && m.id !== chosen && isChat(m.id) && (!needsImages || m.images))
    .map((m) => m.id).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)));
  return out.slice(0, 5);
}

const isBusy = (e) => { const c = e?.status ?? 0; return c === 429 || c === 408 || c >= 500 || (c === 404 && /no endpoints/i.test(e?.message || '')); };

/// Sends a conversation. Returns { text, model, note }.
export async function send(messages, { p = provider(), model = modelOf(p), system = systemPrompt() } = {}) {
  if (p !== 'openRouter') return { text: await sendOnce(p, model, messages, system), model, note: null };
  const needsImages = messages.some((m) => m.images?.length);
  const models = await listModels('openRouter');
  const order = candidates(model, needsImages, models);
  const chosenCanSee = models.find((m) => m.id === model)?.images ?? true;
  const busy = [];
  let last;
  for (let i = 0; i < order.length; i++) {
    for (let t = 0; t < (i === 0 ? 2 : 1); t++) {
      try {
        const text = await sendOnce('openRouter', order[i], messages, system);
        const note = order[i] === model ? null
          : (needsImages && !chosenCanSee && !busy.includes(model)) ? `${model} can't read images, so ${order[i]} answered.` : `${model} was busy, so ${order[i]} answered.`;
        if (order[i] !== model && needsImages && !chosenCanSee) setModel('openRouter', order[i]);
        return { text, model: order[i], note };
      } catch (e) {
        last = e;
        if (!isBusy(e)) throw e;
        if (t === 0 && i === 0) await new Promise((r) => setTimeout(r, 2000)); else busy.push(order[i]);
      }
    }
  }
  if (order.length <= 1 && last) throw last;
  throw err(429, `Every free model I tried is busy (${busy.slice(0, 3).join(', ')}). Wait a minute, add a little credit on openrouter.ai, or use Gemini — its key is free.`);
}

/// One question, one answer (palette, clipboard actions, automations).
export async function ask(question, opts = {}) {
  return (await send([{ role: 'user', text: question }], opts)).text;
}

/// Answers using web results as sources (Pro: Web search with sources).
export async function askWithWeb(question, history = [], opts = {}) {
  const results = await webSearch(question).catch(() => []);
  const sources = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n');
  const prompt = results.length
    ? `Answer using these web results, citing them like [1]. Finish with a "Sources" list of the ones you used.\n\nResults:\n${sources}\n\nQuestion: ${question}`
    : question;
  const r = await send([...history, { role: 'user', text: prompt }], opts);
  return { ...r, sources: results };
}

// ---- clipboard actions (Pro) ----

export const CLIPBOARD_ACTIONS = {
  summarize: { label: 'Summarise', prompt: 'Summarise this in a few short bullet points. Reply with the summary only.' },
  fix: { label: 'Fix grammar', prompt: 'Fix the spelling and grammar. Reply with the corrected text only, nothing else.' },
  translate: { label: 'Translate to English', prompt: 'Translate this into English. Reply with the translation only.' },
  explain: { label: 'Explain', prompt: 'Explain this simply and briefly.' },
};

// ---- history (Pro) ----

export const chats = () => load('ai.history', []);
export function saveChat(chat) {
  if (!canUse('aiHistory') || !chat.messages.length) return chat;
  const c = { ...chat, id: chat.id || uid(), at: Date.now(),
    title: chat.title || chat.messages.find((m) => m.role === 'user')?.text.slice(0, 60) || 'Chat',
    // Screenshots and files are not kept, to keep storage small.
    messages: chat.messages.map(({ role, text, model }) => ({ role, text: (text || '').slice(0, 20000), model })) };
  save('ai.history', [c, ...chats().filter((x) => x.id !== c.id)].slice(0, 200));
  return c;
}
export const deleteChat = (id) => save('ai.history', chats().filter((c) => c.id !== id));
