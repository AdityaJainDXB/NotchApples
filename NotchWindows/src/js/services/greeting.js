// Hello from the notch (the Windows twin of the Mac's HelloAnimation): when Notch Apple starts and each time this PC wakes
// up, the notch opens at the top of the screen and says hello with your name, written by hand (Mac style) or by a
// character that moves across the notch its own way (Pip flies, Pomo bounces, Mochi hops, Orbit circles, Wisp drifts,
// Notchy drops out and waves). The drawing and moves are js/mascots.js, the same file the Mac app uses. Nothing is sent anywhere.

import { load, save } from '../store.js';
import { invoke, hasTauri } from '../native.js';

/// The same list as js/mascots.js (a test keeps them equal), plus the handwriting.
export const CHARACTERS = [
  { id: 'hello', name: 'Handwritten hello', how: 'Written by hand, Mac style' },
  { id: 'notchy', name: 'Notchy', how: 'Drops out of the notch and waves' },
  { id: 'pomo', name: 'Pomo', how: 'Bounces across the notch' },
  { id: 'wisp', name: 'Wisp', how: 'Drifts across, wakes up on the way' },
  { id: 'mochi', name: 'Mochi', how: 'Hops across the notch' },
  { id: 'orbit', name: 'Orbit', how: 'Circles around the notch' },
  { id: 'pip', name: 'Pip', how: 'Flies across the notch' },
  { id: 'f1lights', name: 'F1: Lights out', how: 'Five start lights, then your team\u2019s car launches' },
  { id: 'f1lap', name: 'F1: Flying lap', how: 'Your team\u2019s car streaks across the notch' },
  { id: 'f1pit', name: 'F1: Pit stop', how: 'Your team\u2019s car pits for fresh tyres' },
];
/// The F1 teams a car can be painted as (the same ids as mascots.js; a test keeps them equal).
export const TEAMS = [['notch', 'Notch Apple purple'], ['ferrari', 'Ferrari'], ['mercedes', 'Mercedes'], ['redbull', 'Red Bull'], ['mclaren', 'McLaren'], ['aston', 'Aston Martin'], ['alpine', 'Alpine'], ['williams', 'Williams'], ['racingbulls', 'Racing Bulls'], ['haas', 'Haas'], ['audi', 'Audi'], ['cadillac', 'Cadillac']];

export const isOn = () => load('hello.on', true) !== false;
export const name = () => String(load('hello.name', '') || '').trim().slice(0, 24);
export const character = () => { const c = load('hello.character', 'hello'); return CHARACTERS.some((x) => x.id === c) ? c : 'hello'; };
export const team = () => { const t = load('hello.team', ''); return TEAMS.some((x) => x[0] === t) ? t : ''; };
export const setTeam = (v) => save('hello.team', v);
export const setOn = (v) => save('hello.on', !!v);
export const setName = (v) => save('hello.name', String(v || '').trim().slice(0, 24));
export const setCharacter = (v) => save('hello.character', v);

let last = 0;

/// Plays the greeting (at most once every 20 seconds unless `force`, and never while it is off).
export async function show(force = false) {
  if (!hasTauri || !isOn()) return;
  if (!force && Date.now() - last < 20000) return;
  last = Date.now();
  const c = character();
  await invoke('greeting_show', { id: c.startsWith('f1') ? `${c}:${team()}` : c, name: name(), notchHeight: 34 }).catch(() => {});
}

export function start() {
  setTimeout(() => show(), 2500);
  // Windows doesn't tell a web page that the PC woke up, but timers stop while it sleeps: a gap of over 30 seconds between two
  // 5-second ticks means it was asleep (a lid opened, or Start, or a key pressed).
  let tick = Date.now();
  setInterval(() => { const now = Date.now(); if (now - tick > 30000) show(); tick = now; }, 5000);
}
