// Runs the Humanizer with the model chosen in AI settings and keeps the word count on this PC. Used by the Humanizer page in Tools
// and the Humanize button under AI replies. The rules are in humanizerlogic.js.

import { load, save } from '../store.js';
import { can } from '../license.js';
import * as AI from './ai.js';
import * as L from './humanizerlogic.js';

const KEY = 'humanizer.usage';
const tier = () => (can(2) ? 2 : can(1) ? 1 : 0);
export const usage = () => L.current(load(KEY, null));
export const perRequestLimit = () => L.perRequestLimit(tier());
export const monthlyLeft = () => L.monthlyLeft(usage(), tier());
export const credits = () => usage().credits;
export const summary = () => `${monthlyLeft().toLocaleString('en-US')} of ${L.monthlyAllowance(tier()).toLocaleString('en-US')} words left this month${credits() ? ` + ${credits().toLocaleString('en-US')} extra` : ''}`;
let busy = false;
export const isBusy = () => busy;

/** Rewrites `text`. Throws an Error with a sentence for the person when a limit or the model stops it; words are counted only when a rewrite comes back. */
export async function humanize(text) {
  const decision = L.decide(L.wordCount(text), tier(), usage());
  const stop = L.message(decision, tier());
  if (stop) throw new Error(stop);
  if (busy) throw new Error('Already working on one. Wait a moment.');
  busy = true;
  try {
    const r = await AI.send([{ role: 'user', text: L.userMessage(text) }], { system: L.SYSTEM });
    const out = L.clean(r.text);
    if (!out) throw new Error('The model sent nothing back. Try again.');
    save(KEY, L.applying(decision, usage()));
    return out;
  } finally { busy = false; }
}
