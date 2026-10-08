// PairDrop, in the background: starts the native engine when the app starts (so other devices can find this PC
// whatever tab is open), keeps the latest state, and tells the screen when it changes. The engine itself is
// native (src-tauri/pairdrop-core) and speaks the same protocol as the Mac app, so a PC and a Mac find each other.
import { load, save } from '../store.js';
import { invoke, listen, notify } from '../native.js';

const EMPTY = { running: false, code: '------', status: 'PairDrop is off', deviceName: '', username: '', peers: [], threads: [], unread: 0, sending: false, progress: null };
let snap = EMPTY;
const subs = new Set();

export const state = () => snap;
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const enabled = () => load('pd.enabled', true);

function set(s) {
  if (!s) return;
  snap = s;
  for (const fn of subs) { try { fn(snap); } catch (e) { console.error(e); } }
}

export async function start() {
  await listen('pairdrop', set);
  await listen('pairdrop-received', (e) => notify('PairDrop: file received', `${e.name} from ${e.from}, saved to Downloads.`));
  await listen('pairdrop-message', (e) => { if (e.text) notify(e.from, String(e.text).slice(0, 140)); });
  set(enabled() ? await invoke('pd_start', { username: load('pd.username', '') }) : await invoke('pd_state'));
}

export const api = {
  async enable(on) { save('pd.enabled', on); set(on ? await invoke('pd_start', { username: load('pd.username', '') }) : await invoke('pd_stop')); },
  async setUsername(name) { save('pd.username', name.trim()); set(await invoke('pd_set_username', { name })); },
  async regenerate() { set(await invoke('pd_regenerate_code')); },
  send: (paths, code, peer) => invoke('pd_send', { paths, code, peer: peer || null }),
  chatStart: (code, peer) => invoke('pd_chat_start', { code, peer: peer || null }),
  chatSend: (thread, text) => invoke('pd_chat_send', { thread, text }),
  chatRead: (thread) => invoke('pd_chat_read', { thread }),
  chatClose: (thread) => invoke('pd_chat_close', { thread }),
};
