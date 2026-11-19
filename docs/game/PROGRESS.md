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

## Section 3: the living city (19 Nov 2026)

Built (`city.js`, 10 tests in `NotchWindows/tests/desertheat-city.test.mjs`, drawing in game.js):
- Shops on real building footprints: 16 real districts decide the mix (gold in Deira, banks and cafés in Business Bay,
  cafeterias in Al Quoz), 10 shop types, all made-up names. The test counts every shop over the whole map: 15%+ enterable
  overall and 10%+ in every district (about 1,400 shops around Deira alone). Shop windows show a painted inside that lights up
  at night; enterable doors are lit.
- Interiors from a kit per type (shelves, fridges, tables, rails, gold counters, barber chairs, gym, bank counter) with a
  person behind the counter. Walk to the counter, E, buy with number keys: food and drink (health, stamina), first aid, clothes
  (changes the character's shirt), gold by the gram at a daily price, gym, paying fines at a bank.
- Traffic signals at 1,120 real junctions (where three or more ordinary roads meet), two phases, green/amber/red; traffic
  stops at the stop line on red. Running a red light: AED 1,000 fine.
- Speed cameras every ~1.8 km on main roads, UAE fine bands (20 km/h buffer), with a flash.
- Salik gates at Al Garhoud, Al Maktoum, Al Safa, Al Barsha and Business Bay Crossing with 2025 variable pricing (6/4/free).
- Fuel: tank, consumption with throttle, gauge, empty means no throttle; 20 petrol stations (made-up brands) with canopy,
  pumps and shop; stop and press E to fill up.
- Traffic density by hour (rush hours, empty at 4 am); people on pavements by hour and district (empty in the midday heat,
  busy evenings), dressed for the area (hi-vis in Al Quoz, kandura and abaya); they jump out of the way of a car, and fall if hit.
- Parked cars along ordinary streets (you bump into them). Money shows only when it changes.

Not done / gaps: OpenStreetMap shop and signal data could not be downloaded (Overpass refused), so shops and signals are
placed by rules on the real buildings and junctions, not their true positions; people are simple instanced figures; no
lane changes or indicators for traffic; no random events yet; fines are kept per character and paid at a bank.

## Section 4: weapons and the police (19 Nov 2026)

Built (`combat.js`, 9 tests in `NotchWindows/tests/desertheat-combat.test.mjs`, drawing in game.js):
- Weapons with made-up names: fists, bat, Kestrel P9 pistol, Mako .45, Vanta 9 SMG, Harrow 12 shotgun, Sable AR rifle,
  Longreach sniper (scope), frag grenades. Magazines, reserve ammo, reloads (R), rate of fire, spread that grows when moving,
  recoil, Fatimah's Focus (Q) steadies her aim. Each character keeps their own weapons; they are saved.
- Aiming: hold the right mouse button (or K to toggle on a trackpad) for an over-the-shoulder camera and crosshair; left click
  (or L) fires. Mouse wheel or [ ] changes weapon, G throws a grenade. Pistols and the SMG can be fired from a car.
- Hits: people fall, traffic stops, police cars take damage and blow up, officers can be hit. Tracers, muzzle flash, sparks,
  explosions, synthesised gunshots.
- Gun shops in Al Quoz (enterable, wall racks): buy weapons, ammo for the weapon in hand, body armour.
- Health and armour (thin bars over the mini-map); armour takes two thirds; crouching is cover (70% less damage); health comes
  back to half on its own.
- Wanted level 1-5: shots fired near witnesses = 2 stars, hitting a person 3, hitting a police officer 4; patrol cars (white
  with a green band and a flashing light bar, a siren) that chase and ram; officers get out and run to you, shoot from 2 stars
  (or 1 star if you have a gun out), arrest you at 1 star if you stand still; roadblocks from 3 stars; a helicopter with a
  searchlight from 4; fast police supercars at 5. Escape by leaving the search circle and staying out of sight (hiding inside
  the circle works, slowly). 1 star in a car: stop next to the patrol car for 3 seconds and pay the fines. Over AED 5,000 of
  unpaid fines and a patrol may stop you.
- Arrested: wake outside the Bur Dubai police station, lose 10% of cash (at most 5,000) and the weapons. Hospitalised: the
  bill (500 plus 5%, at most 3,000).

Not done / gaps: no take-cover key with blind fire (crouch is the cover), no shooting-range mini-game, no weapon wheel (the
mouse wheel cycles), police do not use the road graph for shortcuts, no spike strips or snipers at 5 stars, no safe zones
(mosques, schools, hospitals) because the map data for them could not be downloaded.

## Section 5: the phone, money, cars and the garage (19 Nov 2026)

Built (`economy.js` and `nav.js`, 8 tests in `NotchWindows/tests/desertheat-economy.test.mjs`; `multiplayer.js`, 4 tests):
- The phone (P): Messages (story texts, fines, rides, managers), Maps (places, waypoints), Bank (both balances, send money
  between Fareej and Fatimah, pay fines, gold, business takings), Sayara Ride (Fareej's side job: go online, pick up, drive,
  fare plus tip by how smooth the ride was, passengers talk), My Cars (deliver any car you own for AED 250), Internet (Autos
  Dubai with 7 made-up cars from a AED 48,000 compact to a AED 1.45 million supercar, homes, businesses, a news page that
  reacts to what you did), Camera (photo mode hides the HUD, SPACE saves a photo to the gallery), Settings (day length
  24/48/96 min, camera shake, big subtitles, the OpenStreetMap credit).
- GPS: A* routes over the real road network (one-way streets respected), drawn on the mini-map for waypoints, missions and
  rides. The full map (M) now sets a waypoint on click (shift-click still jumps there in this test build).
- Kiran's Garage in Al Quoz: drive in and stop; repair damage, repaint (a repaint loses the police), engine, brakes, tyres and
  armour plating, 3 levels each, priced by the car's value. Damaged cars smoke.
- Property and businesses: buy apartments and a villa; buy a karak chain, car rental, desert safari, garage or nightclub that
  pay every game day (a week at most piles up). The economy test checks a full playthrough affords one of everything, not all.
- Online multiplayer (up to 8 players, room codes, smooth remote players, quick chat) is in the code but SWITCHED OFF: the
  phone's Online app says "Coming soon" and its buttons are disabled; a test fails if it is ever enabled without a change to
  the code. It needs a relay server before it can be switched on.

Not done / gaps: no contacts and phone calls yet, no tow truck, no wardrobe at home (clothes change in shops), no 10 save
slots (one save), the phone is mouse-only (no controller).

## Section 6: Act 1 (19 Nov 2026)

Built (`missions.js`, 5 tests in `NotchWindows/tests/desertheat-missions.test.mjs`; a generic mission layer in game.js):
- Missions 2-6 after "Night Fare", unlocked one at a time; the next one's start is a column of light on the map and the GPS
  leads there; press E with the right character to start. Each has dialogue, checkpoints, failure and retry.
  - **The Files** (Fatimah): hide the files in her apartment; her name is on forty million in transfers.
  - **Debts** (Fareej): Uncle Rashid in the gold souk, the debt of 400,000, the first gun (Kestrel P9), deliver a pickup to
    Kiran in Al Quoz without damaging it; a police checkpoint halfway gives a star you must lose first. AED 5,000.
  - **Clean Hands** (Fatimah): back at the Business Bay office; sneak through the basement past security to Victor's lift;
    his office, the contracts, and a lead to Desai Motors.
  - **Chop Shop** (Fareej): steal a red Corsa Velo from a Jumeirah villa; the alarm brings 2 stars; lose them and deliver it
    to Kiran. AED 25,000.
  - **The Same Name** (both): Fareej drives to Karama, the game switches to Fatimah, they meet at Al Fanar Shawarma.
- The supporting cast appears in scenes: Uncle Rashid (white kandura), Kiran Desai (overalls); Jomon, Victor and Officer
  Mariam are defined for later acts.
- The whole of Act 1 was played start to end by the review script (no errors).

Not done / gaps: scenes are short in-engine shots with subtitles, no animation of talking; the basement has one guard
(the brief says two); no voice acting.

## Section 7: the rest of Dubai (19 Nov 2026)

Built (`landmarks.js`, 3 tests in `NotchWindows/tests/desertheat-landmarks.test.mjs`):
- Landmark models at their real places (the plain map footprint there is removed): Burj Khalifa (setback tiers, spire and a
  blinking red light), Burj Al Arab (the sail, mast and helipad), Dubai Frame (gold, lit at night), Museum of the Future,
  Atlantis on the Palm, the Jumeirah Beach Hotel wave, Emirates Towers, the Deira clock tower. You cannot drive through them.
- The Metro Red Line: a 25.8 km viaduct down the middle of Sheikh Zayed Road on pillars, built from the road data, with 12
  stations at their real places (gold curved shells) and two red-and-white trains that stop at each station; windows light up
  at night.
- Dubai International: the runway, a long glass terminal with parked aircraft, and a plane landing about every 2.5 minutes.
- Ras Al Khor flamingos; four abras crossing the Creek between Bur Dubai and Deira.
- Two malls with made-up names: Mall of the Dunes (Al Barsha, with the snow slope behind glass) and Crescent Mall
  (Downtown). Inside: a long hall with shoppers, a food court, and six shop fronts that each open into their own interior.
- The Palm, the airport roads, Al Quoz and Ras Al Khor were already in the road data.

Not done / gaps: the map's west edge cuts the outer crescent of the Palm, and the airport's east side; downloading more map
data was blocked in this session, so those need the owner's go-ahead to fetch. The airport terminal is not enterable.
No Metro rides yet (trains run, you cannot board).

## Section 8: Act 2 and the first heist (19 Nov 2026)

Built (missions 7-12 in `missions.js`, heist rules with a test; game support for gangs, choices and the plan board):
- **The Gold Run** (Fareej): collect Rashid's bag in the souk, 2 stars, run to the abra station, cross the Creek for one
  dirham, walk away on the Bur Dubai side.
- **Paper Towers** (Fatimah): the Palm sales office; sneak to the records room, photograph six sales of one villa in a week,
  the alarm, lose 2 stars.
- **Desert Delivery** (Fareej): drive Kiran's pickup to a camp past Ras Al Khor; the deal goes wrong; the first big gunfight
  against six armed men (an SMG from Kiran); back to Kiran. AED 60,000.
- **Detective** (Fatimah): Officer Mariam at the Bur Dubai police station; a choice (tell her about Victor, or say nothing)
  that is remembered.
- **The Heist Plan** (both): a planning board: quiet or loud, the crew (Jomon 6%, Kiran 12% with a faster car, a hired
  gunman 15% with fewer guards when loud), the getaway car; then a prep job: steal a security van and bring it in clean.
- **Business Bay Job** (both): quiet (sneak to the vault lift; being seen costs 30% of the take) or loud (fight armed
  security with a rifle); switch to Fareej in the getaway car, 3 or 4 stars; take the money to the garage; the split
  (1.2 or 1.8 million, minus the crew's cut, halved).
- Gang members are a new kind of enemy: armed, they hold position and shoot; they do not count as police.
- Businesses from section 5 are the "businesses" part of this section.
- The review script played all of Act 2 from start to end with the loud plan (no errors).

Not done / gaps: the desert camp is at the city's edge until section 9 adds the desert; no jet ski (Paper Towers escapes on
foot); the choice changes later dialogue only once Act 4 is written.

## Section 9: the E11, the desert, Abu Dhabi, Yas and the sea (19 Nov 2026)

Built (`region.js`, 6 tests in `NotchWindows/tests/desertheat-region.test.mjs`):
- The map data stops at Jebel Ali and downloading more was blocked in this session, so this region is generated by rules
  and joined exactly to the real Sheikh Zayed Road where the data ends. The drive is shortened (about 19 km of motorway
  instead of 120). GPS routes from the Marina to Abu Dhabi over the joined network (tested).
- The E11: two 4-lane carriageways at 140 km/h with traffic, lamps and barriers like the rest of the motorway network.
- The desert inland of the E11: dunes up to about 20 m (crescent dunes with ripples), flat on the road and at the camp;
  off-road the car slides, slows and is pushed by slopes, with sand kicked up. A sand track leads to a Bedouin-style camp
  (tents, majlis, a fire that lights the night, resting camels). Act 2's "Desert Delivery" now goes there.
- Abu Dhabi island: the Corniche and five avenues, eight cross streets with real street names, the bridge, towers along the
  Corniche and mid-rise blocks; Sheikh Zayed Grand Mosque (weapons cannot be used there), Etihad Towers, Emirates Palace.
- Yas Island and its circuit: grandstand, start lights; stop on the grid and press E to race five rivals over 3 laps with lap
  times and positions, prize money for the top three.
- Jet skis at the Marina and on the Corniche: ride them on the water (they stop at the shore), get off at a beach.

Not done / gaps: the region is generated, not real map data; no boats bigger than jet skis; the Metro no longer runs into
the generated motorway (fixed); Abu Dhabi has no interiors or shops yet; no Hatta mountains (Act 4 needs them).
