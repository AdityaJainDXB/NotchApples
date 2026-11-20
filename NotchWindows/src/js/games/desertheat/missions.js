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
    // Act 3-5 places: the ones outside the real map are filled in by region.js once the generated region exists
    fareejHomeAct: { ...S.PLACES.fareejHome, name: 'Fareej\'s flat, Deira' },
    yasParty: { x: 0, z: 0, name: 'A party on Yas Island', region: 'yasParty' },
    corniche: { x: 0, z: 0, name: 'The Corniche, Abu Dhabi', region: 'corniche' },
    mussafah: { x: 0, z: 0, name: 'A warehouse in Mussafah', region: 'mussafah' },
    estate: { x: 0, z: 0, name: 'The Captain\'s desert estate', region: 'estate' },
    hideout: { x: 0, z: 0, name: 'The dunes', region: 'hideout' },
    yasGrid: { x: 0, z: 0, name: 'Yas circuit, the grid', region: 'yasGrid' },
    yacht: { ...S.xz(25.1300, 55.1060), name: 'The Captain\'s yacht, off the Palm' },
    palmBeach: { ...S.xz(25.1180, 55.1290), name: 'A beach on the Palm' },
    downtownTower: { ...S.xz(25.1955, 55.2780), name: 'The network\'s vault, Downtown' },
    uniforms: { ...S.xz(25.2440, 55.3010), name: 'A uniform supplier, Karama' },
    armoured: { ...S.xz(25.1520, 55.2330), name: 'An armoured van, Al Quoz' },
    helipad: { ...S.xz(25.2010, 55.2700), name: 'A rooftop helipad, Downtown' },
    victorOffice: { ...S.xz(25.1875, 55.2640), name: 'Haldane Properties, Business Bay' },
    captainStart: { ...S.xz(25.2020, 55.2690), name: 'Downtown' },
    goldBag: { ...S.xz(25.2693, 55.2969), name: 'The gold shop, the souk' },
    abraDeira: { ...S.xz(25.2633, 55.2990), name: 'Deira Old Souk abra station' },
    abraBur: { ...S.xz(25.2610, 55.2958), name: 'Bur Dubai abra station' },
    palmOffice: { ...S.xz(25.1180, 55.1385), name: 'Sales office, Palm Jumeirah' },
    camp: { ...S.xz(25.1650, 55.3480), name: 'A camp past Ras Al Khor' },
    truck: { ...S.xz(25.1390, 55.2300), name: 'The truck, Al Quoz' },
    policeHQ: { ...S.xz(25.2575, 55.2985), name: 'Bur Dubai police station' },
    van: { ...S.xz(25.1460, 55.2275), name: 'A security van, Al Quoz' },
    tower: { ...S.xz(25.1860, 55.2655), name: 'The network\'s tower, Business Bay' },
  };
  // the supporting cast (part 7.4) as they appear in scenes
  const CAST = {
    rashid: { name: 'Uncle Rashid', skin: '#a0704e', hair: '#d8d4cc', shirt: '#f4f2ec', trousers: '#f4f2ec', height: 1.74, beard: true, shoes: '#6b4a2c' },
    kiran: { name: 'Kiran Desai', skin: '#8a5a3c', hair: '#1a1410', shirt: '#2f4a6a', trousers: '#2f4a6a', height: 1.7, beard: false, shoes: '#222' },
    jomon: { name: 'Jomon', skin: '#6e4630', hair: '#141210', shirt: '#e2a72c', trousers: '#2b2b2b', height: 1.68, beard: false, shoes: '#111' },
    victor: { name: 'Victor Haldane', skin: '#e0b896', hair: '#8a7a64', shirt: '#22252b', trousers: '#22252b', height: 1.86, beard: false, shoes: '#111' },
    layla: { name: 'Layla', skin: '#b58560', hair: '#1a1410', shirt: '#7a3fa0', trousers: '#22252b', height: 1.62, abaya: false, shoes: '#eee' },
    son: { name: 'Saif', skin: '#c99a76', hair: '#141210', shirt: '#f4f2ec', trousers: '#f4f2ec', height: 1.8, beard: true, shoes: '#6b4a2c' },
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
      // ---------------------------------------------------------------- Act 2: The Network
    {
      id: 'gold-run', act: 2, title: 'The Gold Run', who: 'fareej', after: 'same-name', start: 'goldSouk', reward: 40000, hour: 19.5,
      steps: [
        { id: 'collect', who: 'fareej', objective: 'Collect Rashid\'s bag from the gold shop.', target: 'goldBag', check: (c) => !c.inCar && near(c, P.goldBag, 4) },
        { id: 'run', who: 'fareej', checkpoint: true, objective: 'The shop was watched. Run through the souk to the abra station.', target: 'abraDeira', setup: { wanted: 2 },
          check: (c) => !c.inCar && near(c, P.abraDeira, 8), lines: [[0.3, 'Fareej', 'Police? Wallah, Rashid, you said no questions!'], [3, '', 'ON FOOT · SHIFT sprints']] },
        { id: 'abra', who: 'fareej', cut: true, setup: { moveTo: 'abraBur', clearWanted: true }, check: (c, m) => m.t > 7,
          lines: [[0.5, '', 'ONE DIRHAM ACROSS THE CREEK'], [2.5, 'Fareej', 'Best getaway car in Dubai. Nobody chases an abra.'], [5, 'Abra driver', 'Yalla, sit down, sit down.']] },
        { id: 'away', who: 'fareej', objective: 'Walk away from the Bur Dubai side calmly.', check: (c) => !c.inCar && !near(c, P.abraBur, 60) },
      ],
    },
    {
      id: 'paper-towers', act: 2, title: 'Paper Towers', who: 'fatimah', after: 'gold-run', start: 'palmOffice', reward: 0, hour: 22.5,
      steps: [
        { id: 'arrive', who: 'fatimah', objective: 'Go to the sales office on the Palm.', target: 'palmOffice', check: (c) => !c.inCar && near(c, P.palmOffice, 8) },
        { id: 'records', who: 'fatimah', checkpoint: true, objective: 'Get to the records room through the car park without being seen.', setup: { garage: 'palmOffice', guards: 1 },
          check: (c) => c.atLift, fail: (c) => c.guardSaw ? 'A guard saw you.' : null },
        { id: 'photos', who: 'fatimah', cut: true, setup: { shopCut: { type: 'bank', name: 'Palm Crescent Sales' } }, check: (c, m) => m.t > 9,
          lines: [[0.5, 'Fatimah', 'Villas sold six times in one week. Each time to a different company.'], [4, 'Fatimah', 'Every company has the same director: V. Haldane.'], [7.5, '', 'ALARM']] },
        { id: 'escape', who: 'fatimah', checkpoint: true, objective: 'Get out and lose the police.', setup: { wanted: 2, outside: 'palmOffice' }, check: (c) => !c.wanted },
      ],
    },
    {
      id: 'desert-delivery', act: 2, title: 'Desert Delivery', who: 'fareej', after: 'paper-towers', start: 'kiran', reward: 60000, hour: 23,
      steps: [
        { id: 'truck', who: 'fareej', objective: 'Take Kiran\'s pickup.', target: 'truck', setup: { spawnCar: { id: 'pickup', paint: '#4b5236', at: 'truck' } }, check: (c) => c.inMissionCar },
        { id: 'drive', who: 'fareej', objective: 'Drive to the camp past Ras Al Khor.', target: 'camp', check: (c) => c.inMissionCar && near(c, P.camp, 25) && c.speed < 2,
          lines: [[2, 'Kiran', 'Hand over the box, take the envelope, come back. Easy.']] },
        { id: 'deal', who: 'fareej', cut: true, setup: { npc: 'kiran' }, check: (c, m) => m.t > 6, lines: [[0.5, 'Man', 'That is not the box. Who sent you?'], [3, 'Fareej', 'Kiran sent— wait—'], [5, '', 'GET TO COVER · CTRL crouch · RIGHT MOUSE aims']] },
        { id: 'fight', who: 'fareej', checkpoint: true, objective: 'Survive. Take them out.', setup: { hostiles: { at: 'camp', n: 6 }, give: { weapon: 'smg', mags: 4 } }, check: (c) => c.hostilesLeft === 0,
          lines: [[1, 'Fareej', 'Kiran, you are a dead man!']] },
        { id: 'back', who: 'fareej', objective: 'Get back to Kiran.', target: 'kiran', check: (c) => near(c, P.kiran, 18) && c.speed < 2 },
        { id: 'kiran', who: 'fareej', cut: true, setup: { npc: 'kiran' }, check: (c, m) => m.t > 7, lines: [[0.5, 'Kiran', 'They switched the box. Not me, I swear on my mother.'], [4, 'Kiran', 'Here. Sixty thousand. And the SMG is yours.']] },
      ],
    },
    {
      id: 'detective', act: 2, title: 'Detective', who: 'fatimah', after: 'desert-delivery', start: 'policeHQ', reward: 0, hour: 10,
      steps: [
        { id: 'go', who: 'fatimah', objective: 'Officer Mariam Al Suwaidi wants to see you at the Bur Dubai police station.', target: 'policeHQ', check: (c) => !c.inCar && near(c, P.policeHQ, 8) },
        { id: 'talk', who: 'fatimah', cut: true, setup: { npc: 'mariam' }, check: (c, m) => m.t > 8,
          lines: [[0.5, 'Mariam', 'Your name is on forty million dirhams of transfers, Miss Fatimah.'], [4, 'Mariam', 'Tell me why I should not arrest you today.']] },
        { id: 'choice', who: 'fatimah', cut: true, setup: { choice: { key: 'toldMariam', options: ['Tell her about Victor', 'Say nothing and ask for a lawyer'] } }, check: (c) => c.choiceMade },
        { id: 'after', who: 'fatimah', cut: true, check: (c, m) => m.t > 6, lines: [[0.5, 'Mariam', 'We will speak again. Do not leave Dubai.']] },
      ],
    },
    {
      id: 'heist-plan', act: 2, title: 'The Heist Plan', who: 'fatimah', after: 'detective', start: 'kiran', reward: 0, hour: 21,
      steps: [
        { id: 'meet', who: 'fatimah', objective: 'Meet Fareej and Kiran at the garage.', target: 'kiran', check: (c) => near(c, P.kiran, 15) },
        { id: 'board', who: 'fatimah', cut: true, setup: { board: true }, check: (c) => c.planDone,
          lines: [[0.5, 'Fatimah', 'The network keeps cash in the basement of their tower. Friday night, the vault is full.']] },
        { id: 'van', who: 'fareej', forceSwitch: true, objective: 'Prep: steal a security van in Al Quoz.', target: 'van', setup: { spawnCar: { id: 'suv', paint: '#e9e6df', at: 'van' } }, check: (c) => c.inMissionCar },
        { id: 'stash', who: 'fareej', objective: 'Bring the van to the garage without police.', target: 'kiran', check: (c) => c.inMissionCar && near(c, P.kiran, 18) && c.speed < 2 && !c.wanted },
      ],
    },
    {
      id: 'business-bay-job', act: 2, title: 'Business Bay Job', who: 'fatimah', after: 'heist-plan', start: 'tower', reward: 0, heist: true, hour: 23.5,
      steps: [
        { id: 'inside', who: 'fatimah', objective: 'Go to the tower. Fareej waits in the getaway car.', target: 'tower', check: (c) => !c.inCar && near(c, P.tower, 10) },
        { id: 'vault', who: 'fatimah', checkpoint: true, objective: 'Reach the vault lift in the basement.', setup: { garage: 'tower', guards: 1, heistLoud: true },
          check: (c) => c.atLift, fail: (c) => c.quiet && c.guardSaw ? 'Security saw you. The quiet way is over.' : null },
        { id: 'grab', who: 'fatimah', cut: true, setup: { shopCut: { type: 'bank', name: 'The vault' } }, check: (c, m) => m.t > 7, lines: [[0.5, 'Fatimah', 'Bags. So many bags.'], [3.5, 'Fatimah', 'Fareej, I\'m coming up. Engine on.']] },
        { id: 'getaway', who: 'fareej', forceSwitch: true, checkpoint: true, objective: 'Fatimah is in. Drive! Lose the police.', setup: { wanted: 3, outside: 'tower', bothInCar: true }, check: (c) => !c.wanted && c.inCar,
          lines: [[0.5, 'Fareej', 'Yalla, yalla, yalla!']] },
        { id: 'safe', who: 'fareej', objective: 'Take the money to the garage.', target: 'kiran', check: (c) => c.inCar && near(c, P.kiran, 18) && c.speed < 2 },
        { id: 'split', who: 'fareej', cut: true, setup: { npc: 'kiran', payout: true }, check: (c, m) => m.t > 8, lines: [[0.5, 'Kiran', 'I have never seen this much money in one room.'], [4, 'Fatimah', 'It is not the money. It is the ledger in bag nine.']] },
      ],
    },
    // ---------------------------------------------------------------- Act 3: Abu Dhabi
    {
      id: 'the-e11', act: 3, title: 'The E11', who: 'fareej', after: 'business-bay-job', start: 'kiran', reward: 15000, hour: 23.2,
      steps: [
        { id: 'go', who: 'fareej', objective: 'Bag nine says the network\'s money goes to Abu Dhabi. Take the E11 south.', target: 'yasGrid', check: (c) => c.inCar && c.onE11 },
        { id: 'chase', who: 'fareej', checkpoint: true, objective: 'A black SUV again. Lose it on the motorway.', setup: { chaser: true }, check: (c) => c.pursuitLost, fail: (c) => c.wrecked ? 'The car is wrecked.' : null,
          lines: [[0.5, 'Fareej', 'The same SUV. They never learn.'], [3, '', 'HOLD Q · ROAD SENSE']] },
        { id: 'arrive', who: 'fareej', objective: 'Get to Yas Island.', target: 'yasGrid', check: (c) => near(c, P.yasGrid, 60) },
      ],
    },
    {
      id: 'layla', act: 3, title: 'Layla', who: 'fatimah', after: 'the-e11', start: 'yasParty', reward: 0, hour: 22.8,
      steps: [
        { id: 'party', who: 'fatimah', objective: 'Your sister Layla is at a party on Yas. The network knows who she is. Find her.', target: 'yasParty', check: (c) => !c.inCar && near(c, P.yasParty, 8) },
        { id: 'found', who: 'fatimah', cut: true, setup: { npc: 'layla' }, check: (c, m) => m.t > 9,
          lines: [[0.5, 'Layla', 'Fatimah? What are you doing here?'], [2.5, 'Fatimah', 'We\'re leaving. Now. Don\'t ask.'], [5, 'Layla', 'You\'re scaring me.'], [7, 'Fatimah', 'Good.']] },
        { id: 'drive', who: 'fatimah', objective: 'Get Layla to the Corniche, away from the island.', target: 'corniche', setup: { wanted: 2 }, check: (c) => c.inCar && near(c, P.corniche, 40) && !c.wanted,
          lines: [[1, 'Layla', 'Why are the police here?'], [3.5, 'Fatimah', 'Not the police I\'m worried about.']] },
      ],
    },
    {
      id: 'track-day', act: 3, title: 'Track Day', who: 'fareej', after: 'layla', start: 'yasGrid', reward: 30000, hour: 20,
      steps: [
        { id: 'grid', who: 'fareej', objective: 'The Captain\'s son races at Yas tonight. Line up on the grid and press E.', target: 'yasGrid', check: (c) => c.raceStarted },
        { id: 'race', who: 'fareej', checkpoint: true, objective: 'Win the race.', check: (c) => c.raceWon, fail: (c) => c.raceLost ? 'You did not win.' : null },
        { id: 'son', who: 'fareej', cut: true, setup: { npc: 'son' }, check: (c, m) => m.t > 8, lines: [[0.5, 'Saif', 'Nobody beats me here. Who taught you to drive?'], [3.5, 'Fareej', 'Deira traffic.'], [5.5, 'Saif', 'Come to the Corniche tomorrow. My father likes drivers.']] },
      ],
    },
    {
      id: 'corniche', act: 3, title: 'Corniche', who: 'fareej', after: 'track-day', start: 'corniche', reward: 20000, hour: 18.2,
      steps: [
        { id: 'meet', who: 'fareej', objective: 'Meet Saif on the Corniche.', target: 'corniche', check: (c) => !c.inCar && near(c, P.corniche, 10) },
        { id: 'ambush', who: 'fareej', checkpoint: true, objective: 'It\'s a trap. Fight your way out.', setup: { hostiles: { at: 'corniche', n: 7 } }, check: (c) => c.hostilesLeft === 0,
          lines: [[0.5, 'Fareej', 'Of course. Of course it is.']] },
        { id: 'call', who: 'fareej', cut: true, check: (c, m) => m.t > 6, lines: [[0.5, 'Fatimah', 'Are you alive?'], [2, 'Fareej', 'Mostly. They know about us.']] },
      ],
    },
    {
      id: 'mussafah', act: 3, title: 'Mussafah', who: 'fareej', after: 'corniche', start: 'mussafah', reward: 45000, hour: 2.5,
      steps: [
        { id: 'go', who: 'fareej', objective: 'The network\'s warehouse in Mussafah: stolen cars and guns.', target: 'mussafah', check: (c) => near(c, P.mussafah, 20) },
        { id: 'clear', who: 'fareej', checkpoint: true, objective: 'Clear the warehouse.', setup: { hostiles: { at: 'mussafah', n: 8 }, give: { weapon: 'shotgun', mags: 4 } }, check: (c) => c.hostilesLeft === 0 },
        { id: 'take', who: 'fareej', objective: 'Take the Corsa Velo they stole from Kiran\'s client.', setup: { spawnCar: { id: 'super', paint: '#8d1f1f', at: 'mussafah' } }, check: (c) => c.inMissionCar },
        { id: 'home', who: 'fareej', objective: 'Drive it back to Kiran in Al Quoz.', target: 'kiran', check: (c) => c.inMissionCar && near(c, P.kiran, 18) && c.speed < 2, fail: (c) => c.missionCarDamage > 240 ? 'The car is wrecked.' : null },
      ],
    },
    {
      id: 'the-estate', act: 3, title: 'The Estate', who: 'fatimah', after: 'mussafah', start: 'estate', reward: 0, hour: 22,
      steps: [
        { id: 'arrive', who: 'fatimah', objective: 'The Captain\'s estate in the desert. There is a party. Walk in like a guest.', target: 'estate', check: (c) => !c.inCar && near(c, P.estate, 12) },
        { id: 'sneak', who: 'fatimah', checkpoint: true, objective: 'Find his study below the house without being seen.', setup: { garage: 'estate', guards: 1 }, check: (c) => c.atLift, fail: (c) => c.guardSaw ? 'A guard saw you.' : null },
        { id: 'study', who: 'fatimah', cut: true, setup: { shopCut: { type: 'bank', name: 'The study' } }, check: (c, m) => m.t > 10,
          lines: [[0.5, 'Fatimah', 'Photos. Of Victor, of Rashid, of Fareej\'s father.'], [4.5, 'Fatimah', 'And a name on the deeds: Captain Khalid Al Murr.'], [8, 'Fatimah', 'The Captain has a name.']] },
      ],
    },
    // ---------------------------------------------------------------- Act 4: Burned
    {
      id: 'set-up', act: 4, title: 'Set Up', who: 'fareej', after: 'the-estate', start: 'fareejHomeAct', reward: 0, hour: 7.5,
      steps: [
        { id: 'news', who: 'fareej', cut: true, check: (c, m) => m.t > 7, lines: [[0.5, '', 'GULF NEWS TODAY · "TWO WANTED FOR BUSINESS BAY MURDER"'], [3, 'Fareej', 'That\'s my face. That\'s my face on the news.'], [5.5, 'Fatimah', 'Mine too. Victor. Run.']] },
        { id: 'run', who: 'fareej', checkpoint: true, objective: 'You are wanted for a murder you did not do. Escape.', setup: { wanted: 4 }, check: (c) => !c.wanted },
      ],
    },
    {
      id: 'the-mountains', act: 4, title: 'The Mountains', who: 'fareej', after: 'set-up', start: 'hideout', reward: 0, hour: 15,
      steps: [
        { id: 'hide', who: 'fareej', objective: 'Hide out in the dunes past the camp.', target: 'hideout', check: (c) => near(c, P.hideout, 60) },
        { id: 'found', who: 'fareej', checkpoint: true, objective: 'They found you. Lose them in the dunes.', setup: { wanted: 3 }, check: (c) => !c.wanted, lines: [[0.5, 'Fareej', 'Sand in my teeth and police in my mirrors.']] },
      ],
    },
    {
      id: 'the-yacht', act: 4, title: 'The Yacht', who: 'fatimah', after: 'the-mountains', start: 'palmBeach', reward: 0, hour: 21,
      steps: [
        { id: 'ski', who: 'fatimah', objective: 'Take a jet ski from the Palm out to the Captain\'s yacht.', target: 'palmBeach', setup: { jetski: 'palmBeach', yacht: true }, check: (c) => c.onBoat },
        { id: 'out', who: 'fatimah', objective: 'Ride out to the yacht.', target: 'yacht', check: (c) => c.onBoat && near(c, P.yacht, 40) },
        { id: 'aboard', who: 'fatimah', cut: true, check: (c, m) => m.t > 10, lines: [[0.5, '', 'THE CAPTAIN\'S YACHT · OFF THE PALM'], [2, 'Fatimah', 'The ledger. The real one. With every bank account.'], [6, 'Fatimah', 'And a date: Friday. The vault under the Downtown tower.']] },
      ],
    },
    {
      id: 'mariams-deal', act: 4, title: 'Mariam\'s Deal', who: 'fatimah', after: 'the-yacht', start: 'policeHQ', reward: 0, hour: 11,
      steps: [
        { id: 'go', who: 'fatimah', objective: 'Officer Mariam wants to meet. Alone.', target: 'policeHQ', check: (c) => !c.inCar && near(c, P.policeHQ, 8) },
        { id: 'deal', who: 'fatimah', cut: true, setup: { npc: 'mariam', clearWanted: true }, check: (c, m) => m.t > 9,
          lines: [[0.5, 'Mariam', 'I know you did not kill anyone.'], [3, 'Mariam', 'Help me take the Captain, and you both walk free.'], [6, 'Fatimah', 'And if we take the money in the vault instead?'], [8, 'Mariam', 'Then I never met you.']] },
      ],
    },
    {
      id: 'big-one-1', act: 4, title: 'The Big One: The Van', who: 'fareej', after: 'mariams-deal', start: 'armoured', reward: 0, hour: 3,
      steps: [
        { id: 'van', who: 'fareej', objective: 'Steal the armoured van in Al Quoz.', target: 'armoured', setup: { spawnCar: { id: 'suv', paint: '#3a3e44', at: 'armoured' } }, check: (c) => c.inMissionCar },
        { id: 'stash', who: 'fareej', objective: 'Hide it at Kiran\'s.', target: 'kiran', check: (c) => c.inMissionCar && near(c, P.kiran, 18) && c.speed < 2 && !c.wanted },
      ],
    },
    {
      id: 'big-one-2', act: 4, title: 'The Big One: Uniforms', who: 'fatimah', after: 'big-one-1', start: 'uniforms', reward: 0, hour: 10,
      steps: [
        { id: 'buy', who: 'fatimah', objective: 'Collect the security uniforms in Karama.', target: 'uniforms', check: (c) => !c.inCar && near(c, P.uniforms, 6) },
        { id: 'paid', who: 'fatimah', cut: true, setup: { npc: 'jomon' }, check: (c, m) => m.t > 6, lines: [[0.5, 'Jomon', 'Two uniforms, two passes, one very nervous Jomon.'], [3.5, 'Fatimah', 'You\'re not coming, Jomon.'], [5, 'Jomon', 'Thank God.']] },
      ],
    },
    {
      id: 'big-one-3', act: 4, title: 'The Big One: The Helicopter', who: 'fatimah', after: 'big-one-2', start: 'helipad', reward: 0, hour: 17,
      steps: [
        { id: 'pad', who: 'fatimah', objective: 'A helicopter is waiting near the Burj. Take it.', target: 'helipad', setup: { heli: 'helipad' }, check: (c) => c.inHeli },
        { id: 'fly', who: 'fatimah', objective: 'Fly to Kiran\'s in Al Quoz and land. (W/S forward and back, A/D turn, SPACE up, SHIFT down)', target: 'kiran', check: (c) => c.inHeli && near(c, P.kiran, 60) && c.landed },
      ],
    },
    {
      id: 'big-one-4', act: 4, title: 'The Big One', who: 'fatimah', after: 'big-one-3', start: 'downtownTower', reward: 0, heist: true, hour: 23.8,
      steps: [
        { id: 'inside', who: 'fatimah', objective: 'Friday night. Walk into the Downtown tower in uniform.', target: 'downtownTower', check: (c) => !c.inCar && near(c, P.downtownTower, 10) },
        { id: 'vault', who: 'fatimah', checkpoint: true, objective: 'Down to the vault.', setup: { garage: 'downtownTower', guards: 1, heistLoud: true }, check: (c) => c.atLift, fail: (c) => c.quiet && c.guardSaw ? 'Security saw you.' : null },
        { id: 'grab', who: 'fatimah', cut: true, setup: { shopCut: { type: 'bank', name: 'The vault' } }, check: (c, m) => m.t > 7, lines: [[0.5, 'Fatimah', 'Gold, cash, and the Captain\'s hard drives.'], [4, 'Fareej', 'I\'m outside. Hurry.']] },
        { id: 'getaway', who: 'fareej', forceSwitch: true, checkpoint: true, objective: 'Get away. Lose the police.', setup: { wanted: 4, outside: 'downtownTower', bothInCar: true }, check: (c) => !c.wanted && c.inCar },
        { id: 'safe', who: 'fareej', objective: 'Back to Kiran\'s.', target: 'kiran', check: (c) => c.inCar && near(c, P.kiran, 18) && c.speed < 2 },
        { id: 'split', who: 'fareej', cut: true, setup: { npc: 'kiran', payout: true }, check: (c, m) => m.t > 7, lines: [[0.5, 'Kiran', 'Bigger than Business Bay. Much bigger.'], [3.5, 'Fatimah', 'The Captain will come for this himself.']] },
      ],
    },
    // ---------------------------------------------------------------- Act 5: The End of the Road
    {
      id: 'victor', act: 5, title: 'Victor', who: 'fatimah', after: 'big-one-4', start: 'victorOffice', reward: 0, hour: 9,
      steps: [
        { id: 'go', who: 'fatimah', objective: 'Go to Haldane Properties. It is time to talk to Victor.', target: 'victorOffice', check: (c) => !c.inCar && near(c, P.victorOffice, 8) },
        { id: 'guards', who: 'fatimah', checkpoint: true, objective: 'Victor\'s guards are waiting. Get through them.', setup: { hostiles: { at: 'victorOffice', n: 6 }, give: { weapon: 'rifle', mags: 3 } }, check: (c) => c.hostilesLeft === 0 },
        { id: 'talk', who: 'fatimah', cut: true, setup: { npc: 'victor' }, check: (c, m) => m.t > 12,
          lines: [[0.5, 'Victor', 'Fatimah. You were always my best lawyer.'], [3.5, 'Fatimah', 'You signed my name forty million times.'], [6.5, 'Victor', 'The Captain made me. He leaves the country tonight, from Downtown.'], [10, 'Fatimah', 'Then I\'ll be there too.']] },
      ],
    },
    {
      id: 'the-captain', act: 5, title: 'The Captain', who: 'fareej', after: 'victor', start: 'captainStart', reward: 0, hour: 22,
      steps: [
        { id: 'spot', who: 'fareej', objective: 'The Captain\'s car leaves Downtown. Get close.', target: 'captainStart', check: (c) => near(c, P.captainStart, 60) },
        { id: 'chase', who: 'fareej', checkpoint: true, objective: 'Chase the Captain\'s car. Ram it three times.', setup: { flee: true }, check: (c) => c.targetHits >= 3, fail: (c) => c.targetLost ? 'The Captain got away.' : null,
          lines: [[0.5, 'Fareej', 'Yalla, Captain. One more fare.']] },
        { id: 'air', who: 'fatimah', forceSwitch: true, checkpoint: true, objective: 'Fatimah, in the helicopter: keep the Captain in sight for 30 seconds.', setup: { heli: 'overTarget' }, check: (c) => c.trackedSecs >= 30, fail: (c) => c.targetLost ? 'You lost him.' : null },
        { id: 'end', who: 'fareej', forceSwitch: true, cut: true, setup: { stopTarget: true }, check: (c, m) => m.t > 10,
          lines: [[0.5, '', 'THE END OF THE ROAD · 1:40 AM'], [2, 'Captain', 'A taxi driver and a junior lawyer.'], [5, 'Fareej', 'And you\'re out of road.'], [8, 'Mariam', 'Khalid Al Murr, step away from the car.']] },
      ],
    },
    {
      id: 'ending', act: 5, title: 'The End of the Road', who: 'fatimah', after: 'the-captain', start: 'kiran', reward: 0, hour: 6.2,
      steps: [
        { id: 'dawn', who: 'fatimah', objective: 'Meet Fareej at the garage at dawn.', target: 'kiran', check: (c) => near(c, P.kiran, 20) },
        { id: 'choose', who: 'fatimah', cut: true, setup: { choice: { key: 'ending', options: ['Take the money and leave Dubai together', 'Give the hard drives and the money to Mariam'] } }, check: (c) => c.choiceMade,
          lines: [[0.5, 'Fatimah', 'The money, or our names. We can\'t have both.']] },
        { id: 'epilogue', who: 'fatimah', cut: true, setup: { epilogue: true }, check: (c, m) => m.t > 14 },
      ],
    },
  ];


  // ---- heists: the plan decides the take and the crew's cut (part 9, mission 11)
  const CREW = {
    jomon: { name: 'Jomon', cut: 0.06, skill: 'Knows the delivery bays; quiet way only gets easier' },
    kiran: { name: 'Kiran', cut: 0.12, skill: 'A faster getaway car' },
    gunman: { name: 'A hired gunman', cut: 0.15, skill: 'Fewer guards when it gets loud' },
  };
  const GETAWAY = { saloon: 'Hamra Saloon (blends in)', suv: 'Sakhr Patrol LX (rams through)', super: 'Corsa Velo (fastest)' };
  /** plan: { approach: 'quiet'|'loud', crew: id, car: id, clean: was it done without being seen } */
  function heistPayout(plan) {
    const base = plan.approach === 'quiet' ? 1200000 : 1800000;
    const take = Math.round(base * (plan.approach === 'quiet' && !plan.clean ? 0.7 : 1));
    const crewCut = Math.round(take * (CREW[plan.crew] ? CREW[plan.crew].cut : 0));
    const each = Math.floor((take - crewCut) / 2);
    return { take, crewCut, fareej: each, fatimah: each };
  }
  const startWanted = (plan) => plan.approach === 'loud' ? 4 : 3;


  // The two endings (part 9: neither is "bad"). flags.ending: 0 = take the money, 1 = give the evidence.
  const ENDINGS = [
    [[0.5, '', 'SIX MONTHS LATER'], [2, '', 'A small garage on a quiet road in Muscat. A sign: "F & F Motors".'], [6, 'Fatimah', 'Your father called. The debt is paid. He cried.'], [10, 'Fareej', 'Five stars, then?'], [12, 'Fatimah', 'Four. You still drive like a maniac.']],
    [[0.5, '', 'SIX MONTHS LATER'], [2, '', 'The Captain and Victor Haldane are sentenced. Two names are cleared.'], [6, 'Mariam', 'The police could use a driver like you, Fareej.'], [9, 'Fareej', 'I have a ride-hailing rating to repair.'], [12, 'Fatimah', 'And I have a law firm to start. In my own name.']],
  ];

  const byId = (id) => MISSIONS.find((m) => m.id === id);
  /** The next mission available after the ones done (null when Act 1 is finished). */
  function nextMission(done) { return MISSIONS.find((m) => !done.includes(m.id) && done.includes(m.after)) || null; }
  const PLACES = P;

  return { MISSIONS, byId, nextMission, PLACES, CAST, CREW, GETAWAY, heistPayout, startWanted, ENDINGS };
}));
