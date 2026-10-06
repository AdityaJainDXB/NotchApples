// Panic hide: one key for "someone just walked up". Closes the notch, hides it completely, empties the clipboard and, if
// you like, wipes the clipboard history (pinned items stay). Bring the notch back with the hide shortcut (Ctrl+Alt+O).
// Nothing is sent anywhere.

import { load, save } from '../store.js';
import { invoke } from '../native.js';

export const wipesHistory = () => load('panic.wipeHistory', true);
export const setWipesHistory = (v) => save('panic.wipeHistory', !!v);

export async function panic() {
  const { collapse } = await import('../app.js');
  await collapse?.().catch?.(() => {});
  await invoke('set_hidden', { hidden: true }).catch(() => {});
  await invoke('clipboard_copy_text', { text: '' }).catch(() => {});
  if (wipesHistory()) (await import('./clipboard.js')).clearAll({ keepPinned: true });
}
