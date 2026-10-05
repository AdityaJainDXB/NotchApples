// A stand-in for the native side when the UI runs in an ordinary browser (for
// design work and testing with dev/serve.py). Never used inside the app.
// `window.__mock.emit(event, payload)` simulates native events.

const listeners = new Map();
const state = {
  hidden: false, expanded: false, awake: 0,
  volume: 0.42, muted: false, micMuted: false,
  apps: [{ name: 'Spotify', volume: 0.8, muted: false, active: true }, { name: 'Google Chrome', volume: 1, muted: false, active: true },
    { name: 'Microsoft Teams', volume: 0.6, muted: false, active: false }, { name: 'System sounds', volume: 0.5, muted: false, active: false }],
  media: { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', app: 'Spotify.exe', playing: true, position: 61, duration: 200, art: null, can_next: true, can_previous: true },
};
setInterval(() => { if (state.media?.playing) state.media.position = Math.min(state.media.duration, state.media.position + 1); }, 1000);

const emit = (event, payload) => { for (const fn of listeners.get(event) || []) fn(payload); };
window.__mock = { emit, state };

const ok = (v) => Promise.resolve(v);
const rand = (a, b) => a + Math.random() * (b - a);

const hits = (q) => [
  { name: 'Notch apple', path: 'shell:AppsFolder\\NotchApple', parent: 'App', is_dir: false, size: 0, kind: 'app', modified: 0 },
  { name: `${q} report.docx`, path: `C:\\Users\\you\\Documents\\${q} report.docx`, parent: 'C:\\Users\\you\\Documents', is_dir: false, size: 48213, kind: 'file', modified: 1790000000 },
  { name: `${q} photos`, path: `C:\\Users\\you\\Pictures\\${q} photos`, parent: 'C:\\Users\\you\\Pictures', is_dir: true, size: 0, kind: 'folder', modified: 1789000000 },
];

const commands = {
  app_info: () => ({ version: '1.25.0', dataDir: 'C:\\Users\\you\\AppData\\Roaming\\com.notchapple.windows', autostarted: false, selftest: false, platform: 'windows' }),
  set_expanded: ({ expanded }) => { state.expanded = expanded; },
  set_layout: () => {}, set_hidden: ({ hidden }) => { state.hidden = hidden; }, set_hide_in_fullscreen: () => {}, set_edge_trigger: () => {},
  register_shortcuts: () => [], quit_app: () => {}, notify: ({ title, body }) => console.info('notify', title, body),
  set_autostart: () => {}, get_autostart: () => false,
  system_stats: () => ({ ram_used: 9.1e9, ram_total: 16e9, cpu_percent: rand(5, 35), cpu_cores: 8, cpu_name: 'Intel Core i7-1165G7',
    down_bytes_per_sec: rand(1e4, 2e6), up_bytes_per_sec: rand(1e3, 2e5), net_interface: 'Wi-Fi', disk_free: 212e9, disk_total: 512e9,
    battery_percent: 76, battery_charging: false, uptime_seconds: 18400, host_name: 'DESKTOP-NOTCH' }),
  top_processes: () => [{ name: 'chrome', cpu: 12.4, memory: 1.8e9 }, { name: 'Code', cpu: 6.1, memory: 9e8 }, { name: 'Spotify', cpu: 2.2, memory: 3e8 }],
  transliterate: ({ text }) => (/[^\x00-\x7f]/.test(text) ? 'ni hao' : ''),
  capture_screen: () => '',
  installed_apps: () => ['Calculator', 'Google Chrome', 'Microsoft Edge', 'Notepad', 'Paint', 'Spotify', 'Visual Studio Code', 'Word']
    .map((name) => ({ name, path: `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\${name}.lnk`, icon: null })),
  path_info: ({ path }) => ({ name: path.split(/[\\/]/).pop(), path, parent: path.split(/[\\/]/).slice(0, -1).join('\\'), is_dir: !/\.\w+$/.test(path), size: 1024, kind: 'file', modified: 0 }),
  launch_app: () => {}, open_path: () => {}, reveal_path: () => {}, open_url: ({ url }) => window.open(url, '_blank'),
  pick_app: () => ({ name: 'Notepad', path: 'C:\\Windows\\notepad.exe', icon: null }), pick_folder: () => 'C:\\Users\\you\\Projects', pick_file: () => 'C:\\Users\\you\\Documents\\notes.txt',
  open_browser: ({ url }) => window.open(url, '_blank'),
  search_files: ({ query }) => (query ? hits(query) : []), set_search_folders: () => {}, search_status: () => [true, 48213],
  icons: () => ({}),
  clipboard_pause: () => {}, clipboard_copy_text: ({ text }) => navigator.clipboard?.writeText(text).catch(() => {}), clipboard_copy_image: () => {}, clipboard_forget: () => {},
  set_keep_awake: ({ on, display }) => { state.awake = on ? (display === false ? 1 : 2) : 0; }, keep_awake_state: () => state.awake,
  screen_time: () => {
    const d = new Date(); const k = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const out = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(d - i * 864e5);
      out[k(day)] = { 'Google Chrome': 7200 + i * 300, 'Visual Studio Code': 5400 - i * 200, Spotify: 2400, 'Microsoft Teams': 1800 + i * 120, Discord: 900 };
    }
    return out;
  },
  privacy_now: () => ({ microphone: [], camera: [] }), foreground_now: () => ({ exe: 'chrome.exe', name: 'Google Chrome', title: 'YouTube' }), minimize_external: () => {},
  snap_window: () => {}, tile_windows: () => 4,
  media_now: () => state.media,
  media_control: ({ action }) => { if (action === 'toggle') state.media.playing = !state.media.playing; emit('media', { ...state.media }); },
  audio_state: () => ({ available: true, volume: state.volume, muted: state.muted, output: 'Speakers (Realtek Audio)',
    outputs: [{ id: 'a', name: 'Speakers (Realtek Audio)', default: true }, { id: 'b', name: 'Headphones (WH-1000XM4)', default: false }],
    input: 'Microphone Array (Intel)', mic_muted: state.micMuted, apps: state.apps }),
  audio_set: ({ what, value, app }) => {
    if (what === 'volume') state.volume = value; if (what === 'mute') state.muted = value > 0.5; if (what === 'mic-mute') state.micMuted = value > 0.5;
    const a = state.apps.find((x) => x.name === app); if (a && what === 'app-volume') a.volume = value; if (a && what === 'app-mute') a.muted = value > 0.5;
  },
  hello_available: () => false, hello_verify: () => true,
  paste_text: () => {}, paste_now: () => {}, dictate: () => {},
  read_file_base64: ({ path }) => ({ name: path.split(/[\\/]/).pop(), mime: 'image/png', data: 'iVBORw0KGgo=', size: 8 }),
  plugins_list: () => [{ file: 'example.1m.ps1', name: 'example', interval: 60 }],
  plugins_dir: () => 'C:\\Users\\you\\AppData\\Roaming\\com.notchapple.windows\\Plugins',
  plugin_run: () => `Hello from PowerShell\nIt's ${new Date().toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}\nPlugin guide | href=https://github.com/AdityaJainDXB/NotchApples`,
  run_command: ({ command }) => `ran: ${command}`,
  update_check: () => null, update_install: () => {},
  vpn_status: () => ({ connected: null, profiles: [] }), vpn_connect: () => {}, vpn_disconnect: () => {},
  selftest_capture: () => {}, selftest_finish: ({ report }) => console.info('selftest', report),
  downloads_progress: () => [], save_temp_file: ({ name }) => `C:\\Temp\\${name}`, save_file_as: ({ name }) => `C:\\Users\\you\\Downloads\\${name}`,
};

export default {
  async invoke(cmd, args) {
    const fn = commands[cmd];
    if (!fn) throw new Error(`(dev) no stand-in for ${cmd}`);
    return fn(args || {});
  },
  async listen(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    if (event === 'media') setTimeout(() => fn({ ...state.media }), 50);
    return () => listeners.get(event)?.delete(fn);
  },
  async http(req) {
    const r = await fetch('/__http', { method: 'POST', body: JSON.stringify(req) });
    if (!r.ok) throw new Error('dev server: start NotchWindows/dev/serve.py');
    return r.json();
  },
};
