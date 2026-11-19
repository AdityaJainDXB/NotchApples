// Desert Heat section 4: weapons, damage and the wanted level, with no drawing in them (docs/game/DESERT_HEAT_PROMPT.md
// parts 13 and 14). All weapon names are made up. Loaded as window.DesertHeatCombat and by node for the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatCombat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // dmg per hit, rof shots a second, mag size, spread (radians, standing still), range metres, recoil kick, reload seconds,
  // pellets for shotguns, auto for holding the trigger, price and ammo price (per magazine) in the gun shop.
  const WEAPONS = {
    fists: { name: 'Fists', kind: 'melee', dmg: 12, rof: 2.2, mag: Infinity, spread: 0, range: 1.6, recoil: 0, reload: 0, price: 0 },
    bat: { name: 'Bat', kind: 'melee', dmg: 30, rof: 1.4, mag: Infinity, spread: 0, range: 2.0, recoil: 0, reload: 0, price: 60 },
    pistol: { name: 'Kestrel P9', kind: 'gun', dmg: 24, rof: 4, mag: 15, spread: 0.012, range: 60, recoil: 0.03, reload: 1.3, price: 1800, ammo: 40 },
    heavy: { name: 'Mako .45', kind: 'gun', dmg: 42, rof: 2.4, mag: 8, spread: 0.01, range: 70, recoil: 0.06, reload: 1.6, price: 3600, ammo: 60 },
    smg: { name: 'Vanta 9', kind: 'gun', dmg: 18, rof: 12, mag: 30, spread: 0.035, range: 45, recoil: 0.02, reload: 1.9, auto: true, price: 6200, ammo: 90 },
    shotgun: { name: 'Harrow 12', kind: 'gun', dmg: 14, pellets: 8, rof: 1.1, mag: 6, spread: 0.09, range: 28, recoil: 0.12, reload: 2.6, price: 5400, ammo: 70 },
    rifle: { name: 'Sable AR', kind: 'gun', dmg: 30, rof: 9, mag: 30, spread: 0.018, range: 120, recoil: 0.025, reload: 2.2, auto: true, price: 12500, ammo: 120 },
    sniper: { name: 'Longreach', kind: 'gun', dmg: 110, rof: 0.8, mag: 5, spread: 0.002, range: 400, recoil: 0.15, reload: 3, price: 21000, ammo: 150, scope: true },
    grenade: { name: 'Frag grenade', kind: 'throw', dmg: 140, rof: 0.8, mag: 1, spread: 0, range: 35, radius: 7, recoil: 0, reload: 0.8, price: 300, ammo: 300 },
  };
  const ORDER = ['fists', 'bat', 'pistol', 'heavy', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'];

  /** One character's weapons: what they own, ammo in the magazine and in reserve, firing and reloading. */
  class Arsenal {
    constructor(owned = ['fists']) { this.owned = {}; for (const id of owned) this.give(id, 0); this.cur = 'fists'; this.cool = 0; this.reloading = 0; }
    give(id, mags = 2) {
      const w = WEAPONS[id]; if (!w) return;
      const o = this.owned[id] || (this.owned[id] = { mag: w.mag === Infinity ? Infinity : 0, reserve: 0 });
      if (w.mag !== Infinity) { o.reserve += w.mag * mags; if (o.mag === 0) { const take = Math.min(w.mag, o.reserve); o.mag = take; o.reserve -= take; } }
    }
    has(id) { return !!this.owned[id]; }
    get weapon() { return WEAPONS[this.cur]; }
    get armed() { return this.weapon.kind !== 'melee'; }
    select(id) { if (this.owned[id] && id !== this.cur) { this.cur = id; this.cool = 0.3; this.reloading = 0; } }
    cycle(dir) { const ids = ORDER.filter((k) => this.owned[k]); const i = ids.indexOf(this.cur); this.select(ids[(i + dir + ids.length) % ids.length]); }
    step(dt) {
      this.cool = Math.max(0, this.cool - dt);
      if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) { this.reloading = 0; const w = this.weapon, o = this.owned[this.cur], need = w.mag - o.mag, take = Math.min(need, o.reserve); o.mag += take; o.reserve -= take; } }
    }
    reload() { const w = this.weapon, o = this.owned[this.cur]; if (w.mag === Infinity || this.reloading || o.mag >= w.mag || o.reserve <= 0) return false; this.reloading = w.reload; return true; }
    /** Try to fire. moving 0..1 widens the spread. Returns null or { pellets, spread, dmg, range, kind }. */
    fire(moving = 0, focus = false) {
      const w = this.weapon, o = this.owned[this.cur];
      if (this.cool > 0 || this.reloading > 0) return null;
      if (o.mag !== Infinity) { if (o.mag <= 0) { this.reload(); return null; } o.mag--; }
      this.cool = 1 / w.rof;
      const spread = w.spread * (1 + moving * 2.5) * (focus ? 0.35 : 1);
      const shot = { pellets: w.pellets || 1, spread, dmg: w.dmg, range: w.range, kind: w.kind, radius: w.radius || 0, recoil: w.recoil };
      if (o.mag === 0 && w.kind === 'throw') { delete this.owned[this.cur]; this.cur = 'fists'; }
      else if (o.mag === 0 && o.reserve > 0) this.reload();
      return shot;
    }
    toJSON() { return { owned: this.owned, cur: this.cur }; }
    static from(j) { const a = new Arsenal([]); if (j && j.owned) { for (const k in j.owned) a.owned[k] = { mag: j.owned[k].mag === null ? Infinity : j.owned[k].mag, reserve: j.owned[k].reserve }; a.cur = a.owned[j.cur] ? j.cur : 'fists'; } if (!a.owned.fists) a.owned.fists = { mag: Infinity, reserve: 0 }; return a; }
  }

  /** Damage to someone with health and armour: armour takes two thirds while it lasts. cover cuts damage by 70%. */
  function damage(target, dmg, cover = false) {
    let d = dmg * (cover ? 0.3 : 1);
    if (target.armour > 0) { const a = Math.min(target.armour, d * 2 / 3); target.armour -= a; d -= a; }
    target.health = Math.max(0, target.health - d);
    return target.health <= 0;
  }

  /** Chance a police officer's shot hits, by distance, the target's speed, cover and difficulty. */
  function hitChance(dist, targetSpeed, cover, difficulty = 1) {
    let p = 0.55 * Math.exp(-dist / 28) * difficulty;
    p *= 1 / (1 + targetSpeed * 0.12);
    if (cover) p *= 0.3;
    return Math.max(0, Math.min(0.85, p));
  }

  // ---- the wanted level
  const ESCAPE_SECONDS = [0, 10, 18, 28, 40, 55];        // out of sight AND outside the search circle for this long
  const SEARCH_RADIUS = [0, 140, 220, 340, 480, 650];
  const UNITS = [0, 1, 3, 5, 7, 9];                       // police cars at once
  const CRIMES = { shotsFired: 2, hitPerson: 3, killPerson: 3, hitCop: 4, killCop: 4, ramCop: 1, fines: 1, carjack: 1, wreckCop: 3, rob: 2 };

  class Wanted {
    constructor() { this.level = 0; this.unseen = 0; this.lastSeen = null; this.heat = 0; this.cool = 0; }
    /** A crime seen (or heard) at x,z. The level never drops from a new crime. Several of the same raise it slowly. */
    crime(type, x, z) {
      const lv = CRIMES[type] || 1;
      this.heat += lv * 0.25;
      const target = Math.min(5, Math.max(this.level, lv, this.level > 0 ? Math.floor(this.level + this.heat / 3) : 0));
      if (target > this.level) this.level = target;
      this.lastSeen = { x, z }; this.unseen = 0;
      return this.level;
    }
    /** seen: any officer can see the player. Returns 'cleared' when the player escapes. */
    step(dt, x, z, seen) {
      if (!this.level) return null;
      if (seen) { this.lastSeen = { x, z }; this.unseen = 0; return null; }
      const out = !this.lastSeen || Math.hypot(x - this.lastSeen.x, z - this.lastSeen.z) > SEARCH_RADIUS[this.level];
      if (out) this.unseen += dt; else this.unseen += dt * 0.25;      // hiding inside the circle works, slowly
      if (this.unseen >= ESCAPE_SECONDS[this.level]) { this.clear(); return 'cleared'; }
      return null;
    }
    clear() { this.level = 0; this.unseen = 0; this.lastSeen = null; this.heat = 0; }
    get units() { return UNITS[this.level]; }
    get radius() { return SEARCH_RADIUS[this.level]; }
    get helicopter() { return this.level >= 4; }
    get roadblocks() { return this.level >= 3; }
    get supercars() { return this.level >= 5; }
    get shootOnSight() { return this.level >= 2; }
  }

  // Busted: lose 10% of cash (at most 5,000) and the weapons carried. Wasted: hospital bill plus 5% (at most 3,000).
  function busted(money) { return Math.min(5000, Math.round(money * 0.10)); }
  function wasted(money) { return 500 + Math.min(3000, Math.round(money * 0.05)); }

  return { WEAPONS, ORDER, Arsenal, damage, hitChance, Wanted, ESCAPE_SECONDS, SEARCH_RADIUS, UNITS, CRIMES, busted, wasted };
}));
