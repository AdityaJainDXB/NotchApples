// The automated UI check that runs on a real Windows machine in CI
// (.github/workflows/windows-ci.yml). It opens every tab and every Settings
// pane in the real app, records any error, saves a screenshot of each, and
// writes a report. Only runs when the app is started with NOTCH_SELFTEST set.

import { invoke } from '../native.js';
import { MODULES } from '../modules.js';
import { save } from '../store.js';
import { expand, collapse, show, errors, isExpanded } from '../app.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run() {
  const report = { started: new Date().toISOString(), tabs: [], panes: [], errors: [], warnings: [], ok: true };
  const capture = (name) => invoke('selftest_capture', { name }).catch((e) => report.warnings.push(`capture ${name}: ${e.message}`));   // a missing screenshot is a warning: the checks are the tabs and panes

  try {
    await wait(1500);
    await capture('00-pill');
    // Every tab on, in order.
    save('modules.enabled', MODULES.map((m) => m.id));
    await expand('today');
    for (const [i, m] of MODULES.entries()) {
      const before = errors.length;
      await show(m.id);
      await wait(m.id === 'today' || m.id === 'sports' || m.id === 'f1' || m.id === 'markets' ? 4500 : 2200);
      const page = document.getElementById('page');
      const text = page.innerText.trim();
      const failed = errors.slice(before).map((e) => e.message);
      const broken = /Couldn't open /.test(text);
      report.tabs.push({ id: m.id, ok: !failed.length && !broken && text.length > 0, chars: text.length, errors: failed });
      await capture(`${String(i + 1).padStart(2, '0')}-${m.id}`);
    }
    // Every Settings pane.
    const { PANES } = await import('../modules/settings.js');
    for (const pane of Object.keys(PANES)) {
      const before = errors.length;
      await show('settings', { pane });
      await wait(900);
      const failed = errors.slice(before).map((e) => e.message);
      report.panes.push({ pane, ok: !failed.length, errors: failed });
      await capture(`settings-${pane.toLowerCase()}`);
    }
    // The command palette.
    const { openPalette } = await import('../app.js');
    await openPalette('time');
    await wait(700);
    await capture('palette');
    document.getElementById('palette')?.remove();
    await collapse();
    await wait(800);
    report.collapsedAgain = !isExpanded();
    await capture('zz-pill-after');
  } catch (e) {
    report.errors.push(`selftest crashed: ${e?.stack || e}`);
  }

  report.errors.push(...errors.map((e) => e.message));
  report.ok = !report.errors.length && report.tabs.every((t) => t.ok) && report.panes.every((p) => p.ok);
  report.finished = new Date().toISOString();
  await invoke('selftest_finish', { report: JSON.stringify(report, null, 2) });
}
