// The first-run feature chooser (and "Choose with pictures…" in Settings → Tabs). It goes through the tabs one at a
// time: a picture of what it does, what plan it needs, and Turn on / Not now. A Pro or Ultimate tab is shown
// too, so you can see what you'd get, but turning it on opens a note saying it has to be bought, with a link to
// the website and the flyer. The pictures are the Mac app's screenshots (the Windows tabs look and work the same).

import { el, load, save } from '../store.js';
import { openUrl } from '../native.js';
import { MODULES, DEFAULT_ON, byId } from '../modules.js';
import { canUse, tierOf, tierLabel } from '../features.js';
import { toggle, modal, button } from '../ui.js';
import { keyField, BUY_URL } from './activation.js';
import { buildTabs, show } from '../app.js';

// Tabs that have a picture in img/features/. The rest show their icon.
const PICTURES = new Set(['today', 'ai', 'sports', 'f1', 'nowplaying', 'clipboard', 'notes', 'todo', 'focus', 'timer', 'worldclock',
  'tools', 'shelf', 'windows', 'games', 'markets', 'home', 'audio', 'snippets', 'voicenotes', 'screentime', 'quickadd', 'messenger',
  'mirror', 'vpn', 'devices', 'live', 'plugins', 'share']);

const planOf = (m) => (m.feature ? tierOf(m.feature) || 1 : 0);
const locked = (m) => !!m.feature && !canUse(m.feature);

/// "X needs Pro": what it costs, where to buy it, the flyer, and a place to paste the key.
export function upgradeDialog(m, onUnlocked) {
  const plan = tierLabel(planOf(m));
  const price = planOf(m) >= 2 ? '$5' : '$1';
  const dlg = modal(null, el('div', { class: 'upgrade-dlg' },
    el('img', { class: 'flyer', src: 'img/flyer.webp', alt: 'Notch apple: your MacBook notch, finally useful' }),
    el('div', { class: 'col', style: 'gap:10px;flex:1;min-width:0' },
      el('span', { class: `tier ${plan.toLowerCase()}` }, plan),
      el('div', { class: 'title' }, `${m.name} needs ${plan}`),
      el('div', { class: 'small dim' }, m.blurb),
      el('div', { class: 'small' }, `To turn it on you have to buy ${plan} (${price}, once, with every future update included). It works on up to 3 devices, Mac or Windows.`),
      el('button', { class: 'btn', onclick: () => openUrl(BUY_URL) }, `Get ${plan} on the website →`),
      el('div', { class: 'small faint' }, 'Already bought it? Paste your key:'),
      keyField(() => { dlg.close(); onUnlocked?.(); }))),
    { wide: true });
  return dlg;
}

export function render(page) {
  const first = !load('onboarding.done', false);
  const chosen = new Set(load('modules.enabled', DEFAULT_ON).filter((id) => { const m = byId(id); return m && id !== 'settings' && !locked(m); }));
  // Free ones first, then Pro, then Ultimate; each group keeps the app's own order.
  const steps = MODULES.filter((m) => m.id !== 'settings').sort((a, b) => planOf(a) - planOf(b));
  let i = 0;

  const finish = () => {
    save('modules.enabled', [...chosen, 'settings']);
    save('onboarding.done', true);
    buildTabs();
    show([...chosen][0] || 'today');
  };

  const go = (n, dir = 1) => { i = n; paint(dir); };
  const decide = (m, on) => {
    if (on && locked(m)) {
      upgradeDialog(m, () => { chosen.add(m.id); go(i + 1); });   // bought: it's on, carry on
      return;
    }
    on ? chosen.add(m.id) : chosen.delete(m.id);
    go(i + 1);
  };

  function paint(dir = 1) {
    page.replaceChildren();
    if (i >= steps.length) { page.append(summary()); return; }
    const m = steps[i];
    const plan = planOf(m);
    const isLocked = locked(m);
    const on = chosen.has(m.id);
    const art = PICTURES.has(m.id)
      ? el('img', { class: 'ws-img', src: `img/features/${m.id}.webp`, alt: '', onerror: (e) => e.target.replaceWith(el('span', { class: 'wc-emoji big' }, m.icon)) })
      : el('span', { class: 'wc-emoji big' }, m.icon);
    page.append(
      el('div', { class: 'ws-top' },
        el('div', { class: 'ws-bar' }, el('i', { style: `width:${Math.round((i / steps.length) * 100)}%` })),
        el('span', { class: 'small dim' }, `${i + 1} of ${steps.length}`),
        first ? button('Skip the rest', () => go(steps.length), { kind: 'quiet' }) : button('Close', () => show('settings'), { kind: 'quiet' })),
      el('div', { class: `ws-step ${dir > 0 ? 'fwd' : 'back'}` },
        el('div', { class: 'ws-art' }, art, plan ? el('span', { class: `tier on-art ${tierLabel(plan).toLowerCase()}` }, tierLabel(plan)) : null),
        el('div', { class: 'ws-copy' },
          el('div', { class: 'ws-name' }, m.icon, ' ', m.name),
          el('div', { class: 'ws-blurb' }, m.blurb),
          isLocked ? el('div', { class: 'small faint' }, `Needs ${tierLabel(plan)}. You can see what it does here; turning it on takes a purchase.`) : null,
          on ? el('div', { class: 'small', style: 'color:var(--ok)' }, '✓ On right now') : null,
          el('div', { class: 'ws-actions' },
            button(isLocked ? `Turn on (needs ${tierLabel(plan)})` : on ? 'Keep on' : 'Turn on', () => decide(m, true)),
            button(on ? 'Turn off' : 'Not now', () => decide(m, false), { kind: 'quiet' }),
            i > 0 ? button('← Back', () => go(i - 1, -1), { kind: 'ghost' }) : null))));
  }

  function summary() {
    const names = [...chosen].map((id) => byId(id)?.name).filter(Boolean);
    return el('div', { class: 'ws-step fwd ws-done' },
      el('div', { style: 'font-size:46px' }, '🎉'),
      el('div', { class: 'title' }, "You're all set"),
      el('div', { class: 'small dim', style: 'max-width:520px;text-align:center' }, names.length ? `In your notch: ${names.join(', ')}.` : 'Nothing is switched on yet.'),
      el('div', { class: 'small faint' }, 'Change any of this in Settings → Tabs.'),
      el('div', { class: 'ws-actions', style: 'justify-content:center' },
        button('Start', finish),
        button('← Back', () => go(steps.length - 1, -1), { kind: 'quiet' })));
  }

  paint();
}
