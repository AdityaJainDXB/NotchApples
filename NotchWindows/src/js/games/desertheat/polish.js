// Desert Heat section 11: weather, the radio, random events, graphics presets and save slots, with no drawing in them
// (docs/game/DESERT_HEAT_PROMPT.md parts 15.3, 19, 20 and 22). All radio stations, DJs, music and ads are made up and the
// music is synthesised in the game (no recordings, no real songs). window.DesertHeatPolish / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatPolish = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  // ---- weather: one state per game hour, chosen by the day, the hour and the season (November = winter: clearer, fog at dawn)
  const WEATHER = {
    clear: { name: 'Clear', fog: 1, fogCol: null, grip: 1, light: 1, particles: null, policeEscape: 1 },
    haze: { name: 'Hazy', fog: 2.2, fogCol: '#d9c39a', grip: 1, light: 0.85, particles: null, policeEscape: 1.1 },
    fog: { name: 'Fog', fog: 6, fogCol: '#cfd3d6', grip: 0.97, light: 0.7, particles: null, policeEscape: 1.6 },
    sandstorm: { name: 'Sandstorm', fog: 9, fogCol: '#c9955c', grip: 0.92, light: 0.55, particles: 'sand', policeEscape: 2.2 },
    rain: { name: 'Rain storm', fog: 3.2, fogCol: '#8a9198', grip: 0.78, light: 0.5, particles: 'rain', policeEscape: 1.4 },
  };
  /** The weather at a game hour on a day of the year (deterministic, so both characters see the same sky). */
  function weatherAt(day, hour) {
    const winter = day > 305 || day < 75, h = Math.floor(hour), r = rnd(day * 31 + Math.floor(h / 6))();
    if (winter && h >= 4 && h < 9 && r < 0.3) return 'fog';
    if (r > 0.985) return winter ? 'rain' : 'sandstorm';
    if (r > 0.95) return 'sandstorm';
    if (!winter && r > 0.6 && h >= 10 && h < 17) return 'haze';
    if (r > 0.82) return 'haze';
    return 'clear';
  }
  /** Smooth blend between two weathers (t 0..1) for the numbers the renderer uses. */
  function blend(a, b, t) { const A = WEATHER[a], B = WEATHER[b]; const k = (x, y) => x + (y - x) * t; return { fog: k(A.fog, B.fog), grip: k(A.grip, B.grip), light: k(A.light, B.light), policeEscape: k(A.policeEscape, B.policeEscape) }; }

  // ---- the radio: six made-up stations; music is generated from a style, a key and a tempo
  const STATIONS = [
    { id: 'noor', name: 'Noor FM', freq: '98.4', style: 'arabpop', bpm: 102, key: 50, scale: [0, 1, 4, 5, 7, 8, 11], djs: ['Noor FM. Good evening, Dubai.', 'Hamdan with the hits, yalla.', 'Shout out to everyone stuck on Al Khail right now.'] },
    { id: 'masala', name: 'Masala 104', freq: '104.1', style: 'filmi', bpm: 118, key: 52, scale: [0, 2, 4, 5, 7, 9, 11], djs: ['Masala 104, Dubai\'s Bollywood!', 'Next up: a big one from the eighties. Sing along.', 'Request from Priya in Karama. This one is for your mother.'] },
    { id: 'gulfrock', name: 'Gulf Rock', freq: '96.7', style: 'rock', bpm: 132, key: 40, scale: [0, 3, 5, 7, 10], djs: ['Gulf Rock. Turn it up.', 'Too hot outside, too loud inside.', 'That was loud. This one is louder.'] },
    { id: 'dunes', name: 'Deep Dunes', freq: '101.9', style: 'house', bpm: 122, key: 45, scale: [0, 3, 5, 7, 10], djs: ['Deep Dunes. Sunset sessions from the Marina.', 'Keep it deep, keep it cool.', 'Rooftop vibes all the way to Abu Dhabi.'] },
    { id: 'khaleeji', name: 'Classic Khaleeji', freq: '92.0', style: 'khaleeji', bpm: 96, key: 48, scale: [0, 2, 3, 5, 7, 8, 10], djs: ['Classic Khaleeji. The songs our fathers knew.', 'Here is an old one from the seventies.', 'For everyone driving home to Sharjah tonight.'] },
    { id: 'talk', name: 'Talk 97', freq: '97.3', style: 'talk', bpm: 0, key: 0, scale: [], djs: [] },
  ];
  const TALK = [
    'Caller from JLT says his rent went up again. Mine too, habibi, mine too.',
    'Traffic: Sheikh Zayed Road is slow from Trade Centre to the Marina. So, normal.',
    'It is forty degrees in November. Is it winter yet? Our weatherman says no.',
    'A listener asks: is it legal to park on the yellow and black kerb? No. No, it is not.',
    'Coming up after the news: why does every cafeteria have the same menu? An investigation.',
  ];
  const ADS = [
    'Zephyr City: the compact car for compact parking spaces. Autos Dubai.',
    'Sayara Ride. Get where you are going, mostly on time.',
    'Gulf Crescent Bank. We believe in you. Terms and conditions apply.',
    'Iron Dunes Gym: summer body, all year, because it is always summer.',
  ];
  /** What a station plays at a moment: music, a DJ link, an ad or (Talk 97) a topic. Deterministic by time. */
  function programme(station, t, news = []) {
    const S = STATIONS.find((s) => s.id === station) || STATIONS[0];
    const slot = Math.floor(t / 45), r = rnd(slot * 7 + S.freq.length)();
    if (S.style === 'talk') { const pool = news.length ? TALK.concat(news.map((n) => 'In the news: ' + n + '.')) : TALK; return { kind: 'talk', text: pool[slot % pool.length] }; }
    if (slot % 4 === 3) return { kind: 'ad', text: ADS[slot % ADS.length] };
    if (r < 0.25) return { kind: 'dj', text: S.djs[slot % S.djs.length] };
    return { kind: 'music', seed: slot * 13 + S.bpm };
  }
  /** A bar of music: notes as [beat, semitone above the key, length in beats, voice]. */
  function bar(station, seed) {
    const S = STATIONS.find((s) => s.id === station); if (!S || !S.scale.length) return [];
    const r = rnd(seed), out = [], sc = S.scale;
    const bass = sc[Math.floor(r() * 3)];
    for (let b = 0; b < 4; b++) {
      out.push([b, bass - 12, 0.9, 'bass']);
      if (S.style === 'house' || S.style === 'rock') out.push([b, 0, 0.1, 'kick']);
      if (S.style !== 'khaleeji' || b % 2) out.push([b + 0.5, 0, 0.05, 'hat']);
      if (S.style === 'khaleeji' && b % 2 === 0) out.push([b + 0.25, 0, 0.1, 'darbuka']);
      const n = 1 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) out.push([b + k * 0.5, sc[Math.floor(r() * sc.length)] + 12, 0.45, 'lead']);
    }
    return out;
  }

  // ---- random events in free roam (part 15.3): when and where each may start
  const EVENTS = [
    { id: 'street-race', name: 'Street race offer', when: (h) => h >= 21 || h < 3, where: 'petrol' },
    { id: 'breakdown', name: 'A broken-down car', when: () => true, where: 'road' },
    { id: 'bag-snatch', name: 'A bag snatcher', when: (h) => h >= 9 && h < 23, where: 'pavement' },
    { id: 'wedding', name: 'A wedding convoy', when: (h) => h >= 20 || h < 1, where: 'road' },
    { id: 'police-chase', name: 'A police chase passing by', when: () => true, where: 'road' },
  ];
  /** Picks an event that fits the hour (null most of the time). r: a random number 0..1. */
  function pickEvent(hour, r, cooldown) {
    if (cooldown > 0 || r > 0.012) return null;
    const ok = EVENTS.filter((e) => e.when(hour));
    return ok[Math.floor((r / 0.012) * ok.length) % ok.length] || null;
  }

  // ---- graphics presets (part 22.3)
  const PRESETS = {
    low: { pixelRatio: 0.85, shadows: false, shadowMap: 1024, drawDistance: 0.7, traffic: 0.5, people: 0.5 },
    balanced: { pixelRatio: 1.25, shadows: true, shadowMap: 1024, drawDistance: 0.85, traffic: 0.8, people: 0.8 },
    high: { pixelRatio: 1.75, shadows: true, shadowMap: 2048, drawDistance: 1, traffic: 1, people: 1 },
    ultra: { pixelRatio: 2, shadows: true, shadowMap: 4096, drawDistance: 1.25, traffic: 1, people: 1 },
  };
  /** Chooses a preset from the measured frame rate: steps down when it is slow for a while, up when there is headroom. */
  function autoPreset(cur, fps) { const order = ['low', 'balanced', 'high', 'ultra']; const i = order.indexOf(cur); if (fps < 45 && i > 0) return order[i - 1]; if (fps > 58 && i < 2) return order[i + 1]; return cur; }

  // ---- saves: 10 slots, versioned so updates can migrate old saves (part 22.1)
  const SAVE_VERSION = 2, SLOTS = 10;
  function migrate(save) {
    if (!save || typeof save !== 'object') return null;
    const s = { ...save };
    if (!s.v || s.v < 2) { s.v = 2; s.done = s.done || []; s.settings = s.settings || {}; s.slotName = s.slotName || 'Autosave'; }
    return s;
  }
  const slotKey = (i) => i === 0 ? 'desertheat.save' : `desertheat.save.${i}`;

  // ---- accessibility: colour-blind safe palettes for the map and the HUD
  const PALETTES = {
    normal: { route: '#c8a25a', motorway: '#c8a25a', police: '#d8574a', ally: '#7fbf6a' },
    deutan: { route: '#e1a03c', motorway: '#e1a03c', police: '#3c78d8', ally: '#f0e442' },
    tritan: { route: '#d55e00', motorway: '#d55e00', police: '#cc79a7', ally: '#009e73' },
  };

  return { WEATHER, weatherAt, blend, STATIONS, TALK, ADS, programme, bar, EVENTS, pickEvent, PRESETS, autoPreset, SAVE_VERSION, SLOTS, migrate, slotKey, PALETTES };
}));
