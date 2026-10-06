// Claude Usage (Ultimate): tokens Claude Code has used in your 5-hour window, today and this week,
// read from the conversation files in %USERPROFILE%\.claude\projects. Claude doesn't publish your
// plan's limits to your PC, so you set your own budgets. Laid out like the Mac's Claude Usage tab.

import { el } from '../store.js';
import * as U from '../services/claudeusage.js';

export function render(root) {
  const windowCard = el('div', { class: 'card col', style: 'flex:1.4;min-width:0;gap:8px' });
  const totalsCard = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:8px' });
  root.append(el('div', { class: 'row fill', style: 'gap:16px' }, windowCard, totalsCard));

  const bar = (f) => el('div', { class: 'bar', style: 'height:8px' }, el('i', { style: `width:${Math.max(3, Math.round(f * 100))}%;${f >= 1 ? 'background:#ff453a' : f >= 0.8 ? 'background:#ff9f0a' : ''}` }));
  const budgetRow = (label, key, value, repaint) => {
    const input = el('input', { class: 'field num', type: 'number', min: 0, placeholder: 'None', value: value || '', style: 'width:110px;text-align:right' });
    input.onchange = () => { U.setBudget(key, input.value); repaint(); };
    return el('div', { class: 'hstack' }, el('span', { class: 'small dim grow' }, label), input, el('span', { class: 'tiny dim' }, 'tokens'));
  };

  let state = null;
  function paint() {
    const b = U.budgets();
    windowCard.replaceChildren(el('div', { class: 'section-title' }, 'Current 5-hour window'));
    if (!state) windowCard.append(el('div', { class: 'dim' }, 'Reading…'));
    else if (!state.found) windowCard.append(el('div', {}, "Claude Code hasn't been used on this PC yet."),
      el('div', { class: 'small dim' }, 'This tab reads the conversations Claude Code keeps in your .claude\\projects folder. Use Claude Code once and the numbers appear here.'));
    else if (state.summary.block) {
      const blk = state.summary.block, used = U.tokens(blk.totals), f = U.fraction(used, b.block);
      windowCard.append(el('div', { class: 'hstack', style: 'align-items:baseline;gap:8px' }, el('span', { class: 'huge', style: 'font-size:44px' }, U.format(used)), el('span', { class: 'dim' }, 'tokens')),
        f !== null ? bar(f) : null,
        f !== null ? el('div', { class: `small ${f >= 0.8 ? 'warn' : 'dim'}` }, `${Math.round(f * 100)}% of your ${U.format(b.block)} budget`) : null,
        el('div', {}, `Resets in ${U.remaining(blk.end)}`),
        el('div', { class: 'small dim' }, `${blk.totals.messages} replies · ${U.format(blk.totals.input)} in · ${U.format(blk.totals.output)} out · ${U.format(blk.totals.cacheRead + blk.totals.cacheWrite)} cached`));
    } else windowCard.append(el('div', { class: 'big' }, 'No active window'), el('div', { class: 'small dim' }, 'A new 5-hour window starts with your next Claude Code message.'));
    const pr = U.prefs();
    const tog = (label, on, onchange, disabled = false) => el('label', { class: 'hstack small dim', style: `gap:8px;cursor:pointer;${disabled ? 'opacity:.5' : ''}` }, el('input', { type: 'checkbox', checked: on, disabled, onchange: (e) => onchange(e.target.checked) }), label);
    const at = el('input', { class: 'field auto', type: 'time', value: `${String(Math.floor(pr.summaryAt / 60)).padStart(2, '0')}:${String(pr.summaryAt % 60).padStart(2, '0')}`, style: 'width:100px', disabled: !pr.summary });
    at.onchange = () => { const [h, m] = at.value.split(':').map(Number); if (Number.isFinite(h)) U.setPref('summaryAt', h * 60 + (m || 0)); };
    windowCard.append(el('div', { class: 'spacer' }), budgetRow('Budget per window', 'block', b.block, paint),
      tog('Alert at 90% of the weekly budget', pr.weekAlert, (v) => { U.setPref('weekAlert', v); }, b.week === 0),
      el('div', { class: 'hstack' }, tog('Daily summary at', pr.summary, (v) => { U.setPref('summary', v); paint(); }), at));

    totalsCard.replaceChildren(el('div', { class: 'section-title' }, 'Usage'));
    if (state?.found) {
      const row = (name, t) => el('div', { class: 'hstack' }, el('span', { class: 'dim grow' }, name), el('b', { class: 'num', style: 'font-size:18px' }, U.format(U.tokens(t))), el('span', { class: 'tiny dim' }, `${t.messages} replies`));
      totalsCard.append(row('Today', state.summary.today), row('Last 7 days', state.summary.week));
      const wf = U.fraction(U.tokens(state.summary.week), b.week);
      if (wf !== null) totalsCard.append(bar(wf));
      if (state.summary.byModel.length) totalsCard.append(el('div', { class: 'section-title', style: 'margin-top:4px' }, 'By model'),
        ...state.summary.byModel.slice(0, 4).map((m) => el('div', { class: 'hstack small' }, el('span', { class: 'grow' }, U.friendlyModel(m.model)), el('span', { class: 'num dim' }, U.format(m.tokens)))));
    }
    totalsCard.append(el('div', { class: 'spacer' }), budgetRow('Weekly budget', 'week', b.week, paint),
      el('div', { class: 'tiny dim' }, 'Read from your .claude folder on this PC. Nothing is sent anywhere.'));
  }

  const refresh = async () => { try { state = await U.read(); } catch { state = { found: false }; } paint(); };
  paint(); refresh();
  const t = setInterval(refresh, 30000);
  return () => clearInterval(t);
}
