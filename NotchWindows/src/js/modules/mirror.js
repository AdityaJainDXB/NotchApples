// Mirror (Pro): your camera, to check how you look before a call. Nothing is recorded.
import { el } from '../store.js';
import { empty } from '../ui.js';

export function render(root) {
  const video = el('video', { autoplay: true, playsinline: true, muted: true, style: 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);border-radius:16px;background:#000' });
  root.append(el('div', { class: 'fill', style: 'position:relative' }, video));
  let stream = null;
  navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }).then((s) => { stream = s; video.srcObject = s; })
    .catch((e) => root.replaceChildren(empty('📷', 'Camera unavailable', `${e.message}. Check Windows Settings → Privacy & security → Camera.`)));
  return () => stream?.getTracks().forEach((t) => t.stop());
}
