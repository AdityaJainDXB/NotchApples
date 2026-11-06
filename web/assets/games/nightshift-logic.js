// Night Shift: the rules (no drawing). An original night-guard horror game for the Games tab, shared by the Mac and Windows apps:
// you are the night guard at Tinker's Toy Emporium, a closed-down toy shop whose wind-up toys wander at night. Watch them on the
// cameras, shut the doors when one is outside, keep an eye on the power, and last from 12 AM to 6 AM.
//
// The toys (all original to Notch Apple):
//   Clank      a wind-up tin robot. Comes down the West Hall to the left door.
//   Petunia    a porcelain doll with a music box. Comes down the East Hall to the right door.
//   Grin       a jack-in-the-box in the Prize Corner. It creeps out of its box while nobody looks at the cameras, then sprints
//              down the West Hall; a shut left door stops it (it bangs, and that costs power).
//   Conductor  a toy train engine. Only comes when the power runs out (and, on later nights, along the east side).
//
// Each toy gets a chance to move every few seconds: it moves when a roll of 0-20 is under its level for the night (the higher the
// level, the busier it is). Everything here is plain data and functions so it can be tested without a screen
// (NotchWindows/tests/nightshift.test.mjs). `step(state, dt, rng)` moves the night on by dt seconds.
(function (root) {
  'use strict';

  const HOUR = 60;                 // seconds of play for one hour on the clock (12 AM to 6 AM is six minutes)
  const POWER_PER_UNIT = 0.104;    // % per second for each bar of usage (one bar all night uses about 37%)
  const MOVE_EVERY = { clank: 4.97, petunia: 4.98, grin: 5.01, conductor: 3.02 };
  const BOTS = ['clank', 'petunia', 'grin', 'conductor'];

  /// The rooms, with the camera number shown on the map. The kitchen camera is broken: you can only hear it.
  const ROOMS = {
    stage: { cam: '1A', name: 'Show Stage' },
    dining: { cam: '1B', name: 'Toy Floor' },
    prize: { cam: '1C', name: 'Prize Corner' },
    workshop: { cam: '5', name: 'Repair Workshop' },
    closet: { cam: '3', name: 'Supply Closet' },
    westHall: { cam: '2A', name: 'West Hall' },
    westCorner: { cam: '2B', name: 'West Hall Corner' },
    eastHall: { cam: '4A', name: 'East Hall' },
    eastCorner: { cam: '4B', name: 'East Hall Corner' },
    kitchen: { cam: '6', name: 'Stockroom', audioOnly: true },
    restrooms: { cam: '7', name: 'Restrooms' },
  };
  const CAMS = Object.keys(ROOMS);

  /// Where each walking toy can go next from each room. "leftDoor" / "rightDoor" are the doorways right beside the office.
  const PATHS = {
    clank: { stage: ['dining'], dining: ['workshop', 'westHall'], workshop: ['dining', 'westHall'], westHall: ['closet', 'westCorner'], closet: ['westHall', 'westCorner'], westCorner: ['leftDoor', 'westHall'] },
    petunia: { stage: ['dining'], dining: ['restrooms', 'kitchen'], restrooms: ['kitchen', 'eastHall'], kitchen: ['eastHall', 'restrooms'], eastHall: ['eastCorner', 'dining'], eastCorner: ['rightDoor', 'eastHall'] },
    conductor: { stage: ['dining'], dining: ['restrooms'], restrooms: ['kitchen'], kitchen: ['eastHall'], eastHall: ['eastCorner'], eastCorner: ['rightDoor'] },
  };
  const SIDE = { clank: 'left', petunia: 'right', conductor: 'right' };
  const RETREAT = { clank: 'dining', petunia: 'dining', conductor: 'eastHall' };

  /// Each night: the toys' levels at 12 AM, and what is added at 2, 3 and 4 AM.
  const NIGHTS = {
    1: { start: { clank: 1, petunia: 0, grin: 0, conductor: 0 }, add: { 2: { clank: 1 }, 3: { clank: 1, petunia: 1, grin: 1 }, 4: { clank: 1, petunia: 1, grin: 1 } } },
    2: { start: { clank: 3, petunia: 1, grin: 1, conductor: 0 }, add: { 2: { clank: 1 }, 3: { clank: 1, petunia: 1, grin: 1 }, 4: { clank: 1, petunia: 1, grin: 1 } } },
    3: { start: { clank: 5, petunia: 4, grin: 2, conductor: 1 }, add: { 2: { clank: 1 }, 3: { clank: 1, petunia: 1, grin: 1 }, 4: { clank: 1, petunia: 1, grin: 1 } } },
    4: { start: { clank: 7, petunia: 6, grin: 5, conductor: 2 }, add: { 2: { clank: 1 }, 3: { clank: 1, petunia: 1, grin: 1 }, 4: { clank: 1, petunia: 1, grin: 1 } } },
    5: { start: { clank: 10, petunia: 9, grin: 8, conductor: 4 }, add: { 2: { clank: 1 }, 3: { clank: 1, petunia: 1, grin: 1 }, 4: { clank: 1, petunia: 1, grin: 1 } } },
  };
  const LAST_NIGHT = 5;            // all five nights
  const OFFICE_GRACE = 1.0;        // seconds a toy stands in the office after you lower the cameras, before it jumps
  const CAM_LIMIT = 20;            // seconds the cameras can stay up while a toy is in the office before it pulls them down

  /// A custom night: the player picks each toy's level (0 to 20) and they stay that way all night, with no hourly rise.
  function clampLevels(levels) { const out = {}; for (const id of BOTS) out[id] = Math.max(0, Math.min(20, Math.floor(Number(levels && levels[id]) || 0))); return out; }
  function newCustom(levels) { return newNight(1, clampLevels(levels)); }

  function newNight(night = 1, levels = null) {
    const n = NIGHTS[night] ? night : 1, ai = levels || NIGHTS[n].start;
    const bot = (id, i) => ({ id, room: id === 'grin' ? 'prize' : 'stage', ai: ai[id], timer: MOVE_EVERY[id] + i * 0.3, inOffice: false, scareT: 0, upT: 0, stage: 0, running: false, runT: 0, seenRun: false, bangs: 0 });
    return {
      night: levels ? 0 : n, custom: !!levels, levels: levels ? { ...levels } : null, t: 0, hour: 0, power: 100,
      doors: { left: false, right: false }, lights: { left: false, right: false }, jam: { left: false, right: false },
      camUp: false, cam: 'stage', powerOut: false, po: null,
      bots: { clank: bot('clank', 0), petunia: bot('petunia', 1), grin: bot('grin', 2), conductor: bot('conductor', 3) },
      over: null, events: [],
    };
  }

  /// Bars of power in use: 1 always, plus each shut door, a light, and the cameras.
  function usage(s) {
    if (s.powerOut) return 0;
    return 1 + (s.doors.left ? 1 : 0) + (s.doors.right ? 1 : 0) + (s.lights.left || s.lights.right ? 1 : 0) + (s.camUp ? 1 : 0);
  }

  const watched = (s, room) => s.camUp && s.cam === room;

  // ---- what the guard does ----
  function toggleDoor(s, side) {
    if (s.over || s.powerOut) return false;
    if (s.jam[side]) { s.events.push({ type: 'jammed', side }); return false; }
    s.doors[side] = !s.doors[side]; s.events.push({ type: 'door', side, shut: s.doors[side] }); return true;
  }
  function toggleLight(s, side) {
    if (s.over || s.powerOut || s.camUp) return false;      // the door lights are in the office, not on the tablet
    if (s.jam[side]) { s.events.push({ type: 'jammed', side }); return false; }
    const on = !s.lights[side];
    s.lights.left = false; s.lights.right = false; s.lights[side] = on;
    if (on) s.events.push({ type: 'light', side, seen: at(s, side + 'Door') });
    return true;
  }
  function setCams(s, up) {
    if (s.over || s.powerOut || s.camUp === up) return false;
    s.camUp = up; s.lights.left = s.lights.right = false;
    s.events.push({ type: 'cams', up }); return true;
  }
  function selectCam(s, room) {
    if (!ROOMS[room] || s.cam === room) return false;
    s.cam = room; s.events.push({ type: 'cam', room }); return true;
  }

  /// Which toys are in a room (or doorway) right now.
  function at(s, room) { return BOTS.filter((id) => s.bots[id].room === room && !(id === 'grin' && s.bots.grin.running)); }

  // ---- the night moving on ----
  function step(s, dt, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    s.t += dt;
    const hour = Math.min(6, Math.floor(s.t / HOUR));
    while (s.hour < hour) {
      s.hour++;
      const add = s.custom ? {} : NIGHTS[s.night].add[s.hour] || {};
      for (const id in add) s.bots[id].ai = Math.min(20, s.bots[id].ai + add[id]);
      if (s.hour >= 6) { s.over = { win: true }; s.camUp = false; s.events.push({ type: 'six' }); return s; }
      s.events.push({ type: 'hour', hour: s.hour });
    }
    if (!s.powerOut) {
      s.power -= usage(s) * POWER_PER_UNIT * dt;
      if (s.power <= 0) blackout(s, rng);
    }
    if (s.powerOut) { stepBlackout(s, dt, rng); return s; }

    for (const id of BOTS) {
      const b = s.bots[id];
      b.timer -= dt;
      while (b.timer <= 0 && !s.over) { b.timer += MOVE_EVERY[id]; chance(s, b, rng); }
      if (id === 'grin') runGrin(s, b, dt);
      else if (b.inOffice) inOffice(s, b, dt);
      if (s.over) return s;
    }
    return s;
  }

  function chance(s, b, rng) {
    if (b.ai <= 0) return;
    if (b.id === 'grin') {
      if (b.running || s.camUp) return;             // it only creeps out while nobody is looking at the cameras
      if (rng() * 20 >= b.ai) return;
      b.stage++;
      s.events.push({ type: 'grin', stage: b.stage });
      if (b.stage >= 3) { b.running = true; b.runT = 0; b.seenRun = false; s.events.push({ type: 'run' }); }
      return;
    }
    if (b.inOffice) return;
    if (b.id === 'conductor' && watched(s, b.room)) return;   // the train only moves when you are not watching it
    if (rng() * 20 >= b.ai) return;
    const side = SIDE[b.id], from = b.room;
    if (b.room === side + 'Door') {
      if (s.doors[side]) { b.room = RETREAT[b.id]; s.events.push({ type: 'leave', bot: b.id, from, side }); }
      else { b.room = 'office'; b.inOffice = true; b.scareT = 0; b.upT = 0; s.jam[side] = true; s.lights[side] = false; s.events.push({ type: 'enter', bot: b.id, side }); }
      return;
    }
    const opts = PATHS[b.id][b.room]; if (!opts) return;
    b.room = opts[Math.min(opts.length - 1, Math.floor(rng() * opts.length))];
    s.events.push({ type: 'move', bot: b.id, from, to: b.room, seen: watched(s, from) || watched(s, b.room) });
  }

  function inOffice(s, b, dt) {
    if (s.camUp) {
      b.upT += dt;
      if (b.upT >= CAM_LIMIT) { s.camUp = false; s.events.push({ type: 'cams', up: false, forced: true }); }
      return;
    }
    b.scareT += dt;
    if (b.scareT >= OFFICE_GRACE) caught(s, b.id);
  }

  function runGrin(s, b, dt) {
    if (!b.running) return;
    if (watched(s, 'westHall') && !b.seenRun) { b.seenRun = true; b.runT = Math.max(b.runT, 1.2); }
    b.runT += dt;
    if (b.runT < 2.6) return;
    if (s.doors.left) {
      const cost = 1 + 5 * b.bangs;
      s.power = Math.max(0, s.power - cost); b.bangs++;
      b.running = false; b.stage = b.bangs % 2; b.room = 'prize';
      s.events.push({ type: 'bang', cost });
    } else caught(s, 'grin');
  }

  function caught(s, id) { s.over = { win: false, by: id }; s.camUp = false; s.events.push({ type: 'scare', bot: id }); }

  // ---- the power runs out: the doors open, the lights and cameras die, the Conductor comes with its music ----
  function blackout(s, rng) {
    s.power = 0; s.powerOut = true; s.camUp = false;
    s.doors.left = s.doors.right = false; s.lights.left = s.lights.right = false;
    s.po = { phase: 'dark', t: 0, wait: 3 + rng() * 6 };
    s.events.push({ type: 'blackout' });
  }
  function stepBlackout(s, dt, rng) {
    const p = s.po; p.t += dt;
    if (p.t < p.wait) return;
    p.t = 0;
    if (p.phase === 'dark') { p.phase = 'music'; p.wait = 5; p.tries = 0; s.events.push({ type: 'music' }); return; }
    if (p.phase === 'music') { p.tries++; if (rng() < 0.2 || p.tries >= 4) { p.phase = 'black'; p.wait = 2; s.events.push({ type: 'musicEnd' }); } else p.wait = 5; return; }
    if (p.phase === 'black') { if (rng() < 0.2) caught(s, 'conductor'); else p.wait = 2; }
  }

  /// The clock as shown on screen: "12 AM", "1 AM" … "6 AM".
  const clock = (hour) => (hour === 0 ? '12 AM' : hour + ' AM');

  const api = { HOUR, POWER_PER_UNIT, ROOMS, CAMS, PATHS, NIGHTS, LAST_NIGHT, BOTS, newNight, newCustom, clampLevels, usage, step, toggleDoor, toggleLight, setCams, selectCam, at, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchNightLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
