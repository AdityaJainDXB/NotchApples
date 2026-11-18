// Runs the Humanizer with the model chosen in AI settings and keeps the word count on this PC. Used by the Humanizer page in Tools
// and the Humanize button under AI replies. The rules are in humanizerlogic.js, the habit checker in aitells.js.

import { load, save } from '../store.js';
import { can, WORKER } from '../license.js';
import { getJSON } from '../native.js';
import * as AI from './ai.js';
import * as L from './humanizerlogic.js';
import * as T from './aitells.js';

const KEY = 'humanizer.usage';
export const STYLE_KEY = 'humanizer.style';
const tier = () => (can(3) ? 3 : can(2) ? 2 : can(1) ? 1 : 0);   // 3 = admin key: no word limits
export const usage = () => L.current(load(KEY, null));
export const perRequestLimit = () => L.perRequestLimit(tier());
export const monthlyLeft = () => L.monthlyLeft(usage(), tier());
export const credits = () => usage().credits;
export const style = () => load(STYLE_KEY, '');
export const setStyle = (text) => save(STYLE_KEY, String(text || '').slice(0, 4000));
export const summary = () => `${monthlyLeft().toLocaleString('en-US')} of ${L.monthlyAllowance(tier()).toLocaleString('en-US')} words left this month${credits() ? ` + ${credits().toLocaleString('en-US')} extra` : ''}`;
let busy = false;
export const isBusy = () => busy;

const ask = async (user) => L.clean((await AI.send([{ role: 'user', text: user }], { system: L.SYSTEM })).text);

/**
 * Rewrites `text`: a first rewrite, a safe tidy in code, then (if the checker still finds habits) a second pass on only those.
 * Returns { text, before, after } (the habit reports). Throws an Error with a sentence for the person when a limit or the model stops it;
 * the words are counted only when a rewrite comes back.
 */
export async function humanize(text) {
  const decision = L.decide(L.wordCount(text), tier(), usage());
  const stop = L.message(decision, tier());
  if (stop) throw new Error(stop);
  if (busy) throw new Error('Already working on one. Wait a moment.');
  busy = true;
  try {
    const before = T.report(text);
    let out = T.autoFix(await ask(L.userMessage(text, style())));
    if (!out) throw new Error('The model sent nothing back. Try again.');
    const hint = T.remainingHint(out);
    if (hint) {
      try {
        const fixed = T.autoFix(await ask(L.editMessage(out, hint)));
        if (fixed && T.report(fixed).total <= T.report(out).total && L.wordCount(fixed) * 2 >= L.wordCount(out)) out = fixed;
      } catch { /* the first rewrite stands */ }
    }
    save(KEY, L.applying(decision, usage()));
    return { text: out, before, after: T.report(out) };
  } finally { busy = false; }
}

const device = () => { let d = load('humanizer.device', ''); if (!d || d.length < 16) { d = crypto.randomUUID().replaceAll('-', ''); save('humanizer.device', d); } return d; };

/** Redeems a top-up code emailed after buying extra words on Whop. The server accepts each code once; the words are added to this
 *  PC's extra words, which never run out with the month. Returns a sentence for the person. */
export async function redeem(code) {
  const c = String(code || '').trim();
  if (!c) return 'Enter the code from your email.';
  let r;
  try { r = await getJSON(`${WORKER}/humanizer/redeem`, { method: 'POST', json: { code: c, device: device() }, timeout: 30000 }); }
  catch (e) { return e?.message && !/fetch|network/i.test(e.message) ? e.message : "Couldn't reach the server. Check your connection and try again."; }
  if (!r || !(r.words > 0)) return (r && r.error) || "That code didn't work. Check it and try again.";
  const u = usage(); u.credits += r.words; save(KEY, u);
  return `Added ${r.words.toLocaleString('en-US')} words. They never run out with the month.`;
}
