// Window snapping, from the Mac's Windows tab: acts on the window you were using.
import { el } from '../store.js';
import { invoke } from '../native.js';
import { collapse, show } from '../app.js';
import { toast } from '../ui.js';

const LAYOUTS = [
  ['left', '◧', 'Left half'], ['right', '◨', 'Right half'], ['top', '⬒', 'Top half'], ['bottom', '⬓', 'Bottom half'],
  ['top-left', '◰', 'Top left'], ['top-right', '◳', 'Top right'], ['bottom-left', '◱', 'Bottom left'], ['bottom-right', '◲', 'Bottom right'],
  ['left-third', '▏', 'Left third'], ['center-third', '▕', 'Centre third'], ['right-third', '▕', 'Right third'], ['left-two-thirds', '◧', 'Left two thirds'],
  ['right-two-thirds', '◨', 'Right two thirds'], ['maximize', '⬜', 'Maximise'], ['almost-maximize', '▣', 'Almost maximise'], ['center', '◻', 'Centre'],
  ['next-display', '🖥', 'Next screen'], ['restore', '↺', 'Restore'],
];
export function render(root) {
  const go = async (action) => { await collapse(); try { await invoke('snap_window', { action }); } catch (e) { toast(e.message, { error: true }); } };
  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'small dim' }, 'Click a layout: the window you were using before opening the notch moves there. Set keyboard shortcuts in Settings → Shortcuts.'),
    el('div', { class: 'grid scroll', style: 'grid-template-columns:repeat(auto-fill,minmax(110px,1fr));flex:1' },
      ...LAYOUTS.map(([a, g, n]) => el('div', { class: 'tile', onclick: () => go(a) }, el('div', { class: 'glyph' }, g), el('div', { class: 'name' }, n)))),
    el('div', { class: 'hstack' }, el('button', { class: 'btn', onclick: async () => { await collapse(); invoke('tile_windows').catch((e) => toast(e.message, { error: true })); } }, '⊞ Tile all windows'),
      el('button', { class: 'btn quiet', onclick: () => show('settings', { pane: 'Shortcuts' }) }, 'Shortcuts…'))));
}
