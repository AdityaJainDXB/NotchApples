# F1 game HUD redesign: what the reference video shows, and the plan (18 November 2026)

Layout and behaviour only, in our own style. No logos, team marks, fonts, artwork or screenshots from the video are in the
repo, and nothing is named after the game it came from. Reference: a 3 min 16 s console capture of a 5-lap Monaco race from
the halo camera (640x358, so small text was read from enlarged crops and a few details are marked "unsure").

## 1. What the video shows

The video is one race from the start of lap 4 to the podium. It has **no** pit stop, qualifying, results table, start
lights or formation lap. Those screens are not redesigned from this video (see "Not in the video").

| # | Element | Where | What it does |
|---|---|---|---|
| 1 | Position tower | top left | Dark navy, translucent panel. Header (series mark + "RACE"), a "LAP 4 / 5" line, then five rows: position, team chip, surname, tyre compound icon, gap to the leader (+3.270, growing down the list). The leader's row shows dashes. |
| 2 | Tower flag block | top left, replaces the header | Yellow "CAUTION" with "SECTOR 2" under it while a sector is yellow; green "RESUME RACING" when it ends. The "LAP n / 5" line stays. |
| 3 | Fastest-lap row | tower | Whoever holds the fastest lap gets a full-width purple row with a stopwatch marker sticking out past the right edge. |
| 4 | Lap panel | top right | Navy panel: three tiny sector markers, "1 / 20" (position / field) on the left, the live lap time on the right, a teal rule, then "BEST 1:32.650" inside the same panel. |
| 5 | Dash | bottom centre | Left ring: battery percent (lime arc, full ring at 100%). Centre: big gear number. Right ring: speed with RPM under it. A few shift-light dots over the gear. A thin lime bar under the gear (unsure what it measures; revs or throttle). |
| 6 | Top banners | top centre, one at a time | Dark pill with an icon square: purple stopwatch "FASTEST LAP: name, 1:32.020"; green "CLEAN LAPS x4"; "FIA WARNING - CORNER CUTTING"; chequered-flag icon "CHEQUERED FLAG". Fade in, hold a few seconds, fade out. |
| 7 | Radio subtitles | bottom centre (bottom left after the finish) | The engineer's words ("Final lap. Final lap. Push push.") on a dark translucent band. |
| 8 | Mini track map | beside the left wing mirror | A small outline of the circuit with a dot for you; the line is coloured per sector (purple best, green personal best, yellow slower); a chequered flag at the line on the last lap; coloured dots for rivals near the end. |
| 9 | Tyre / wear panel | bottom right | A top-down car with four wear rings (FL, FR, RL, RR with a percent each). Two small round buttons above it (radio, and a dot). |
| 10 | Power-unit wear page | same place | The same car icon, tinted green, with a list: MGU-H, ES, CE, ICE, MGU-K, TC, GEARBOX, each with a percent. |
| 11 | Multi-function display (MFD) | bottom right, above the car icon | Panel with a title and a status line (pit window "N/A", "Pit now: rejoin P20", "n changes to apply"), then rows with left/right chevrons (Downforce 48, Next tyres, Front brake bias 58%, Differential 25%). The selected row is a solid white bar; the others are dim. |
| 12 | Radio menu | same place | Mode label ("STANDARD RACE", a tyre icon, a number: unsure), then call options ("Box This Lap" selected, "Full Race Update"). |
| 13 | Finish card | bottom left, after the flag | Small event caption, then a big "2ND", then the driver name, on a navy block. The camera pulls back to a halo view. |
| 14 | Driver card | centre, last seconds | A tall portrait card with a title and the name (needs artwork: not built). |
| 15 | Rival callout | over a car | A gap number plus a status word on a red tag (unsure what it meant: "1.98 Auto-Recovery"). Not built. |

### Not in the video (so no new layout is invented)

Pit stop screen, qualifying screens, results table, start lights, formation lap, weekend hub. They only get the new colours
and type sizes so they sit with the rest.

## 2. What our game already has

The structure is already close: `drawTower`, `drawLapPanel`, `drawDash` (battery ring, gear, speed and revs, 15 rev lights),
`drawCondition` (four tyre rings with temperatures, damage car), the minimap in `drawHud`, `drawF1Hud` (ERS, fuel, tyres,
damage, MFD as text boxes), `drawF1Rc` (race control lines), `setFlag` and `toast` (big centred text), `say` (voice only,
no text), and the DOM results table. So this is mostly restyle plus five additions.

## 3. Plan (small steps, racing HUD first)

| Step | What | Kind |
|---|---|---|
| 1 | `f1/hud.js` (pure, tested in `tests/f1-hud.test.mjs`): tower rows and gap text, fastest-lap holder, tower flag block (state to label and colour), the banner queue (priority, duration, one at a time), subtitle line timing, sector colours, finish-card text. Loaded in `RacingGame.html` and the Windows loader. | add |
| 2 | Racing HUD: tower (own header mark instead of the italic F1 glyph, LAP row, flag block, purple fastest-lap row, tyre icon), lap panel (BEST inside, teal rule, "1 / 20"), dash (tab behind the gear, thin bar under it). | restyle |
| 3 | Top-centre banner queue, used for fastest lap, track-limit and penalty warnings, green flag / resume, Safety Car, chequered flag. Replaces the big text toast for those events. Radio subtitle band for engineer and commentary lines (also useful with sound off). | add |
| 4 | Bottom panels: tyre panel in the new style; a power-unit wear page for the F1 car (parts from the existing damage and power-unit modules); MFD as a solid-bar selector with chevrons and a status line. The tyre panel stays bottom left (the battery-overlap fix from 15 Nov depends on it). | restyle, add |
| 5 | Minimap: line coloured per sector from the existing sector times, chequered flag on the last lap. | restyle |
| 6 | Finish card (position, name, event) and chequered-flag banner; results table kept. | add |
| 7 | Same colours and type on the qualifying HUD, pit-lane panel, results and weekend DOM styles. | restyle |
| 8 | Check at 4:3 and 16:9, no console errors, `node --test` for racing and f1 tests, notes, version 2.2.80. | |

Every step is verified in the browser with `NotchRaceGame.current._state()` before the next one starts.

## 4. What was built (18 November 2026, in 2.2.80)

Checked in headless Chromium at 1024x768 (4:3) and 1280x720 (16:9): a race from the start lights, the Safety Car, yellow and
green flags, qualifying, a road car, the top-down view, the F1 Weekend panels, with no console errors. Not played on a real Mac
or Windows PC.

- `f1/hud.js` (pure, 14 tests in `tests/f1-hud.test.mjs`): tower rows and gaps, fastest-lap holder, tower flag block, banner
  queue, subtitles, clean-lap streak, sector line colours, finish card. Loaded by `RacingGame.html` (Mac) and `F1_MODULES`
  in `modules/games.js` (Windows). The drawing is in `racing.js` (`drawTower`, `drawLapPanel`, `drawBanner`, `drawSubtitle`,
  `drawFinishCard`, the minimap block in `drawHud`).
- Rows 1 to 4, 6, 7, 8, 11 and 13 of the table above are built for every circuit and every car (the F1 car and the road cars
  share the HUD). Qualifying has the same mark, panel and colours. `NotchRaceGame.current._state().hud` exposes the banner
  queue and the flag tracker for tests.
- **Left out on purpose:** the thin bar under the gear (row 5: nobody could tell what it measures); the power-unit wear page
  (row 10: the simulation has season unit counts but no per-part wear in a race, so a percentage list would be invented); the
  radio menu (row 12); the driver portrait card (row 14: needs artwork); the rival callout (row 15: unclear). The tyre panel
  stays bottom left.
- Default tower mode is unchanged (L cycles hidden, gap to you, gap to the leader); the video shows the gap to the leader.
- Not in the video, restyled only: pit stop, qualifying, results table, start lights, weekend hub.
- Known, not new: with the Safety Car out and a pit-lane message up, the long pit-lane line can still run under the tower at 4:3.
