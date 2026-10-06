// The first-run feature chooser (and "Choose features again" in Settings → Tabs): every tab with a picture of
// what it does, what plan it needs, and a switch. Free tabs switch on. A Pro or Ultimate tab shows up too,
// so you can see what you'd get, but its switch opens a note saying it has to be bought, with a link to the
// website and the flyer. The pictures are the Mac app's screenshots (the Windows tabs look and work the same).

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
  const count = el('span', { class: 'small dim' });
  const paint = () => { count.textContent = `${chosen.size} on`; };

  const finish = () => {
    save('modules.enabled', [...chosen, 'settings']);
    save('onboarding.done', true);
    buildTabs();
    show([...chosen][0] || 'today');
  };

  const cards = MODULES.filter((m) => m.id !== 'settings').map((m) => {
    const plan = planOf(m);
    const isLocked = locked(m);
    const sw = toggle(chosen.has(m.id), (on) => {
      const input = sw.querySelector('input');
      if (on && isLocked) {                       // not bought: say so instead of switching it on
        input.checked = false;
        upgradeDialog(m, () => { chosen.add(m.id); input.checked = true; card.classList.remove('locked'); paint(); });
        return;
      }
      on ? chosen.add(m.id) : chosen.delete(m.id);
      paint();
    });
    const art = el('div', { class: 'wc-art' },
      PICTURES.has(m.id)
        ? el('img', { src: `img/features/${m.id}.webp`, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(el('span', { class: 'wc-emoji' }, m.icon)) })
        : el('span', { class: 'wc-emoji' }, m.icon),
      plan ? el('span', { class: `tier on-art ${tierLabel(plan).toLowerCase()}` }, tierLabel(plan)) : null);
    const card = el('div', { class: `wc${isLocked ? ' locked' : ''}`, onclick: (e) => { if (!e.target.closest('.switch')) sw.querySelector('input').click(); } },
      art,
      el('div', { class: 'wc-body' },
        el('div', { class: 'wc-top' }, el('b', { class: 'grow' }, m.name), sw),
        el('div', { class: 'wc-blurb' }, m.blurb)));
    return card;
  });
  paint();

  page.append(
    el('div', { class: 'wc-head' },
      el('div', { class: 'col grow' },
        el('div', { class: 'title' }, first ? 'Welcome! Choose what you want in your notch' : 'Choose your features'),
        el('div', { class: 'small dim' }, 'Switch tabs on or off. Pro and Ultimate ones are shown so you can see what they do. You can change this any time in Settings → Tabs.')),
      count,
      first ? button('Skip', () => { save('onboarding.done', true); show('today'); }, { kind: 'quiet' }) : null,
      button(first ? 'Start' : 'Done', finish)),
    el('div', { class: 'wc-grid' }, ...cards));
}
