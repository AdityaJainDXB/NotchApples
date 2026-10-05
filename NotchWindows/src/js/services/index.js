// Background services: everything that keeps working while the notch is closed
// (clipboard history, timers, the song playing, your team's score, reminders,
// meeting alerts…). Each starts on its own, so one failing can't stop the others.
// The ones you see straight away start first; the rest follow one by one, so opening
// the app doesn't make twenty things start (and the window stutter) at the same moment.

const NOW = ['clipboard', 'focus', 'timer', 'media', 'rules'];
const LATER = ['sports', 'reminders', 'calendar', 'weather', 'markets', 'screentime', 'privacy', 'awake',
  'downloads', 'messenger', 'plugins', 'automations', 'updates', 'flights', 'f1'];

async function run(name) {
  try {
    const mod = await import(`./${name}.js`);
    await mod.start?.();
  } catch (e) {
    console.error(`service ${name} failed to start`, e);
    (await import('../app.js')).reportError(`service ${name}: ${e?.message ?? e}`);
  }
}

const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => setTimeout(r, 250), { timeout: 1500 }) : setTimeout(r, 400)));

export async function start() {
  await Promise.all(NOW.map(run));
  (async () => { for (const name of LATER) { await idle(); await run(name); } })();
}
