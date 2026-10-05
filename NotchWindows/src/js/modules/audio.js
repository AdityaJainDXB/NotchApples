// Audio (Pro): master volume, output, mic mute and per-app volume.
import { el } from '../store.js';
import { invoke, openUrl } from '../native.js';
import { toast, empty } from '../ui.js';

export function render(root) {
  const wrap = el('div', { class: 'row fill' });
  root.append(wrap);
  const set = (what, value, app) => invoke('audio_set', { what, value, app }).catch((e) => toast(e.message, { error: true }));
  async function paint() {
    const s = await invoke('audio_state');
    if (!s.available) { wrap.replaceChildren(el('div', { class: 'card', style: 'flex:1' }, empty('🔇', 'No audio device', 'Connect speakers or headphones.'))); return; }
    const vol = el('input', { type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100) });
    vol.oninput = () => set('volume', vol.value / 100);
    wrap.replaceChildren(
      el('div', { class: 'card col gap-6', style: 'flex:1' }, el('div', { class: 'section-title' }, 'Output'),
        el('div', { class: 'small' }, `🔈 ${s.output}`),
        el('div', { class: 'hstack' }, el('button', { class: `icon-btn ${s.muted ? 'on' : ''}`, title: 'Mute', onclick: async () => { await set('mute', s.muted ? 0 : 1); paint(); } }, s.muted ? '🔇' : '🔊'), vol),
        el('div', { class: 'section-title' }, 'Devices'),
        ...s.outputs.map((d) => el('div', { class: 'small' }, d.default ? '● ' : '○ ', d.name)),
        el('button', { class: 'btn small quiet', onclick: () => openUrl('ms-settings:sound') }, 'Change output in Windows…'),
        el('div', { class: 'section-title' }, 'Microphone'),
        el('div', { class: 'hstack small' }, el('span', { class: 'grow ellipsis' }, s.input || 'None'), el('button', { class: `btn small ${s.mic_muted ? 'danger' : 'quiet'}`, onclick: async () => { await set('mic-mute', s.mic_muted ? 0 : 1); paint(); } }, s.mic_muted ? '🎙 Muted — unmute' : '🎙 Mute mic'))),
      el('div', { class: 'card col gap-6 scroll', style: 'flex:1.2' }, el('div', { class: 'section-title' }, 'Apps'),
        ...s.apps.map((a) => { const r = el('input', { type: 'range', min: 0, max: 100, value: Math.round(a.volume * 100), style: 'flex:1' }); r.oninput = () => set('app-volume', r.value / 100, a.name);
          return el('div', { class: 'hstack small' }, el('span', { class: 'ellipsis', style: `width:130px;${a.active ? '' : 'opacity:.6'}` }, a.name), r, el('button', { class: 'icon-btn', onclick: async () => { await set('app-mute', a.muted ? 0 : 1, a.name); paint(); } }, a.muted ? '🔇' : '🔊')); }),
        s.apps.length ? null : el('div', { class: 'small dim' }, 'Apps playing sound appear here.')));
  }
  paint().catch((e) => wrap.replaceChildren(el('div', { class: 'err' }, e.message)));
  const t = setInterval(() => { if (!document.activeElement?.matches('input[type=range]')) paint().catch(() => {}); }, 4000);
  return () => clearInterval(t);
}
