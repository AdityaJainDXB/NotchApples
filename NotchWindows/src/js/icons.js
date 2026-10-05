// One consistent line-icon set for the tab bar and top buttons (the Mac app uses SF Symbols;
// emoji look different on every PC). 24×24, 2px round strokes, coloured by the text colour.

const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  ai: '<path d="M11 3l1.9 5.4L18.3 10l-5.4 1.9L11 17.3 9.1 11.9 3.7 10l5.4-1.6z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  sports: '<rect x="2" y="5" width="20" height="14" rx="3.5"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.8"/>',
  f1: '<path d="M5 22V3"/><path d="M5 4h14l-2.2 4 2.2 4H5"/><path d="M10 4v8M14.5 4v8"/>',
  nowplaying: '<path d="M9 18V5.5l11-2V16"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>',
  launcher: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><path d="M17.2 13.5v7.5M13.5 17.2H21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.6-4.6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  notes: '<rect x="3.5" y="3" width="17" height="18" rx="3.5"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  todo: '<circle cx="12" cy="12" r="9"/><path d="M7.8 12.3l3 3 5.6-6.4"/>',
  focus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.8 1.8M9.5 2.5h5M12 2.5v3.5"/>',
  translator: '<path d="M3.5 5.5h9M8 3.5v2M5.5 5.5c.4 3.2 3.2 6 6.2 7.3M11 5.5c-.7 3.4-3.6 6.2-7 7.5"/><path d="M11.5 21l4.3-10 4.2 10M13.2 17.5h5.4"/>',
  stats: '<path d="M5 21V11M12 21V3.5M19 21v-7.5"/>',
  worldclock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l3.5 2"/>',
  tools: '<path d="M14.5 6a4.2 4.2 0 0 0 5.2 5.4L21 12.7 12.7 21a2.9 2.9 0 0 1-4.1-4.1L16.8 8.6"/><path d="M5 3l3.5 3.5L6.5 8.5 3 5z"/>',
  shelf: '<path d="M3 13.5l3-8.5h12l3 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13.5h5.3l1.2 3h5l1.2-3H21"/>',
  windows: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M12 9v11"/>',
  games: '<path d="M6.5 7.5h11a4.5 4.5 0 0 1 4.4 5.4l-.7 3.5a2.8 2.8 0 0 1-4.8 1.4L15 16H9l-1.4 1.8a2.8 2.8 0 0 1-4.8-1.4l-.7-3.5a4.5 4.5 0 0 1 4.4-5.4z"/><path d="M8 10.5v3.5M6.2 12.2h3.6"/><circle cx="15.5" cy="11.4" r=".9"/><circle cx="17.7" cy="13.4" r=".9"/>',
  markets: '<path d="M3 3v18h18"/><path d="M7 15l4-4.5 3.2 3L20 6.5"/>',
  home: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/>',
  audio: '<path d="M4 9.5v5h3.8L13 19V5L7.8 9.5z"/><path d="M16.2 9a4.2 4.2 0 0 1 0 6M18.8 6.4a8 8 0 0 1 0 11.2"/>',
  snippets: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M8.2 7.8L20 19M8.2 16.2L20 5"/>',
  voicenotes: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  screentime: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6.2 5 9s-5 4-5 9M17 3c0 5-5 6.2-5 9s5 4 5 9"/>',
  quickadd: '<path d="M13 2.5L4.5 13.5h6.8L10.5 21.5 19.5 10h-6.8z"/>',
  messenger: '<path d="M4.5 4.5h11a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H10l-4 3v-3h-1.5A2.5 2.5 0 0 1 2 12V7a2.5 2.5 0 0 1 2.5-2.5z"/><path d="M20 9.5a2.5 2.5 0 0 1 2 2.4v4.6a2.5 2.5 0 0 1-2.5 2.5H19V22l-3.2-2.8H11"/>',
  mirror: '<ellipse cx="12" cy="11" rx="6.5" ry="8"/><path d="M12 19v3M8.5 22h7"/>',
  vpn: '<path d="M12 2.8l7.5 3v5.7c0 4.6-3.2 8.2-7.5 9.7-4.3-1.5-7.5-5.1-7.5-9.7V5.8z"/><path d="M8.8 12l2.4 2.4 4-4.6"/>',
  devices: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6.5" rx="1.8"/><rect x="17" y="14" width="4" height="6.5" rx="1.8"/>',
  live: '<path d="M3.5 8.5L12 4l8.5 4.5v7L12 20l-8.5-4.5z"/><path d="M3.5 8.5L12 13l8.5-4.5M12 13v7"/>',
  actions: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  plugins: '<path d="M9.5 3v3.5M14.5 3v3.5M7 6.5h10v4.2a5 5 0 0 1-10 0z"/><path d="M12 15.7V21"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12v6.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2V12"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5l1.6 2.3 2.7-.6.9 2.6 2.6.9-.6 2.7 2.3 1.6-2.3 1.6.6 2.7-2.6.9-.9 2.6-2.7-.6L12 21.5l-1.6-2.3-2.7.6-.9-2.6-2.6-.9.6-2.7L2.5 12l2.3-1.6-.6-2.7 2.6-.9.9-2.6 2.7.6z"/>',
  power: '<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  appearance: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2.2-.5-1.3.3-2.8 1.7-2.8H18a3 3 0 0 0 3-3C21 7 17 3 12 3z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.2" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>',
  shortcuts: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  weather: '<path d="M7 18a4.5 4.5 0 1 1 1.3-8.8A5.5 5.5 0 0 1 19 11.5a3.3 3.3 0 0 1-.5 6.5z"/>',
  security: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  rules: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  automations: '<path d="M13 2.5L4.5 13.5h6.8L10.5 21.5 19.5 10h-6.8z"/>',
  access: '<circle cx="8" cy="15" r="4.5"/><path d="M11.5 11.5L20 3M16 7l2.5 2.5M13.5 9.5L16 12"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6h.01"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  pin: '<path d="M9 3h6l-1 6 3.5 3.5V14H6.5v-1.5L10 9z"/><path d="M12 14v7"/>',
  hide: '<path d="M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
};

/// An inline SVG for a module id or a control name; falls back to the given emoji.
export function icon(name, size = 22, fallback = '•') {
  const body = P[name];
  const span = document.createElement('span');
  span.className = 'svgicon';
  span.style.cssText = `width:${size}px;height:${size}px`;
  if (!body) { span.textContent = fallback; return span; }
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return span;
}
export const hasIcon = (name) => name in P;
