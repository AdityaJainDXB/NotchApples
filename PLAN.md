# PLAN: full F1 simulation on top of the existing Racing game

Status: **confirmed by the owner (all four phases, F1-only opt-in, own numbers, spec tyre windows and track limits, no R&D / cost cap). Phase 1 modules done and tested; Phases 2 to 4 and the game integration in progress.**
Branch for the work: `main-fxaehg`. Mac and Windows share one version (docs/VERSIONING.md); each phase would be its own PR and release.

## 1. What the audit found

Everything lives in one file, `NotchWindows/src/js/games/racing.js` (4,341 lines, one IIFE, plain browser JS, no build step), shared by the
Windows app (`modules/games.js` imports it) and the Mac app (`RacingGame.html` loads the same file in a web view, bundled by `project.yml`).
Tests: `NotchWindows/tests/racing.test.mjs` (51 tests, Node's built-in runner, `node --test NotchWindows/tests/*.test.mjs`). The file exposes a
`_test` object for them. Other games already split their rules into a pure `*-logic.js` file that runs in Node and in the web view
(`ctf-logic.js` + `ctf.js` is the pattern: `window.NotchCtfLogic` / `module.exports`).

| Area | What exists today | Where |
|---|---|---|
| Physics loop | Fixed sub-steps of at most 1/120 s inside the frame loop; `stepCar` is a body-frame model (engine, brakes, drag, grip-limited yaw, slide with slip recovery), `gearbox` (auto or manual, rev limiter), road height/bank/slope per track sample | `stepCar` ~l.969, loop ~l.4306 |
| Cars | 7 cars with `accel, vmax, grip, steer, loose, brake, down` (a crude downforce factor), `gears, idle, redline, cyl, tough`; `f1` is the F1 car | `CARS` ~l.884 |
| Tyres | Compounds S/M/H/I/W with grip, wear rate and `WET` track wetness; **one temperature per wheel** (not surface + carcass), one grip window 80–110 °C for all compounds; wear lowers grip linearly (no cliff); puncture; brake disc temps and fade | `TYRES`, `tyreGrip`, `thermal`, `tyreWearGrip` ~l.857–1235 |
| Damage | `dmg` 0..1 per car (one number), `hurt()`, crash spin, wrecks, punctures; no per-part damage | `hurt` ~l.1195 |
| Aero | `down` factor only. **No** air density, drag area, ground effect, porpoising, dirty air, active aero | `stepCar` |
| DRS / ERS | `drsEligible` (green, lap ≥ 1, < 1.0 s) and a one-number `ersStep` (14 s deploy, refill under braking). **No** MGU-K/ICE split, SoC in MJ, super clipping, Overtake Mode, X/Z mode | l.1240–1246 |
| Race control | `raceCtl` + `setFlag`: `green, yellow, vsc, sc, red` (rank-ordered, only ever escalates), crash → flag via `flagForCrash`, Safety Car and Medical Car are real cars, VSC delta, penalties for breaking a flag; lives **inside `mount()`**, tied to the DOM and to `racers` | ~l.2200–2600 |
| Flags missing | `YELLOW_DOUBLE`, per-mini-sector yellows, BLUE (only a banner for the player), BLACK_AND_ORANGE, BLACK_AND_WHITE, BLACK, CHEQUERED as a state | |
| Weekend | `race` or `quali` (Q1/Q2/Q3 knockout with `qualiSizes/qualiOrder/qualiKnockout/qualiGrid`), a formation lap, pit stops with crew animation, `pitInfo`, 80 km/h `PIT_LIMITER_KMH`, track-limit counter (`trackLimitStep`: warn, warn, B&W, then 5 s each time) | ~l.1147, 1395 |
| Weekend missing | FP1–FP3, Sprint weekend (SQ1–SQ3, Sprint, GP quali), 107 % rule, Parc Fermé, 13-set tyre allocation, mandatory two-compound rule, Drive-Through / Stop-Go, penalty serving rules, unsafe release, red-flag pit-lane restart procedure | |
| AI / engineer | AI drivers with `LEVELS` (skill, slip, corner, brakes, defend), pit decisions via `pitTyreChoice`; radio engineer lines and TTS (`say`, `spokenTimes`); F1 2025 grid names and liveries (`F1_2025`) | ~l.1029, 1236–1262 |
| Track | 12 premade tracks + the real 2026 calendar circuits traced from GPS, designer, track generator, elevation, banking, barrier at `WALL` = 7 m | |
| HUD | Chase / cockpit / top-down, minimap, dash, tyre temperature rings, setup screen (`screen = 'setup'`) | |
| Environment | `WET` (a single 0..1 number), no rubbering-in, no altitude/temperature air density | |
| Not in the code at all | Season component pool, fuel load, R&D / cost cap, MFD | |

Constraints that shape the plan:
1. **No build step and one file.** New code must be plain browser JS that also loads in Node. Mac needs each new file added to `project.yml` and
   `RacingGame.html`; I can run the Node tests and a headless browser here, **not** the Mac build.
2. `raceCtl` and the weekend code read and write closure variables of `mount()`. A real `RaceControlStateMachine` has to be extracted as a pure
   module with the closure calling into it, done one flag at a time so the current Safety Car / VSC / red flag behaviour keeps working.
3. The existing tyre and ERS numbers are tuned and tested (51 tests). I will keep the current functions' signatures and behaviour for the six
   non-F1 cars and for existing saves, and add the F1-grade model behind the F1 car / an "F1 Weekend" mode, so nothing existing changes unless chosen.
4. The spec is large. I read it as four releases, not one change.

## 2. File-level architecture (proposed)

New pure logic modules next to `racing.js`, each exporting to `window.NotchRaceF1.<name>` and `module.exports`, each with its own test file. Nothing
in them touches the DOM, `Math.random` or `Date` (a seeded RNG is passed in), so results are deterministic and frame-rate independent (they take `dt`).

```
NotchWindows/src/js/games/f1/
  era.js          RegulationEra {ERA_2025, ERA_2026} config: which aero/ERS/active-aero rules apply
  aero.js         air density (altitude, temperature), downforce/drag (0.5 ρ v² C A), ground effect vs ride height, porpoising,
                  dirty air from the car ahead, DRS (2025) and Z/X mode (2026)
  powerunit.js    ICE + MGU-K split, battery SoC (MJ), harvesting (braking, lift-and-coast, super clipping, 8.5 MJ/lap cap), Overtake Mode
  tyres.js        surface + carcass temperatures, per-compound windows, graining/blistering, wear curve with a cliff below 30 %, grip multiplier
  damage.js       per-part damage: front-wing endplate, floor edge, sidepod blockage (cooling), suspension (DNF)
  racecontrol.js  RaceControlStateMachine: global state + per-mini-sector flags, all flag types, red-flag procedure, restart, blue flag logic
  penalties.js    steward queue: track limits, pit speeding, unsafe release, blue-flag, serving rules, black flag escalation
  weekend.js      session flow (standard / sprint), knockout, 107 %, Parc Fermé, tyre allocation + two-compound rule, component pool
  evolution.js    rubbering-in, rain washing, dry/wet line grip map
  strategy.js     AI pit/undercut strategy and the race engineer's context rules (fuel delta, ERS, tyres, weather, undercut)
  mfd.js          data model for the multi-function display (what can be adjusted, limits)
NotchWindows/tests/f1-*.test.mjs   one per module, plus f1-integration.test.mjs (a whole simulated race)
```

`racing.js` keeps its role (screen, input, rendering, networking, existing modes) and gains thin adapter calls: `stepCar` asks `aero`/`tyres`
for multipliers when the F1 model is on; `raceCtl` becomes a view over `racecontrol.js`. `RacingGame.html`, `project.yml` and
`modules/games.js` get the new script files (one entry per file).

## 3. Phases (each is a PR with tests green and a release)

### Phase 1: core physics, aero, power unit, tyres, damage
- [x] `era.js`: `RegulationEra` config + a menu toggle (default 2025), saved with the other settings
- [x] `aero.js`: ρ from altitude/temperature (add per-track altitude to the real-circuit data: Mexico City, São Paulo, Spa… where known), quadratic downforce and drag,
      ground-effect downforce rising as ride height falls, aerodynamic stall below the critical height at speed, porpoising oscillation, dirty air −15..35 % front
      downforce within 1.5 s (gap taken from the existing position data), front tyre surface heating while following
- [x] 2025 DRS (zone + < 1.0 s at the detection point, flap open) and 2026 Z/X mode on designated straights regardless of gap; zone data per track
- [x] `powerunit.js`: ICE ~400 kW + MGU-K ~350 kW (2026) vs the 2025 split; SoC in MJ; harvesting incl. lift-and-coast and super clipping; 8.5 MJ/lap cap; Overtake Mode above 290 km/h within 1.0 s
- [x] `tyres.js`: two-zone temperatures, windows Soft 90–110 / Medium 100–120 / Hard 110–135 °C, graining below the window, blistering + snap oversteer when the surface overheats,
      wear curve with a cliff below 30 % life; Inter/Wet keep their own windows
- [x] `damage.js`: front-wing endplate breakaway, floor edge (downforce loss), sidepod blockage (engine temperature), terminal suspension failure
- [x] Tests: downforce/drag scale with v² and with ρ; ride-height curve and stall threshold; porpoising only below threshold at speed; dirty-air loss within 15–35 % and zero beyond 1.5 s;
      SoC conservation (never below 0 or above the cap, harvest ≤ 8.5 MJ/lap); tyre grip curve with the cliff; damage effects; determinism (same inputs, same outputs at 60 and 120 Hz)
- [x] Integration: `stepCar` / `tyreGrip` / the computer driver use the multipliers when a car has `c.f1` (set only in the F1 Weekend mode); the other cars and the 51 existing tests are unchanged. `f1/sim.js` joins the modules per car. (Wiring the sim into the race loop: with the F1 Weekend mode, below.)

### Phase 2: race control state machine
- [ ] Extract `racecontrol.js`: states `GREEN, YELLOW_SINGLE, YELLOW_DOUBLE` (per mini-sector), `VSC, SAFETY_CAR, RED_FLAG, CHEQUERED`, plus driver flags `BLUE, BLACK_AND_ORANGE, BLACK_AND_WHITE, BLACK`
- [ ] Move the existing `setFlag/incident/flagForCrash` behaviour behind it first (green tests before adding anything)
- [ ] VSC positive sector delta with breach penalty; SC with bunching, lapped cars may unlap, no overtaking before Safety Car Line 1
- [ ] Red flag: freeze classification from the last timing loop all cars crossed, cars to the pit lane fast lane in race order, tyre changes (counts toward the compound rule), front-wing swap,
      formation lap behind the SC, standing start (dry) or rolling start (wet)
- [ ] Blue flag: within 1.2 s of a backmarker, must yield within 3 marshal posts or +5 s; meatball on critical damage forces a pit; B&W on strike 3 / unsportsmanlike; black on DSQ or ignored Stop-Go
- [ ] Tests: legal/illegal transitions, escalation order, classification freeze, restart ordering, blue-flag timer, no overtaking in flagged sectors

### Phase 3: weekend loop, pit stops, penalties
- [ ] `weekend.js`: standard (`FP1 FP2 FP3 Q1[18] Q2[15] Q3[12] GP`) and sprint (`FP1 SQ1 SQ2 SQ3 Sprint GPQ GP`) flows reusing the existing knockout functions; 107 % rule in Q1
- [ ] Parc Fermé after the first exit in Q1/SQ1 (allowed: front wing angle, brake bias, diff, tyre pressure; breaking it = pit-lane start)
- [ ] Tyre allocation 13 dry sets (2 H, 3 M, 8 S, 1 S reserved for Q3) + Inter/Wet; two-distinct-compound rule (waived if Inter/Wet used); post-race DSQ if broken
- [ ] `penalties.js`: pit limiter 80 km/h (60 on tight street tracks), track limits per the spec (strike 1–2 lap deleted/warning, 3 B&W, 4 +5 s, 5 +10 s then reset: the existing counter differs and will be corrected),
      5/10 s served stationary before mechanics touch the car or added post-race, Drive-Through and 10 s Stop-Go within 3 laps, unsafe release
- [ ] Tests: knockout sizes and ordering, 107 %, parc fermé violations, allocation counts, compound rule, every penalty path and timer

### Phase 4: AI strategy, track evolution, telemetry
- [ ] `evolution.js`: +3–5 % grip on the racing line as rubber is laid, rain washes it (dry-line vs wet-line, slick kerbs)
- [ ] Season component pool (4 ICE/TC/MGU-K, 2 ES/CE, 8 exhausts) with 10-place then 5-place grid penalties, kept in local storage
- [ ] `strategy.js`: AI undercut/overcut windows and tyre choice by wear/weather; race engineer prompts (fuel delta, ERS, tyre windows, weather, undercut) on top of the existing radio and TTS
- [ ] `mfd.js` + HUD: multi-function display (brake bias, diff, ERS mode, wing angle, pit strategy) and live sector deltas, carcass/surface temps, flag indicators
- [ ] Tests: evolution curve and rain reset, component penalty arithmetic, strategy decisions on fixed scenarios, MFD limits
- [ ] A full-race integration test and a headless-browser run per phase

R&D tree, cost cap and wind-tunnel limits (career/My Team) are in the second spec you pasted but not in the module list: **I propose leaving them out of these four phases** and adding a Phase 5 only if wanted. Fuel load is also missing and is needed for the engineer's fuel delta: I'd add a simple fuel mass to Phase 1.

## 4. How I will verify each phase
`node --test NotchWindows/tests/*.test.mjs` (51 existing + new), a headless Chromium run of a race with the F1 car, `scripts/gate-site.sh`'s link/secret checks, and a diff review.
Not verifiable here: the Mac build, `cargo test`, and real multiplayer. I will say so in each PR.

## 5. Decisions I need from you before Phase 1
1. **Scope and size.** This is months of simulation work in a game that runs inside a notch panel. Are four releases (one per phase) right, or do you want a smaller first slice (for example Phase 1's aero + tyres + ERS only)?
2. **Opt-in or replace.** I plan to keep the six non-F1 cars and the current F1 car behaviour as they are, and switch the new model on for the F1 car / an "F1 Weekend" mode, with the Era toggle in that mode. OK, or should every car use the new tyre/aero model?
3. **Numbers.** Real values (CL·A, CD·A, ride-height curve, per-circuit altitude) are my estimates tuned for feel, not data from any team. OK to proceed on that basis?
4. **Tyre windows.** The spec's windows (Soft 90–110, Medium 100–120, Hard 110–135 °C) replace today's single 80–110 °C window for the F1 car. Confirmed?
5. **Existing track-limit rule.** The shipped counter gives a 5 s penalty on every strike from the 4th; the spec gives +5 s on 4, +10 s on 5, then reset. I will follow the spec in Phase 3 for all modes. OK?
6. **Releases.** After each merged phase I can run the Mac release by hand through the workflow (as before) but tag pushes are blocked in this session; the Windows tag still needs you.
