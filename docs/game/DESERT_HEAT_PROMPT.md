# Desert Heat: the build prompt

*Working title. An open-world crime game set in Dubai and Abu Dhabi, played inside Notch Apple on Mac and Windows.*

This document is the full brief for whoever builds the game: a developer or an AI coding agent. Read all of it before writing any code. Then build **one section at a time** (Part 23), stop at the end of each section, and show the owner what was built: screenshots, a short video, and the list of what works and what doesn't. Do not start the next section until the owner has commented.

---

## Contents

1. What we are building
2. Rules that cannot be broken
3. "It must not look AI-made": the art direction
4. Technology and where the code lives
5. The world: Dubai (section 1 is the roads)
6. The world: Abu Dhabi, the E11 and the desert (later sections)
7. The two main characters: Fareej and Fatimah
8. Switching between characters
9. The storyline
10. The first mission, in full detail
11. On foot
12. Driving
13. Weapons and combat
14. Police and the wanted level
15. A living city: traffic, people, events
16. Enterable buildings (at least 15% of shops)
17. The phone
18. Money, property and businesses
19. Time, weather and light
20. Sound, radio and music
21. The HUD and menus
22. Saving, performance and settings
23. The build plan, section by section, with review gates
24. Testing
25. Content, legal and naming rules
26. The checklist for "done"

---

## 1. What we are building

A third-person open-world game in the spirit of the big modern crime sandboxes: a believable city, two playable leads whose stories cross, cars that feel heavy and real, guns, police that escalate, shops you can walk into, and a story told through missions, phone calls and the radio.

- **Setting:** present-day Dubai first, then Abu Dhabi, joined by the E11 motorway and the desert. Real geography and real landmarks; made-up companies, brands and people.
- **Playable characters:** **Fareej** and **Fatimah**. The player can switch between them at any time outside missions, and inside some missions.
- **Camera:** a real third-person 3D camera behind the character or car, with a free-look orbit. Not top-down. A top-down or isometric look is what makes small browser games look cheap; we are not doing that.
- **Price:** the whole game, guns included, is **free** for everyone. If the owner later puts extras behind Pro or Ultimate, an admin key must unlock everything (CLAUDE.md rule).
- **Where it runs:** in Notch Apple's Games tab, which opens the game in its own large window (or full screen). The closed notch only shows small updates (mission ready, wanted level, rent paid).

### What "finished" feels like

The player starts the game at night on the Al Maktoum Bridge over the Creek in an old Nissan-shaped saloon (made-up brand), traffic rolling past, the Deira towers lit up, the radio playing a made-up Arabic pop station. They can drive anywhere in Dubai on the real road layout, stop at a petrol station, walk into the shop, buy water, walk out, and get chased by the police for running a red light on the way home. That moment, working well, is the bar for every section.

---

## 2. Rules that cannot be broken

1. **Build in sections and stop for review.** Each section in Part 23 ends with a demo for the owner. No section is merged into `main` without the owner's yes.
2. **No real brands.** No real company names, logos, car makes, airlines, banks, malls, phone networks, songs or people. Landmarks (Burj Khalifa, Burj Al Arab, the Museum of the Future, Sheikh Zayed Road, the Creek, the Palm) are fine as places. Their *operators* get made-up names.
3. **Respect.** Mosques appear in the world but no mission, fight or chase happens inside or on the grounds of one. No mocking of religion, nationality or the UAE's leaders. Characters can be criminals; the country is not portrayed as one.
4. **Nothing in the game may be called GTA**, use Rockstar's fonts, logos, loading-screen style or character names.
5. **Shared code for Mac and Windows.** One web game, opened by both apps, the way the Racing game is.
6. **It must run at 60 fps on a 2020 MacBook Air and a mid-range Windows laptop** at the default setting. If it doesn't, the section isn't done.
7. **No placeholder look in a review.** Grey boxes are allowed while building, but every review screenshot must look like the finished art direction for the parts it shows (Part 3).
8. **Licensing, Do It, Convert, Smart Home, Claude Usage and Purge are not touched.** No helper app, no localhost server.

---

## 3. "It must not look AI-made": the art direction

The owner's biggest worry is that the game looks like something an AI threw together. These are the tell-tale signs of that, and what to do instead. Every review is checked against this list.

### 3.1 The signs of an AI-made game, and the fix

| AI-made look | Do this instead |
|---|---|
| Flat solid colours, no texture | Every surface has a material: asphalt with patches and tyre marks, concrete with stains, glass that reflects the sky, sand with ripples |
| Purple/blue neon gradients everywhere | A real Dubai palette: sand beige, sun-bleached white, dusty green palms, steel-blue glass, warm sodium-orange street light at night |
| Rounded "app" buttons and system fonts in the HUD | A designed HUD with one licensed open font (for example Inter or Barlow Condensed for numbers, and a matching Arabic font such as Noto Kufi Arabic), thin lines, no emoji |
| Emoji as icons | Drawn icons made for the game, in one consistent style |
| Everything perfectly clean and new | Wear: dust on cars, faded road paint, rust on old pickups, litter near the bins, worn kerbs |
| Empty streets | Traffic, parked cars, people, birds, construction cranes, workers on scaffolding, delivery bikes |
| Identical repeated buildings | A small set of building kits with variations (height, colour, balconies, signs, AC units, lit windows) mixed by rules |
| Text that says what the player should feel ("An epic chase!") | Short, natural dialogue in the characters' own voices, mixing English and Arabic words the way people in Dubai actually talk |
| Floaty, weightless cars | Real suspension, body roll, tyre squeal, weight transfer (Part 12) |
| Perfect midday light, no shadows | Real sun position for Dubai's latitude, long shadows at golden hour, haze, bloom on hot surfaces, heat shimmer on roads |

### 3.2 Visual targets

- **Lighting:** physically based materials (PBR), a sun and sky model, shadow maps for the sun, baked light for buildings, light cones from street lamps at night, car headlights that light the road.
- **Post-processing:** gentle bloom, tone mapping (ACES or AgX), a light film grain, slight lens distortion at speed, motion blur on fast cars (can be turned off), and haze that gets thicker towards the horizon.
- **Colour grading:** warm and slightly washed out by day (Dubai's dusty haze), deep blue with orange street light at night. One LUT per time of day, blended.
- **Reference photos:** before each area is built, collect 20-30 reference photos of that real place (street level, not postcards) and keep the list (links only, not the images) in `docs/game/references/`. Match road widths, kerb colours, lamp posts, signs and building heights to them.

### 3.3 The Dubai details that make it believable

- Road signs in **Arabic and English**, green for local roads and blue for motorways, the white-on-brown style for tourist places. Exit numbers on Sheikh Zayed Road.
- **Black-and-yellow kerbs** where stopping is not allowed, white-and-black elsewhere.
- **Toll gates** (made-up name, not Salik) as overhead gantries with a beep.
- Speed cameras on poles with a white box and a flash.
- **Taxis** in a cream colour with a coloured roof (made-up company).
- **Labour buses** (white with a stripe), water trucks, delivery motorbikes with boxes, white Land Cruiser-like SUVs everywhere.
- **Metro viaduct** over Sheikh Zayed Road with gold-shell-shaped stations.
- Palm trees with lights wrapped around the trunks, planted central reservations, sprinklers watering the grass at dawn.
- Construction everywhere: cranes, hoardings with made-up developers' slogans.
- Shops with signs in Arabic, English, Hindi/Urdu and Malayalam in Deira and Karama.
- **The call to prayer** heard faintly five times a day near mosques (audio only, respectfully, no gameplay around it).

### 3.4 UI style

- Look: dark translucent panels with a thin sand-gold accent line. Numbers in a condensed font. No rounded "pill" buttons, no gradients, no drop-shadow cards.
- All text in **English and Arabic** (Arabic right-to-left done properly, not mirrored letters).
- Menus open with fast, short animations (150-200 ms). No bouncy springs.

---

## 4. Technology and where the code lives

### 4.1 Engine

- **Three.js** (pinned version) with WebGL 2, falling back to lower settings on weak GPUs. If the team prefers, **Babylon.js** is acceptable; pick one and do not mix.
- **Physics:** Rapier (WebAssembly) for cars, characters and collisions.
- **World streaming:** the map is split into square tiles (for example 256 m). Only tiles near the camera are loaded; far tiles use low-detail versions (LOD). Buildings far away become simple boxes with a baked texture.
- **Assets:** glTF/GLB models, KTX2 compressed textures, Draco or Meshopt compressed meshes. Sources must be our own or under a licence that allows use in a commercial app (CC0 is safest: e.g. Poly Haven, Kenney's CC0 packs as a base, then modified so they don't look stock). Keep a `docs/game/ASSET_LICENCES.md` listing every outside asset and its licence.
- **Road network:** generated from real road data. Use **OpenStreetMap** data for Dubai (licence ODbL: we must credit "© OpenStreetMap contributors" in the credits screen). Convert it offline with a script into our own road-graph format: lanes, widths, junction types, speed limits, signals. Do not fetch map data at runtime.

### 4.2 Where things go in this repository

```
NotchWindows/src/js/games/desertheat/      the game (shared by Mac and Windows)
  main.js            start-up, the game loop
  world/             tiles, streaming, roads, buildings, interiors
  vehicles/          car physics, damage, AI drivers
  actors/            player, people, police, animation
  weapons/           guns, aiming, hits
  missions/          mission scripts and the mission runner
  story/             characters, dialogue, cut-scenes
  ui/                HUD, phone, menus, map
  audio/             sound, radio
  save/              saving and loading
  logic/             pure rules with unit tests (no three.js in here)
NotchWindows/src/game-desertheat.html      the page the window opens
NotchApple/Resources/Games/DesertHeat/      the Mac copy (copied by the build, as the Racing game is)
tools/desertheat/                           offline scripts: map conversion, texture packing
docs/game/                                  this prompt, references, asset licences, progress notes
```

Look at how `racing.js` and `f1/` are opened from both apps and follow the same pattern.

### 4.3 Pure logic is tested

Anything that is a rule (wanted level, money, mission steps, traffic signals, switching characters, damage) lives in `logic/` as plain functions with `node --test` tests in `NotchWindows/tests/`. Rendering code is checked in the browser with Playwright screenshots.

---

## 5. The world: Dubai

### 5.1 Scale

- Real scale where it matters for driving (road lengths, widths, junction spacing), compressed in empty areas. Target: about **12 km by 8 km** of drivable Dubai at first, from Deira in the north-east to Dubai Marina in the south-west, along Sheikh Zayed Road.
- Driving from Deira to the Marina at the speed limit should take about **5-6 real minutes** (the real trip takes 25). Compress empty stretches, not the city centres.

### 5.2 Districts in Dubai (in the order they are built)

1. **Sheikh Zayed Road (E11)**: the spine. Six to seven lanes each way, the Metro viaduct in the middle, towers on both sides, the big interchanges (numbered), the service roads alongside.
2. **Downtown and Business Bay**: the tallest tower (made-up name for the operator; the tower itself is recognisable), the boulevard, the fountain lake, the Canal with its bridges, Business Bay towers.
3. **Deira and the Creek**: older, denser streets, the gold and spice souks (indoor), the Creek with abras (wooden boats), Al Maktoum and Garhoud bridges, the old dhows at the wharf, small shops packed side by side. Fareej's home area.
4. **Bur Dubai, Karama and Al Fahidi**: the old wind-tower houses, the textile souk, Karama's busy shops and cheap restaurants.
5. **Jumeirah and Al Wasl**: villas, Jumeirah Beach Road, the sail-shaped hotel on its island, beaches, the Jumeirah mosque (seen, not used).
6. **Dubai Marina and JBR**: the canal of towers, the walk, the beach, yachts, the big wheel off the coast. Fatimah's home area.
7. **Palm Jumeirah**: the trunk road, the fronds with villas, the hotel at the top, the monorail.
8. **Al Quoz**: warehouses, workshops, car garages, art galleries, labour camps nearby. The chop shop lives here.
9. **The airport (DXB)**: drivable roads around it, the terminals as large set pieces, planes taking off and landing on a loop.
10. **Ras Al Khor and the wildlife sanctuary**: flamingos, the edge of the city, the road to the desert.

### 5.3 Section 1 in detail: Dubai roads

Section 1 is **only the roads and driving**, but done properly. Its parts:

**a. Road data**
- Script `tools/desertheat/osm-to-roads.js` reads a saved OSM extract of Dubai and writes `world/roads.bin` (or JSON for now): every road as a line of points with its type (motorway, primary, secondary, residential, service), lane count each way, one-way, speed limit, bridge or tunnel, and every junction with its type (signals, roundabout, slip road, flyover).
- Clean-up rules: merge tiny segments, snap junctions, smooth curves with splines, give motorways real banking and gradients.
- Speed limits: Sheikh Zayed Road 120 km/h, main city roads 60-80, residential 40, unless OSM says otherwise.

**b. Road meshes**
- Each road is built as a mesh from its lanes: lane markings (dashed white between lanes, solid yellow on the left edge of a motorway, white on the right), arrows before junctions, zebra crossings, stop lines, "SLOW" painted in Arabic and English, rumble strips at motorway exits, yellow box junctions.
- Kerbs, pavements, central reservations with palms and grass, crash barriers on motorways, concrete barriers on bridges, sound walls in places.
- Bridges and flyovers with real supports, ramps with gradients; tunnels with lights along the ceiling.
- Materials: two or three asphalt types (new black on Sheikh Zayed Road, faded grey in Deira, patched), with tyre marks near junctions and oil stains at traffic lights.

**c. Street furniture**
- Lamp posts (the motorway double-arm kind, the decorative kind in Downtown), traffic lights on gantries and poles, bus shelters (air-conditioned glass boxes), signs with real road and area names (place names are fine), overhead direction signs at every motorway exit, toll gantries, speed cameras, petrol stations (made-up brands, two or three designs).

**d. The skyline**
- For section 1, buildings along Sheikh Zayed Road and in Downtown at real heights, as good-looking shells (no interiors yet): glass towers that reflect the sky, lit windows at night in random patterns. The famous towers modelled recognisably. Everything else as varied mid-rise blocks from a kit.

**e. Driving**
- One car to start: an old four-door saloon (made-up brand "Kaizen Sentra" style name, not real). Full driving model from Part 12, at least: engine, gears, weight transfer, grip, hand brake, damage to the body that shows.
- Camera: chase camera with speed-based distance and field of view, free look with the mouse or right stick, a bonnet camera.

**f. Minimum traffic**
- Simple traffic that follows lanes and stops at red lights, so the roads don't look dead in the review. Smarter traffic comes in section 3.

**g. Day and night**
- A time-of-day slider in a debug menu so the owner can see the roads at noon, sunset and night.

**Review for section 1:** a 2-minute video driving from Deira over Al Maktoum Bridge, onto Sheikh Zayed Road, past Downtown, to the Marina, at sunset; screenshots of 10 named places next to a real photo of each; frame-rate numbers on both test machines.

### 5.4 Shops and businesses on the map

Place shops along every street that real Dubai has shops on: groceries, cafeterias, shawarma places, phone repair, laundries, barbers, pharmacies, petrol station shops, car parts, gold shops in the souk, mall entrances, gun shops (made-up; set in Al Quoz and Mussafah). Every shop has a made-up name and a sign that fits its area (cheap lightbox signs in Karama, polished brass letters in Downtown). See Part 16 for which ones open.

---

## 6. The world: Abu Dhabi, the E11 and the desert (later sections)

- **The E11 to Abu Dhabi:** about 8-10 km of compressed motorway with Jebel Ali port, the industrial areas, the desert opening up, petrol stations and a famous roadside mosque (seen only), and the toll-free stretch where people race at night.
- **Abu Dhabi:** the Corniche and its beaches, the downtown grid, Yas Island with a race circuit (made-up name; the Racing game's track tech can help), theme-park buildings (made-up names), Saadiyat's museums (made-up), Mussafah's industry, and the Grand Mosque as a landmark only.
- **The desert:** dunes you can drive on, a desert camp, camel farms, a hidden airstrip for the smuggling missions, and the mountains towards Hatta with a dam and winding roads.
- **The sea:** the Gulf with dhows, jet skis, speed boats, and islands (The World islands as an unfinished, half-built set).

---

## 7. The two main characters: Fareej and Fatimah

### 7.1 Fareej

- **Who he is:** 29, born in Dubai's Deira to a family that ran a small electronics shop in the old souk. The shop closed after a landlord dispute; his father has debts with the wrong people. Fareej drives for a ride-hailing company by night (made-up name) and fixes phones by day.
- **Personality:** quiet, careful, funny in a dry way, very loyal to family. He knows every back road in Deira and Bur Dubai. He hates showing off but is the best driver in the story.
- **Look:** medium build, short beard, usually in jeans, a plain t-shirt and an old jacket at night; a white kandura for family scenes.
- **Skills (gameplay):** better driving (more grip and control under stress), a special ability: **"Road Sense"**, a short slow-motion while driving that makes tight escapes possible.
- **Home:** a small flat above a shop in Deira (enterable, saves the game, wardrobe, his car in the street).
- **Speech:** English mixed with Arabic words ("yalla", "khalas", "wallah", "habibi" to friends), never a cartoon accent.

### 7.2 Fatimah

- **Who she is:** 27, grew up in Abu Dhabi, moved to Dubai to work in a big real-estate company in Business Bay as a junior lawyer. She finds out her company launders money through property for a criminal network, and that her boss set her up to take the blame.
- **Personality:** sharp, confident, impatient, a planner. She talks fast and reads people well. Not a fighter at the start, becomes a capable one.
- **Look:** smart office clothes with an abaya in some scenes, casual sportswear in action scenes, sunglasses. Her outfits are chosen by the player from her wardrobe.
- **Skills (gameplay):** better aim and steadier hands with guns, a special ability: **"Focus"**, a short slow-motion while aiming. She is also the one who hacks phones, cameras and gates in missions (a simple timing mini-game).
- **Home:** an apartment in a Marina tower (enterable, saves the game, wardrobe, balcony view, a parking garage below).
- **Speech:** English mostly, Arabic with her family, switches to formal Arabic when she needs to impress.

### 7.3 How they meet

Fareej is the ride-hailing driver Fatimah gets into on the night she runs from her office with stolen files. Neither knows who the other is. That ride is the first mission (Part 10).

### 7.4 Supporting cast (all made up)

- **Uncle Rashid**, Fareej's father's old friend, a fixer in the Deira gold souk. Gives early missions.
- **Mr Kiran Desai**, the owner of an Al Quoz garage and chop shop. Buys stolen cars, tunes Fareej's car.
- **Layla**, Fatimah's younger sister in Abu Dhabi, a student, gets pulled into the story in Act 3.
- **Victor Haldane**, Fatimah's boss, the polished face of the real-estate company.
- **"The Captain"** (real name revealed late), the man behind the network, who runs it from a yacht and a desert estate.
- **Officer Mariam Al Suwaidi**, an honest police detective who first chases them, later uses them.
- **Jomon**, a Keralite delivery rider and Fareej's friend, comic relief and a source of tips.

All dialogue is written, not generated in the game. Voice acting is a later decision; until then, subtitles with short text-to-speech or no voice.

---

## 8. Switching between characters

- **When:** at any time when no mission is running and the character is not wanted by the police, and at set moments inside missions that use both.
- **How:** hold a key (default **Tab** on keyboard, **D-pad down** on a controller) to open a wheel with the two faces; pick one.
- **The switch camera:** the camera pulls up into the sky above the current character, flies across the map, and drops down onto the other character. It takes 2-4 seconds; the far character's area is loaded during the flight.
- **What the other character was doing:** when you arrive, they are in the middle of something that fits the time and place: Fareej fixing a phone in his flat, driving a fare, arguing with a mechanic; Fatimah on a call on her balcony, jogging along JBR, leaving a café in Downtown. Pick from a list by time of day and location.
- **Separate state:** each has their own money, weapons, cars, clothes, health, skills and wanted level. The shared things are the story, the businesses (which can belong to one or both) and the map they've discovered.
- **In missions:** a mission can say "switch now" (for example Fatimah hacks the gate while Fareej waits in the car; switch to drive away). The switch is instant (no sky camera) in missions.

**Tests:** switching rules (allowed, not allowed while wanted, mission-forced), separate state, and that the "doing something" picker always finds an activity.

---

## 9. The storyline

Five acts, about 30 main missions. Missions are named; their content is a plan the writer can change with the owner's approval.

### Act 1: The Ride (Dubai, Deira to Downtown)

1. **Night Fare** (Fareej, then both): the first mission (Part 10).
2. **The Files** (Fatimah): hide the stolen files in her Marina apartment; she finds her own name on the transfers.
3. **Debts** (Fareej): Uncle Rashid tells Fareej his father owes 400,000 dirhams; a job to deliver a car to Al Quoz with no questions.
4. **Clean Hands** (Fatimah): go back to the office in Business Bay the next morning as if nothing happened; sneak into Victor's office (stealth, an enterable office tower).
5. **Chop Shop** (Fareej): Kiran Desai teaches stealing to order: take a specific supercar from a Jumeirah villa.
6. **The Same Name** (both): each finds the other's name in the files; they meet again on purpose at a shawarma place in Karama.

### Act 2: The Network (Dubai)

7. **The Gold Run** (Fareej): a getaway from the gold souk through Deira's narrow streets and over the Creek in an abra.
8. **Paper Towers** (Fatimah): photograph contracts in a sales office on the Palm; escape on a jet ski.
9. **Desert Delivery** (Fareej): drive a truck to a desert camp at night; a deal goes wrong; first big gunfight.
10. **Detective** (Fatimah): Officer Mariam questions her; choose what to tell her (affects later dialogue, not the ending).
11. **The Heist Plan** (both): plan a raid on the network's money: choose the approach (quiet or loud), the crew (Jomon, Kiran, a hired gunman), and the getaway cars. Several prep missions follow (steal a van, get uniforms, get a security pass).
12. **Business Bay Job** (both): the first heist; switch between them during it.

### Act 3: Abu Dhabi

13. **The E11** (Fareej): a chase down the motorway at night.
14. **Layla** (Fatimah): her sister has been noticed by the network; get her out of a party on Yas Island.
15. **Track Day** (Fareej): win a race on the Yas circuit to get close to the Captain's son.
16. **Corniche** (both): a meeting that becomes an ambush along the Corniche.
17. **Mussafah** (Fareej): a warehouse full of stolen cars and the network's guns.
18. **The Estate** (Fatimah): sneak into the Captain's desert estate during a party.

### Act 4: Burned

19. **Set Up** (both): Victor frames both for a murder; both are wanted at 4 stars as the act starts.
20. **The Mountains** (Fareej): hide out near Hatta; a chase on the mountain roads.
21. **The Yacht** (Fatimah): get onto the Captain's yacht off the Palm.
22. **Mariam's Deal** (both): Officer Mariam offers a deal: help her get the Captain and walk free.
23-26. **The Big One**: a four-part heist on the network's vault under a Downtown tower, with prep missions and a choice of approach.

### Act 5: The End of the Road

27. **Victor** (Fatimah): confront Victor in Business Bay.
28. **The Captain** (both): the final chase from Downtown down Sheikh Zayed Road to the desert, switching between a car (Fareej) and a helicopter (Fatimah).
29. **Ending**: two endings depending on one late choice (take the money and leave, or give the evidence to Mariam). Neither is "bad"; both close the story.
30. **After**: the world stays open; side content continues.

### Story rules

- Cut-scenes are short (under 90 seconds) and use the game engine, not videos.
- Every main mission has at least one checkpoint and a "retry from checkpoint" option.
- Each act unlocks more of the map, shops, cars and weapons, but the player can drive anywhere in Dubai from the start.

---

## 10. The first mission, in full detail: "Night Fare"

This mission is built in section 2 (after the roads), and it is the owner's first full test of the game's feel.

**Opening (cut-scene, about 40 seconds).** 11:40 pm. Business Bay. Fatimah hurries out of a tower's side door with a laptop bag, looking back. Her phone shows a ride-hailing app (made-up name). Across town, Fareej's phone pings in his car on Sheikh Zayed Road. He sighs, accepts the fare.

**Part 1: Pick up (Fareej, driving).**
- Objective: "Pick up your passenger in Business Bay." GPS route on the mini-map.
- The player drives about 1.5 km through real Business Bay roads. Traffic is light. Radio on.
- Teaches: accelerating, braking, steering, the mini-map route, indicators (optional), the horn.
- If the player crashes into things, the passenger rating shown on the phone drops (a light touch of humour, no failure).

**Part 2: The passenger (Fareej, driving; Fatimah in the back).**
- Fatimah gets in, says "Marina. Please, fast." Short dialogue while driving: she's distracted, on the phone, he makes a dry joke, she doesn't laugh.
- At the second junction, a black SUV (made-up brand) pulls out behind. Dialogue: Fatimah: "Is that car following us?" Fareej: "Everyone in Dubai drives like they're following someone."
- The SUV rams the car. Mission objective changes: "Lose the black SUV."

**Part 3: The chase (Fareej, driving).**
- The SUV chases through Business Bay, over the Canal bridge, onto Al Khail Road or Sheikh Zayed Road (the player chooses).
- The player can lose it by breaking line of sight for 10 seconds, using tunnels, the service roads or the underpass.
- Fareej's **Road Sense** ability is introduced here with an on-screen hint (one line, no tutorial pop-up).
- If the car is wrecked: checkpoint at the start of the chase.

**Part 4: The switch (Fatimah, on foot).**
- Once the SUV is lost, the car stops in a car park under a Marina tower. Fatimah gets out; the game switches to her (first forced switch, explains the key).
- A man from the SUV is waiting in the car park. Fatimah hides behind cars (introduces cover). She can sneak past him to the lift, or pick up a fire extinguisher and knock him out (introduces melee). A gun is not used in this mission; the first gun appears in mission 3.

**Part 5: The apartment (Fatimah, inside).**
- She reaches her apartment (first enterable home). She opens the laptop; a short scene shows her name on the transfer documents.

**Part 6: The end (Fareej).**
- Switch back to Fareej, sitting in his damaged car. He sees she left her phone charger. He keeps it. The phone shows: "Rating: 1 star. 'Drove like a maniac.'" Mission complete screen: money earned (the fare plus nothing for the damage), time, accuracy (none), a one-line summary.

**Afterwards:** the free roam opens with both characters. Fareej's car needs a repair (introduces the garage). Fatimah's phone gets a message from an unknown number: "We know you took them."

**Tests:** each part's objective changes in order; the SUV gives up after 10 seconds out of sight; failure states (car wrecked, Fatimah caught) restart at the right checkpoint; the switch happens only when the script says.

---

## 11. On foot

- **Movement:** walk, jog, sprint (stamina), crouch, jump, vault over low walls and car bonnets, climb ladders and fences, swim.
- **Animation:** motion-captured style animations (from a licensed library such as Mixamo, or CC0) blended with a state machine; feet stay on the ground on slopes (foot IK); the character leans when turning at speed. No sliding feet. This is one of the most visible "cheap game" tells.
- **Heat:** between 11 am and 4 pm in summer months, stamina drains 30% faster outside in the sun; shade and air-conditioned interiors restore it. Drinking water from a shop restores it at once.
- **Interaction:** a context prompt for doors, shops, cars, people (talk, rob, fight), items.
- **Health:** health and armour bars; health regenerates to half on its own; food and medical kits restore the rest.
- **Clothes:** each character has a wardrobe at home and can buy clothes in clothing shops; clothes are visible in cut-scenes.

---

## 12. Driving

Driving is the core of the game and gets the most care.

### 12.1 The car model

- A raycast-wheel vehicle with: engine torque curve, automatic gearbox (manual optional), differential, weight per car, centre of mass, suspension (spring, damper, travel), tyre grip with a slip curve (a simplified Pacejka model), aerodynamic drag and downforce for supercars.
- **Weight transfer:** the nose dips when braking, squats when accelerating, the body rolls in turns.
- **Hand brake** locks the rear wheels for drifts; **ABS** and **traction control** on most cars, off on old ones and some supercars.
- **Surfaces:** asphalt, concrete, painted lines (slightly slippery when wet), sand (slow, deep, needs 4x4 or momentum), gravel, grass, wet asphalt after rain.

### 12.2 Classes (about 30 cars by the end; 5 in section 2)

- **Everyday:** old saloon (Fareej's), modern saloon, hatchback, taxi.
- **SUVs and 4x4s:** the white land-cruiser type (very common), a luxury SUV, a pickup, a desert-prepared 4x4.
- **Sports and supercars:** a German-style sports saloon, an Italian-style supercar, a British-style grand tourer, a hypercar (all made-up brands and recognisable only by type).
- **Work:** delivery motorbike, labour bus, water truck, police cars (saloon, SUV, supercar), ambulance, tow truck.
- **Motorbikes:** sports bike, cruiser, quad bike for the desert.
- **Later:** boats, jet skis, a helicopter, a light plane.

### 12.3 Damage

- Visible: dents (vertex deformation), broken lights and windows, bumpers that hang and fall off, scratched paint, flat tyres.
- Mechanical: engine damage lowers power and adds smoke; a damaged wheel pulls to one side; enough damage starts a fire and the car explodes after a few seconds.
- Repair at garages (costs money) or at the character's home garage (free, takes a minute of game time).

### 12.4 Fuel

- A fuel gauge in the HUD; cars use fuel by engine load. Petrol stations (made-up brands) refill the tank (pay at the pump). Running out leaves the car coasting.
- Fuel is on by default and can be turned off in settings ("Realism: Fuel").

### 12.5 Driving extras

- Indicators, hazard lights, the horn, headlights (auto at night), the radio.
- **Cruise control** on motorways.
- **Speed cameras:** a flash and a fine sent to the phone (Part 14).
- **Toll gates:** passing under one takes 4 dirhams from the character's account and beeps.
- Cameras: chase near/far, bonnet, cockpit (later), cinematic (press a key near landmarks).

### 12.6 Tuning (garage, section 5)

- Engine, gearbox, brakes, suspension (lower, stiffer), tyres (road, sport, sand), nitro, armour, bulletproof tyres, paint (gloss, matte, chrome, pearl), wheels, window tint (within the legal limit, or higher and the police notice), number plates (custom text, made-up formats).

---

## 13. Weapons and combat

Guns are in the game and free. The style is grounded and readable, not gory.

### 13.1 Weapons

- **Melee:** fists, a bat, a crowbar, a knife (no gore; a quick hit animation).
- **Pistols:** a light pistol, a heavy pistol.
- **SMGs**, **shotguns**, **assault rifles**, a **sniper rifle**, **grenades**, a **rocket launcher** (late game).
- All made-up model names; shapes can be realistic.

### 13.2 Aiming and shooting

- Third-person over-the-shoulder aim, switchable shoulder.
- Soft lock-on for controllers (can be turned off), free aim with the mouse.
- Recoil, spread that grows when moving, reloads with animations, ammo counts.
- **Cover:** press a key near a wall or car to take cover; blind fire; move between cover.
- Hit reactions on enemies; enemies take cover, flank and throw grenades on higher difficulty.
- **Fatimah's Focus**: slow motion while aiming for a few seconds, recharges over time.
- Shooting from cars (side windows, driver aims at the side), and from the back of a pickup in missions.

### 13.3 Getting weapons

- **Gun shops** (made-up names) in Al Quoz and Mussafah, enterable, with a counter, a shooting range out back (a mini-game with scores).
- Picking up weapons from enemies.
- Each character keeps their own weapons.

### 13.4 Consequences

- Firing a gun in public makes people flee and call the police: 2 stars at once if seen; hitting a person is 3 stars.
- No violence against the player's own family characters or in mosques, schools and hospitals (the game blocks shooting there: the weapon lowers automatically).

---

## 14. Police and the wanted level

### 14.1 Small crimes first

- **Fines** (no stars): speeding past a camera, running a red light seen by a camera, parking on yellow-and-black kerbs (if a warden sees it). Fines go to the phone; pay in the bank app. Unpaid fines over 5,000 dirhams make the police stop the character when they see their car (1 star).
- **Black points:** like real licences, points pile up; too many and the car gets impounded next time the police stop you (get it back at the impound lot, for a fee).

### 14.2 The stars

- **1 star:** a patrol car tries to pull you over. Stop and accept the fine, or run.
- **2 stars:** several patrol cars; police shoot only if you have a gun out.
- **3 stars:** roadblocks at junctions ahead, police SUVs that ram.
- **4 stars:** a helicopter with a searchlight, the special unit in armoured SUVs.
- **5 stars:** the police supercar fleet (Dubai is famous for its police supercars), spike strips, snipers on bridges.

### 14.3 Escaping

- Police search an area around where they last saw you (shown as a circle on the mini-map, as police cones of sight on the map). Leave the circle and stay out of sight for a time that grows with stars.
- Hiding places: underground car parks, tunnels, car washes (the car comes out clean and harder to recognise), changing cars out of sight, a sandstorm, a building interior with a back exit.
- **Busted:** wake up at a police station, lose 10% of cash (capped) and the weapons you carried.
- **Wasted:** wake up at a hospital, pay the bill, lose some cash.

### 14.4 Police AI

- Cars use the same traffic road graph, plus shortcuts across reservations when chasing.
- They box you in, ram you (PIT manoeuvre), set roadblocks on predicted routes, and call in more units.
- Officer Mariam appears in the story and sometimes in the world (never shot by the player: the aim moves off her and the game warns once, in story terms).

---

## 15. A living city

### 15.1 Traffic

- Vehicles follow the road graph lanes; pick routes at random weighted by road type; change lanes to overtake or reach a turn; use indicators; stop at red lights and give way at roundabouts; honk when blocked.
- **Density** depends on the time of day and the area: heavy at rush hour on Sheikh Zayed Road (7-9 am, 5-8 pm), lighter at night, very light at 4 am.
- **The local flavour:** a few drivers tailgate with high beams flashing in the fast lane, taxis stop suddenly to pick people up, delivery bikes weave between lanes, labour buses move slowly in the right lane.
- **Accidents** happen on their own sometimes; drivers get out and argue; the police arrive.
- Parked cars along streets and in car parks; some are unlocked.

### 15.2 People

- People on pavements and in malls, dressed for where they are: office workers in Business Bay, families at JBR, workers in hi-vis in Al Quoz, tourists in Downtown, shoppers in Deira.
- They react: step aside, look at a loud car, film a crash on their phones, run from guns, call the police, sometimes fight back.
- Some can be talked to (a short line of dialogue), some give small jobs.
- Crowds follow the time: busy evening walks along JBR and the Downtown boulevard, empty streets in the midday heat.

### 15.3 Random events

- A street race offer at a petrol station at night.
- A car breaking down that needs a push or a tow.
- A thief snatching a bag (chase him and return it, or not).
- A wedding convoy honking down a road at night.
- A police chase passing by.
- A delivery rider whose bike was stolen (Jomon's friends).
- About 30 events by the end; 5 in the first event section.

### 15.4 Animals and life

- Birds over the Creek, flamingos at Ras Al Khor, cats around bins in Deira, camels in the desert, fish in the Marina water.
- Sprinklers at dawn, window-cleaning cradles on towers by day, cranes moving, fireworks over Downtown on special nights.

---

## 16. Enterable buildings

### 16.1 The 15% rule

**At least 15% of all shops and businesses placed on the map must be enterable**, and each enterable one must be worth entering (something to buy, do or find). This is checked automatically: a test counts every shop in the map data and the ones marked `enterable: true`, and fails below 15%.

Count by area, so the 15% is spread out, not all in one mall: every district must reach at least 10% on its own, and the whole map at least 15%.

### 16.2 How interiors work

- Interiors are separate small scenes loaded when the player walks through the door (a short fade, under 1 second, or seamless where the shop window shows the inside).
- Shop windows of non-enterable shops show a believable inside painted on (parallax interior mapping, so they look deep), so the street doesn't look fake.
- Inside: lighting, staff (who react to guns), customers, things on shelves, a till.
- Interiors are built from a kit (shelves, counters, fridges, tables) with variations per shop type, plus hand-made unique ones for story places.

### 16.3 What you can do inside

| Shop type | What it offers |
|---|---|
| Grocery / petrol station shop | Water, snacks (health, stamina), cigarettes are not sold, lottery-type scratch cards (no real gambling money), rob the till |
| Cafeteria / shawarma place | Eat (health), sit with characters in story scenes, karak tea |
| Clothing shop | Buy clothes per character, try them on in a changing room |
| Gun shop | Buy weapons, ammo, armour, the range mini-game |
| Garage / tuning shop | Repair, tune, paint (Part 12.6) |
| Car dealer | Buy cars (delivered to your garage) |
| Phone shop | New phone covers, ringtones, (story) hacking tools for Fatimah |
| Barber / salon | Hair and beards |
| Pharmacy | Medical kits |
| Gold shop (souk) | Buy and sell gold (an investment that changes price daily) |
| Gym | Raise stamina skill |
| Bank branch | Pay fines, see accounts, part of a heist later |
| Malls (two big ones, made-up names) | Many shops inside, a food court, an indoor ski slope look-alike (made-up name), the cinema |

### 16.4 Other interiors

- Each character's home (and later the properties they buy).
- Story places: Victor's office tower, the Al Quoz chop shop, the gold souk alleys, the desert estate, the yacht, the vault.
- Car parks under towers (great for escapes), Metro stations, the airport terminal (landside only).

---

## 17. The phone

Opened with a key (**Up** on the controller, **P** on the keyboard). It's the main menu while playing. It looks like a real modern phone with a made-up brand, a wallpaper the player chooses, and apps:

- **Contacts:** call characters to get missions, ask for help (Jomon picks you up), invite for activities.
- **Messages:** story texts, fines, rent paid, job offers.
- **Map:** set a waypoint, GPS directions, filter shops and activities.
- **Bank:** both characters' balances, transfer between them, pay fines, see business income.
- **Ride:** the ride-hailing app: Fareej can take fares as a side job (pick up, drive, rating, tips).
- **Car app:** order a car of yours delivered to where you are (costs money, takes time), call a tow truck.
- **Camera:** take photos (a photo mode), selfies.
- **Internet:** a few made-up websites: buy property, buy cars, the news (which reacts to what the player did: "Chaos on Sheikh Zayed Road").
- **Settings:** ringtone, wallpaper, do not disturb (no calls during free roam).

---

## 18. Money, property and businesses

- **Currency:** dirhams (AED), shown as "AED" or "Dh".
- **Earning:** missions, side jobs (taxi fares, deliveries, races, stolen cars to order), robbing tills, heists, businesses, gold trading.
- **Spending:** cars, tuning, weapons, clothes, property, fines, tolls, fuel, repairs, hospital bills.
- **Property:** apartments in Deira, Karama, the Marina, Downtown and a villa on the Palm. Each one: saves the game, a wardrobe, garage spaces, a view.
- **Businesses (Act 2 onwards):** car rental (Al Quoz), desert safari company, a garage, a karak tea chain, a nightclub on the Marina (made-up name). Each earns money every game day, has a manager who calls with problems that become short side missions (a stolen delivery, a rival, a police raid).
- **Balance:** a full playthrough should end with enough money for one of everything, not all of everything. Write the economy as data with tests (prices, payouts, income per day) in `logic/economy.js`.

---

## 19. Time, weather and light

- **Day length:** 1 game day = 48 real minutes (adjustable in settings: 24, 48, 96).
- **The sun** follows Dubai's real path by date: high and white at noon, golden low light at 5-6 pm, short dusk.
- **Night:** sodium-orange and white LED street lights, lit towers, lit Burj, car lights, light pollution haze, few stars.
- **Seasons (optional):** summer (very hot, more haze, emptier streets at noon), winter (clearer, more people outside, events like fireworks and markets).
- **Weather:**
  - Clear (most of the time).
  - Hazy / dusty (lower visibility, yellow sky).
  - **Sandstorm** (rare, very low visibility, wind sounds, sand on the road, police lose you faster).
  - **Rain storm** (very rare, flooded underpasses, slippery roads, people running for cover, cars stuck in water: a real Dubai thing).
  - Fog in the early morning in winter (on the E11 especially).

---

## 20. Sound, radio and music

- **Engines:** sampled engine sounds per car type, blended by RPM and load; turbo whistle, exhaust pops on supercars, tyre squeal by slip, suspension thumps, gear changes.
- **The city:** traffic hum, horns, Metro trains, aircraft overhead near the airport, the call to prayer at the right times near mosques (respectful volume), seagulls at the Creek, construction, AC units humming, crowd chatter in Arabic, English, Hindi, Malayalam, Tagalog.
- **Interiors:** shop music, fridges humming, the souk's echo.
- **Radio:** 6 made-up stations, each with its own made-up music (commissioned or licensed royalty-free with a commercial licence), made-up DJs and ads:
  - *Noor FM* (Arabic pop), *Masala 104* (Bollywood and Indian pop), *Gulf Rock*, *Deep Dunes* (electronic/house), *Classic Khaleeji*, *Talk 97* (a talk show with jokes about traffic, rent and the heat, and news that reacts to the player).
- **No real songs.** Every track must have a licence on file in `docs/game/ASSET_LICENCES.md`.
- **Mix:** music ducks under dialogue; the radio keeps its place when you leave and return to a car.

---

## 21. The HUD and menus

### 21.1 HUD (keep it small)

- **Bottom left:** the mini-map (rotating, with roads, GPS route, police circles), health and armour as thin arcs around it, the character's special ability as a thin bar.
- **Top right:** money (appears only when it changes), wanted stars (appear only when wanted), the weapon and ammo (only when armed).
- **Bottom right in cars:** speed (km/h), fuel, gear (small, and only in a car).
- **Centre:** objective text (one short line, fades), subtitles.
- **No permanent clutter.** The HUD fades in only when needed.

### 21.2 Menus

- **Pause menu:** map (full screen, zoom, filters, waypoints), story progress, stats, settings, brief (recent dialogue), save and quit.
- **Character wheel:** for switching (Part 8).
- **Weapon wheel:** hold a key to slow time and pick a weapon.
- **Loading screens:** artwork of the characters in Dubai places (drawn illustrations, not AI-generated pictures), with a short tip.

### 21.3 Controls

- Keyboard and mouse, and controllers (Xbox, PlayStation through the browser Gamepad API). Every key can be remapped.
- Steering wheel support is a stretch goal.

---

## 22. Saving, performance and settings

### 22.1 Saving

- Auto-save after every mission, on entering a home, and every 5 minutes in free roam (not during a chase).
- Manual save at homes; 10 save slots.
- Saves are a JSON file in the app's data folder (Mac and Windows use their own data folders). Make the format versioned so updates can migrate old saves.

### 22.2 Performance targets

- 60 fps on the default "Balanced" setting on: a 2020 MacBook Air (M1), and a Windows laptop with integrated Intel Iris Xe graphics.
- Under 2 GB of memory; under 1.5 GB to download at first (stream more areas as later downloads if needed).
- First load into the world under 20 seconds on those machines.

### 22.3 Settings

- Graphics presets (Low, Balanced, High, Ultra) and each option alone: resolution scale, shadows, reflections, draw distance, traffic density, people density, motion blur, film grain.
- Gameplay: difficulty, aim assist, fuel on/off, day length, subtitles size, language (English, Arabic).
- Audio: master, music, radio, effects, dialogue.
- Accessibility: colour-blind modes for the map and HUD, hold or toggle for sprint and aim, camera shake off, big subtitles.

---

## 23. The build plan, section by section, with review gates

Every section: its own branch (`game/section-N-name`), unit tests for its logic, a Playwright run that opens the game and takes screenshots at set positions, frame-rate numbers, and a **review package for the owner**: 6-10 screenshots, a short video (Playwright can record), and a list of what works and what doesn't yet. Then **stop and wait** for comments.

| Section | What's built | What the owner reviews |
|---|---|---|
| **0. Set-up** | Engine choice, folders, the game window opening from both apps, an empty test world with a sky and ground, the frame-rate counter | The window opens on Mac and Windows; the sky and light look real, not flat |
| **1. Dubai roads** | Part 5.3 in full: real road network from Deira to the Marina, road meshes and markings, bridges, Sheikh Zayed Road with the Metro, signs, lamp posts, the skyline shells, one drivable car, simple traffic, day/night slider | The drive video from Deira to the Marina; 10 places next to real photos |
| **2. Fareej, Fatimah and the first mission** | Both characters on foot (animations, camera), switching (Part 8), Fareej's flat and Fatimah's apartment, mission runner, "Night Fare" in full (Part 10) | Play the first mission start to end |
| **3. Living city** | Proper traffic AI, people, parked cars, the 15% enterable shops for the built areas, petrol stations, fuel, tolls, speed cameras, fines | A busy rush-hour drive; walking into five kinds of shop |
| **4. Guns and police** | Weapons, aiming, cover, gun shops and the range, wanted levels 1-5, police AI, busted and wasted | A 3-star chase and a shootout |
| **5. Phone, money, garage** | The phone and its apps, the bank, buying cars, the garage and tuning, damage repair, clothes shops | Customise a car and outfit; pay fines |
| **6. Act 1 story** | Missions 2-6, cut-scenes, Uncle Rashid, Kiran, the chop shop | Play Act 1 |
| **7. Rest of Dubai** | Jumeirah, the Palm, the airport, Al Quoz in full, Ras Al Khor, interiors for those areas, malls | Free-roam tour |
| **8. Act 2** | Missions 7-12, the first heist with planning, businesses | Play Act 2 |
| **9. E11, desert, Abu Dhabi** | The motorway, the desert (sand driving, dunes, the camp), Abu Dhabi districts, Yas circuit, boats and jet skis | Drive from Dubai to Abu Dhabi; dune bashing |
| **10. Acts 3-5** | Missions 13-30, the helicopter, the endings | Play to the end |
| **11. Weather, radio, polish** | Sandstorms, rain, fog, the six radio stations, random events, photo mode, accessibility, performance pass | Final review |

Progress notes for each section go in `docs/game/PROGRESS.md`: what was built, screenshots' paths, what's left, decisions the owner made.

---

## 24. Testing

- **Unit tests** (`node --test`) for: road-graph conversion (lane counts, junction types), traffic rules (signals, give way), wanted level rules, police escape timer, character switching rules, economy numbers, mission step order, save migration, the 15% enterable rule.
- **Playwright** opens `game-desertheat.html` with a test flag that places the camera at named spots (for example `?spot=burj-sunset`) and takes screenshots; compares the frame rate against the target; fails on console errors.
- **Real machines:** each review also runs on the owner's Mac and on Windows through the existing Windows CI self-test (`windows-ci.yml`), which captures the game window.
- **Never run a test copy of the Mac app with the real bundle id** (CLAUDE.md).

---

## 25. Content, legal and naming rules

- All brands made up, including cars (styles only), weapons (model names), shops, banks, phone network, airlines, hotels, malls, ride-hailing app, police supercar models, radio music.
- Real places, roads and landmarks are fine. Credit OpenStreetMap.
- No real people, including no look-alikes of public figures.
- Age rating: the game has guns, crime and drinking-free nightlife; mark it **17+** in the Games tab and ask for confirmation once before first play. No sexual content, no drugs shown being used, no gore.
- The owner decides the final name; until then "Desert Heat".

---

## 26. The checklist for "done" (each section)

- [ ] Works the same on Mac and Windows.
- [ ] 60 fps on the target machines at Balanced.
- [ ] No console errors in the Playwright run.
- [ ] Unit tests for the section's rules pass.
- [ ] Screenshots pass the Part 3 list (no flat colours, no emoji, no purple gradients, real light, wear, life on the streets).
- [ ] The enterable shops test passes for the built areas (15% overall, 10% per district).
- [ ] No real brands anywhere (search the code and assets for a list of banned names).
- [ ] Asset licences listed.
- [ ] `docs/game/PROGRESS.md` updated.
- [ ] Review package sent to the owner, and the owner said yes before merging.
