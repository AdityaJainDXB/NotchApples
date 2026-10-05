// Background services: everything that keeps working while the notch is closed
// (clipboard history, timers, the song playing, your team's score, reminders,
// meeting alerts…). Each starts on its own, so one failing can't stop the others.

const SERVICES = [
  'clipboard', 'focus', 'timer', 'media', 'sports', 'reminders', 'calendar', 'weather',
  'markets', 'screentime', 'privacy', 'awake', 'rules', 'downloads', 'messenger', 'plugins',
  'automations', 'updates', 'flights', 'f1',
];

export async function start() {
  await Promise.all(SERVICES.map(async (name) => {
    try {
      const mod = await import(`./${name}.js`);
      await mod.start?.();
    } catch (e) {
      console.error(`service ${name} failed to start`, e);
      (await import('../app.js')).reportError(`service ${name}: ${e?.message ?? e}`);
    }
  }));
}
