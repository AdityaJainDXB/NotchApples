// Desert Heat: the story rules with no drawing in them (section 2): the two characters, switching between them, what the
// other one is doing when you arrive, the mission runner and the first mission, "Night Fare" (docs/game/DESERT_HEAT_PROMPT.md
// parts 7, 8 and 10). Loaded as a script (window.DesertHeatStory) and by node for the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatStory = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORIGIN = { lat: 25.17, lon: 55.24 };
  const M_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
  const xz = (lat, lon) => ({ x: (lon - ORIGIN.lon) * M_LON, z: -(lat - ORIGIN.lat) * 110574 });

  // Real places used by section 2.
  const PLACES = {
    fareejHome: { ...xz(25.2705, 55.3040), name: 'Fareej\'s flat, Deira', heading: 0 },
    fatimahHome: { ...xz(25.0790, 55.1395), name: 'Fatimah\'s tower, Dubai Marina', heading: 0 },
    szrStart: { ...xz(25.2040, 55.2655), name: 'Sheikh Zayed Road' },
    pickup: { ...xz(25.1875, 55.2640), name: 'Business Bay' },
    marinaGarage: { ...xz(25.0802, 55.1405), name: 'Marina tower car park' },
    lift: { ...xz(25.0807, 55.1400), name: 'The lift' },
  };

  const CHARACTERS = {
    fareej: { id: 'fareej', name: 'Fareej', ability: 'Road Sense', shirt: '#4a4f57', trousers: '#2f3a4c', skin: '#9c6b4a', hair: '#1d1712', height: 1.78, home: 'fareejHome', car: '#6d7378' },
    fatimah: { id: 'fatimah', name: 'Fatimah', ability: 'Focus', shirt: '#1d1d22', trousers: '#1d1d22', skin: '#b07c58', hair: '#16110e', height: 1.66, home: 'fatimahHome', car: '#e9e6df', abaya: true },
  };

  function newCharacter(id) {
    const c = CHARACTERS[id], h = PLACES[c.home];
    return { id, money: id === 'fareej' ? 1240 : 18600, health: 100, armour: 0, wanted: 0, x: h.x, z: h.z, y: 0, heading: 0, inCar: false, activity: null };
  }

  // Part 8: may the player switch now?
  function canSwitch(game) {
    const me = game.chars[game.active];
    if (game.mission && !game.mission.allowSwitch) return { ok: false, why: 'Not during this part of the mission' };
    if (me.wanted > 0) return { ok: false, why: `${CHARACTERS[game.active].name} is wanted by the police` };
    if (!game.unlocked.fatimah) return { ok: false, why: 'Fatimah is not in your story yet' };
    return { ok: true };
  }

  // What the other character is doing when the camera arrives (by time and place). Always returns something.
  const ACTIVITIES = {
    fareej: [
      { from: 6, to: 11, text: 'fixing a cracked phone screen at the shop counter' },
      { from: 11, to: 15, text: 'eating karak and paratha at a cafeteria in Deira' },
      { from: 15, to: 19, text: 'arguing with a mechanic about a gearbox' },
      { from: 19, to: 6, text: 'waiting for a fare with the engine running' },
    ],
    fatimah: [
      { from: 5, to: 8, text: 'jogging along the JBR walk' },
      { from: 8, to: 18, text: 'on a call on her balcony, pacing' },
      { from: 18, to: 22, text: 'leaving a café in Dubai Marina' },
      { from: 22, to: 5, text: 'reading the files at her kitchen table' },
    ],
  };
  function activityFor(id, hour) {
    const h = ((hour % 24) + 24) % 24;
    const list = ACTIVITIES[id];
    for (const a of list) if (a.from < a.to ? h >= a.from && h < a.to : h >= a.from || h < a.to) return a.text;
    return list[0].text;
  }

  // Part 10.3: the chaser gives up after this many seconds without seeing you.
  const LOSE_AFTER = 10;
  class Pursuit {
    constructor() { this.unseen = 0; this.lost = false; }
    // seen: can the chaser see the player (distance and nothing in the way, decided by the game)
    step(dt, seen) { if (this.lost) return true; this.unseen = seen ? 0 : this.unseen + dt; if (this.unseen >= LOSE_AFTER) this.lost = true; return this.lost; }
  }
  // Simple line of sight used by the game: close enough, or close and recently rammed.
  const chaserSees = (dist, blocked) => dist < 70 || (dist < 180 && !blocked);

  // ---- the mission runner: a list of steps, each with an objective, a check and optional dialogue.
  class Mission {
    constructor(def) {
      this.def = def; this.i = -1; this.t = 0; this.done = false; this.failed = null; this.checkpoint = 0;
      this.data = {}; this.log = []; this.allowSwitch = false;
      this.next();
    }
    get step() { return this.def.steps[this.i]; }
    next() {
      this.i++; this.t = 0;
      if (this.i >= this.def.steps.length) { this.done = true; return; }
      const s = this.step;
      if (s.checkpoint) this.checkpoint = this.i;
      this.allowSwitch = !!s.allowSwitch;
      this.log.push(s.id);
    }
    // ctx: what the game knows this frame (positions, flags). Returns events for the game to act on.
    update(dt, ctx) {
      if (this.done || this.failed) return [];
      this.t += dt;
      const s = this.step, ev = [];
      if (s.fail) { const why = s.fail(ctx, this); if (why) { this.failed = why; ev.push({ type: 'fail', why }); return ev; } }
      if (s.check(ctx, this)) { ev.push({ type: 'stepDone', id: s.id }); this.next(); if (!this.done) ev.push({ type: 'stepStart', id: this.step.id }); else ev.push({ type: 'complete' }); }
      return ev;
    }
    retry() { this.failed = null; this.i = this.checkpoint - 1; this.data = {}; this.next(); return this.step.id; }
  }

  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;

  // Part 10: "Night Fare". The game supplies ctx = { player, car, carSpeed, inCar, active, chaser, pursuitLost, atLift, guardSaw, guardDown, fatimahInCar, wrecked }.
  const NIGHT_FARE = {
    id: 'night-fare', title: 'Night Fare', startHour: 23.66,
    steps: [
      { id: 'intro', who: 'fareej', cut: true, objective: '', check: (c, m) => m.t > 7,
        lines: [[0, '', '11:40 PM · BUSINESS BAY'], [1.2, 'Fatimah', 'Come on, come on…'], [3.6, '', 'Across town, a phone pings on Sheikh Zayed Road.'], [5.4, 'Fareej', 'One more fare. Then home. Khalas.']] },
      { id: 'pickup', who: 'fareej', checkpoint: true, objective: 'Pick up your passenger in Business Bay.', target: 'pickup',
        check: (c) => c.inCar && near(c.car, PLACES.pickup, 18) && c.carSpeed < 2,
        lines: [[1, 'Fareej', 'Business Bay. Of course it\'s Business Bay.']] },
      { id: 'passenger', who: 'fareej', objective: 'Drive to Dubai Marina.', target: 'marinaGarage', check: (c, m) => m.t > 22 || c.distFromPickup > 900,
        lines: [[0.4, 'Fatimah', 'Marina. Please, fast.'], [4, 'Fareej', 'Fast is extra. Joking. Yalla.'], [9, 'Fatimah', '…no, I\'m not at the office. I left. Don\'t call this number.'], [15, 'Fatimah', 'Is that car following us?'], [18.5, 'Fareej', 'Everyone in Dubai drives like they\'re following someone.']] },
      { id: 'chase', who: 'fareej', checkpoint: true, objective: 'Lose the black SUV.', chaser: true,
        check: (c) => c.pursuitLost, fail: (c) => c.wrecked ? 'The car is wrecked.' : null,
        lines: [[0.2, 'Fatimah', 'Wallah, he hit us!'], [2.5, 'Fareej', 'Hold on to something.'], [6, '', 'HOLD Q · ROAD SENSE: time slows for a moment']] },
      { id: 'tomarina', who: 'fareej', objective: 'Take her to the car park under her tower in the Marina.', target: 'marinaGarage',
        check: (c) => c.inCar && near(c.car, PLACES.marinaGarage, 22) && c.carSpeed < 2,
        lines: [[1, 'Fatimah', '…thank you. I mean it.'], [3, 'Fareej', 'Five stars would be nice.']] },
      { id: 'switch', who: 'fatimah', forceSwitch: true, checkpoint: true, objective: 'You are Fatimah now. Get to the lift.', target: 'lift',
        check: (c) => c.active === 'fatimah' && c.atLift, fail: (c) => c.guardSaw ? 'He saw you.' : null,
        lines: [[0.5, '', 'TAB switches between Fareej and Fatimah when the story allows it'], [3, 'Fatimah', 'Someone\'s there. Stay low.'], [6, '', 'CTRL crouch · stay out of his torch · E to knock him out from behind']] },
      { id: 'apartment', who: 'fatimah', cut: true, objective: '', check: (c, m) => m.t > 8,
        lines: [[0.5, '', 'APARTMENT 3104 · DUBAI MARINA'], [2, 'Fatimah', 'Transfers… Haldane Properties… signed by—'], [5, 'Fatimah', '…me. That\'s my name.']] },
      { id: 'end', who: 'fareej', cut: true, objective: '', check: (c, m) => m.t > 7,
        lines: [[0.5, 'Fareej', 'She left her charger.'], [3, '', 'RATING: 1 STAR · "DROVE LIKE A MANIAC."']] },
    ],
  };

  // The fare: 38 dirhams plus 2 a kilometre, nothing for the damage (part 10.6).
  const fareFor = (km) => Math.round(38 + 2 * km);

  return { ORIGIN, xz, PLACES, CHARACTERS, newCharacter, canSwitch, activityFor, Pursuit, LOSE_AFTER, chaserSees, Mission, NIGHT_FARE, fareFor, near };
}));
