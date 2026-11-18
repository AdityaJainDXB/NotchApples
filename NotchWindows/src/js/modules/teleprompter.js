// Tools → Teleprompter: type or paste a script, press Start, and it scrolls up a reading line at the speed you choose.
// Speed, text size and mirror are saved. The rules are in services/teleprompterlogic.js. Everything stays on this PC.
import { el, load, save } from '../store.js';
import * as L from '../services/teleprompterlogic.js';

export function render(root) {
  let speed = L.clampSpeed(load('teleprompter.speed', L.DEFAULT_SPEED));
  let font = L.clampFont(load('teleprompter.font', L.DEFAULT_FONT));
  let mirror = !!load('teleprompter.mirror', false);
  let running = false, finished = false, offset = 0, last = 0, raf = 0;

  const script = el('textarea', { class: 'field', style: 'flex:1;min-height:70px', placeholder: 'Type or paste what you want to read…' });
  script.value = load('teleprompter.script', '');
  const info = el('div', { class: 'small dim grow' });
  const clear = el('button', { class: 'quiet', style: 'font-size:11px', onclick: () => { script.value = ''; script.oninput(); } }, 'Clear');
  const editor = el('div', { class: 'card col gap-6', style: 'flex:1;min-height:0' },
    el('div', { class: 'section-title' }, 'Your script'), script, el('div', { class: 'hstack' }, info, clear));

  const text = el('div', { style: 'position:absolute;left:14px;right:14px;top:0;font-weight:600;white-space:pre-wrap;line-height:1.4;will-change:transform' });
  const guide = el('div', { style: 'position:absolute;left:0;right:0;top:40%;height:2px;background:var(--accent, #8b5cf6);opacity:.45;pointer-events:none' });
  const end = el('div', { class: 'small', style: 'position:absolute;top:6px;left:50%;transform:translateX(-50%);padding:2px 8px;border-radius:99px;background:var(--surface, #222);display:none' }, 'End of script');
  const viewport = el('div', { class: 'card', style: 'position:relative;flex:1;min-height:96px;overflow:hidden;padding:0' }, text, guide, end);

  const start = el('button', { class: 'btn' }, 'Start');
  const reset = el('button', { class: 'quiet', style: 'display:none' }, 'Reset');
  const speedNote = el('span', { class: 'small dim' });
  const sizeNote = el('span', { class: 'small dim' });
  const speedBox = el('input', { type: 'range', min: String(L.SPEED_MIN), max: String(L.SPEED_MAX), step: '1', style: 'width:90px' });
  const sizeBox = el('input', { type: 'range', min: String(L.FONT_MIN), max: String(L.FONT_MAX), step: '2', style: 'width:80px' });
  speedBox.value = String(speed);
  sizeBox.value = String(font);
  const mirrorBox = el('input', { type: 'checkbox' });
  mirrorBox.checked = mirror;
  const controls = el('div', { class: 'hstack', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' },
    start, reset, el('div', { class: 'grow' }),
    el('div', { class: 'col', style: 'gap:1px' }, el('div', { class: 'hstack', style: 'gap:4px' }, el('span', { class: 'small dim' }, 'Speed'), speedNote), speedBox),
    el('div', { class: 'col', style: 'gap:1px' }, el('div', { class: 'hstack', style: 'gap:4px' }, el('span', { class: 'small dim' }, 'Size'), sizeNote), sizeBox),
    el('label', { class: 'hstack small', style: 'gap:4px', title: 'Flips the text sideways, for a prompter glass' }, mirrorBox, 'Mirror'));
  const host = el('div', { class: 'col', style: 'flex:1;min-height:0;gap:8px' });

  const reading = () => running || offset > 0 || finished;
  const maxOffset = () => text.offsetHeight + viewport.clientHeight * 0.4 - viewport.clientHeight;
  function paint() {
    const w = L.wordCount(script.value);
    speedNote.textContent = `${L.wordsPerMinute(speed)} wpm`;
    sizeNote.textContent = `${Math.round(font)} px`;
    info.textContent = w === 0 ? 'No words yet' : `${w} words · about ${L.clock(L.seconds(w, speed))} at this speed`;
    start.textContent = running ? 'Pause' : (offset > 0 && !finished ? 'Resume' : 'Start');
    start.disabled = w === 0;
    reset.style.display = reading() ? '' : 'none';
    text.style.fontSize = `${font}px`;
    text.style.transform = `translateY(${viewport.clientHeight * 0.4 - offset}px)`;
    viewport.style.transform = mirror ? 'scaleX(-1)' : '';
    end.style.display = finished ? '' : 'none';
    host.replaceChildren(controls, reading() ? viewport : editor);
  }
  function frame(now) {
    if (!root.isConnected) { running = false; return; }          // the page was left: stop quietly
    if (running) {
      const dt = Math.min((now - last) / 1000, 0.2);
      const step = L.advance(offset, dt, speed, font, maxOffset());
      offset = step.offset;
      text.style.transform = `translateY(${viewport.clientHeight * 0.4 - offset}px)`;
      if (step.finished) { running = false; finished = true; paint(); return; }
      last = now;
      raf = requestAnimationFrame(frame);
    }
  }
  function begin() {
    if (finished) { offset = 0; finished = false; }
    text.textContent = script.value;
    running = true; last = performance.now();
    paint();
    raf = requestAnimationFrame(frame);
  }
  start.onclick = () => { if (running) { running = false; cancelAnimationFrame(raf); paint(); } else begin(); };
  reset.onclick = () => { running = false; finished = false; offset = 0; cancelAnimationFrame(raf); paint(); };
  script.oninput = () => { save('teleprompter.script', script.value); paint(); };
  speedBox.oninput = () => { speed = L.clampSpeed(speedBox.value); save('teleprompter.speed', speed); paint(); };
  sizeBox.oninput = () => { font = L.clampFont(sizeBox.value); save('teleprompter.font', font); paint(); };
  mirrorBox.onchange = () => { mirror = mirrorBox.checked; save('teleprompter.mirror', mirror); paint(); };

  root.append(host);
  paint();
}
