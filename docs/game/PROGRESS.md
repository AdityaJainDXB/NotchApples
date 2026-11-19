# Desert Heat: progress

The build prompt is `docs/game/DESERT_HEAT_PROMPT.md`. Each stage ends with a review by the owner.

## Stage 0 and 1: the game window and Dubai's roads (19 November 2026, waiting for the owner's comments)

**Built**
- Opens from the Games tab on both apps: a "Desert Heat" card with **Play full screen**. Mac: its own full-screen window (`DesertHeatView.swift`, `GameWindow`). Windows: its own window (Rust `desertheat_open`, capability `desertheat.json`).
- The real map from OpenStreetMap, Deira to Dubai Marina (about 22 × 24 km, real scale): 9,720 roads with lanes, one-way rules, speed limits, road numbers, English and Arabic names and exit destinations; 111,129 buildings (real heights where the map has them); the coast, the Creek, the Canal and the sea. Converted offline by `tools/desertheat/osm-to-world.js` into `games/desertheat/data/` (15 MB).
- Roads: lane markings (yellow inside edge on divided roads, dashed lane lines), kerbs (black/yellow and black/white), pavements, planted central reservations with palms, concrete barriers on motorways, bridges and flyovers that ramp up from the ground with parapets and pillars, street lamps every 40 m with pools of light on the road at night, exit signs in English and Arabic (blue on motorways, green elsewhere).
- Buildings stream in around the car; towers of 45 m and more are always loaded so the skyline is seen from far away. Each building has its own window layout, shop fronts on the ground floor, glass towers reflect the sky, windows light up at night.
- The sky and sun follow Dubai's real sun path for the date; the light, haze and colours change from dawn to night; time passes (48 minutes a day) or is set with T.
- One car (a four-door saloon) with the full driving model in `logic.js`: engine and automatic gearbox, weight transfer, tyre grip and slip, hand-brake slides, reverse, collisions with buildings, parapets and other cars. Engine, tyre and wind sounds.
- Traffic (110 cars) that follows the lanes and road connections and keeps its distance.
- HUD: speed, gear, rev bar, rotating mini-map, the road's name in English and Arabic with its number and limit, the clock, a full map (M; click to move there in this test build), frame counter (F).
- 10 unit tests (`NotchWindows/tests/desertheat-logic.test.mjs`).

**Measured**: 60 fps in Chrome on this Mac at 1600 × 900 (150-430 draw calls, 0.12-0.37 M triangles).

**Not done yet / known problems**
- Traffic lights: the map has no signal positions in this extract, so traffic does not stop at junctions yet (section 3).
- The car and the traffic share one simple saloon model; proper car models come later.
- Tunnels and underpasses are drawn at ground level.
- The Metro viaduct is not built (the map server was busy when its data was fetched).
- No interiors, people, police or missions yet (later sections).
- The camera can end up inside a lamp post.
- Not yet run inside the Mac or Windows app (checked in Chrome only); the Windows Rust command is not compiled yet.

## Section 2: Fareej, Fatimah and "Night Fare" (19 Nov 2026)

Built:
- `story.js` (rules, no drawing): both characters with separate money and state, the switch rules (not while wanted, not
  mid-mission unless the step allows, Fatimah locked until the first mission), "what the other one is doing" by hour, the
  chaser's 10-second escape timer, the mission runner (steps, checkpoints, failure, retry) and "Night Fare" with its dialogue.
  7 tests in `NotchWindows/tests/desertheat-story.test.mjs`.
- `people.js`: jointed figures for Fareej (beard, jacket) and Fatimah (abaya and shayla) with a walk, run and crouch cycle
  matched to speed, idle breathing and a sitting pose; the car-park guard carries a torch.
- On foot: WASD relative to the camera, Shift sprint with stamina (drains faster outdoors at midday), Ctrl crouch, Space jump,
  F to get in and out of your own car, mouse drag turns the camera.
- Switching: TAB opens the wheel, 1/2 or a click picks; the camera lifts into the sky, flies across Dubai and drops onto the
  other character. Each has their own car (Fareej grey, Fatimah white).
- Homes: walk to Fareej's flat in Deira or Fatimah's Marina tower, E goes in (saves the game), E at the door leaves.
- "Night Fare" in full: intro cut-scene (Fatimah leaving the Business Bay tower, Fareej taking the fare), pick-up, the drive,
  the black SUV that rams you (chase AI on the same car model), "lose him" with an out-of-sight counter, Road Sense on Q
  (slow time), the Marina car park (fade in, Fatimah gets out, forced switch), the guard with a torch cone (cover behind cars
  and pillars, crouch, E to knock him out from behind, seen = fail and retry from the checkpoint), her apartment with the
  laptop, the end scene, the result card (fare, 1-star rating) and the unknown-number text. N replays the mission.

Screens: docs/game/screens/s2-*.png.

Not done yet / honest gaps:
- Figures are built from simple shapes and animated by code, not motion capture; they read as mannequins up close.
- No melee animation (the knock-out is instant) and no fire extinguisher prop.
- The chase SUV can cut corners through small gaps; the out-of-sight test samples building walls, so it is approximate.
- Parked cars in the car park have no wheels; the garage is a closed box reached by a fade, not a real ramp.
- Not played inside the Mac or Windows app yet, only in Chrome.
