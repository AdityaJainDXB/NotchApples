// Share: send files to phones and computers nearby with PairDrop (works in any
// browser, end-to-end on your network) or Windows Nearby sharing.
import { el } from '../store.js';
import { invoke, openUrl } from '../native.js';

export function render(root) {
  root.append(el('div', { class: 'row fill' },
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { style: 'font-size:30px' }, '📤'), el('div', { class: 'title' }, 'PairDrop'),
      el('div', { class: 'small dim' }, 'Open pairdrop.net on both devices (phone, Mac, PC). Devices on the same Wi-Fi appear automatically; pair others with a 6-digit code.'),
      el('button', { class: 'btn', onclick: () => invoke('open_browser', { url: 'https://pairdrop.net/' }) }, 'Open PairDrop')),
    el('div', { class: 'card col', style: 'flex:1' }, el('div', { style: 'font-size:30px' }, '🪟'), el('div', { class: 'title' }, 'Nearby sharing'),
      el('div', { class: 'small dim' }, 'Windows can send files to nearby Windows PCs over Bluetooth and Wi-Fi. Right-click a file → Share in Explorer.'),
      el('button', { class: 'btn quiet', onclick: () => openUrl('ms-settings:crossdevice') }, 'Nearby sharing settings'))));
}
