// F1 strategy and the race engineer: when and for what the computer drivers pit (cliff, weather, damage, the two-compound rule, a cheap stop under
// a Safety Car, an undercut), the undercut and overcut windows, and the radio calls "Marc" makes to the player (fuel delta, ERS, tyre temperature
// windows, weather radar, undercut, flags, damage, penalties). Pure: no DOM, no clock, no randomness; the time and the car's state come in.
//
// ALL TUNABLE NUMBERS ARE IN `STRAT` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const STRAT = {
    engineer: 'Marc',
    cliffLife: 0.30,            // the tyre cliff (the tyres module's)
    cliffMarginLaps: 1.2,       // come in when the cliff is this many laps away
    pitLossS: { GREEN: 22, VSC: 13, SAFETY_CAR: 9, YELLOW: 22 },    // what a stop costs under each flag
    cheapStopLife: 0.65,        // under a VSC / Safety Car, stop if the tyres have less life than this
    cheapStopMinLaps: 4,        // ... and more than this many laps remain
    ruleStopLapsLeft: 3,        // a dry race still on one compound: stop by this many laps from the end
    wetPit: 0.35, dryPit: 0.12, // wetness above which slicks must come in; below which inters / wets are wrong
    rainForecastRain: 0.35,     // the radar shows at least this much rain
    undercutLaps: 2,            // the other car stays out about this long
    undercutMaxLife: 0.85,      // do not undercut on tyres that are nearly new
    freshGainS: 1.1,            // seconds a lap a fresh set gains over a worn one
    lastLapsNoStop: 2,          // no strategic stop in the last laps
    // Engineer thresholds and quiet times
    fuelShortLaps: -0.3, fuelSpareLaps: 1.5,
    ersLow: 0.15, ersFull: 0.95,
    cooldownS: { fuel: 90, ers: 45, tyre: 40, weather: 120, strategy: 60, flag: 20, damage: 60, penalty: 120, battle: 30, engine: 60 },
  };

  /// Laps until the tyres reach the cliff at the observed rate of wear (life per lap). Infinity if they are not wearing.
  const lapsToCliff = (life, lifePerLap) => (lifePerLap > 1e-6 ? Math.max(0, (life - STRAT.cliffLife) / lifePerLap) : Infinity);
  /// Laps the tyres will last in all (to 0 life).
  const lapsToEnd = (life, lifePerLap) => (lifePerLap > 1e-6 ? Math.max(0, life / lifePerLap) : Infinity);

  /// The compound to fit for the rest of the race. `used` are the dry compounds already used. In a wet race wets / inters, otherwise the one that
  /// reaches the end (and satisfies the two-compound rule): Hard for a long way, Medium for less, Soft for a sprint to the flag.
  function chooseCompound(c) {
    const { lapsLeft, wetness = 0, used = [], lifeLaps = { S: 8, M: 14, H: 22 } } = c;
    if (wetness > 0.65) return 'W';
    if (wetness > STRAT.dryPit) return 'I';
    const needDifferent = used.length > 0 && new Set(used.filter((x) => 'SMH'.includes(x))).size < 2;
    const order = lapsLeft > lifeLaps.M ? ['H', 'M', 'S'] : lapsLeft > lifeLaps.S ? ['M', 'H', 'S'] : ['S', 'M', 'H'];
    for (const k of order) if (lifeLaps[k] >= lapsLeft * 0.95 && !(needDifferent && used.includes(k) && used.length === 1 && order.some((o) => o !== k && lifeLaps[o] >= lapsLeft * 0.95))) return k;
    return order[0] === 'S' ? 'M' : 'H';
  }

  /// What a stop costs under the current flag (seconds).
  const pitLoss = (flag) => STRAT.pitLossS[flag] != null ? STRAT.pitLossS[flag] : STRAT.pitLossS.GREEN;

  /// Is an undercut worth trying on the car ahead? o: gapAheadS, gapBehindS, flag, life, lapsLeft, freshGainS.
  /// The car pits, and on fresh tyres gains `freshGainS` a lap while the other stays out for `undercutLaps` laps; it works if that beats the gap
  /// and the car behind is far enough back that the stop does not cost the place to him.
  function undercut(o) {
    if (o.gapAheadS == null || !(o.gapAheadS > 0)) return { viable: false, why: 'no car to undercut' };
    if ((o.life ?? 1) < STRAT.cliffLife) return { viable: false, why: 'the tyres must be changed anyway' };
    if ((o.life ?? 1) > STRAT.undercutMaxLife) return { viable: false, why: 'the tyres are too new' };
    if ((o.lapsLeft ?? 99) <= STRAT.lastLapsNoStop + 1) return { viable: false, why: 'too late in the race' };
    const gain = (o.freshGainS != null ? o.freshGainS : STRAT.freshGainS) * STRAT.undercutLaps, loss = pitLoss(o.flag || 'GREEN');
    const behindOk = o.gapBehindS == null || o.gapBehindS > loss - 2;
    const viable = o.gapAheadS < gain && behindOk;
    return { viable, advantageS: gain - o.gapAheadS, rejoinGapS: (o.gapBehindS == null ? 99 : o.gapBehindS) - loss, why: viable ? 'window open' : (!behindOk ? 'the car behind would jump us' : 'the gap is too big') };
  }
  /// Stay out and let the other car stop first (an overcut): worth it when our tyres are in good shape and the car ahead is pitting.
  function overcut(o) {
    return { viable: !!(o.aheadPitting && (o.life ?? 0) > 0.5 && (o.gapAheadS ?? 99) < 3), why: o.aheadPitting ? 'he has come in: stay out on good tyres' : 'nobody pitting' };
  }

  /// Should a computer driver pit now? c: lap (completed), lapsTotal, life, lifePerLap, compound, used (dry compounds used so far, including this one), wetness,
  /// forecastRain (radar, 0..1), flag ('GREEN'|'VSC'|'SAFETY_CAR'), needsPit, gapAheadS, gapBehindS, noStopsAllowed (sprint),
  /// Returns { pit, reason, compound, urgent }.
  function shouldPit(c) {
    const lapsLeft = Math.max(0, (c.lapsTotal || 0) - (c.lap || 0)), wet = c.wetness || 0, flag = c.flag || 'GREEN';
    const slick = 'SMH'.includes(c.compound), life = c.life != null ? c.life : 1;
    const used = (c.used || [c.compound]).filter((x) => 'SMH'.includes(x));
    const pick = (extra) => chooseCompound({ lapsLeft: Math.max(1, lapsLeft), wetness: Math.max(wet, extra || 0), used });
    if (c.needsPit) return { pit: true, reason: 'damage', compound: pick(), urgent: true };
    if (slick && wet > STRAT.wetPit) return { pit: true, reason: 'rain on slicks', compound: pick(), urgent: true };
    if (!slick && wet < STRAT.dryPit && (c.forecastRain || 0) < 0.2 && lapsLeft > 1) return { pit: true, reason: 'dry track on wets', compound: pick(), urgent: false };
    if (slick && (c.forecastRain || 0) >= STRAT.rainForecastRain && wet > STRAT.dryPit * 0.5 && lapsLeft > 2) return { pit: true, reason: 'rain coming', compound: pick(Math.max(wet, 0.3)), urgent: false };
    if (lapsLeft <= 1) return { pit: false, reason: 'last lap', compound: null, urgent: false };
    const cliff = lapsToCliff(life, c.lifePerLap || 0);
    if (!c.noStopsAllowed && slick && !wet && new Set(used).size < 2 && lapsLeft <= STRAT.ruleStopLapsLeft && lapsLeft > 1) return { pit: true, reason: 'two-compound rule', compound: pick(), urgent: true };
    if (slick && cliff <= STRAT.cliffMarginLaps && lapsLeft > cliff + 0.5) return { pit: true, reason: 'tyres at the cliff', compound: pick(), urgent: life < STRAT.cliffLife + 0.03 };
    if (slick && (flag === 'VSC' || flag === 'SAFETY_CAR') && life < STRAT.cheapStopLife && lapsLeft > STRAT.cheapStopMinLaps) return { pit: true, reason: 'cheap stop under ' + (flag === 'VSC' ? 'the VSC' : 'the Safety Car'), compound: pick(), urgent: false };
    if (slick && flag === 'GREEN' && lapsLeft > STRAT.lastLapsNoStop + 1) {
      const u = undercut({ gapAheadS: c.gapAheadS, gapBehindS: c.gapBehindS, flag, life, lapsLeft });
      if (u.viable && life < 0.8 && cliff < lapsLeft) return { pit: true, reason: 'undercut', compound: pick(), urgent: false };
    }
    return { pit: false, reason: '', compound: null, urgent: false };
  }

  // ---- the race engineer

  const fmt1 = (x) => (Math.round(x * 10) / 10).toString();
  /// What Marc says now. `st`: the player's situation: fuelDeltaLaps, socFraction, ersMode, tyre { state, life, carcass, window, cliff, blistering, compound }, engineC,
  /// rain { raining, radarRain, nextRainInS }, flag, needsPit, damageWhy, penaltySecs, ahead { name, gapS }, overtakeEligible, undercut (the result of undercut()), lap,
  /// lapsTotal, clipping, wetness. `mem` remembers when each call was last made (pass the same object every time). `now`: seconds. Returns up to `max` calls,
  /// most important first: [{ id, text, priority, group }].
  function engineerCalls(st, mem, now, max = 2) {
    const S = STRAT, out = [];
    const add = (id, group, priority, text, once) => out.push({ id, group, priority, text, once: !!once });
    const lapNo = st.lap || 0, t = st.tyre || {};
    if (st.needsPit) add('damage', 'damage', 1, `Box, box. ${st.damageWhy ? 'We have ' + st.damageWhy + '.' : 'We have damage.'} We need to fix it.`);
    if (st.flag === 'RED_FLAG') add('flag-red', 'flag', 1, 'Red flag, red flag. Go to the pit lane. Tyres and front wing are allowed.', true);
    else if (st.flag === 'SAFETY_CAR') add('flag-sc', 'flag', 2, `Safety Car, Safety Car.${t.life != null && t.life < S.cheapStopLife ? ' Cheap stop if you want it: box, box.' : ' Stay close, keep the tyres warm.'}`, true);
    else if (st.flag === 'VSC') add('flag-vsc', 'flag', 2, 'Virtual Safety Car. Keep to the delta, no overtaking.', true);
    if (t.cliff || (t.life != null && t.life < S.cliffLife + 0.03)) add('tyre-cliff', 'tyre', 1, 'The tyres are at the cliff. Box this lap.');
    else if (t.blistering > 0.3) add('tyre-blister', 'tyre', 2, 'Blistering on the rears. Back off the kerbs and the traction.');
    else if (t.state === 'hot' && lapNo >= 1) add('tyre-hot', 'tyre', 3, `Tyres are overheating, ${Math.round(t.carcass || 0)} degrees against a window of ${(t.window || [0, 0]).join(' to ')}. Look after them.`);
    else if (t.state === 'cold' && lapNo >= 1) add('tyre-cold', 'tyre', 4, `Tyres are below the window, ${Math.round(t.carcass || 0)} degrees, we need ${(t.window || [0, 0])[0]}. Push the fronts.`);
    if (st.rain && st.rain.raining && t.compound && 'SMH'.includes(t.compound)) add('rain-now', 'weather', 1, 'It is raining. Box for intermediates.');
    else if (st.rain && st.rain.nextRainInS != null && st.rain.nextRainInS <= 240 && t.compound && 'SMH'.includes(t.compound)) add('rain-soon', 'weather', 3, `Rain in about ${Math.max(1, Math.round(st.rain.nextRainInS / 60))} minute${st.rain.nextRainInS > 90 ? 's' : ''}. Think about intermediates.`);
    else if (st.rain && st.rain.drying && t.compound && !'SMH'.includes(t.compound)) add('drying', 'weather', 3, 'The track is drying. We can look at slicks soon.');
    if (st.undercut && st.undercut.viable && st.ahead) add('undercut', 'strategy', 2, `Box now to undercut ${st.ahead.name}. Target plus two on the front wing.`);
    if (st.overcut && st.overcut.viable && st.ahead) add('overcut', 'strategy', 3, `${st.ahead.name} has come in. Stay out, the tyres are good: we will overcut.`);
    if (st.fuelDeltaLaps != null && st.fuelDeltaLaps < S.fuelShortLaps) add('fuel-short', 'fuel', 2, `Fuel check. We are ${fmt1(-st.fuelDeltaLaps)} laps short. Lift and coast into the braking zones.`);
    else if (st.fuelDeltaLaps != null && st.fuelDeltaLaps > S.fuelSpareLaps && lapNo >= 2) add('fuel-spare', 'fuel', 5, `Fuel is fine, plus ${fmt1(st.fuelDeltaLaps)} laps. You can use the rich mixture.`);
    if (st.socFraction != null && st.socFraction < S.ersLow) add('ers-low', 'ers', 3, 'The battery is low. Harvest through the next braking zones, lift and coast.');
    else if (st.socFraction != null && st.socFraction > S.ersFull && st.ersMode === 'LOW') add('ers-full', 'ers', 5, 'The battery is full. Switch the ERS to High and use it.');
    if (st.clipping) add('clipping', 'ers', 5, 'We are super clipping at the end of the straight to charge the battery.');
    if (st.overtakeEligible && st.ahead) add('overtake', 'battle', 3, `Overtake Mode is available. ${st.ahead.name} is ${fmt1(st.ahead.gapS)} ahead.`);
    if (st.penaltySecs > 0) add('penalty', 'penalty', 2, `${Math.round(st.penaltySecs)} second penalty. Serve it at your next stop.`);
    if (st.engineC != null && st.engineC > 118) add('engine-hot', 'engine', 2, `Engine temperature is ${Math.round(st.engineC)} degrees. Check the sidepods, we may need to lift.`);
    out.sort((a, b) => a.priority - b.priority);
    mem.said = mem.said || {};
    const calls = [];
    for (const c of out) {
      if (calls.length >= max) break;
      const last = mem.said[c.id], cool = S.cooldownS[c.group] || 60;
      if (c.once ? last != null && now - last < 600 : last != null && now - last < cool) continue;
      mem.said[c.id] = now; calls.push({ id: c.id, text: c.text, priority: c.priority, group: c.group });
    }
    return calls;
  }

  /// The ERS mode a computer driver uses: save the battery when it is low, attack when it is full or a car is close, otherwise the balanced mode.
  function ersAuto(o) {
    const soc = o.socFraction == null ? 0.5 : o.socFraction;
    if (soc < 0.12) return 'LOW';
    if ((o.gapAheadS != null && o.gapAheadS < 1.2 && soc > 0.3) || (o.gapBehindS != null && o.gapBehindS < 0.8 && soc > 0.3)) return 'HIGH';
    if (soc > 0.9) return 'HIGH';
    if (o.lapsLeft != null && o.lapsLeft <= 1) return 'HIGH';
    return soc < 0.3 ? 'LOW' : 'MEDIUM';
  }

  const api = { STRAT, ersAuto, lapsToCliff, lapsToEnd, chooseCompound, pitLoss, undercut, overcut, shouldPit, engineerCalls };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.strategy = api;
})(typeof window !== 'undefined' ? window : globalThis);
