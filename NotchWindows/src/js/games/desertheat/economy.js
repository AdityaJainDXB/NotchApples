// Desert Heat section 5: money as data (docs/game/DESERT_HEAT_PROMPT.md parts 12.6, 17 and 18): cars for sale, tuning,
// repairs, the ride-hailing side job, property and businesses. All brands are made up. window.DesertHeatEconomy / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatEconomy = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Cars: price in AED, how they drive (multipliers on the saloon), body proportions for the model.
  const CARS = {
    saloon: { name: 'Hamra Saloon', cls: 'Saloon', price: 62000, torque: 1, top: 52, grip: 1.02, mass: 1350, body: [1, 1, 1] },
    taxi: { name: 'Hamra Saloon (cab)', cls: 'Saloon', price: 0, torque: 1, top: 52, grip: 1.02, mass: 1350, body: [1, 1, 1], hidden: true },
    hatch: { name: 'Zephyr City', cls: 'Compact', price: 48000, torque: 0.8, top: 48, grip: 1.0, mass: 1100, body: [0.94, 0.98, 0.86] },
    suv: { name: 'Sakhr Patrol LX', cls: 'SUV', price: 245000, torque: 2.1, top: 58, grip: 1.0, mass: 2550, body: [1.1, 1.32, 1.1] },
    pickup: { name: 'Jabal Hauler', cls: 'Pickup', price: 128000, torque: 1.7, top: 50, grip: 0.98, mass: 2100, body: [1.08, 1.22, 1.14] },
    coupe: { name: 'Vesta GT', cls: 'Sports', price: 390000, torque: 2.6, top: 80, grip: 1.22, mass: 1550, body: [1.03, 0.86, 1.02] },
    muscle: { name: 'Bastion V8', cls: 'Muscle', price: 210000, torque: 2.9, top: 75, grip: 1.05, mass: 1750, body: [1.04, 0.92, 1.08] },
    super: { name: 'Corsa Velo', cls: 'Super', price: 1450000, torque: 4.2, top: 95, grip: 1.4, mass: 1450, body: [1.06, 0.76, 1.04] },
  };
  // Tuning (Kiran's garage in Al Quoz): each level multiplies a stat; cost grows with the car's price.
  const TUNE = {
    engine: { name: 'Engine', levels: [1, 1.12, 1.25, 1.4], base: [0, 6000, 14000, 30000] },
    brakes: { name: 'Brakes', levels: [1, 1.15, 1.3, 1.45], base: [0, 2500, 5500, 9000] },
    tyres: { name: 'Tyres', levels: [1, 1.06, 1.12, 1.18], base: [0, 3200, 7000, 12000] },
    armour: { name: 'Armour plating', levels: [1, 1.25, 1.5, 2], base: [0, 9000, 20000, 42000] },
  };
  const tuneCost = (part, lv, carPrice) => Math.round(TUNE[part].base[lv] * (0.6 + carPrice / 400000));
  const PAINTS = [['Pearl white', '#e9e6df'], ['Desert sand', '#c8b48e'], ['Graphite', '#3b3d40'], ['Midnight blue', '#1d2c44'], ['Racing red', '#8d1f1f'], ['Olive', '#4b5236'], ['Gold', '#b08a2e'], ['Matte black', '#141416']];
  const PAINT_COST = 1800;

  /** Applies a car and its tuning to a Car's spec (returns a new spec). */
  function specFor(base, carId, tune = {}) {
    const c = CARS[carId] || CARS.saloon, e = TUNE.engine.levels[tune.engine || 0], b = TUNE.brakes.levels[tune.brakes || 0], t = TUNE.tyres.levels[tune.tyres || 0];
    return Object.assign({}, base, {
      torque: base.torque.map(([r, q]) => [r, q * c.torque * e]),
      topSpeed: c.top * (1 + (e - 1) * 0.35), grip: c.grip * t, mass: c.mass, brakeForce: base.brakeForce * b * c.mass / 1350,
    });
  }
  // Repairs: damage points (0-300) cost money; the price grows with the car's value.
  const repairCost = (damage, carPrice) => Math.round(Math.min(300, damage) * (4 + carPrice / 60000));

  // ---- the ride-hailing side job (Fareej): base fare, per km, tip by how smooth the ride was
  function rideFare(km, minutes, bumps) {
    const fare = Math.round(12 + km * 2.1 + minutes * 0.5);
    const rating = Math.max(1, 5 - Math.floor(bumps / 2));
    const tip = rating >= 5 ? Math.round(fare * 0.15) : rating === 4 ? Math.round(fare * 0.05) : 0;
    return { fare, rating, tip, total: fare + tip };
  }
  const RIDE_NAMES = ['Priya', 'Omar', 'Hannah', 'Rajesh', 'Mariam', 'Chen', 'Joseph', 'Aisha', 'Dmitri', 'Grace', 'Faisal', 'Neha'];
  const RIDE_LINES = [
    'Can you take Al Khail? Sheikh Zayed is a parking lot.', 'Sorry, I\'m on a call.', 'Is the AC on? It\'s like an oven back here.',
    'First time in Dubai. Is it always this hot in November?', 'Don\'t go through Salik, please.', 'My meeting started five minutes ago.',
    'Wallah, this traffic.', 'Nice car. Smells like karak.', 'Just here on the right is fine.', 'Can you put the radio on?',
  ];

  // ---- property (save points with a garage) and businesses (income per game day)
  const PROPERTY = [
    { id: 'deira-flat', name: 'Flat above a shop, Deira', price: 0, owner: 'fareej', lat: 25.2705, lon: 55.3040 },
    { id: 'marina-apt', name: 'Apartment 3104, Dubai Marina', price: 0, owner: 'fatimah', lat: 25.0790, lon: 55.1395 },
    { id: 'karama-apt', name: '1-bed in Karama', price: 650000, lat: 25.2420, lon: 55.3040 },
    { id: 'downtown-apt', name: 'Downtown view apartment', price: 2400000, lat: 25.1945, lon: 55.2745 },
    { id: 'jumeirah-villa', name: 'Villa in Jumeirah', price: 6800000, lat: 25.2050, lon: 55.2470 },
  ];
  const BUSINESSES = [
    { id: 'karak', name: 'Karak tea stall chain', price: 180000, perDay: 2400, lat: 25.2440, lon: 55.3010 },
    { id: 'rental', name: 'Car rental, Al Quoz', price: 750000, perDay: 7800, lat: 25.1400, lon: 55.2300 },
    { id: 'safari', name: 'Desert safari company', price: 1200000, perDay: 11500, lat: 25.1180, lon: 55.2010 },
    { id: 'garage', name: 'Garage, Al Quoz', price: 950000, perDay: 9000, lat: 25.1385, lon: 55.2290 },
    { id: 'club', name: 'Nightclub, the Marina', price: 3500000, perDay: 31000, lat: 25.0815, lon: 55.1420 },
  ];
  /** Income for the days passed since the last collection; it stops piling up after a week (the manager calls). */
  const businessIncome = (perDay, days) => perDay * Math.min(7, Math.max(0, Math.floor(days)));

  /** Moving money between the two characters (the bank app); never below zero. */
  function transfer(from, to, amount) {
    const a = Math.max(0, Math.min(Math.floor(amount), Math.floor(from.money)));
    from.money -= a; to.money += a; return a;
  }

  // ---- the news site reacts to what the player did
  function headlines(stats) {
    const h = [];
    if (stats.policeWrecked > 0) h.push(`${stats.policeWrecked} police cars destroyed in a night of chaos`);
    if (stats.maxWanted >= 4) h.push('Helicopter joins manhunt over Dubai');
    if (stats.fines > 5000) h.push('Record traffic fines: one driver owes thousands');
    if (stats.rides > 5) h.push('Ride-hailing driver praised for "knowing every back road in Deira"');
    if (stats.speed > 250) h.push('Radar clocks car at over 250 km/h on Sheikh Zayed Road');
    h.push('Humidity to rise this week; fog expected on the E11 at dawn', 'New tower in Business Bay tops out at 70 floors', 'Gold price steady in the Deira souk');
    return h.slice(0, 5);
  }

  return { CARS, TUNE, tuneCost, PAINTS, PAINT_COST, specFor, repairCost, rideFare, RIDE_NAMES, RIDE_LINES, PROPERTY, BUSINESSES, businessIncome, transfer, headlines };
}));
