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
