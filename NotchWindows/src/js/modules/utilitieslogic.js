// Utilities: which tabs live inside the Utilities tab. No imports, so it is tested on its own.
// While Utilities is on, these tabs leave the tab bar and open from inside it.
export const MEMBERS = ['stats', 'shelf', 'worldclock', 'launcher', 'convert'];

/// Is this tab shown only inside Utilities right now? `enabled` is the list of tabs that are switched on.
/// World Clock is never a tab of its own: it lives in Utilities for everyone. The others are inside Utilities while it is switched on.
export const ALWAYS_INSIDE = ['worldclock'];
export const insideUtilities = (enabled, id) => ALWAYS_INSIDE.includes(id) || (enabled.includes('utilities') && MEMBERS.includes(id));

/// Where a request for a tab should go: a member tab opens inside Utilities (with that tool open), anything else stays.
export function route(enabled, id) {
  return insideUtilities(enabled, id) ? { id: 'utilities', opts: { open: id } } : { id, opts: undefined };
}
