// The decisions behind a reliable Do It run on Windows (Ultimate): a port of the Mac's DoItPolicy.swift with the same
// numbers and rules. Did the screen change between two screenshots, is the agent stuck repeating itself, which hint to
// escalate to, when an AI error is worth retrying, when a run has made no progress for too long, how to break one scroll
// into chunks a real app honours, and how to trim an accessibility element list down to what fits in a prompt.
// No screen and no events here (and no imports), so it is tested in Node (tests/doitpolicy.test.mjs).

// ---- budgets -------------------------------------------------------------------------------------------------------

/// The run ends after this many consecutive steps without progress…
export const MAX_NO_PROGRESS = 15;
/// …or after this many steps in all (a safety ceiling; a paused run can be continued).
export const STEP_CEILING = 300;

/// Why the run must pause now: 'noProgress', 'ceiling', or null to carry on.
export function shouldEnd(noProgress, totalSteps) {
  if (noProgress >= MAX_NO_PROGRESS) return 'noProgress';
  if (totalSteps >= STEP_CEILING) return 'ceiling';
  return null;
}

/// The new "steps without progress" counter after a step. The screen changing is progress; so is asking the user
/// (their answer moves the task on) and zooming (the agent deliberately changed what it sees).
export function updateNoProgress(count, action, changed) {
  return changed || action === 'ask' || action === 'zoom' ? 0 : count + 1;
}

// ---- did the screen change? ----------------------------------------------------------------------------------------

/// Two signatures (same-length arrays of 0–255 luma values) count as different when more than this fraction of
/// cells moved by more than CELL_DELTA.
export const CHANGE_FRACTION = 0.015;
export const CELL_DELTA = 12;

/// The fraction of cells that changed noticeably between two signatures. Different lengths count as fully changed (1),
/// and empty ones as unchanged (0) so a failed capture never fakes progress or an endless settle.
export function changedFraction(a, b) {
  a = a || []; b = b || [];
  if (!a.length && !b.length) return 0;
  if (a.length !== b.length || !a.length) return 1;
  let moved = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > CELL_DELTA) moved++;
  return moved / a.length;
}

export const screenChanged = (a, b) => changedFraction(a, b) > CHANGE_FRACTION;

// ---- settling (instead of a fixed wait) ----------------------------------------------------------------------------

/// After an action the engine polls the screen signature every SETTLE_POLL_MS until it stops changing for
/// SETTLE_QUIET_POLLS polls in a row, up to SETTLE_MAX_MS. "wait" always sleeps at least SETTLE_MIN_MS.
export const SETTLE_POLL_MS = 400;
export const SETTLE_QUIET_POLLS = 2;
export const SETTLE_MAX_MS = 5000;
export const SETTLE_MIN_MS = 300;

// ---- stuck detection -----------------------------------------------------------------------------------------------

/// The same action this many times in a row means the approach is wrong, whatever the screen did.
export const REPEAT_LIMIT = 3;

/// A canonical key for an action, so "click (312, 448)" and "click (318, 451)" count as the same attempt.
/// Coordinates are bucketed to 25 grid units. `a` is the parsed action object.
export function actionKey(a) {
  const bucket = (v) => Math.trunc((v || 0) / 25);
  switch (a.action) {
    case 'click': case 'double_click': case 'right_click': case 'drag':
      return `${a.action}@${bucket(a.x)},${bucket(a.y)}`;
    case 'scroll': return `scroll@${bucket(a.x)},${bucket(a.y)}`;
    case 'type': return `type ${String(a.text || '').slice(0, 30)}`;
    case 'key': return `key ${String(a.key || '').toLowerCase()}`;
    case 'click_element': case 'set_value': case 'select':
      return `${a.action}#${a.id ?? -1} ${String(a.option || '').slice(0, 30)}`;
    case 'menu': return `menu ${(a.path || []).join('>')}`;
    case 'focus_app': case 'open_app': return `${a.action} ${a.name || ''}`;
    default: return a.action;
  }
}

/// How long the trailing run of the same action key is. `outcomes` is [{ key, changed }], oldest first.
export function repeatRun(outcomes) {
  if (!outcomes.length) return 0;
  const last = outcomes[outcomes.length - 1].key;
  let n = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i].key === last; i--) n++;
  return n;
}

/// How many steps in a row ended with no visible change.
export function noChangeRun(outcomes) {
  let n = 0;
  for (let i = outcomes.length - 1; i >= 0 && !outcomes[i].changed; i--) n++;
  return n;
}

/// The escalating hint the next prompt should carry: 0 none, 1 gentle, 2 firm (change method), 3 ask the user.
export function hintLevel(outcomes) {
  const repeats = repeatRun(outcomes);
  const flat = noChangeRun(outcomes);
  const effectiveRepeats = outcomes.length && !outcomes[outcomes.length - 1].changed ? repeats : 0;
  if (flat >= 8 || effectiveRepeats >= REPEAT_LIMIT + 3) return 3;
  if (flat >= 5 || effectiveRepeats >= REPEAT_LIMIT) return 2;
  if (flat >= 2 || effectiveRepeats >= 2) return 1;
  return 0;
}

// ---- retrying the AI -----------------------------------------------------------------------------------------------

/// Pauses between retries of a transient AI failure; after the last the run gives up.
export const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

/// Null when there are no retries left.
export function retryDelayMs(attempt) {
  return attempt >= 0 && attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : null;
}

/// Is this AI error worth retrying (rate limits, server errors, timeouts, network blips), or permanent
/// (bad key, no access, a model that cannot see images)?
export function isTransientAIError(message) {
  const m = String(message || '').toLowerCase();
  const permanent = ['api key', 'apikey', 'invalid key', 'unauthorized', '401', '403', 'forbidden',
    'quota exceeded for this billing', 'billing', 'not found', '404', "can't see images", 'does not support', 'unsupported'];
  if (permanent.some((p) => m.includes(p))) return false;
  const transient = ['429', 'rate limit', 'rate_limit', 'too many requests', 'overloaded', '503', '502', '500',
    '529', 'timed out', 'timeout', 'took too long', 'network', 'connection', 'temporarily',
    'unavailable', 'offline', 'internet', 'socket', 'reset', 'eof', 'stream'];
  return transient.some((t) => m.includes(t));
}

// ---- scrolling -----------------------------------------------------------------------------------------------------

/// One scroll request split into small chunks (at most SCROLL_CHUNK lines each) played ~SCROLL_CHUNK_GAP_MS apart,
/// because many apps ignore one big wheel event but follow several small ones.
export const SCROLL_CHUNK = 4;
export const SCROLL_CHUNK_GAP_MS = 60;

export function scrollChunks(amount) {
  amount = Math.trunc(amount || 0);
  if (!amount) return [];
  const sign = amount < 0 ? -1 : 1;
  let left = Math.abs(amount);
  const out = [];
  while (left > 0) {
    const step = Math.min(left, SCROLL_CHUNK);
    out.push(step * sign);
    left -= step;
  }
  return out;
}

// ---- the element list ----------------------------------------------------------------------------------------------

export const MAX_ELEMENTS = 80;
export const MAX_ELEMENT_CHARS = 6000;

/// One prompt line per element: `id role "label" = value @x,y wxh` (grid units), flagged when focused or in a menu.
/// An element is { id, role, label, value, x, y, w, h, focused, menu, front }.
export function elementLine(e) {
  let s = `${e.id} ${e.role}`;
  if (e.label) s += ` "${String(e.label).slice(0, 60)}"`;
  if (e.value) s += ` = ${String(e.value).slice(0, 40)}`;
  s += ` @${Math.trunc(e.x)},${Math.trunc(e.y)} ${Math.trunc(e.w)}x${Math.trunc(e.h)}`;
  if (e.focused) s += ' FOCUSED';
  if (e.menu) s += ' MENU';
  return s;
}

/// The elements worth sending, highest priority first: open menus, the focused element, the frontmost window, the rest —
/// capped by count and by the total characters their lines would take. Original order is kept within each group.
export function trimElements(all, maxCount = MAX_ELEMENTS, maxChars = MAX_ELEMENT_CHARS) {
  const groups = [all.filter((e) => e.menu), all.filter((e) => !e.menu && e.focused),
    all.filter((e) => !e.menu && !e.focused && e.front !== false), all.filter((e) => !e.menu && !e.focused && e.front === false)];
  const out = [];
  let chars = 0;
  for (const group of groups) {
    for (const e of group) {
      if (out.length >= maxCount) return out;
      const line = elementLine(e).length + 1;
      if (chars + line > maxChars) return out;
      out.push(e);
      chars += line;
    }
  }
  return out;
}
