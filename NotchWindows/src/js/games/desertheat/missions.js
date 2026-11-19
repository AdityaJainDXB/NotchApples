// Desert Heat: the story missions after "Night Fare", as data (docs/game/DESERT_HEAT_PROMPT.md part 9). Each step names who
// plays it, what to set up when it starts, the objective, the dialogue and a check on what the game reports each frame (ctx).
// The game reads `setup` and builds ctx; the rules live here so they can be tested. window.DesertHeatMissions / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./story.js'));
  else root.DesertHeatMissions = factory(root.DesertHeatStory);
}(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  const P = {
    goldSouk: { ...S.xz(25.2688, 55.2978), name: 'Uncle Rashid, the Gold Souk' },
    souqCar: { ...S.xz(25.2672, 55.2995), name: 'The pickup' },
    kiran: { ...S.xz(25.1385, 55.2290), name: 'Kiran\'s Garage, Al Quoz' },
    office: { ...S.xz(25.1875, 55.2640), name: 'Haldane Properties, Business Bay' },
    villa: { ...S.xz(25.2050, 55.2470), name: 'A villa in Jumeirah' },
    karama: { ...S.xz(25.2420, 55.3030), name: 'Al Fanar Shawarma, Karama' },
    marinaTower: S.PLACES.fatimahHome,
  };
  // the supporting cast (part 7.4) as they appear in scenes
  const CAST = {
    rashid: { name: 'Uncle Rashid', skin: '#a0704e', hair: '#d8d4cc', shirt: '#f4f2ec', trousers: '#f4f2ec', height: 1.74, beard: true, shoes: '#6b4a2c' },
    kiran: { name: 'Kiran Desai', skin: '#8a5a3c', hair: '#1a1410', shirt: '#2f4a6a', trousers: '#2f4a6a', height: 1.7, beard: false, shoes: '#222' },
    jomon: { name: 'Jomon', skin: '#6e4630', hair: '#141210', shirt: '#e2a72c', trousers: '#2b2b2b', height: 1.68, beard: false, shoes: '#111' },
    victor: { name: 'Victor Haldane', skin: '#e0b896', hair: '#8a7a64', shirt: '#22252b', trousers: '#22252b', height: 1.86, beard: false, shoes: '#111' },
    mariam: { name: 'Officer Mariam Al Suwaidi', skin: '#b07c58', hair: '#141210', shirt: '#5b6450', trousers: '#4a5242', height: 1.68, abaya: false, shoes: '#111' },
  };
  const near = (c, p, r) => c.pos && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < r;

  const MISSIONS = [
    {
      id: 'the-files', act: 1, title: 'The Files', who: 'fatimah', after: 'night-fare', start: 'marinaTower', reward: 0, hour: 1.2,
      steps: [
        { id: 'home', who: 'fatimah', objective: 'Go up to your apartment with the laptop.', target: 'marinaTower', check: (c) => !c.inCar && near(c, P.marinaTower, 6) },
        { id: 'hide', who: 'fatimah', cut: true, setup: { room: 'fatimah' }, check: (c, m) => m.t > 10,
          lines: [[0.5, '', 'APARTMENT 3104 · 1:15 AM'], [1.5, 'Fatimah', 'Behind the panel. Nobody looks behind the panel.'], [4.5, 'Fatimah', 'Haldane Properties to Crescent Holdings… forty million… signed by me.'], [8, 'Fatimah', 'I never signed this. Victor did.']] },
      ],
    },
    {
      id: 'debts', act: 1, title: 'Debts', who: 'fareej', after: 'the-files', start: 'goldSouk', reward: 5000, hour: 10.5,
      steps: [
        { id: 'souk', who: 'fareej', objective: 'Meet Uncle Rashid in the gold souk.', target: 'goldSouk', check: (c) => !c.inCar && near(c, P.goldSouk, 5) },
        { id: 'talk', who: 'fareej', cut: true, setup: { give: { weapon: 'pistol', mags: 3 }, npc: 'rashid' }, check: (c, m) => m.t > 13,
          lines: [[0.5, 'Rashid', 'Fareej, habibi. Sit. Your father owes four hundred thousand.'], [4, 'Fareej', 'Four hundred… to who?'], [6.5, 'Rashid', 'People who do not wait. One job and they wait a little longer.'], [9.5, 'Rashid', 'Take the pickup to Kiran in Al Quoz. No scratches, no questions. And take this. Just in case.'], [12, '', 'YOU GOT A KESTREL P9 PISTOL · RIGHT MOUSE AIMS, LEFT FIRES']] },
        { id: 'getin', who: 'fareej', objective: 'Get in the pickup.', target: 'souqCar', setup: { spawnCar: { id: 'pickup', paint: '#e9e6df', at: 'souqCar' } }, check: (c) => c.inMissionCar },
        { id: 'drive', who: 'fareej', checkpoint: true, objective: 'Deliver the pickup to Kiran in Al Quoz. Keep it clean.', target: 'kiran',
          check: (c) => c.inMissionCar && near(c, P.kiran, 18) && c.speed < 2 && !c.wanted,
          fail: (c) => c.missionCarDamage > 160 ? 'The pickup is too damaged. Rashid will not be happy.' : c.missionCarLost ? 'You left the pickup behind.' : null,
          events: [{ at: (c, m) => m.t > 40 && !m.data.cops, run: 'wanted1', say: ['Fareej', 'A checkpoint? Since when is there a checkpoint here?'] }],
          lines: [[2, 'Fareej', 'What is in the back, Uncle? …Don\'t answer that.']] },
        { id: 'kiran', who: 'fareej', cut: true, setup: { npc: 'kiran' }, check: (c, m) => m.t > 8,
          lines: [[0.5, 'Kiran', 'Rashid\'s boy. Not a scratch? Good.'], [3, 'Kiran', 'You drive well. I have work for drivers who drive well.'], [6, '', 'KIRAN\'S GARAGE: REPAIRS, PAINT AND TUNING (STOP HERE IN ANY CAR)']] },
      ],
    },
    {
      id: 'clean-hands', act: 1, title: 'Clean Hands', who: 'fatimah', after: 'debts', start: 'office', reward: 0, hour: 9.2,
      steps: [
        { id: 'arrive', who: 'fatimah', objective: 'Go to the office in Business Bay as if nothing happened.', target: 'office', check: (c) => !c.inCar && near(c, P.office, 7) },
        { id: 'sneak', who: 'fatimah', checkpoint: true, objective: 'Get to Victor\'s private lift through the basement without being seen.', setup: { garage: 'office', guards: 2 },
          check: (c) => c.atLift, fail: (c) => c.guardSaw ? 'Security saw you.' : null,
          lines: [[0.5, 'Fatimah', 'Two guards on the basement level. Victor\'s lift is at the far end.'], [4, '', 'CTRL crouch · keep out of the torch beams · E behind a guard knocks him out']] },
        { id: 'office', who: 'fatimah', cut: true, setup: { shopCut: { type: 'bank', name: 'Haldane Properties' } }, check: (c, m) => m.t > 11,
          lines: [[0.5, '', 'VICTOR HALDANE\'S OFFICE · 41ST FLOOR'], [2, 'Fatimah', 'Contracts… every one signed with my name.'], [5.5, 'Fatimah', 'And this one: a garage in Al Quoz. Desai Motors.'], [9, 'Fatimah', 'Photos taken. Now walk out slowly.']] },
      ],
    },
    {
      id: 'chop-shop', act: 1, title: 'Chop Shop', who: 'fareej', after: 'clean-hands', start: 'kiran', reward: 25000, hour: 21.5,
      steps: [
        { id: 'brief', who: 'fareej', objective: 'See Kiran at the garage.', target: 'kiran', check: (c) => near(c, P.kiran, 18) && c.speed < 2 },
        { id: 'job', who: 'fareej', cut: true, setup: { npc: 'kiran' }, check: (c, m) => m.t > 9,
          lines: [[0.5, 'Kiran', 'A red Corsa Velo. A villa in Jumeirah. The owner is in London.'], [4, 'Kiran', 'The alarm will call the police. Lose them, then bring it here.'], [7, 'Fareej', 'And if I say no?'], [8.2, 'Kiran', 'Then your father says no too.']] },
        { id: 'villa', who: 'fareej', objective: 'Go to the villa in Jumeirah.', target: 'villa', setup: { spawnCar: { id: 'super', paint: '#8d1f1f', at: 'villa' } }, check: (c) => c.inMissionCar },
        { id: 'alarm', who: 'fareej', checkpoint: true, objective: 'The alarm went off. Lose the police.', setup: { wanted: 2 },
          check: (c) => c.inMissionCar && !c.wanted, fail: (c) => c.missionCarDamage > 220 ? 'The Corsa Velo is wrecked.' : c.missionCarLost ? 'You left the car behind.' : null,
          lines: [[0.5, 'Fareej', 'Of course it has an alarm. Yalla, yalla.'], [3, '', 'HOLD Q · ROAD SENSE']] },
        { id: 'deliver', who: 'fareej', objective: 'Take the Corsa Velo to Kiran.', target: 'kiran',
          check: (c) => c.inMissionCar && near(c, P.kiran, 18) && c.speed < 2, fail: (c) => c.missionCarDamage > 220 ? 'The Corsa Velo is wrecked.' : null },
        { id: 'paid', who: 'fareej', cut: true, setup: { npc: 'kiran' }, check: (c, m) => m.t > 6, lines: [[0.5, 'Kiran', 'Beautiful. Twenty-five thousand. Your father\'s account is a little lighter now.']] },
      ],
    },
    {
      id: 'same-name', act: 1, title: 'The Same Name', who: 'fareej', after: 'chop-shop', start: 'karama', reward: 0, hour: 20.4,
      steps: [
        { id: 'karama', who: 'fareej', objective: 'A message from an unknown number: "Al Fanar Shawarma, Karama. 9 pm." Go.', target: 'karama', check: (c) => near(c, P.karama, 12) },
        { id: 'switchF', who: 'fatimah', forceSwitch: true, objective: 'Fatimah is already there. Go inside.', target: 'karama', setup: { placeNear: 'karama' }, check: (c) => !c.inCar && near(c, P.karama, 6) },
        { id: 'meet', who: 'fatimah', cut: true, setup: { shopCut: { type: 'cafeteria', name: 'Al Fanar Shawarma', both: true } }, check: (c, m) => m.t > 16,
          lines: [[0.5, '', 'AL FANAR SHAWARMA · KARAMA'], [1.5, 'Fareej', 'You. The Marina. One star.'], [4, 'Fatimah', 'You drove like a maniac.'], [6, 'Fatimah', 'Desai Motors. Your name is on a Haldane transfer. Delivery fee.'],
            [9.5, 'Fareej', 'I delivered a pickup. That\'s all.'], [11.5, 'Fatimah', 'Then we are both being set up by the same people.'], [14, 'Fareej', '…two shawarma, please. This will be a long night.']] },
      ],
    },
  ];

  const byId = (id) => MISSIONS.find((m) => m.id === id);
  /** The next mission available after the ones done (null when Act 1 is finished). */
  function nextMission(done) { return MISSIONS.find((m) => !done.includes(m.id) && done.includes(m.after)) || null; }
  const PLACES = P;

  return { MISSIONS, byId, nextMission, PLACES, CAST };
}));
