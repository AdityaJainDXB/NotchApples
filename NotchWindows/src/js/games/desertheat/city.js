// Desert Heat section 3: the living city's rules with no drawing in them: districts, shops and the 15% enterable rule,
// traffic signals, traffic and crowd density by hour, fuel, Salik tolls, speed cameras and fines.
// (docs/game/DESERT_HEAT_PROMPT.md parts 12, 15, 16 and 18). Loaded as window.DesertHeatCity and by node for the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatCity = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORIGIN = { lat: 25.17, lon: 55.24 };
  const M_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
  const xz = (lat, lon) => ({ x: (lon - ORIGIN.lon) * M_LON, z: -(lat - ORIGIN.lat) * 110574 });
  const hash = (a, b, salt = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233 + salt * 37.719) * 43758.5453; return s - Math.floor(s); };

  // ---- districts (centres of real areas; the nearest one names the place)
  const DISTRICTS = [
    ['deira', 'Deira', 25.268, 55.312], ['burdubai', 'Bur Dubai', 25.255, 55.292], ['karama', 'Karama', 25.240, 55.303],
    ['satwa', 'Satwa', 25.226, 55.278], ['tradecentre', 'Trade Centre', 25.220, 55.283], ['downtown', 'Downtown', 25.195, 55.276],
    ['businessbay', 'Business Bay', 25.186, 55.265], ['jumeirah', 'Jumeirah', 25.205, 55.245], ['alquoz', 'Al Quoz', 25.145, 55.235],
    ['umsuqeim', 'Umm Suqeim', 25.150, 55.205], ['barsha', 'Al Barsha', 25.110, 55.200], ['internetcity', 'Internet City', 25.095, 55.160],
    ['marina', 'Dubai Marina', 25.080, 55.140], ['jlt', 'JLT', 25.070, 55.145], ['garhoud', 'Garhoud', 25.240, 55.345], ['rasalkhor', 'Ras Al Khor', 25.185, 55.335],
  ].map(([id, name, lat, lon]) => ({ id, name, ...xz(lat, lon) }));
  function districtAt(x, z) { let b = DISTRICTS[0], bd = Infinity; for (const d of DISTRICTS) { const q = (d.x - x) ** 2 + (d.z - z) ** 2; if (q < bd) { bd = q; b = d; } } return b; }

  // ---- shops (made-up names; part 25: no real brands)
  const SHOP_TYPES = {
    grocery: { label: 'Baqala', names: ['Al Noor Grocery', 'Barakat Mini Mart', 'Al Waha Supermarket', 'Rasheed Foodstuff', 'Fresh Day Grocery'], sign: '#2f7d4a' },
    cafeteria: { label: 'Cafeteria', names: ['Kerala Star Cafeteria', 'Al Fanar Shawarma', 'Karak House', 'Arabian Tea Corner', 'Lulu Snack'], sign: '#b5402c' },
    pharmacy: { label: 'Pharmacy', names: ['Life Care Pharmacy', 'Al Shifa Pharmacy', 'Medi Plus'], sign: '#2c8a7a' },
    clothing: { label: 'Clothing', names: ['Sahar Fashion', 'Gulf Tailors', 'Urban Thread', 'Al Majd Abayas'], sign: '#6a3f8a' },
    phone: { label: 'Mobiles', names: ['Star Mobiles', 'Fix It Phones', 'Galaxy Mobile Repair'], sign: '#2a5ea8' },
    barber: { label: 'Barber', names: ['Gents Salon Al Rawda', 'Sharp Cut Barbers', 'Royal Gents'], sign: '#9a7a2c' },
    gold: { label: 'Gold', names: ['Al Dhahab Jewellers', 'Golden Crescent', 'Noor Gold & Diamonds'], sign: '#b08a2e' },
    gym: { label: 'Gym', names: ['Iron Dunes Gym', 'Pulse Fitness'], sign: '#3a3a3a' },
    bank: { label: 'Bank', names: ['Gulf Crescent Bank', 'Emirates Pearl Bank'], sign: '#1f3b5c' },
    laundry: { label: 'Laundry', names: ['Clean Way Laundry', 'Al Safa Dry Clean'], sign: '#3c86b8' },
    guns: { label: 'Guns', names: ['Desert Arms Co.', 'Falcon Firearms', 'Al Quoz Shooting Supplies'], sign: '#4a4f3a' },
  };
  // How likely each type is per district (souks have gold, offices have banks and cafés, Al Quoz has workshops' cafeterias).
  const MIX = {
    default: { grocery: 5, cafeteria: 5, pharmacy: 2, clothing: 2, phone: 2, barber: 2, laundry: 2, gym: 1, bank: 1, gold: 0.4 },
    deira: { grocery: 5, cafeteria: 5, gold: 5, phone: 4, clothing: 4, pharmacy: 2, barber: 2, laundry: 2, bank: 1 },
    burdubai: { grocery: 4, cafeteria: 5, clothing: 5, phone: 3, gold: 2, pharmacy: 2, barber: 2, laundry: 2, bank: 1 },
    karama: { grocery: 4, cafeteria: 6, clothing: 4, phone: 3, barber: 2, pharmacy: 2, laundry: 2 },
    downtown: { cafeteria: 6, clothing: 4, pharmacy: 2, bank: 3, gym: 2, grocery: 2, phone: 1 },
    businessbay: { cafeteria: 6, bank: 3, gym: 2, grocery: 3, pharmacy: 2, laundry: 1 },
    marina: { cafeteria: 6, grocery: 3, gym: 3, clothing: 2, pharmacy: 2, barber: 2, bank: 1 },
    alquoz: { cafeteria: 5, grocery: 4, laundry: 2, barber: 2, phone: 1, guns: 1.4 },
  };
  function pickType(district, r) {
    const mix = MIX[district] || MIX.default;
    let sum = 0; for (const k in mix) sum += mix[k];
    let t = r * sum; for (const k in mix) { t -= mix[k]; if (t <= 0) return k; }
    return 'grocery';
  }
  function polyArea(b) { let a = 0; const n = (b.length - 1) / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += b[1 + i * 2] * b[2 + j * 2] - b[1 + j * 2] * b[2 + i * 2]; } return Math.abs(a) / 2; }

  const ENTERABLE_MIN = 0.15;
  /**
   * Shops on one tile of buildings ([height, x,z, ...] footprints). Low and mid-rise buildings get a shop front on their
   * longest wall. At least 15% of each tile's shops are enterable (so every district reaches it too).
   * Returns [{ id, type, name, x, z, nx, nz, w, h, enterable, district }], x/z the middle of the front, n the outward normal.
   */
  function shopsForTile(buildings, key) {
    const out = [];
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi], h = b[0], n = (b.length - 1) / 2;
      if (h > 60 || n < 3) continue;
      const area = polyArea(b); if (area < 90 || area > 6000) continue;
      if (hash(b[1], b[2], 1) > 0.42) continue;
      // longest edge is the front
      let best = 0, bl = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; const l = Math.hypot(b[1 + j * 2] - b[1 + i * 2], b[2 + j * 2] - b[2 + i * 2]); if (l > bl) { bl = l; best = i; } }
      if (bl < 6) continue;
      const j = (best + 1) % n, ax = b[1 + best * 2], az = b[2 + best * 2], bx = b[1 + j * 2], bz = b[2 + j * 2];
      const dx = (bx - ax) / bl, dz = (bz - az) / bl;
      // counter-clockwise rings (the converter makes them so): the outside is to the right of the edge
      const nx = -dz, nz = dx;
      const mx = (ax + bx) / 2 + nx * 0.05, mz = (az + bz) / 2 + nz * 0.05;
      const d = districtAt(mx, mz);
      const type = pickType(d.id, hash(mx, mz, 2));
      const T = SHOP_TYPES[type];
      out.push({ id: `${key}:${bi}`, type, name: T.names[Math.floor(hash(mx, mz, 3) * T.names.length)], x: mx, z: mz, nx, nz, dx, dz, w: Math.min(bl * 0.8, 14), h: Math.min(h, 4.2), enterable: hash(mx, mz, 4) < 0.18, district: d.id });
    }
    // the 15% rule: top up with the next most likely ones
    const need = Math.ceil(out.length * ENTERABLE_MIN) - out.filter((s) => s.enterable).length;
    if (need > 0) out.filter((s) => !s.enterable).sort((a, b) => hash(a.x, a.z, 4) - hash(b.x, b.z, 4)).slice(0, need).forEach((s) => { s.enterable = true; });
    return out;
  }

  // What each enterable shop sells (prices in AED). effect: what it does to the character.
  const MENUS = {
    grocery: [['Water, 1.5 L', 2, { stamina: 1 }], ['Laban and a samosa', 4, { health: 15 }], ['Chips and juice', 5, { health: 10 }], ['Scratch card (prize: a free drink)', 5, { scratch: 1 }]],
    cafeteria: [['Karak tea', 1, { stamina: 0.5 }], ['Chicken shawarma', 8, { health: 30 }], ['Paratha and egg', 7, { health: 25 }], ['Fresh lime mint', 9, { stamina: 1 }]],
    pharmacy: [['First aid kit', 45, { health: 100 }], ['Painkillers', 12, { health: 20 }]],
    clothing: [['Plain t-shirt (charcoal)', 49, { shirt: '#3b3d40' }], ['Linen shirt (sand)', 120, { shirt: '#c8b48e' }], ['Jacket (olive)', 260, { shirt: '#4b5236' }], ['Shirt (white)', 95, { shirt: '#e9e6df' }]],
    phone: [['Phone cover', 25, {}], ['Screen protector', 15, {}]],
    barber: [['Trim and shave', 35, { beard: false }], ['Beard shaping', 25, { beard: true }]],
    gold: [['Buy 10 g of gold', 'gold10', { gold: 10 }], ['Sell 10 g of gold', 'sell10', { gold: -10 }]],
    gym: [['Day pass and a workout', 30, { staminaSkill: 0.05 }]],
    bank: [['Pay all fines', 'fines', { payFines: true }]],
    laundry: [['Wash and iron', 15, {}]],
    guns: [['Kestrel P9 pistol', 1800, { weapon: 'pistol' }], ['Mako .45 heavy pistol', 3600, { weapon: 'heavy' }], ['Vanta 9 SMG', 6200, { weapon: 'smg' }],
      ['Harrow 12 shotgun', 5400, { weapon: 'shotgun' }], ['Sable AR rifle', 12500, { weapon: 'rifle' }], ['Longreach sniper rifle', 21000, { weapon: 'sniper' }],
      ['Frag grenades (3)', 900, { weapon: 'grenade', mags: 3 }], ['Ammo for the weapon in hand (2 magazines)', 'ammo', { ammo: 2 }], ['Body armour', 500, { armour: 100 }]],
  };
  // Gold price per gram moves each game day (deterministic, between about 300 and 340 AED).
  const goldPrice = (day) => Math.round(318 + Math.sin(day * 0.9) * 12 + (hash(day, 7) - 0.5) * 14);

  // ---- traffic signals: a junction's approaches split into two phases by axis
  const CYCLE = 44, GREEN = 18, AMBER = 3, ALLRED = 1;
  function phaseOf(heading, axis) { let d = Math.abs(((heading - axis) % Math.PI + Math.PI) % Math.PI); if (d > Math.PI / 2) d = Math.PI - d; return d < Math.PI / 4 ? 0 : 1; }
  /** 'green' | 'amber' | 'red' for an approach in phase p (0 or 1) at time t, for a junction with this offset. */
  function signal(p, t, offset = 0) {
    const c = ((t + offset) % CYCLE + CYCLE) % CYCLE, start = p * (CYCLE / 2), u = ((c - start) % CYCLE + CYCLE) % CYCLE;
    if (u < GREEN) return 'green'; if (u < GREEN + AMBER) return 'amber'; return 'red';
  }

  // ---- how busy: traffic and people by hour (part 15.1, 15.2)
  function trafficDensity(hour) {
    const h = ((hour % 24) + 24) % 24;
    const rush = Math.exp(-((h - 8) ** 2) / 1.2) + Math.exp(-((h - 18.5) ** 2) / 2.2);
    const base = h < 5 ? 0.18 + (h < 4 ? 0 : 0.1) : h < 6.5 ? 0.35 : 0.6;
    return Math.min(1, base + rush * 0.45);
  }
  function crowdDensity(hour, district) {
    const h = ((hour % 24) + 24) % 24;
    let d = h < 6 ? 0.08 : h < 11 ? 0.45 : h < 16 ? 0.22 : h < 23 ? 0.85 : 0.35;    // empty at midday heat, busy evenings
    if (['deira', 'burdubai', 'karama', 'marina', 'downtown', 'satwa'].includes(district)) d *= 1.35;
    if (['alquoz', 'rasalkhor', 'internetcity'].includes(district)) d *= 0.6;
    return Math.min(1, d);
  }

  // ---- fuel (part 12)
  const FUEL = { tank: 64, price: 2.79, idlePerSec: 0.00025, perMetre: 0.000085 };
  function burn(litres, metres, throttle, dt) { return Math.max(0, litres - (metres * FUEL.perMetre * (0.6 + throttle * 0.9) + FUEL.idlePerSec * dt)); }
  const fillCost = (litres) => Math.round((FUEL.tank - litres) * FUEL.price * 100) / 100;

  // ---- Salik toll gates (real places), variable pricing as in Dubai since 2025
  const SALIK = [
    ['Al Garhoud Bridge', 25.2268, 55.3403], ['Al Maktoum Bridge', 25.2482, 55.3165], ['Al Safa', 25.1843, 55.2570],
    ['Al Barsha', 25.1135, 55.1880], ['Business Bay Crossing', 25.1936, 55.3290],
  ].map(([name, lat, lon]) => ({ name, ...xz(lat, lon) }));
  function salikFee(hour, weekday = true) {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 1 && h < 6) return 0;
    if (weekday && ((h >= 6 && h < 10) || (h >= 16 && h < 20))) return 6;
    return 4;
  }

  // ---- speed cameras and fines (UAE amounts; cameras trigger 20 km/h over the limit)
  function speedFine(speedKmh, limit) {
    const over = speedKmh - limit;
    if (over <= 20) return 0;
    if (over <= 30) return 300; if (over <= 40) return 600; if (over <= 50) return 700; if (over <= 60) return 1000; if (over <= 80) return 2000;
    return 3000;
  }
  const RED_LIGHT_FINE = 1000;

  // Where speed cameras stand: every ~1.8 km along fast roads (deterministic from the road index).
  function camerasAlong(len, roadIndex) { const out = []; for (let s = 400 + hash(roadIndex, 9) * 900; s < len - 100; s += 1800) out.push(s); return out; }

  // ---- petrol stations: made-up brands, every few km along main roads
  const FUEL_BRANDS = ['Sahra Fuel', 'Gulf Line', 'Oasis Petroleum'];

  return {
    xz, hash, DISTRICTS, districtAt, SHOP_TYPES, MIX, pickType, shopsForTile, ENTERABLE_MIN, MENUS, goldPrice,
    CYCLE, GREEN, AMBER, ALLRED, phaseOf, signal, trafficDensity, crowdDensity,
    FUEL, burn, fillCost, SALIK, salikFee, speedFine, RED_LIGHT_FINE, camerasAlong, FUEL_BRANDS,
  };
}));
