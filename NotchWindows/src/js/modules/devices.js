// Devices: what's using your mic or camera (with a mic mute), battery, Bluetooth.
import { el, load, save } from '../store.js';
import { invoke, openUrl } from '../native.js';
import { toggle, toast } from '../ui.js';
import { canUse } from '../features.js';
import { proNote } from './activation.js';
import * as P from '../services/privacy.js';

export function render(root) {
  const priv = el('div', { class: 'col gap-6' }), bat = el('div', { class: 'col gap-4' }), mic = el('div');
  const paintPriv = (p) => priv.replaceChildren(
    el('div', { class: 'small' }, '🎙 Microphone: ', p.microphone.length ? el('b', { class: 'warn' }, p.microphone.join(', ')) : el('span', { class: 'dim' }, 'not in use')),
    el('div', { class: 'small' }, '📷 Camera: ', p.camera.length ? el('b', { class: 'warn' }, p.camera.join(', ')) : el('span', { class: 'dim' }, 'not in use')));
  async function paintMic() {
    if (!canUse('micMute')) { mic.replaceChildren(proNote('micMute')); return; }
    const s = await invoke('audio_state').catch(() => null);
    mic.replaceChildren(el('button', { class: `btn ${s?.mic_muted ? 'danger' : 'quiet'}`, onclick: async () => { await invoke('audio_set', { what: 'mic-mute', value: s?.mic_muted ? 0 : 1 }).catch((e) => toast(e.message, { error: true })); paintMic(); } }, s?.mic_muted ? '🎙 Microphone muted — unmute' : '🎙 Mute microphone'));
  }
  async function paintBat() {
    const s = await invoke('system_stats').catch(() => null);
    bat.replaceChildren(el('div', { class: 'small' }, s?.battery_percent == null ? '🔌 This PC has no battery' : `💻 This PC: ${s.battery_percent}%${s.battery_charging ? ' · charging' : ''}`),
      el('button', { class: 'btn small quiet', onclick: () => openUrl('ms-settings:bluetooth') }, 'Bluetooth devices and their battery…'));
  }
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { class: 'section-title' }, 'Privacy'), priv, mic,
      el('label', { class: 'hstack small dim' }, toggle(load('privacy.indicator', true), (v) => save('privacy.indicator', v)), 'Show on the closed notch when in use')),
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { class: 'section-title' }, 'Battery'), bat)));
  const un = P.subscribe(paintPriv);
  paintMic(); paintBat();
  return un;
}
