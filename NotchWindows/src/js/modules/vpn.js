// VPN (Pro): free VPN Gate servers through Windows' built-in VPN (L2TP), or
// open a server's OpenVPN profile in the OpenVPN app.
import { el } from '../store.js';
import { invoke, http } from '../native.js';
import { toast, empty } from '../ui.js';

export function render(root) {
  let servers = null, busy = false;
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), status = el('div', { class: 'hstack' });
  async function paintStatus() {
    const s = await invoke('vpn_status').catch(() => ({ connected: false }));
    status.replaceChildren(el('span', { class: `badge ${s.connected ? '' : 'quiet'}` }, s.connected ? 'CONNECTED' : 'NOT CONNECTED'), el('span', { class: 'grow' }),
      s.connected ? el('button', { class: 'btn small danger', onclick: async () => { await invoke('vpn_disconnect').catch((e) => toast(e.message, { error: true })); paintStatus(); } }, 'Disconnect') : null);
  }
  async function load() {
    try {
      const r = await http('https://www.vpngate.net/api/iphone/', { timeout: 30000 });
      servers = r.text.split('\n').slice(2).map((l) => l.split(',')).filter((c) => c.length > 14 && c[1]).map((c) => ({ host: c[0], ip: c[1], score: Number(c[2]), ping: Number(c[3]), speed: Number(c[4]), country: c[5], cc: c[6], ovpn: c[14] }))
        .sort((a, b) => b.score - a.score).slice(0, 40);
    } catch (e) { servers = []; toast(`Couldn't load servers: ${e.message}`, { error: true }); }
    paint();
  }
  function paint() {
    if (servers === null) { list.replaceChildren(el('div', { class: 'skel', style: 'height:200px' })); return; }
    list.replaceChildren(...servers.map((s) => el('div', { class: 'item' },
      el('div', { class: 'main' }, el('div', { style: 'font-weight:600' }, `${s.country}`), el('div', { class: 'tiny faint' }, `${s.ip} · ${Math.round(s.speed / 1e6)} Mbps · ${s.ping || '?'} ms`)),
      el('button', { class: 'btn small', onclick: async () => {
        if (busy) return; busy = true; toast(`Connecting to ${s.country}…`);
        try { await invoke('vpn_connect', { server: s.ip }); toast('Connected'); } catch (e) { toast(e.message, { error: true }); }
        busy = false; paintStatus();
      } }, 'Connect'),
      el('button', { class: 'btn small quiet', title: 'Open in the OpenVPN app', onclick: async () => {
        try { const p = await invoke('save_temp_file', { name: `vpngate-${s.cc}-${s.ip.replace(/\./g, '-')}.ovpn`, base64: s.ovpn }); await invoke('open_path', { path: p }); }
        catch { toast('Install OpenVPN Connect to use .ovpn profiles.', { error: true }); }
      } }, '.ovpn'))));
    if (!servers.length) list.append(empty('🛡', 'No servers', 'VPN Gate didn’t answer. Try again later.'));
  }
  root.append(el('div', { class: 'col fill' }, status,
    el('div', { class: 'tiny faint' }, 'Free volunteer servers from VPN Gate (University of Tsukuba). Connect uses Windows’ own VPN; some networks block it. Not for anything sensitive.'), list));
  paintStatus(); paint(); load();
}
