// Colour themes, the same palettes as the Mac app's AppTheme.swift: the 14 free
// themes, the 8 Pro themes, and your own theme from the editor (Pro). Each theme
// sets CSS custom properties on <html>.

export const THEMES = [
  { id: 'notch_purple', name: 'Notch Purple', category: 'Classic', bg: '#0d0519', surface: 'rgba(255,255,255,.07)', primary: '#9e6bff', secondary: '#c79eff', text: '#ffffff', border: 'rgba(255,255,255,.10)', glow: 'rgba(158,107,255,.35)', end: '#38176b' },
  { id: 'oled_obsidian', name: 'OLED Obsidian', category: 'Minimal & Premium', bg: '#000000', surface: 'rgba(255,255,255,.06)', primary: '#ffffff', secondary: '#8e8e93', text: '#ffffff', border: 'rgba(255,255,255,.12)', glow: 'rgba(255,255,255,.15)' },
  { id: 'graphite_titanium', name: 'Graphite & Titanium', category: 'Minimal & Premium', bg: '#1e1e24', surface: '#2a2a32', primary: '#007aff', secondary: '#5e5ce6', text: '#f2f2f7', border: '#3a3a46', glow: 'rgba(0,122,255,.25)' },
  { id: 'tokyo_midnight', name: 'Tokyo Midnight', category: 'Cyberpunk & Neon', bg: '#0b0c10', surface: '#1f2833', primary: '#66fcf1', secondary: '#45a29e', text: '#c5c6c7', border: 'rgba(69,162,158,.4)', glow: 'rgba(255,0,85,.5)' },
  { id: 'synthwave_dusk', name: 'Synthwave Dusk', category: 'Cyberpunk & Neon', bg: '#12092b', surface: '#241442', primary: '#ff71ce', secondary: '#01cdfe', text: '#f2ebf9', border: 'rgba(255,113,206,.35)', glow: 'rgba(5,255,161,.4)' },
  { id: 'matrix_green', name: 'Matrix Green', category: 'Cyberpunk & Neon', bg: '#050b05', surface: '#0d1f0d', primary: '#00ff66', secondary: '#4caf50', text: '#e0ffe0', border: '#1b431c', glow: 'rgba(0,255,102,.3)' },
  { id: 'nordic_dusk', name: 'Nordic Dusk', category: 'Dark & Cozy', bg: '#2e3440', surface: '#3b4252', primary: '#88c0d0', secondary: '#ebcb8b', text: '#eceff4', border: '#434c5e', glow: 'rgba(136,192,208,.25)' },
  { id: 'dracula_void', name: 'Dracula Void', category: 'Dark & Cozy', bg: '#282a36', surface: '#343746', primary: '#ff79c6', secondary: '#bd93f9', text: '#f8f8f2', border: '#44475a', glow: 'rgba(139,233,253,.3)' },
  { id: 'espresso_mocha', name: 'Espresso & Mocha', category: 'Dark & Cozy', bg: '#1e1e1e', surface: '#2d2a2e', primary: '#ffd866', secondary: '#ff6188', text: '#fcfcfa', border: '#403e41', glow: 'rgba(255,216,102,.25)' },
  { id: 'deep_forest', name: 'Deep Forest', category: 'Nature & Earthy', bg: '#0d1b1e', surface: '#152a2d', primary: '#52b788', secondary: '#b7e4c7', text: '#e8f5e9', border: '#2d4a43', glow: 'rgba(231,111,81,.3)' },
  { id: 'sunset_horizon', name: 'Sunset Horizon', category: 'Nature & Earthy', bg: '#1a0a13', surface: '#2d1222', primary: '#ff7b54', secondary: '#ffb26b', text: '#fff0e6', border: '#4a1d39', glow: 'rgba(255,217,61,.3)' },
  { id: 'oceanic_trench', name: 'Oceanic Trench', category: 'Nature & Earthy', bg: '#0a192f', surface: '#112240', primary: '#64ffda', secondary: '#57cbde', text: '#ccd6f6', border: '#233554', glow: 'rgba(100,255,218,.25)' },
  { id: 'matcha_cream', name: 'Matcha & Cream', category: 'Modern Pastel', bg: '#192019', surface: '#253325', primary: '#a8dadc', secondary: '#e2f0d9', text: '#f4f9f4', border: '#364a36', glow: 'rgba(244,162,97,.3)' },
  { id: 'lavender_haze', name: 'Lavender Haze', category: 'Modern Pastel', bg: '#16131e', surface: '#262035', primary: '#c77dff', secondary: '#e0aaff', text: '#f3eaff', border: '#3d3054', glow: 'rgba(123,44,191,.35)' },
  // Pro collection
  { id: 'aurora', name: 'Aurora', category: 'Pro', pro: true, bg: '#06121a', surface: '#0e2230', primary: '#5ef2b8', secondary: '#9d7bff', text: '#e8fff6', border: 'rgba(94,242,184,.25)', glow: 'rgba(94,242,184,.35)' },
  { id: 'rose_gold', name: 'Rose Gold', category: 'Pro', pro: true, bg: '#1a1214', surface: '#2a1d20', primary: '#f4b6a6', secondary: '#e8c39e', text: '#fff4f0', border: 'rgba(244,182,166,.25)', glow: 'rgba(244,182,166,.3)' },
  { id: 'midnight_blue', name: 'Midnight Blue', category: 'Pro', pro: true, bg: '#050a1f', surface: '#0d1638', primary: '#5b8cff', secondary: '#9fc2ff', text: '#e6eeff', border: '#1e2c5c', glow: 'rgba(91,140,255,.35)' },
  { id: 'crimson_noir', name: 'Crimson Noir', category: 'Pro', pro: true, bg: '#0c0506', surface: '#1c0a0d', primary: '#ff3b5c', secondary: '#ff8a9e', text: '#ffecef', border: '#3d1219', glow: 'rgba(255,59,92,.35)' },
  { id: 'arctic_mint', name: 'Arctic Mint', category: 'Pro', pro: true, bg: '#081416', surface: '#102326', primary: '#7fffd4', secondary: '#b2f7ef', text: '#f0fffc', border: '#1d3a3d', glow: 'rgba(127,255,212,.3)' },
  { id: 'golden_hour', name: 'Golden Hour', category: 'Pro', pro: true, bg: '#140e04', surface: '#24190a', primary: '#ffc93c', secondary: '#ff9a3c', text: '#fff8e7', border: '#3d2c10', glow: 'rgba(255,201,60,.3)' },
  { id: 'neon_violet', name: 'Neon Violet', category: 'Pro', pro: true, bg: '#0a0414', surface: '#170a2b', primary: '#b026ff', secondary: '#ff2bd6', text: '#f7eaff', border: 'rgba(176,38,255,.35)', glow: 'rgba(176,38,255,.45)' },
  { id: 'cobalt_steel', name: 'Cobalt Steel', category: 'Pro', pro: true, bg: '#0f1419', surface: '#1a222b', primary: '#4fc3f7', secondary: '#90a4ae', text: '#eceff1', border: '#263238', glow: 'rgba(79,195,247,.25)' },
];

const KEY = 'selected_theme_id';
const CUSTOM = 'theme.custom';

export const DEFAULT_CUSTOM = { name: 'My theme', bg: '#101018', primary: '#ff7ab6', secondary: '#7ad7ff', glow: 0.4 };

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgba = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
/// The backdrop's far corner: the background tinted 25% toward the accent (as on the Mac).
const blend = (a, b, f) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * f)); };
/// Dark or light text on top of the accent colour, whichever is readable.
const onColour = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b0b0b' : '#ffffff'; };

export function customTheme() {
  const c = { ...DEFAULT_CUSTOM, ...JSON.parse(localStorage.getItem(CUSTOM) || '{}') };
  return { id: 'custom', name: c.name || 'My theme', category: 'Pro', pro: true, custom: true,
    bg: c.bg, surface: 'rgba(255,255,255,.07)', primary: c.primary, secondary: c.secondary, text: '#ffffff',
    border: rgba(c.primary, 0.25), glow: rgba(c.primary, 0.15 + 0.5 * (c.glow ?? 0.4)) };
}

export function saveCustom(c) {
  localStorage.setItem(CUSTOM, JSON.stringify(c));
  if (currentThemeId() === 'custom') applyTheme('custom');
}

export function themeById(id) {
  if (id === 'custom') return customTheme();
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function currentThemeId() {
  try { return localStorage.getItem(KEY) || THEMES[0].id; } catch { return THEMES[0].id; }
}

export function applyTheme(id) {
  const t = themeById(id);
  const s = document.documentElement.style;
  const [tr, tg, tb] = rgb(t.text);
  s.setProperty('--bg', t.bg);
  s.setProperty('--bg-end', t.end || blend(t.bg, t.primary, 0.25));
  s.setProperty('--surface', t.surface);
  s.setProperty('--accent', t.primary);
  s.setProperty('--accent-bright', t.secondary);
  s.setProperty('--on-accent', onColour(t.primary));
  s.setProperty('--text', t.text);
  s.setProperty('--text-dim', `rgba(${tr},${tg},${tb},.74)`);
  s.setProperty('--text-faint', `rgba(${tr},${tg},${tb},.5)`);
  s.setProperty('--border', t.border);
  s.setProperty('--glow', t.glow);
  try { localStorage.setItem(KEY, t.id); } catch {}
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: t.id }));
}

/// Back to the free default when a Pro theme is no longer allowed (key removed).
export function enforceTheme(allowedPro) {
  const t = themeById(currentThemeId());
  if (t.pro && !allowedPro) applyTheme(THEMES[0].id);
}
