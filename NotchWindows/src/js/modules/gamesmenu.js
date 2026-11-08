// The Games menu: a search box, filters, "Jump back in" and a card with a picture for every game. A private game (Flight Economy)
// shows a lock until an access code unlocks it. The list and the search are in gameslogic.js; this file only draws them.
import { el, load, save } from '../store.js';
import { modal, toast, button } from '../ui.js';
import { GAMES, CATEGORIES, filterGames, counts, byId } from './gameslogic.js';
import * as Private from '../services/privategame.js';

const PRIVATE_FOR = { fe: Private.GAME_ID };
const art = (g) => `linear-gradient(135deg,${g.art[0]},${g.art[1]})`;

/// Draws the menu into `host`. `onPick(id)` opens an ordinary game; private games are handled here.
export function renderMenu(host, { onPick }) {
  let q = '', cat = 'all';
  const search = el('input', { class: 'field gm-search', placeholder: 'Search games', autocomplete: 'off', spellcheck: 'false' });
  const chips = el('div', { class: 'gm-chips' });
  const recent = el('div', { class: 'gm-recent' });
  const recentTitle = el('div', { class: 'gm-h' }, 'Jump back in');
  const allTitle = el('div', { class: 'gm-h' });
  const grid = el('div', { class: 'gm-grid' });

  const locked = (g) => g.locked && !Private.isUnlocked(PRIVATE_FOR[g.id]);
  const subtitle = (g) => (g.locked ? 'Private' : (load(`games.best.${g.id}`, 0) > 0 ? `Best ${load(`games.best.${g.id}`, 0)}` : 'Played recently'));

  async function launch(g) {
    if (!g.locked) return onPick(g.id);
    const id = PRIVATE_FOR[g.id];
    if (!Private.isUnlocked(id)) return codeDialog(g);
    try { await Private.open(id); } catch (e) { toast(e.message || 'Could not open the game.', { error: true }); paint(); }
  }

  function codeDialog(g) {
    const id = PRIVATE_FOR[g.id];
    const hero = el('div', { class: 'gm-hero', style: `background:${art(g)}` }, g.icon);
    const input = el('input', { class: 'field gm-code', placeholder: 'XXXX-XXXX-XXXX', maxlength: 14, autocomplete: 'off', spellcheck: 'false' });
    const msg = el('div', { class: 'small', style: 'min-height:18px;text-align:center' });
    let m, busy = false;
    const go = async () => {
      if (busy) return;
      busy = true; msg.style.color = ''; msg.textContent = 'Checking…'; unlockBtn.disabled = true;
      try {
        await Private.unlock(input.value, id);
        msg.style.color = '#6ee7a8'; msg.textContent = 'Unlocked. Opening the game…';
        paint();
        setTimeout(() => { m.close(); Private.open(id).catch((e) => toast(e.message, { error: true })); }, 500);
      } catch (e) {
        msg.style.color = '#ff8a9a'; msg.textContent = e.message || 'That code didn’t work.';
        input.classList.remove('gm-shake'); void input.offsetWidth; input.classList.add('gm-shake');
        busy = false; unlockBtn.disabled = false;
      }
    };
    const unlockBtn = button('Unlock', go);
    input.addEventListener('input', () => { input.value = Private.prettyCode(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    m = modal(null, [hero, el('div', { class: 'title' }, g.name),
      el('div', { class: 'small dim' }, 'A private game. Enter the access code you were given to unlock it on this PC. It stays unlocked.'),
      input, msg], { actions: [button('Cancel', () => m.close(), { kind: 'quiet' }), unlockBtn] });
  }

  const card = (g) => {
    const lk = locked(g);
    return el('div', { class: `gm-card${lk ? ' lock' : ''}`, role: 'button', tabindex: 0, onclick: () => launch(g), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(g); } } },
      el('div', { class: 'gm-art', style: `background:${art(g)}` }, g.icon, lk ? el('span', { class: 'gm-lock' }, '🔒 Code') : null,
        el('div', { class: 'gm-play' }, el('i', {}, lk ? 'Enter code' : 'Play'))),
      el('div', { class: 'gm-meta' }, el('b', {}, g.name),
        el('div', { class: 'gm-tags' }, ...g.tags.map((t) => el('span', { class: `gm-tag ${({ Online: 'on', New: 'new', Daily: 'd', Private: 'p' })[t] || ''}` }, t === 'Private' && !lk ? 'Private · unlocked' : t)))));
  };

  function paint() {
    const list = filterGames(GAMES, { q, cat });
    grid.replaceChildren(...(list.length ? list.map(card) : [el('div', { class: 'gm-empty' }, 'No games match. Try another word.')]));
    const n = counts(GAMES);
    chips.replaceChildren(...CATEGORIES.map((c) => el('button', { class: `gm-chip${c.id === cat ? ' on' : ''}`, onclick: () => { cat = c.id; paint(); } }, c.name, el('small', {}, n[c.id]))));
    const recents = load('games.recent', []).map(byId).filter(Boolean);
    const showRecent = !q && cat === 'all' && recents.length > 0;
    recentTitle.style.display = recent.style.display = showRecent ? '' : 'none';
    recent.replaceChildren(...recents.map((g) => el('div', { class: 'gm-rc', role: 'button', tabindex: 0, onclick: () => launch(g), onkeydown: (e) => { if (e.key === 'Enter') launch(g); } },
      el('div', { class: 'gm-rg', style: `background:${art(g)}` }, g.icon), el('div', {}, el('b', {}, g.name), el('span', {}, subtitle(g))))));
    allTitle.textContent = !q && cat === 'all' ? 'All games' : `${list.length} game${list.length === 1 ? '' : 's'}`;
  }
  search.addEventListener('input', () => { q = search.value; paint(); });
  host.replaceChildren(el('div', { class: 'gm' }, el('div', { class: 'gm-top' }, search, chips), el('div', { class: 'gm-scroll' }, recentTitle, recent, allTitle, grid)));
  paint();
}
