// Per-app rules (Pro): when an app comes to the front, hide the pill (say, while
// presenting in PowerPoint) or switch the notch to a tab.

import { load } from '../store.js';
import { invoke, listen } from '../native.js';
import { canUse } from '../features.js';

export const rules = () => load('rules.list', []); // [{ app, action: 'hide' | 'tab:<id>' }]

let hiddenByRule = false;

export function start() {
  listen('foreground', async (fg) => {
    if (!canUse('appRules') || !fg?.name) return;
    const rule = rules().find((r) => r.app.toLowerCase() === fg.name.toLowerCase());
    if (rule?.action === 'hide') {
      if (!hiddenByRule) { hiddenByRule = true; invoke('set_hidden', { hidden: true }).catch(() => {}); }
      return;
    }
    if (hiddenByRule) { hiddenByRule = false; invoke('set_hidden', { hidden: false }).catch(() => {}); }
    if (rule?.action?.startsWith('tab:')) {
      const { isExpanded, show } = await import('../app.js');
      if (isExpanded()) show(rule.action.slice(4));
      else localStorage.setItem('ui.lastTab', JSON.stringify(rule.action.slice(4)));
    }
  });
}
