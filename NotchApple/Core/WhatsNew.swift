//
//  WhatsNew.swift
//  Notch Apple
//
//  Release notes inside the app. After an update the notch opens once on the patch log (PatchLogView); Got it
//  marks that version as seen, so it never nags again.
//
//  Keep this in step with the website's What's New and the GitHub release notes.
//

import SwiftUI

struct ReleaseNote: Identifiable {
    var id: String { version }
    let version: String
    let date: String
    let headline: String
    let items: [String]
}

enum WhatsNew {
    static let releases: [ReleaseNote] = [
        ReleaseNote(version: "2.1.28", date: "23 October 2026", headline: "Battle: fly low, bigger battlefields, cities, a home base, and day and night", items: [
            "Battle, flying fixes: in Automatic you are no longer held 200 m up. You can fly right down low, and if you keep pushing the stick down you can fly into the ground. Climbing and diving now answer the stick straight away, and turning is quicker.",
            "Bigger battlefields: about half as big again, so you don't run off the edge so easily.",
            "Wings no longer snap off from pulling G. Only a long, very hard pull far past the limit can break one.",
            "Cities to bomb: every wave has an enemy city with houses, tower blocks and a factory, and you can name the first city yourself (Battle menu → Target city).",
            "Home base: a runway near the start of every front. When you run out of missiles or bombs, the HUD points you home. Fly low and slow down the runway and the ground crew rearms you and patches you up.",
            "More enemies in each wave (more bases, more convoys, more fighters), and enemy fire hurts you less in the Easy and Automatic settings.",
            "Friendly fire: your guns and bombs can now hit your own wingman, so watch where you shoot.",
            "Day and night: a new Day/night cycle setting, on by default. The sun rises and sets, with dawn and dusk colours and a starry night, one full day every 16 minutes. The fixed times of day are still there.",
            "Fixed: trees knocked down or cleared away in a battle kept showing on screen.",
        ]),
        ReleaseNote(version: "2.1.27", date: "23 October 2026", headline: "Formula One: real F1 cars, F1 tracks, team radio, and a hello from the notch", items: [
            "Racing, Formula One: a proper F1 car (nose and front wing, sidepods, halo, helmet, airbox, rear wing and four open wheels that turn), and a lower chase camera behind it. Pick the F1 car and every rival drives one too, for a real F1 grid.",
            "Up to 15 rivals (was 5).",
            "Formula One style tracks: Ardennes GP (in the style of Spa, with La Source, Eau Rouge, the Kemmel straight and the Bus Stop), Dunes GP (Zandvoort style) and Temple of Speed (Monza style).",
            "The first track is now a hairpin oval: two long straights and two tight hairpins, to learn braking and turning.",
            "Team radio and commentary (📻 switch): lights out, position changes, lap times and gaps, fastest laps, the final lap, damage, crashes and the chequered flag, spoken by your Mac's voices.",
            "Hello from the notch: when Notch Apple starts and each time your Mac wakes, an F1 car races across the notch and says hello with your name (it asks your name once; change it or turn it off in Settings → Notch Extras).",
            "Settings → AI shows what Notch Apple AI gives you, and that it comes with Pro ($1 once): no key to set up, ask about your screen, web search, voice, always one shortcut away.",
        ]),
        ReleaseNote(version: "2.1.26", date: "23 October 2026", headline: "Racing: cars sit on the road and barriers are solid", items: [
            "Racing: cars now sit on top of the track in the chase view. The road used to be drawn over the back of a car (and over other cars), which made it look sunk into the tarmac. Cars now have wheels, a shadow and a full underside on the road.",
            "The barriers beside the road are solid for every car, including the computer drivers: nothing gets through them, on any track. Tracks you draw in the designer are now checked so a tight bend or two close sections cannot let the barrier fold over and let cars through.",
        ]),
        ReleaseNote(version: "2.1.25", date: "22 October 2026", headline: "Plane racing with friends", items: [
            "Plane racing with friends: in Time Trial, make a race room and send friends the 6-letter code. Everyone picks a plane, the host starts, and you all fly the same 12 hoops at once. You see the other racers' aircraft with their names, a live standings box shows who is ahead, and the results list everyone's time (or who crashed out).",
        ]),
        ReleaseNote(version: "2.1.24", date: "22 October 2026", headline: "Racing: 12 tracks, 7 cars, cockpit view, crashes and a track designer", items: [
            "Racing is much bigger: 12 premade tracks (Grand Prix, Speedway oval, City streets, Mountain pass, Hairpin hill, Desert run, Coast road, Frozen lake, Kart track and the first three), and a garage of 7 cars: Formula One, GT3 Racer, Supercar V10, Muscle, Hot Hatch, Street GT and Drift King, each with its own top speed, grip, brakes, toughness and gearbox (stats shown in the garage).",
            "Three views, switched with V: chase camera, cockpit (a steering wheel that turns with the front wheels, paddles that flash at each gear change, shift lights, speed and rev dials, a mirror; the F1 car has its halo and wheel display) and the old top-down view.",
            "Real engine sound from each car's revs and cylinders (a V8 rumbles, the V10 and F1 scream), gear changes you can hear, squealing tyres, wind, grass rumble and crash sounds. M or the app's Sound switch turns it all off.",
            "Crash physics: solid barriers you bounce and scrape off, car-to-car impacts that push and spin both cars, damage that slows and pulls the car, sparks, flying bodywork, smoke and flames from a wreck.",
            "Track designer: click to draw a circuit or a sprint, drag points to shape it, pick width, scenery and laps. It checks the road as you draw, then drive it at once, save it to your track list, or share it with a code. Online rooms can race on a drawn track: friends get it automatically.",
            "Fixed: the Hairpin hill track used to cross over itself.",
        ]),
        ReleaseNote(version: "2.1.23", date: "22 October 2026", headline: "Full screen button for every small game", items: [
            "Every small game now has a Full screen button (the little corner arrows on Mac, \"⛶ Full screen\" on Windows): 2048, Snake, Breakout, Memory, Reaction, Cookie Clicker, Runner, Blackjack and Poker open in a big window that fills the screen, easy to see from a distance. Solitaire already had one.",
        ]),
        ReleaseNote(version: "2.1.22", date: "22 October 2026", headline: "Airplane sound switch fixed, World Clock: every country and region", items: [
            "The Sound switch is now always obeyed in the airplane game: with it off, the game's audio engine is shut down completely and checked every frame, so no engine, warning or effect sound can slip through.",
            "World Clock: search by country, state or well-known city, not just the time zone's city name. Type India, Mumbai, Texas, California, Dubai or Queensland and it finds the right time. Every country is listed, and each region with its own time (all of the USA's, Australia's, Russia's, Brazil's, Canada's and so on). The clock shows the name you picked.",
        ]),
        ReleaseNote(version: "2.1.20", date: "22 October 2026", headline: "Sound switch works for the airplane game", items: [
            "The Sound switch in the Games list now also turns the airplane game's sound (engine, warnings, effects) on and off. Before, it only affected the other games.",
        ]),
        ReleaseNote(version: "2.1.19", date: "22 October 2026", headline: "New game: Capture the Flag", items: [
            "New game: Capture the Flag, in the Games tab on Mac and Windows. Two teams fight round walls and crates: steal the other team's flag, carry it home to your own base (your own flag has to be there to score), and be first to 2, 3 or 5 captures or lead when the clock runs out. A flag you drop goes home when your team touches it or after 14 seconds, and whoever carries a flag runs faster and takes less damage.",
            "Play against computer teams (2 to 5 players a side, Easy, Normal or Hard, they attack, defend and chase flag thieves), or online with friends: Quick match joins an open game, or Host a game and share the 6-letter code. Empty places are filled by the computer, and with no connection it plays the computer.",
            "Controls: W A S D move, the mouse aims, click or Space shoots (or the arrow keys to aim without a mouse), M mutes.",
        ]),
        ReleaseNote(version: "2.1.18", date: "22 October 2026", headline: "Racing game: race friends in cars", items: [
            "New Racing game in the Games tab (Mac and Windows): top-down cars on a straight sprint, a curved circuit or a mixed track with straights, a hairpin and a chicane. Pick a Street GT, a Drift King or a Muscle car, and race 0 to 5 computer rivals at Easy, Normal or Hard.",
            "Drive with the arrows or W A S D, brake and reverse with the down key, and tap Space for the handbrake to drift round corners (skid marks and a drift score). Lap times, the best race time and a minimap are kept on your computer.",
            "Race friends online: choose Create room and share the 6-letter code, friends type it under Join, and the host starts the race for everyone (up to 8 drivers). Planes can already race through hoops in Plane's Hoop Rush and Time Trial; racing planes with friends is next.",
        ]),
        ReleaseNote(version: "2.1.17", date: "22 October 2026", headline: "Battle works offline", items: [
            "Battle works offline: with no internet (or when the room server can't be reached) Start now plays a solo Battle on this computer instead of waiting for the network, and you don't need to type a name. The Battle menu says when you are offline. Online games with friends still need the internet.",
        ]),
        ReleaseNote(version: "2.1.16", date: "22 October 2026", headline: "Privacy: choose what shows beside the notch", items: [
            "Privacy: Settings → Extras → Beside the notch lets you choose what appears beside the closed notch: calendar (next event and “Join”), timers and alarms, music, battery and charging, volume and brightness, messages and notifications, and everything else. “Only my calendar” keeps just the countdown to your next class or event, “Nothing” keeps the notch plain, and “Show everything” puts it all back. Nothing a passer-by could read pops up unless you allow it.",
        ]),
        ReleaseNote(version: "2.1.15", date: "22 October 2026", headline: "Solitaire full screen, and Lock on is T again", items: [
            "Solitaire has a Full screen button: it opens the game in its own window that fills the screen, with the cards sized to fit (up to nearly four times bigger). It is the same game, so you carry on where you were, and the green button or Esc brings you back.",
            "The faded square glow round the open notch is gone: it was a soft shadow in your theme colour that the window cut off into a square. The notch itself is unchanged.",
            "Battle: Lock on is the T key again, as before. Chat in online games now opens with / instead.",
        ]),
        ReleaseNote(version: "2.1.14", date: "22 October 2026", headline: "Chat in online Battle", items: [
            "Chat in online Battle: press T to open a chat box and type to the other players. While the box is open your plane flies itself in slow circles around the middle of the field (it slows down first with the air brake), so you don't leave the battlefield; on foot you stand still. Enter sends, Enter on an empty line or Esc closes, and a button in the box hides other players' chat.",
            "Key change: Lock on moves from T to K (the Lock on button shows K), because T is now chat.",
            "Windows: the update helper now breaks away from the app before the app closes, so the installer always runs and the notch reopens (this was 2.1.13).",
        ]),
        ReleaseNote(version: "2.1.13", date: "22 October 2026", headline: "Windows updates that survive", items: [
            "Windows: the update helper now breaks away from the app before the app closes. If the notch was started by a launcher or a task, Windows used to stop the helper when the app quit, so the installer never ran, the notch stayed closed and the old version came back when you reopened it. Now the installer runs, and the notch reopens (as the new version, or the old one if the installer failed, with a log in your Temp folder).",
        ]),
        ReleaseNote(version: "2.1.12", date: "22 October 2026", headline: "Battle is a journey, and a Windows update that always comes back", items: [
            "Battle is now a journey on one continuous map: when you clear a wave the front moves on, and the next enemies are way ahead of you (about 2.6 km further for planes, 1.1 km for people on foot and tanks). The land goes on instead of ending in the sea, the front travels along a long road round the map, and respawns, loot, bases, fighters and the edge warnings all follow the front. In shared battles the host decides where the front is and tells everyone.",
            "Windows: the updater now keeps a log (NotchApple-Update.log in your Temp folder) and, if the app did not start again 15 seconds after the installer finished, starts it itself, so the notch always comes back instead of staying closed. If an update still does not take, download the installer from the website and run it, and send that log.",
            "Windows: T is Lock on in Battle (and the checklist everywhere else) in this version; a Windows app older than 2.0.99 still opens the checklist, which is another reason to update.",
        ]),
        ReleaseNote(version: "2.1.11", date: "22 October 2026", headline: "Online Battle on one team, F1 final classification", items: [
            "Update needed for online Battle: it has a new network version, so everyone must be on 2.1.9 or newer (Windows 2.1.9 or newer) to meet in the airplane game. Older versions sit in their own empty rooms and cannot join.",
            "The open online game is Co-op for everybody (everyone on the green team, no Fight vote), and everyone gets 2 guided missiles per wave. Private games you open yourself can still be Co-op or Fight.",
            "Formula 1: when no session is on, the F1 tab shows the latest final classification (the newest race, sprint or qualifying) with gaps, fastest laps and retirements. Live sessions show the running order.",
        ]),
        ReleaseNote(version: "2.1.10", date: "22 October 2026", headline: "Formula 1: latest final classification", items: [
            "Formula 1: when no session is on, the F1 tab now shows the latest final classification (the newest race, sprint or qualifying) with gaps, fastest laps and retirements, instead of an empty page. Live sessions still show the running order.",
            "Housekeeping: the oldest 20 releases and their tags were removed to keep the list short.",
        ]),
        ReleaseNote(version: "2.1.9", date: "22 October 2026", headline: "Update needed for online Battle: everyone on one team", items: [
            "Online Battle has a new network version: only people on this version or newer can meet each other, so everyone must update Notch Apple to play the airplane game with friends. Older versions now sit in their own empty rooms and cannot join, and a game started on a newer version tells you to update.",
            "The open game is Co-op for everybody: all players are on the same team (green) and the Fight vote is gone from it. Private games you open yourself can still be Co-op or Fight.",
            "Everyone gets guided missiles (2 each wave), and friends on the same code share one game and wave.",
        ]),
        ReleaseNote(version: "2.1.8", date: "22 October 2026", headline: "Formula 1 tab fixed", items: [
            "Formula 1: the F1 tab no longer spins forever. F1 has closed the public live-timing feed the tab was reading, so it now shows the running order from ESPN when a session is on or has finished, and otherwise says plainly that session timing isn't being published. The schedule, standings and favourite-team features are unaffected.",
        ]),
        ReleaseNote(version: "2.1.7", date: "22 October 2026", headline: "Guided missiles for everyone", items: [
            "Guided missiles (G) now work for every player in a shared battle, not only the host. You fly your own missile, and when it explodes the host judges what it hit, so a friend's guided missile can destroy a base for the whole team. Everyone sees the explosion; two missiles come back each wave.",
            "Before, only the host could use them and anyone else got \"Guided missiles are for the host\". On the Online button the first player is the host, so most of your friends had no guided missiles at all.",
        ]),
        ReleaseNote(version: "2.1.6", date: "22 October 2026", headline: "Every percent again, and friends share one wave", items: [
            "The Claude usage pulse on the closed notch is back to one for every new percent. The earlier fix that stopped false ones (wobbling numbers and mixing up accounts) stays, so it only fires when a number really goes above the highest one it already showed.",
            "Friends who use the same code end up in the same game and the same wave: if two players both open a game in one room at the same moment, the one that started later now joins the one already running (same wave, score and battlefield size). Waiting to find an open game is also a little longer (6 seconds) so a slow connection does not open a second game by mistake.",
        ]),
        ReleaseNote(version: "2.1.5", date: "22 October 2026", headline: "Plane game: sound really off", items: [
            "Plane game sound: switching sound off, or closing the notch, now shuts the game's audio engine down completely instead of only muting it, so nothing can still be heard. It starts fresh when sound is wanted again.",
        ]),
        ReleaseNote(version: "2.1.4", date: "21 October 2026", headline: "Claude usage pulse: much less often", items: [
            "The Claude usage pulse on the closed notch (\"5h 96% left, wk 48% left\") no longer keeps coming back. It only appears when a number passes the highest one it has already shown (a reading that wobbles 4, 5, 4, 5 says nothing more), at most once every five minutes, and straight away only when usage is at 75% or more. A window that resets starts the count again.",
        ]),
        ReleaseNote(version: "2.1.3", date: "21 October 2026", headline: "Fewer network messages, new version numbers", items: [
            "Online Battle sends 5 updates a second instead of 10, to keep the shared room relay inside Cloudflare's free daily limits. Movement still looks smooth because other players' vehicles are glided between updates.",
            "Version numbers are tidier: Mac rolls over from 2.0.102 to 2.1.3, and Windows now uses the same number as the Mac (2.1.3, replacing the 1.101.0 style). Updates work as normal.",
        ]),
        ReleaseNote(version: "2.0.102", date: "21 October 2026", headline: "Plane menu: shorter and quieter", items: [
            "The big \"How to play\" card on the Plane menu now shows only until you have started a game once. After that it folds into one \"How to play\" button (and a Hide button to fold it again). The long explanation under Host a game is one short line, and the Full screen button only appears where full screen can work, so you no longer get \"Full screen is not available in this window\".",
        ]),
        ReleaseNote(version: "2.0.101", date: "21 October 2026", headline: "Plane game: the sound really stops", items: [
            "Fixed the plane game's sound that would not stop: the Sound button now silences everything (engine, warnings and spoken calls) and turns it back on properly, and closing the notch, leaving the game or hiding the window stops all sound too, including the spoken warnings that kept going in shared battles that run in the background. The old mute only set a volume that the engine sound then glided back up.",
        ]),
        ReleaseNote(version: "2.0.100", date: "21 October 2026", headline: "Battle: flying trees and wildfire", items: [
            "Battle explosions are now dramatic: a missile, bomb, rocket, shell, grenade or a burning depot throws the trees near its middle into the air (they tumble and some are on fire, and a flaming one can set the ground where it lands alight), and sets trees further out on fire.",
            "Burning trees give off flames and smoke for 9 to 16 seconds and then fall, and fire jumps from tree to tree, so a wildfire can spread through a wood after a missile lands close to it. On foot, standing next to a burning tree hurts.",
            "Every player's game picks the same trees to throw and burn, so the fire looks the same for everyone. Heat vision shows the flames through the smoke.",
        ]),
        ReleaseNote(version: "2.0.99", date: "21 October 2026", headline: "Battle: breakable trees and rolling hills", items: [
            "Trees break when you hit them: a plane's wing or nose, a tank or a van that runs into a tree breaks it (leaves fly and there is a crack), and it is gone from the picture for the rest of the battle. A strong Battle plane slows down but flies on; trees grow back in the next battle.",
            "The battlefields are no longer pancake flat: gentle rolling hills (up to about 40 m high, slopes of 5 to 10 degrees) so there are ridges to hide behind and to fly over, still easy for tanks and soldiers to cross.",
            "Automatic flying with heavy planes (the B-52) banks a little less and rolls back the short way, which fixes a rare tumble into the ground.",
            "In shared battles a broken tree breaks for everyone: when one player breaks a tree it falls on every other player's screen too, and players who join later see the trees that are already down.",
        ]),
        ReleaseNote(version: "2.0.98", date: "21 October 2026", headline: "Battle: a simpler screen", items: [
            "Battle looks simpler in a small window: the weapon buttons shrink to an icon with its key count so they all fit and cover less, the Vote and Leave buttons move to the bottom-left corner and the room text is hidden when there is no space, the radar shows just your height, and ground target labels no longer print on top of each other (two at most).",
        ]),
        ReleaseNote(version: "2.0.97", date: "21 October 2026", headline: "Same Wi-Fi, same private room code", items: [
            "Friends on the same Wi-Fi now get the same private room code. The Battle menu shows it as \"This Wi-Fi\", Host uses it and the Join box is filled in with it. The first to press Host opens the game and the others press Join; if two press Host at once, one joins the other automatically. (The Online button already puts everyone in one open game.)",
            "This needs the licence server update (it works out the code from your public network address and stores nothing). Until that is live, Host gives a random code as before.",
        ]),
        ReleaseNote(version: "2.0.96", date: "21 October 2026", headline: "Battle: friends meet in the same open game", items: [
            "Friends now meet in the same open game even if they picked different battlefields. Online used a separate room for each battlefield, so one friend landed in the \"Green Plains\" room and the other in \"Island Fortress\". There is now one open room: the battlefield is the one the first player picked, and you can vote for another with U. Both of you need this version. To play in a private game instead, use Single player and share its room code.",
        ]),
        ReleaseNote(version: "2.0.95", date: "21 October 2026", headline: "Battle: hold R on foot to respawn", items: [
            "On foot, tap R to reload and hold R for 1.5 seconds to respawn in the same wave (a progress message shows while you hold). Same score, same wave, nothing restarts for anyone else.",
        ]),
        ReleaseNote(version: "2.0.94", date: "21 October 2026", headline: "Battle: open games start as Co-op", items: [
            "Open games now start as Co-op, so a friend who joins is on your team (green) and not an enemy. Before, a game inherited whatever the host had picked last, and if that was Fight every other player was an enemy.",
            "The room bar now says which it is: \"CO-OP: all one team\" or \"FIGHT: players are enemies\", with the room code and how many are playing. Vote with U to switch.",
        ]),
        ReleaseNote(version: "2.0.93", date: "21 October 2026", headline: "Battle: heat vision", items: [
            "New heat vision in Battle (press Y or the Heat vision button): the picture goes grey, smoke, dust and haze disappear, and people, vehicles, aircraft and fires glow white so you can see them through smoke.",
        ]),
        ReleaseNote(version: "2.0.92", date: "21 October 2026", headline: "Flight and Battle: Y levels and clearer readouts", items: [
            "New Y levels: Battle markers for teammates, enemies and your wingman now show their height and how far above (+) or below (-) you they are (for example \"Bob 422 m Y578 (+127)\"), and your own Y is shown under the radar.",
            "In free flight the traffic box shows YOU Y and THEM Y heights.",
            "The airfield and traffic readouts use words (AHEAD, BEHIND, TO THE LEFT, TO THE RIGHT, ABOVE, BELOW, LEVEL) instead of arrows, because an up arrow made it look like the plane was climbing.",
        ]),
        ReleaseNote(version: "2.0.91", date: "21 October 2026", headline: "Claude usage no longer announces rises that did not happen", items: [
            "The closed notch no longer pulses \"usage went up\" when it had not. It compared one Claude account's percentage with another's (or with an unstable order of accounts) and read the difference as a rise; each account is now compared only with its own last reading.",
        ]),
        ReleaseNote(version: "2.0.90", date: "21 October 2026", headline: "Battle: working votes and obvious teammates", items: [
            "Fixed the vote panel: none of its buttons worked, because the panel was being rebuilt many times a second, so a click never landed. Voting for teams, enemies, field and pause works again.",
            "Teammates are now easy to spot: in Co-op they show in bright green with a star, a double green bracket and their name always visible, their plane or soldier is tinted green, their names in the player list are green, and they are big green dots on the radar (with a \"GREEN = YOUR TEAM\" note). In Fight everyone keeps their own colour.",
        ]),
        ReleaseNote(version: "2.0.89", date: "21 October 2026", headline: "Battle: loot, healing and a Fortnite-style soldier", items: [
            "Loot drops: glowing boxes with a tall beam (grey, blue, purple, gold) lie around the battlefield each wave and enemy soldiers drop some when they die. Walk over them to pick up rifle ammo, rockets, grenades, bandages, shield potions and medkits; a rarer colour gives more. The host decides who gets each one, so two players never take the same box.",
            "Healing on foot: H bandage (+15 health up to 75), J shield potion (+50 shield), K medkit (full health). The soldier now has a shield bar over the health bar that soaks up damage first.",
            "Fortnite-style walking: an over-the-shoulder third-person camera by default (first person in the scope), Space jumps, Shift runs, Ctrl or V crouches, and you aim with the cursor. Fire is now click or Enter.",
        ]),
        ReleaseNote(version: "2.0.88", date: "21 October 2026", headline: "Battle: R respawns you instead of restarting", items: [
            "Pressing R in a battle now puts you straight back in your vehicle in the same wave, with the same score and kills. It no longer restarts the whole battle for everyone. On foot, R still reloads: use Respawn in the pause menu.",
        ]),
        ReleaseNote(version: "2.0.87", date: "21 October 2026", headline: "Battle: a growing battlefield", items: [
            "For soldiers, tanks and helicopters the battlefield now starts small (40% of its radius) and grows with every wave until it is the full size at wave 7. A message tells you when it grows; at the edge you get a warning.",
            "The host decides the size and tells everyone each wave, so all players share the same field, and players who join later get the current size. Jets keep the full battlefield.",
            "The landing map shows the current play area as a white circle.",
        ]),
        ReleaseNote(version: "2.0.86", date: "21 October 2026", headline: "Battle: parachute start with a map, and a military van", items: [
            "Soldier battles now start with a parachute jump from the bus: a map shows the battlefield, you click where to land (25 seconds, then it jumps for you), float down and steer a little with W A S D.",
            "A military van waits beside you when you land. Walk up and press E to get in: W/S drive, A/D steer, Shift boost (up to about 115 km/h), E to get out when stopped. Other players see your van, parked or driving.",
        ]),
        ReleaseNote(version: "2.0.85", date: "21 October 2026", headline: "Battle: land a helicopter, get out, and RPGs", items: [
            "New Helicopter vehicle (an Apache): land and stop, press E to step out as a soldier, and press E beside it to climb back in. Other players see it parked. If your soldier is lost you get a new helicopter in the same wave.",
            "Soldiers now carry an RPG: press 2 for the RPG (a big rocket that kills a soldier outright, 4 at a time, 2 more each wave) and 1 for the rifle.",
            "Enemy soldiers carry RPGs too. From wave 3 one in each squad fires rockets at you or your low-flying helicopter, and helicopter waves now include squads on foot.",
        ]),
        ReleaseNote(version: "2.0.84", date: "21 October 2026", headline: "Notch popups follow your accent colour", items: [
            "The calendar countdown (\"French in 10m\"), message popups and Clipboard Link popups beside the closed notch now use the accent colour you chose in Settings → Appearance instead of a fixed teal.",
            "Battle: the lock button (T) now also locks on to ground targets: bases, tanks, guns, trucks and fuel depots.",
            "Battle: new guided missiles (G): you fly the missile with the mouse or arrows while your plane flies itself, then detonate it with Space, a click or G. Two per round; in shared battles for now only the host can use them.",
        ]),
        ReleaseNote(version: "2.0.83", date: "21 October 2026", headline: "Battle: online by default, exact bombs and a lock button", items: [
            "Battle now puts you in an open game: press Start and you join the wave being played, or open one if nobody is there. Single player still opens your own game and shows its room code so others can join any time.",
            "You must type your name before starting; it shows above you and in the player list. Players are labelled before the computer fighters.",
            "In shared battles the game keeps running while the notch is closed. Players can vote to pause the round (press U) and vote again to play on.",
            "Soldier: aim with the cursor. The crosshair follows it and the view turns when the cursor reaches the screen edge; in the scope the cursor turns the view slowly.",
            "Bombs land exactly on the yellow diamond where it was when you pressed B, a quick tap always drops one, and Easy and Automatic snap to a target within 45 m.",
            "New lock button (T): lock on to the fighter nearest your nose and keep it locked until you press T again.",
            "Pro: the plane now turns itself back when it heads out of the battlefield (from about 85% of the radius, earlier when fast).",
            "Mac: Keep Awake (Lid Closed) can switch itself off after a time you type in hours, minutes and seconds (numbers only).",
        ]),
        ReleaseNote(version: "2.0.82", date: "21 October 2026", headline: "Battle: eject works in shared battles", items: [
            "Eject (J) now also works in shared battles with friends, and it always tells you what is stopping it (not in a jet, already on foot, the jet already crashed) instead of doing nothing.",
        ]),
        ReleaseNote(version: "2.0.81", date: "21 October 2026", headline: "Battle: eject, parachute and rifle", items: [
            "Eject: a new button (or J) in the Battle jets. The jet goes down in flames and you float down on a parachute, then fight on foot with the rifle. When the jet is badly damaged or on fire the screen says EJECT: PRESS J. A jet that crashes and stops now lets you climb out and keep fighting on foot. If the pilot is lost on foot, a new jet comes back in the same wave.",
            "Ramming works: flying low into a ground target destroys it (at a cost to your jet), as hitting an enemy fighter already does.",
            "Two small buttons by the ? button turn spoken calls (Pull up, ATC) and TCAS traffic calls on or off while you fly. TCAS is on by default and has its own switch in the pause menu settings (a reply to the Pull up request).",
            "Fixed the vote card in shared battles: clicks on it no longer fire your guns, and U now opens it without the key leaking to the game.",
        ]),
        ReleaseNote(version: "2.0.80", date: "21 October 2026", headline: "Battle: fighters fly like jets", items: [
            "Easy and Automatic fighters now bank into their turns: the jet leans in and levels out instead of snapping left and right, and the turn gets wider at high speed.",
            "Diving is much quicker: the F-16 and F-15 can now go down about three times as fast as they climb, and a hard bank lets the nose sag a little.",
            "Q quick turn now ends after exactly 180°. Airliners respond faster to the controls.",
            "Smoother game: scenery builds faster, sound updates less often, and slow computers draw fewer pixels instead of flying in slow motion.",
        ]),
        ReleaseNote(version: "2.0.79", date: "20 October 2026", headline: "Battle: Soldier on foot, two new planes", items: [
            "New Soldier vehicle: walk, run, strafe and crouch with mouse look, a first- or third-person view (C), and a low-poly soldier avatar.",
            "The rifle has 30-round magazines (R reloads), a 4x and 10x scope on right-click or Z with range marks for bullet drop, a rifle sway that settles when still or crouched, and grenades on G.",
            "Enemy riflemen march at you in squads, stop to shoot and miss a lot. Your rifle does twice their damage. Multiplayer works: other players see your soldier, teammates are green.",
            "New war planes: the Interceptor (fastest, 12 missiles, no bombs) and the Heavy Striker (16 bombs, tough, slow to turn).",
            "The bomb countdown is smaller and no longer covers your plane. In Pro, a plane that leaves the battlefield now turns back by itself.",
        ]),
        ReleaseNote(version: "2.0.78", date: "20 October 2026", headline: "Battle: lock-on, descending and teammates", items: [
            "Fixed planes refusing to go down: the pull-up assist now only steps in when you are about to hit the ground, and diving is faster in Easy and Automatic.",
            "Lock-on is clearer: a box and a filling ring on the target, LOCK: PRESS N when a missile can fire, and the lock stays on while the target is roughly ahead.",
            "Teammates show in bright green with a star; players you are fighting show in red.",
            "New notifications (Notifications add-on) pop up beside the closed notch with the sender or app name.",
        ]),
        ReleaseNote(version: "2.0.77", date: "20 October 2026", headline: "Battle is easier to fly and fight", items: [
            "Easy and Automatic now fly arcade style: quick, smooth turns (about 50°/s in the F-16), steady climbs, no stalls and no snapped wings. Press Q for a quick 180° turn (3 s cooldown). Pro keeps the full flight model.",
            "Enemies miss more and fire shorter bursts from farther away; flak is less accurate and half damage in Easy and Automatic.",
            "Enemy bases now stand in a row straight ahead (500–700 m apart). The battlefields are bigger and the edge is gentler: a warning at 85%, 12 s before any damage, and Easy nudges you back.",
        ]),
        ReleaseNote(version: "2.0.76", date: "19 October 2026", headline: "Shift boost for Battle tanks", items: [
            "Hold Shift while driving a tank in Battle to boost its acceleration and raise its top speed from 13 to 20 m/s. The wave briefing now shows the boost control.",
        ]),
        ReleaseNote(version: "2.0.75", date: "19 October 2026", headline: "Battle, Plane and Games, easier to use", items: [
            "Battle keeps fighter wings sturdy and lets you turn off over-G blackout and stress. The self-destruct button respawns you in the same wave without losing kills or score; the red boundary warning and mouse aim ring stay visible and useful.",
            "Plane can open full screen with the menu button or F11. The Games tab adds play-money Texas Hold’em against the computer.",
            "Claude Usage now scrolls inside smaller windows. The Gemini model picker ignores duplicate models and safely discards stale refreshes.",
        ]),
        ReleaseNote(version: "2.0.74", date: "19 October 2026", headline: "Battle is clearer and sturdier", items: [
            "Battle aircraft no longer lose wings to over-G, overspeed or wingtip scrapes; speed and load are capped, while a hard nose-first crash remains fatal.",
            "Easy and Automatic warn and help pull up near the ground; Pro gets a low-altitude warning. Enemy markers, smoke trails, wave objectives and briefings make the battle easier to read.",
            "Fixed multiplayer wave progression getting stuck on wave 1.",
        ]),
        ReleaseNote(version: "2.0.72", date: "19 October 2026", headline: "Battle with friends", items: [
            "Host a game in Battle and share the 6-letter code, or join a friend's. It works on the same Wi-Fi or far apart, and Mac and Windows can play together.",
            "Co-op against the computer or Fight each other, with a vote (press U) to change the match. If you are shot down you come back after five seconds.",
        ]),
        ReleaseNote(version: "2.0.71", date: "19 October 2026", headline: "Battle: a tank, flat battlefields and Automatic flying", items: [
            "Air War is now Battle: pick a vehicle (fighter, gunship, bomber or a tank you drive), one of three flat battlefields, and Automatic, Easy or Pro controls.",
            "Co-op or Fight, and enemies on or off for target practice. The battle screen is simpler.",
        ]),
        ReleaseNote(version: "2.0.70", date: "19 October 2026", headline: "Plane controls made clear, and the game is kept", items: [
            "Every Plane mode now tells you what to press: a card at the start of each flight (press ? to see it again), a How to play box in the menu and a full list in the Controls tab.",
            "Air War: Space or a click fires, B bombs, N a missile, L flares, with clickable weapon buttons.",
            "The Plane game no longer resets when you close the notch or switch tab: it pauses and picks up where you left off.",
        ]),
        ReleaseNote(version: "2.0.69", date: "19 October 2026", headline: "Air War: bombers, bombs and dogfights", items: [
            "A new Plane mode: bomb tanks, bunkers and AA guns and shoot down enemy fighters in waves, with a computer wingman or against computer aces.",
            "Bombs fall realistically with a bombsight; Enter or click fires the cannon, Z bombs, N a missile, L flares.",
            "New aircraft: the B-52 heavy bomber with tail gunners, and the A-10 gunship.",
        ]),
        ReleaseNote(version: "2.0.68", date: "19 October 2026", headline: "Claude usage animates the closed notch", items: [
            "Every percent your 5-hour or weekly use goes up, the closed notch pulses and shows how much is left of both.",
            "Claude usage refreshes every minute in the background and when the Mac wakes, so it no longer goes stale.",
        ]),
        ReleaseNote(version: "2.0.66", date: "16 October 2026", headline: "Blackjack: no more empty bank", items: [
            "Fixed Blackjack getting stuck at a bank of 0 after losing everything and quitting: the table now refills to 500 chips when you open it, so you can always deal.",
        ]),
        ReleaseNote(version: "2.0.65", date: "14 October 2026", headline: "Smoother, and kinder to Reduce Motion", items: [
            "Reordering modules, the tour, theme choices, Home and Claude usage now settle without a bounce and switch to a quick fade when Reduce Motion is on.",
            "The website responds to a tap straight away, follows Reduce Transparency and Increase Contrast, and the chat panel opens from its button.",
        ]),
        ReleaseNote(version: "2.0.64", date: "14 October 2026", headline: "Printer Status: the printer's camera", items: [
            "Printer Status has a Camera card. For P1 and A1 printers (the A1 mini, for example) Open camera shows the live picture from the printer, over your own network: nothing goes through the internet or any server, and nothing is saved.",
            "The X1, P2 and H2 printers send video this app cannot play yet, so for those the card offers Copy video address to open in VLC (switch on LAN Only Liveview on the printer first).",
            "This is based on what the community has documented and was tested against a simulated printer, not a real one: please tell us how it goes.",
        ]),
        ReleaseNote(version: "2.0.63", date: "14 October 2026", headline: "Printer Status: find your printers again any time", items: [
            "After signing in with your Bambu account, a new Find printers on my account button lists the printers again, using the saved sign-in, so you never have to sign out and in to add one. If you are signed in with nothing added yet, the list appears by itself.",
        ]),
        ReleaseNote(version: "2.0.62", date: "14 October 2026", headline: "Plane: Clean start, and a security pass", items: [
            "Plane: a Clean start switch on the flight simulator's home screen. You spawn on the runway with the battery, beacon and engine off and do the whole start-up yourself (Y battery, O beacon, S throttle idle, I engine, then flaps, gear and brake), with the checklist on screen walking you through it. Off, you spawn ready to roll.",
            "Hardening from a full review: the shared-flying relay is rate-limited and only shows pilots in the same part of the world, other pilots' data is validated, the Bambu sign-in is stricter about redirects, sign-out and retries, and a few smaller fixes.",
        ]),
        ReleaseNote(version: "2.0.61", date: "14 October 2026", headline: "Printer Status: sign in without a password", items: [
            "If you sign in to Bambu with Google, Apple or Facebook, use Email me a code instead: enter the same email and type the six-digit code Bambu sends. No password needed.",
        ]),
        ReleaseNote(version: "2.0.60", date: "14 October 2026", headline: "Printer Status: watch your Bambu printers without LAN Mode", items: [
            "Printer Status can now sign in with your Bambu account instead of LAN Mode, so the Bambu Handy app and the printer's cloud features keep working. Your password goes only to Bambu and is never saved; only the sign-in token Bambu returns is kept, in an owner-only file, and signing out deletes it.",
            "Printers on the account are added with one click. Bambu has no official way to do this, so if it stops working, LAN Mode still does.",
        ]),
        ReleaseNote(version: "2.0.59", date: "14 October 2026", headline: "Printer Status: a clear note about LAN Mode", items: [
            "Printer Status now says plainly that LAN Mode switches off the printer's cloud features (Bambu Handy, remote printing, print history), and that some printers may connect without it, so you can try adding the printer first.",
        ]),
        ReleaseNote(version: "2.0.58", date: "14 October 2026", headline: "Plane: fly with other Notch pilots, a step-by-step procedure, glowing lights at night", items: [
            "Plane: Fly with others (off until you turn it on) shows other Notch pilots in the sky with their callsigns. It sends only your callsign, aircraft and position, with a random id and no account.",
            "Plane: a step-by-step procedure for each phase (before take-off, climb-out, approach, landing roll): the next step is highlighted and each ticks itself off.",
            "Plane: runway, helipad and airfield lights, and your own aircraft's lights, glow properly at night.",
        ]),
        ReleaseNote(version: "2.0.57", date: "14 October 2026", headline: "Plane: messages fit the screen", items: [
            "Plane: the take-off and landing configuration warnings are shorter, and long on-screen messages now wrap instead of running off the edge.",
        ]),
        ReleaseNote(version: "2.0.56", date: "14 October 2026", headline: "Plane: cold-and-dark start, air traffic control, night and fog", items: [
            "Plane: no more apron or gate start: every flight begins on a runway, which ended the glitches on the aprons.",
            "Plane: turn on Cold and dark start in Controls, then run the checklist (shown on screen, T hides it) and start the engine with I.",
            "Plane: air traffic control calls out take-off, approach and landing clearances (spoken, switch in Controls), and the ILS is cleared by the tower.",
            "Plane: choose Dawn, Day, Dusk or Night, and Clear, Haze or Fog, in the weather panel.",
        ]),
        ReleaseNote(version: "2.0.55", date: "14 October 2026", headline: "Plane: ILS approaches, wider taxiways, no more tipping over", items: [
            "Plane: instrument landing system on every runway. Line up with a runway within 30 km and an ILS box shows the runway, distance and the localiser and glideslope needles. Press J and the autopilot flies the approach down to 45 m, with tower calls; gear and flaps stay yours.",
            "Plane: the taxiways at the home airfield are twice as wide, so big jets and fighters no longer drop a wheel onto the grass, and turning on the ground is limited so a fast turn can no longer tip a jet over.",
            "Plane: the autopilot now holds its speed properly.",
        ]),
        ReleaseNote(version: "2.0.54", date: "14 October 2026", headline: "Plane: autopilot, solid aprons and visible wheels on traffic", items: [
            "Plane: an autopilot for fixed-wing aircraft. Press K in the air to hold your heading, height and speed; , and . turn it 5 degrees, [ and ] change height by 50 m, and moving the stick or K hands the controls back.",
            "Plane: the aprons at the new airfields count as paved ground now, like the runway, so the nose wheel no longer sinks in and breaks when you turn sharply there.",
            "Plane: other aircraft show their wheels when they are low.",
        ]),
        ReleaseNote(version: "2.0.53", date: "14 October 2026", headline: "Plane: no more crash on take-off start, ground crew and traffic; your feedback", items: [
            "Plane: fighters (F-15, F-22, Su-27 and others) no longer crash into the runway the moment a flight starts: the start height now matches each model's size, and helicopters stay put on their pad until you lift off.",
            "Plane: airliners start at the gate by default, where the ground crew works (1 refuel, 2 catering, 3 baggage, 4 pushback), and other aircraft cross the sky with markers, traffic call-outs, close calls and mid-air collisions that bring both down. Flap configuration errors are called out.",
            "A feedback card now appears in the open notch about every three to four weeks (Not now skips it), and Settings → Help & Feedback can count this Mac anonymously (off until you say yes).",
        ]),
        ReleaseNote(version: "2.0.52", date: "14 October 2026", headline: "A much bigger Plane map, and a security pass", items: [
            "Plane: four new airfields (Seaside on the coast, and Coral Island, Palm Atoll and Lighthouse Cay on islands in the southern sea), each with a runway, hangar, windsock and helipad. Choose where Free Flight starts, and the screen shows the nearest airfield and which way it is.",
            "Hardening from a full code review: links like notchapple://keepawake can no longer crash the app, a bad read of the saved-keys file can no longer wipe your keys, restored settings backups can't redirect your Home Assistant, and PairDrop files are limited in size and marked as downloaded.",
        ]),
        ReleaseNote(version: "2.0.51", date: "14 October 2026", headline: "Updates work again, and helicopters fly properly", items: [
            "Update checks no longer fail with \"Couldn't reach GitHub\": they read a small file from the website first, so a busy shared network can't use up GitHub's hourly limit.",
            "Helicopters rewritten: the stick leans the helicopter (right goes right, up goes forward), the collective stays where you leave it, hover is steady, the tail rotor is calmer, and the blades are drawn properly.",
            "Helicopters start on a helipad (there is one at the airfield and one on the mountain plateau), with new challenges: Hover steady, On the H, Top of the world.",
            "Fixes the mountain strip challenge never showing when you flew in rather than took off. The Bambu tab is now called Printer Status, with clear setup steps.",
        ]),
        ReleaseNote(version: "2.0.50", date: "13 October 2026", headline: "Bambu Lab printers, and helicopter emergencies", items: [
            "New Bambu Lab tab: watch your 3D printer on your Wi-Fi, with status colours (green printing, yellow paused, blue idle, gray offline), progress, time left and live nozzle and bed temperatures, and it shows beside the notch while a print runs.",
            "A red glow, a notification and a sound if a heater runs too hot or the hotend creeps hot; a soft sound and tap when a print pauses, finishes or fails. The printer's certificate is remembered on first connection and a different one is refused.",
            "Plane: press H in a helicopter for an emergency landing (it levels out and sets down gently), with a helicopter HUD. A Flight Simulator item in the menu-bar menu launches or pauses the game.",
            "Fixes a crash that could happen while a small overlay window resized. The app is now written Notch Apple everywhere.",
        ]),
        ReleaseNote(version: "2.0.49", date: "10 October 2026", headline: "Plane: weather, touchdowns and crashes", items: [
            "New Weather panel in the Plane menu: 0–90 kt crosswind, headwind or tailwind, and turbulence from none to extreme, with presets.",
            "Far more realistic touchdowns: oleo struts, tyre side forces, spin-up smoke, skids and burst tyres, tilting bogies, reverse thrust on X, and a rating for every landing.",
            "Even more realistic crashes: the plane breaks into sections, skips across the ground, burns only when a tank tears, and the report says what broke.",
        ]),
        ReleaseNote(version: "2.0.48", date: "10 October 2026", headline: "Six more fighter jets", items: [
            "Plane: the F-16 Falcon, F-15 Eagle, F/A-18 Hornet, Eurofighter Typhoon, F-22 Raptor and Sukhoi Su-27 join the F-35, each with its own wing, tail and colours, afterburner and retractable gear.",
            "Plane: press F again after the last flap setting and the flaps come back up.",
        ]),
        ReleaseNote(version: "2.0.47", date: "10 October 2026", headline: "Plane Sim: far more realistic", items: [
            "Realistic flying: stalls and spins, wind and turbulence, g-limits, gear that bounces on a hard landing.",
            "Crashes like real life: gear collapse, belly slides, wings shearing off, fireballs, debris and a wreck that tumbles, with a crash report.",
            "A new, bigger island world with mountains, forests, towns and a proper airfield with approach and PAPI lights.",
            "Seven new modern aircraft: SR22, PC-12, Citation, E175, A220, 787 and the F-35. Better models for all planes.",
        ]),
        ReleaseNote(version: "2.0.46", date: "10 October 2026", headline: "Drop zones as cards", items: [
            "The Shelf, Convert and Share drop zones are now cards with an icon, \"Drop a file here\" and \"or click to browse\". As you drag a file near they lean towards it and say \"Bring it closer\", then \"Let go to add it\" when you are over them.",
        ]),
        ReleaseNote(version: "2.0.45", date: "10 October 2026", headline: "Files can reach the notch", items: [
            "Dragging a file no longer slides underneath the notch: while you drag, the notch steps below the dragging layer so it can take the drop (it goes back up when you let go).",
        ]),
        ReleaseNote(version: "2.0.44", date: "10 October 2026", headline: "Drop anywhere on the open notch", items: [
            "A file dropped anywhere on the open notch (not only inside a tab's drop area) goes to the Shelf, or to Convert when that tab is showing.",
        ]),
        ReleaseNote(version: "2.0.43", date: "10 October 2026", headline: "Dragging a file to the notch, for real", items: [
            "Drag any file (from a Finder window or the desktop) to the top centre of the screen and the notch opens for the drop. The 2.0.38 version never fired, because macOS doesn't send mouse events to other apps during a drag; it now watches the pointer instead.",
        ]),
        ReleaseNote(version: "2.0.42", date: "10 October 2026", headline: "Drops work again", items: [
            "Dropping files on the Shelf, Convert and the other drop areas works again (2.0.37's new drop handling stopped them registering).",
        ]),
        ReleaseNote(version: "2.0.41", date: "10 October 2026", headline: "Cassette mode redone, and a pin that holds", items: [
            "Cassette mode: the tape is now the big centre of the Now Playing tab with the controls beside it, and Settings → Extras has a switch so it stays on (or off) until you change it.",
            "A pinned notch now only closes when you close it (Esc, the close button, the shortcut): clicking the desktop, switching apps or swiping no longer closes it.",
        ]),
        ReleaseNote(version: "2.0.40", date: "10 October 2026", headline: "The AI provider picker", items: [
            "The AI tab's provider list is now a searchable picker with a preview of each provider, like the model picker beside it.",
        ]),
        ReleaseNote(version: "2.0.39", date: "10 October 2026", headline: "Cassette mode on the Now Playing tab", items: [
            "The Now Playing tab has a tape button beside Open Player: it swaps the cover for a cassette whose reels turn while it plays.",
        ]),
        ReleaseNote(version: "2.0.38", date: "10 October 2026", headline: "Dragging files to the notch", items: [
            "Dragging a file to the top centre of the screen now opens the notch even when its own drop area is hidden or covered, so the file can be dropped straight onto the Shelf.",
        ]),
        ReleaseNote(version: "2.0.37", date: "10 October 2026", headline: "A nicer feel, and two card games", items: [
            "Drop zones lean towards your file like a magnet: the Shelf, Convert, Share, Launcher, Wallpaper and the AI tab.",
            "Clearing the Shelf or finished to-dos is now press-and-hold, with an Undo that counts down.",
            "AI tab: a searchable model picker with a preview of each model.",
            "Music: cassette mode, a tape whose reels turn while it plays.",
            "Games: Blackjack and Solitaire.",
        ]),
        ReleaseNote(version: "2.0.36", date: "10 October 2026", headline: "A bigger Plane world, and the world leaderboard", items: [
            "Plane: the map is about three times bigger, with plains, ranges and sea. Pick where in the world you fly (Dubai, London, Paris, New York, Tokyo, Sydney, Cairo, San Francisco) or press My location, or type a city or country. Each place has its landmark beside the runway.",
            "Plane: a World leaderboard. Tick 🌍 when you save a score to share your name, plane and score; see everyone's by challenge, all time or this week.",
        ]),
        ReleaseNote(version: "2.0.35", date: "10 October 2026", headline: "Live wallpaper", items: [
            "New Wallpaper tab (Pro): play your own video (up to 60 seconds, up to 4K) or a free NASA clip as your desktop wallpaper, on every display.",
            "It pauses on battery, in Low Power Mode, on sleep or lock, and when windows cover it. The lock screen shows a still from the video.",
        ]),
        ReleaseNote(version: "2.0.34", date: "9 October 2026", headline: "Notch Apple AI, included with Pro", items: [
            "Settings → AI → Notch Apple AI (included): ask without setting up any key. Pro gets 60 messages a day, Ultimate 200. Your own keys still work with no limit.",
        ]),
        ReleaseNote(version: "2.0.33", date: "9 October 2026", headline: "Ultimate modules go private, radar fits", items: [
            "The Ultimate modules (Convert, Smart Home, Claude usage, Do It, Purge) are built into official releases only; nothing changes for you.",
            "Flight Radar's header fits on the Mac: the range is a small menu beside Refresh.",
        ]),
        ReleaseNote(version: "2.0.32", date: "9 October 2026", headline: "A new licence, and premium sounds from the server", items: [
            "Notch Apple's code is now source-available (copyright Aditya Jain): you can read and build it, but not resell it or unlock the paid features without a key. Earlier versions stay MIT.",
            "Four premium Klick sounds (Pro) download from the licence server with your key: Cherry MX Black, Gateron Ink, Alps and Buckling spring.",
            "Clipboard Link now checks your Ultimate key with the server; update both devices to keep linking.",
        ]),
        ReleaseNote(version: "2.0.31", date: "9 October 2026", headline: "Do It, and lyrics on the side of your screen", items: [
            "Do It (Ultimate): tell the AI what to do and it does it on your screen, step by step. Start and Stop, asks before anything risky, Ctrl+Option+Esc stops it from any app.",
            "Now Playing: Lyrics on screen (Pro) floats the synced lyrics along the side of your screen while music plays.",
        ]),
        ReleaseNote(version: "2.0.30", date: "9 October 2026", headline: "GPWS callouts, and games that fit", items: [
            "Plane: the airliners now speak realistic GPWS warnings and radio-altimeter callouts (Sink rate, Terrain, Pull up, Minimums, Retard…). Switch it off in Games → Plane → Controls.",
            "The Games list scrolls and keeps the Sound switch in view, so nothing is cut off in the notch.",
        ]),
        ReleaseNote(version: "2.0.29", date: "9 October 2026", headline: "Flight Radar, Airbus and landing gear", items: [
            "New Flight Radar tab: a round radar of every aircraft around you, live, with callsign, type, height and speed. It uses your location rounded to about 1 km and only asks while the tab is open.",
            "Plane game: Airbus A320, A350 and A380, and a gear lever (G) on the airliners with gear lights, a too-low warning and belly landings if you forget.",
        ]),
        ReleaseNote(version: "2.0.28", date: "9 October 2026", headline: "Plane: a proper cockpit", items: [
            "Round airspeed and altimeter dials that change with the aircraft, plus an engine gauge (rpm or jet N1), fuel and flaps position.",
            "Engines sound like what they are: piston, or a spooling jet. Wind, tyres, stall horn and overspeed warning too.",
            "Tail strikes: rotate too steeply and the tail scrapes, damaging it. Flaps step in notches, you can run out of fuel, and airliners call out Rotate.",
        ]),
        ReleaseNote(version: "2.0.27", date: "9 October 2026", headline: "Updates once a week, if you want", items: [
            "New option: Update at most once a week. Off by default. On, Notch Apple stops announcing every release and asks about the newest update once a week; required security updates still appear straight away.",
            "It is switched on or off in this card, in Settings → Notch and in Settings → Updates.",
        ]),
        ReleaseNote(version: "2.0.26", date: "9 October 2026", headline: "Top bar you choose, ⌘E and ⌘J", items: [
            "The always-there buttons sit in a bordered group, and you choose which to keep (Settings → Notch).",
            "⌘E opens and closes the notch; ⌘J hides and shows it. Swipe up on the top bar closes it.",
            "Tools are tidy tiles you tap to open. Settings opens on the desktop you are on.",
        ]),
        ReleaseNote(version: "2.0.25", date: "9 October 2026", headline: "Klick: a Mechanical sound", items: [
            "Klick has a new Mechanical sound: the classic clacky keyboard, with a sharp click, a hard clack and a crisp release.",
        ]),
        ReleaseNote(version: "2.0.23", date: "9 October 2026", headline: "Coffee button, tidier Tools, Convert drops", items: [
            "New coffee button beside the pin: click it to keep your Mac awake until you click it again.",
            "Tools: the two Keep Awake cards are one, with a switch and the time limits and lid-closed option under Options. Three roomy cards instead of four.",
            "Convert: dragging a file onto the notch now keeps the Convert tab (it used to jump to the Shelf), and a Shelf file has Convert… in its menu.",
        ]),
        ReleaseNote(version: "2.0.22", date: "9 October 2026", headline: "Convert: turn any file into another kind", items: [
            "Convert (Ultimate): drop files and turn them into another kind: PPTX to PDF, HEIC to JPG, Word to PDF, MOV to MP4, Excel to CSV, PDF to pictures and more. Saved next to the original.",
            "Pictures can be combined into one PDF, and Make them all sets the same target for every file.",
        ]),
        ReleaseNote(version: "2.0.21", date: "9 October 2026", headline: "Klick asks for the permission it needs", items: [
            "Klick asks for Input Monitoring as well as Accessibility, and shows which one is missing.",
        ]),
        ReleaseNote(version: "2.0.20", date: "9 October 2026", headline: "Klick, and Plane controls that climb when you go up", items: [
            "Klick (Pro): mechanical keyboard sounds as you type, in any app. Eight sounds, each with its own volume, and an on / off switch.",
            "Plane: cursor up (or ↑) now climbs, the mouse steers inside a small ring so it never runs off the notch, and keys always reach the game.",
        ]),
        ReleaseNote(version: "2.0.19", date: "9 October 2026", headline: "Notch Apple opens again", items: [
            "Fixed a crash at launch in 2.0.17 and 2.0.18.",
        ]),
        ReleaseNote(version: "2.0.18", date: "9 October 2026", headline: "Lid-closed Keep Awake asks only when used", items: [
            "The password prompt appears only when you flip the lid-closed switch, and cancelling doesn't bring it back until you flip it again.",
        ]),
        ReleaseNote(version: "2.0.17", date: "9 October 2026", headline: "Keep Awake with the lid closed", items: [
            "New tool: Keep Awake (Lid Closed) keeps your Mac running with the lid shut. It asks for your password, turns off under 15% battery and when Notch Apple quits.",
        ]),
        ReleaseNote(version: "2.0.16", date: "9 October 2026", headline: "⌥A turns the keyboard light off too", items: [
            "Option+A now takes the keyboard backlight to zero with the screen, and restores both.",
            "Settings has a Reset keyboard brightness button in case the backlight is ever left dark.",
        ]),
        ReleaseNote(version: "2.0.15", date: "9 October 2026", headline: "Edit Home in the notch, AirDrop rebuilt", items: [
            "Tap the sliders button on Home to move, resize, collapse, remove or add widgets without going to Settings.",
            "AirDrop was rebuilt so its picker opens reliably, with an Open AirDrop window fallback.",
            "Scrolling up and down now does the same as scrolling left and right.",
        ]),
        ReleaseNote(version: "2.0.14", date: "9 October 2026", headline: "PairDrop can be found, and talks to Windows", items: [
            "PairDrop now runs from launch, so other devices can send to this Mac without the Share tab being open, and a notification says when something arrives.",
            "The Windows app has a matching PairDrop: Mac and Windows can send files and chat to each other.",
        ]),
        ReleaseNote(version: "2.0.12", date: "8 October 2026", headline: "Plane: crashes, failures and a bigger world", items: [
            "Fixed: the plane kept rolling right when the cursor rested off-centre. The mouse is now a self-centring stick, and hands off the wings level themselves.",
            "Wings tear off when they hit trees, buildings or the ground; big impacts break the plane apart. Engine failures, bird strikes, overspeed, over-G and belly landings.",
            "Hills, forests, snowy mountains, a river canyon, a plateau strip, a wind farm and a town, plus five new challenges.",
        ]),
        ReleaseNote(version: "2.0.11", date: "8 October 2026", headline: "Fly the plane with the mouse", items: [
            "Mouse steering, a bigger Controls tab, and new aircraft: Cessna 172, Piper PA-28 and Boeing 737, 747 and 777.",
            "The notch grows while the Plane game is open.",
        ]),
        ReleaseNote(version: "2.0.9", date: "8 October 2026", headline: "Fly a plane, pan your music", items: [
            "Games → Plane: a 3D flight game. Pick one of four planes and fly Hoop Rush, a Time Trial, a Landing challenge or Free Flight, with challenges and a leaderboard.",
            "Now Playing has a speaker balance slider: slide left for the left speaker, right for the right.",
            "Click the song in Now Playing for a Spotify-style lyrics view with the cover and a progress bar.",
        ]),
        ReleaseNote(version: "2.0.8", date: "8 October 2026", headline: "Tennis sized to your notch", items: [
            "The Tennis tab is laid out from the notch's real width.",
        ]),
        ReleaseNote(version: "2.0.7", date: "8 October 2026", headline: "Tennis fits the notch", items: [
            "The draw and singles/doubles buttons wrap when space is tight, so the week controls and favourite players are never cut off.",
        ]),
        ReleaseNote(version: "2.0.6", date: "8 October 2026", headline: "Required fix: the notch always closes", items: [
            "Pinning no longer keeps the notch open for good: the pin lasts until you close it, so clicking outside closes the notch again.",
            "Every notch screen has a close button, including the lock, update and tour screens. Clicking in Settings closes the notch too.",
            "The hide shortcut is now ⌃⌥O instead of ⌘O, so ⌘O opens files in other apps again.",
            "The Non-Necessities tab no longer shows twice.",
        ]),
        ReleaseNote(version: "2.0.5", date: "8 October 2026", headline: "Tennis in the notch", items: [
            "A new Tennis tab, on for everyone: every ATP and WTA match of the week with live set scores, in Men, Women and Mixed tabs.",
            "Grand Slams are painted red. Step back a week at a time, or jump to any of the last four Grand Slams.",
            "The ATP and WTA top 20, and favourite players: star them and their live score shows beside the notch while they play.",
        ]),
        ReleaseNote(version: "2.0.4", date: "8 October 2026", headline: "Updates ask first", items: [
            "A new version is now a request with Update or Skip for now, and the screen lists what is in it. Only a release marked compulsory forces the update.",
        ]),
        ReleaseNote(version: "2.0.3", date: "8 October 2026", headline: "Connect to Claude renews an expired sign-in", items: [
            "When Claude Code\'s saved sign-in has expired, Connect asks Claude Code to renew it and connects by itself.",
        ]),
        ReleaseNote(version: "2.0.2", date: "8 October 2026", headline: "A To-Do widget, widget Home by default, and Connect to Claude fixed", items: [
            "A To-Do widget on Home with Quick Add built in: type a task and a time, add !!! for high priority. High priority is red and sits at the top.",
            "Home opens as the widget page for everyone, with Clipboard, Now Playing and Notes cards.",
            "Connect to Claude shows progress and errors, keeps the macOS prompt visible, and can sign you in to Claude Code.",
        ]),
        ReleaseNote(version: "2.0.1", date: "8 October 2026", headline: "One clear latest version", items: [
            "A withdrawn 2.0.0 had muddled the version order. 2.0.1 is above every earlier release, so every copy updates normally. Everything from 1.34.0 to 1.34.10 is included.",
        ]),
        ReleaseNote(version: "1.34.10", date: "8 October 2026", headline: "Your day is back on Home", items: [
            "One thing today, pinned notes, countdowns and the full Up next list are back, in a Today card on Home.",
        ]),
        ReleaseNote(version: "1.34.9", date: "7 October 2026", headline: "Out-of-date copies must update", items: [
            "Notch Apple checks for the newest release in the background every 15 minutes, even with update notifications off. A copy that is not the newest must update before it works.",
            "A release can carry a security message that the update screen shows.",
        ]),
        ReleaseNote(version: "1.34.8", date: "7 October 2026", headline: "A required update that can't be dodged", items: [
            "When a release is marked required, Notch Apple remembers it, so blocking the internet afterwards does not lift it.",
            "Until the update is installed: the notch shows only the Update screen, paid features and most shortcuts are off, and notch badges stop.",
        ]),
        ReleaseNote(version: "1.34.7", date: "7 October 2026", headline: "Faster license suspension", items: [
            "A suspended license is noticed within about 10 minutes online (checked at launch, after sleep and every 10 minutes).",
            "A Mac that can't verify its license for 3 days pauses paid features until it is online again.",
        ]),
        ReleaseNote(version: "1.34.6", date: "7 October 2026", headline: "Suspended licenses stop within hours", items: [
            "A suspended or revoked license key is now noticed within hours, with no update needed: Notch Apple checks at launch, after sleep and every hour (at most every 6 hours).",
            "A Mac that has not been able to check for 30 days pauses paid features until it is online again.",
            "A brand-new install starts on the widget Home; people updating keep the Classic page until they choose in Settings → Modules & Layout.",
            "This is a required update: it brings the whole 1.34 set of changes to everyone.",
        ]),
        ReleaseNote(version: "1.34.5", date: "7 October 2026", headline: "Search finds features, and a better Claude usage tab", items: [
            "Settings search now finds features: type \"windows\" and Modules & Layout opens showing only Windows, highlighted, with a button to show everything again.",
            "Claude usage has a new look: a ring for each limit, Opus and Sonnet bars when Claude reports them, and a 30-day chart of your busiest point each day.",
            "Several Claude accounts: if Claude Code is signed in under more than one account, pick which to show and see the others at a glance.",
        ]),
        ReleaseNote(version: "1.34.4", date: "7 October 2026", headline: "Claude usage alerts and a run-out forecast", items: [
            "A notification when your real 5-hour session or week reaches 80% and again at 95% (Claude usage tab, on by default once connected).",
            "A line under each limit tells you when you would hit it at your current pace, if that is before it resets.",
        ]),
        ReleaseNote(version: "1.34.3", date: "7 October 2026", headline: "A notch that closes, and What's New that fits", items: [
            "The notch now closes when you swipe to another desktop or open Settings, instead of staying stuck open.",
            "What's New, the tour and update screens now stay inside the notch's edges instead of running out of space.",
        ]),
        ReleaseNote(version: "1.34.2", date: "7 October 2026", headline: "Claude usage connects again", items: [
            "Claude usage finds Claude Code's newer sign-in and reads your limits even when Anthropic's usage endpoint is off. Press Connect once after updating.",
        ]),
        ReleaseNote(version: "1.34.1", date: "7 October 2026", headline: "Classic Home is back, and PairDrop fixed", items: [
            "Settings → Modules & Layout → Home screen switches between Classic (weather, battery, next events) and Widgets, and you can reorder your Home widgets.",
            "File transfers in PairDrop now complete. 1.34.0 closed the connection after the first piece of every file.",
        ]),
        ReleaseNote(version: "1.34.0", date: "7 October 2026", headline: "A huge update for efficiency and a modular notch", items: [
            "Home replaces Today: Devices, Notifications and Quick Add always there; Clipboard, Now Playing and Quick Notes open on click.",
            "Claude usage as green, yellow and red lights for your 5-hour window and week, with a 5-second notch badge and Pin to Home.",
            "An algebra calculator and the Translator inside Tools; ten rarely-used tabs merged into Non-Necessities, placed your way in Settings → Modules & Layout.",
            "PairDrop rebuilt (any size, folders, progress, confirmed delivery), with private chat and a custom name.",
            "Connect to Claude in the Claude usage tab to see your real session and weekly limits.",
        ]),
        ReleaseNote(version: "1.33.2", date: "7 October 2026", headline: "Updating works from anywhere", items: [
            "Fixed the \"Can't write to …/AppTranslocation/…\" error: if Notch Apple was opened from the DMG or Downloads, the update now installs into Applications.",
        ]),
        ReleaseNote(version: "1.33.1", date: "7 October 2026", headline: "The patch log in the notch, and Gemini that switches model", items: [
            "After an update the notch opens on what changed, with a switch for each new optional feature and a Got it button. No separate window.",
            "If a Gemini request fails before answering, Notch Apple retries on the next Gemini model (up to four) and tells you with a short notice.",
        ]),
        ReleaseNote(version: "1.32.5", date: "7 October 2026", headline: "Option+A, update reminders, and no locked screen", items: [
            "Includes everything from 1.32.1 to 1.32.4, which never built. Option+A blacks out the screen and brings it back; update reminders come every 4th or 5th notch open; a window after updating lets you switch on new features; and the permission screen no longer blocks the notch.",
        ]),
        ReleaseNote(version: "1.32.4", date: "7 October 2026", headline: "No more locked screen", items: [
            "The required-permission screen is gone and the notch always shows your tabs. Turn on Accessibility in Settings → Permissions for the volume gauge, ⌥A and window snapping.",
        ]),
        ReleaseNote(version: "1.32.3", date: "7 October 2026", headline: "Update reminders", items: [
            "While an update is waiting, every 4th or 5th time you open the notch it offers Update or Skip for now. Required updates can't be skipped.",
        ]),
        ReleaseNote(version: "1.32.2", date: "7 October 2026", headline: "Required updates, and choose what to switch on", items: [
            "A release can be marked required: the open notch then shows only an Update now screen until you update. Settings and the menu bar still work.",
            "After updating, a window lists the new optional features with a switch for each, once.",
        ]),
        ReleaseNote(version: "1.32.1", date: "7 October 2026", headline: "Option+A screen blackout, and the Accessibility prompt fixed", items: [
            "Press Option+A to take the screen brightness to zero and again to bring it back. Switch it off in Settings if you type å.",
            "macOS keeps a stale Accessibility entry after each update, so Notch Apple kept asking even when it was switched on. It now clears that entry once per version and asks again, and the setup screen has an \"It's already on: fix it\" button.",
        ]),
        ReleaseNote(version: "1.30.3", date: "6 October 2026", headline: "Add your VPN app, and a required setup step", items: [
            "Your own VPN is now just \"add the app\": click VPN app in the VPN tab and pick Proton VPN, NordVPN, Mullvad, WireGuard or any other app. The power button opens it and turns green when your Mac has a VPN tunnel up. No addresses or passwords.",
            "The Accessibility permission is now a required first step. Until it is on, the open notch shows a short setup screen; the moment it is granted, the volume and brightness gauge starts, with no relaunch.",
        ]),
        ReleaseNote(version: "1.30.2", date: "6 October 2026", headline: "The notch is back at the top, and one pop-up at a time", items: [
            "Fixed the notch sitting below the top of the screen in 1.30.0 and 1.30.1. It is flush with the top edge again, and macOS can no longer push it under the menu bar.",
            "Fixed two volume or brightness pop-ups showing on top of each other: until Accessibility is allowed only the macOS pop-up shows; once it is, only the notch gauge shows.",
        ]),
        ReleaseNote(version: "1.30.1", date: "6 October 2026", headline: "Cookie Clicker unlocks", items: [
            "Cookie Clicker buildings now unlock as you bake: they show as locked goals first and open up as your total baked cookies grows.",
        ]),
        ReleaseNote(version: "1.30.0", date: "6 October 2026", headline: "A huge update", items: [
            "Claude Code status dot: a small dot beside the notch, green for 4 seconds when a Claude Code task finishes and yellow for 4 seconds when it needs your input or finishes with warnings or errors. Set it up in Settings → Notch Extras → Claude Code.",
            "A pin in the notch header keeps the notch open while you drag files in from Finder or the Desktop.",
            "A new VPN page: one big power button to connect or disconnect, a discreet server picker on the right, and your own custom VPNs (IKEv2, OpenVPN, WireGuard). The VPN badge is gone from the header.",
            "AirDrop drops now work anywhere on the AirDrop card, and Share can AirDrop text and code snippets (as text or as a file).",
            "Two new games: Cookie Clicker (click multipliers and auto-clickers, saved progress) and Runner, a fast arcade jumper.",
            "Live scores moved into the Sports tab. The old Live tab is now Parcels & Flights and is off by default.",
            "The notch stays put in full-screen apps, including on Macs without a hardware notch.",
        ]),
        ReleaseNote(version: "1.29.0", date: "6 October 2026", headline: "Lid Fold", items: [
            "Lid Fold folds your desktop like a closing laptop lid: it tilts, frosts and dims, then comes back. It is off by default. Turn it on in Settings → Lid Fold, then try Preview, the timed demo, or press ⌃⌥F to fold and hold.",
            "On a MacBook with a lid-angle sensor, “Follow the lid” folds the desktop as you close the screen and unfolds it as you reopen it. Macs without the sensor can still use Preview, the demo and the hotkey.",
            "A fold is always dismissible: click anywhere, press Esc or the hotkey. Every fold except the lid-following one also ends by itself, and any error, sleep, lock or display change removes it. Without Screen Recording it previews on a plain backdrop and captures nothing.",
            "Settings → About → Acknowledgements credits the open-source projects Lid Fold builds on, with their licences.",
        ]),
        ReleaseNote(version: "1.28.1", date: "5 October 2026", headline: "Smoother window switching", items: [
            "Switching tabs now has the Duo blur-morph too: the new page slides in from the side it sits on in the tab bar, coming into focus out of a blur, while the old page blurs and fades away. The pages overlap while they swap, so nothing jumps.",
        ]),
        ReleaseNote(version: "1.28.0", date: "5 October 2026", headline: "Arrange your tabs by dragging", items: [
            "The welcome tour now asks which tabs you want and lets you put them in order by dragging cards, with no up and down arrows. Click + to add a tab, ✕ to remove one, or drag it up to the exact spot you want. The other cards make room as you drag.",
            "The same drag-and-drop organizer replaces the arrows in Settings → Appearance (“Notch tabs and order”), and it uses the same switches as Settings → Modules, so there is only one list.",
            "The Purge tab is now a small menu: “Free up space” opens Purge, “Review removed apps” opens Purge's leftovers review, and if Purge isn't installed the tab asks whether you want to install it.",
        ]),
        ReleaseNote(version: "1.27.3", date: "5 October 2026", headline: "The Duo animation, done properly", items: [
            "The iPhone Duo open and close animation now works the way the Dynamic Island does: the notch grows out with a soft overshoot while what's inside comes into focus out of a blur, and on closing it blurs away quickly as the notch tucks back in with no bounce.",
        ]),
        ReleaseNote(version: "1.27.2", date: "5 October 2026", headline: "Duo animations and full-screen in Modules", items: [
            "“Use iPhone Duo animations” and “Keep the notch visible in full-screen apps” are now also at the top of Settings → Modules, so the notch's switches are in one place. They're still in Settings → Notch too, and both are on by default.",
        ]),
        ReleaseNote(version: "1.27.1", date: "5 October 2026", headline: "The notch stays visible in full-screen apps", items: [
            "“Keep the notch visible in full-screen apps” is now on by default, so the notch stays where it is when an app goes full screen (including on Macs without a hardware notch, like the base M1). Turn it off in Settings → Notch → Stepping aside if you'd rather it step aside.",
        ]),
        ReleaseNote(version: "1.27.0", date: "5 October 2026", headline: "Tidier Settings, a faster Snake and two new games", items: [
            "Settings is shorter. Permissions and Privacy share one entry, “Privacy & Permissions”: choose it and pick which one to open. Focus timer settings moved into Notch → Focus.",
            "Snake no longer drops or ignores quick taps: turns are queued in order (two per move), keys are read directly, the game runs off the main thread and the board is drawn as one fast canvas.",
            "New games: Breakout (mouse or ← → to move the paddle, three lives, faster levels) and Memory (repeat the pattern of lights, one more each round).",
            "Every game keeps its best score, and there is one Sound switch for all of them in the Games sidebar.",
        ]),
        ReleaseNote(version: "1.26.1", date: "5 October 2026", headline: "Purge instead of our own cleaner", items: [
            "The Ultimate Cache Cleaner tab is now the Purge tab. It opens the Purge app (a separate disk cleaner) from the notch, and links you to it if it isn't installed. Notch Apple no longer scans or deletes anything itself.",
            "Fixed: a two-finger sideways swipe over the tab bar used to scroll the tabs and also switch to the next one. It now only scrolls. If you liked switching by swipe, turn on Settings → Notch → Swipe on the tab bar switches tabs.",
        ]),
        ReleaseNote(version: "1.26.0", date: "5 October 2026", headline: "Duo animations, Cache Cleaner and full-screen notch", items: [
            "iPhone Duo animations (on by default): the panel springs out of the notch, the highlight slides between tabs as one shape and pages scale into place, like the Dynamic Island. Turn them off in Settings → Notch → Use iPhone Duo animations. Reduce Motion always wins.",
            "Ultimate: Cache Cleaner. Scans app caches, Xcode derived data, logs and old temporary files and clears them in one click. (Replaced by the Purge tab in 1.26.1.)",
            "Keep the notch visible in full-screen apps (Settings → Notch → Stepping aside): for Macs without a hardware notch, like the base M1, where the notch used to vanish when an app went full screen.",
            "The welcome tour's tab picker now also offers Translator, Mac Stats and Cache Cleaner, and what you pick there is what Settings → Modules shows.",
        ]),
        ReleaseNote(version: "1.25.0", date: "5 October 2026", headline: "Your own hot corners", items: [
            "Settings → Notch → Hot corners: push the pointer into any screen corner to open a website, an app, a file or folder, run a Shortcut, open Mission Control, or open and close the notch.",
            "Pick a different action for each corner, how long the pointer must rest there, and optionally a key to hold (⌥, ⌘, ⌃ or ⇧) so it never fires by accident.",
            "Works next to macOS's own hot corners. In System Settings → Desktop & Dock → Hot Corners, set a corner to “–” if you give it to Notch Apple. Free for everyone.",
        ]),
        ReleaseNote(version: "1.24.0", date: "4 October 2026", headline: "Notch Apple on your iPhone", items: [
            "Ultimate: the iPhone companion. Send text and links to the notch, see the Mac's battery and music, and control music, timers and Keep Awake. It works over your Wi-Fi with no server, and every message is encrypted.",
            "Get NotchAppleCompanion.ipa from the release and install it with Sideloadly. With a free Apple ID, reinstall it every 7 days. Pair it in Settings → iPhone.",
            "Shortcuts on iPhone: “Send to Mac notch” and “Get Mac status”, including from the share sheet.",
            "Pro: speed (0.5× to 3×) and skip 10 seconds for video and podcasts playing in Safari, Chrome, Arc, Brave or Edge.",
            "Questions about a purchase? Write to notchapples.support@gmail.com.",
        ]),
        ReleaseNote(version: "1.23.1", date: "4 October 2026", headline: "Pro and Ultimate are on sale", items: [
            "Buy Pro ($1) or Ultimate ($5) on the website: your signed key is shown and emailed, and works on up to 3 Macs.",
            "Every future update is included for buyers, 2.0 and beyond. Add an optional tip at checkout if you'd like.",
            "Students can ask for a free Pro promo code.",
        ]),
        ReleaseNote(version: "1.23.0", date: "4 October 2026", headline: "The finishing touches", items: [
            "Peek: rest the pointer on the closed notch for a one-line glance (what's playing, your next event or the weather). Click to open.",
            "Swipe down on the notch to open it (Settings → Notch), and a countdown beside the notch 15 minutes before your next event.",
            "Undo: deleting a note, to-do, clipboard item, shelf file or Home widget shows Undo for a few seconds (⌘Z works too).",
            "Focus: with a Shortcuts automation, the notch stays quiet or steps aside while a Focus is on; with Pro it switches to the matching profile.",
            "AppleScript: tell application \"Notch Apple\" to run notch command \"timer?minutes=5\".",
            "Pro: a Do Not Disturb toggle, send to-dos to Things or Todoist, and drag-and-drop in Home.",
        ]),
        ReleaseNote(version: "1.22.0", date: "4 October 2026", headline: "Trust, and a few more extras", items: [
            "Settings → Privacy: every permission, everywhere Notch Apple can connect to and when, and what it keeps on this Mac, with Delete buttons.",
            "Settings → Help & Feedback: send feedback, and a bug report you read in full before you submit it yourself on GitHub.",
            "Crash reports, off by default: after a crash you can review the report (name and home folder removed) and send it.",
            "Pro: a 12-hour and 7-day forecast for up to six cities, a meeting-time planner in World Clock, mic mute, and top apps by CPU.",
            "Ultimate: the beta channel, priority support, and notes and to-dos synced through iCloud.",
        ]),
        ReleaseNote(version: "1.21.0", date: "4 October 2026", headline: "Make it yours", items: [
            "Pro: Home, a dashboard tab of widgets (clock, weather, battery, next event, Now Playing, timer, to-do, markets) in small, medium or large.",
            "Pro: profiles (Work, Study, Gaming…) that choose your tabs and theme, switching by the app in front or the time of day.",
            "Pro: per-app rules: hide the notch in an app, or have it open on a tab when an app comes forward.",
            "Pro: animation styles and speed, your own open/close sounds and haptic feel, rounded/serif/monospaced text and a menu bar icon.",
            "Ultimate: the plugin SDK. Plugins can show beside the notch (activity: lines), be Home widgets and keep running in the background.",
            "Ultimate: the plugin gallery: install community plugins in one click, after reading their source.",
        ]),
        ReleaseNote(version: "1.20.0", date: "4 October 2026", headline: "Get more done", items: [
            "A To-do list in the Notes tab, saved on this Mac.",
            "Pro: Reminders in To-do (tick them off right there), Markdown preview and #tags for notes.",
            "Pro: the command palette (⌃⌥P): search and run tabs, timers, snippets, saved prompts, apps and Settings, or ask the AI.",
            "Pro: a text expander: give a snippet an abbreviation like ;sig and type it anywhere.",
            "Pro: screenshot markup (arrows, boxes, highlights, text), a screen ruler, and unit and currency conversion in the calculator.",
            "Pro: shelf folders, auto-expiry and a Share button; up to 5,000 clipboard items and apps whose copies are never saved.",
            "Ultimate: a notch command for Terminal and more notchapple:// commands (ask, note, todo, theme, palette…).",
        ]),
        ReleaseNote(version: "1.19.0", date: "4 October 2026", headline: "A smarter assistant", items: [
            "Apple Intelligence as an AI provider: free, private and on this Mac (macOS 26 or newer with Apple Intelligence on).",
            "Pro: web search with sources. Turn on the globe and answers search DuckDuckGo first and cite what they used.",
            "Pro: personas (Tutor, Concise, Code reviewer, Writing coach or your own) and saved prompts.",
            "Pro: slash commands: /summarize, /explain, /eli5, /fix, /translate fr: …, /code, /web, /persona.",
            "Pro: dictate questions and have answers read aloud.",
            "Pro: AI on your clipboard: summarise, fix, translate or explain a copied item; the result is copied back.",
            "Ultimate: AI automations, prompts that run on a schedule (say a morning summary of your calendar), delivered as a notification.",
        ]),
        ReleaseNote(version: "1.18.0", date: "4 October 2026", headline: "More live activities", items: [
            "A soft pulse beside the notch when a video call is about to start, with Join one click away.",
            "Pro: Markets, a watchlist of stocks and crypto with today's change and a chart; pin one beside the notch.",
            "Pro: live flight status in Live (altitude and speed while it's in the air), pinned beside the notch.",
            "Pro: follow up to five more teams in Sports; their live scores take turns beside the notch.",
            "Ultimate: the Live Activities API. Show your own builds, uploads or anything else beside the notch from Terminal, Shortcuts or an app.",
            "Ultimate: two activities at once, one in each ear (say a timer and a live score).",
        ]),
        ReleaseNote(version: "1.17.0", date: "4 October 2026", headline: "A notch that fits how you work", items: [
            "Settings → Notch: hover delay, hide in fullscreen apps, and (optionally) hide while the screen is recorded.",
            "Keyboard control: ⌘1–⌘9 jump to a tab, ⌘[ and ⌘] step through them. Long-press the closed notch for quick actions; swipe on the tab bar to change tabs, swipe up to close.",
            "A four-step welcome for new installs: permissions, your tabs, your look and a quick tour (show it again from Settings → General).",
            "Search in Settings, optional open/close sounds and trackpad haptics, and stronger contrast when Increase Contrast is on.",
            "Pro: resize the open notch with a live preview (or pinch it), edge trigger zones along the top of the screen, tabs per display, remappable gestures, eight new themes and a theme editor with import and export.",
        ]),
        ReleaseNote(version: "1.16.0", date: "4 October 2026", headline: "Free, Pro and Ultimate", items: [
            "Three tiers, each paid once: Free stays complete, Pro is $1 and Ultimate is $5. No subscription, no account, every 1.x update included. See Settings → License → Compare tiers.",
            "AI is free: ask anything and keep asking, with your own free key or Ollama. Asking about your screen (⌃⌥S), selected text, images and PDFs, and AI History are Pro.",
            "Signed product keys, checked on your Mac, offline. They're emailed to you, work on up to 3 Macs, and activate with one click from the checkout page.",
            "Settings → License: your tier, Deactivate this Mac, Lost my key?, Upgrade to Ultimate for $4, and Terms.",
            "Moved to Pro: Launcher, Snippets, Mirror, Focus timer, meeting alerts, download progress, rain alerts, lyrics and automatic sync. Backup, F1, sports, clipboard, window snapping, AirDrop, screenshots, Shortcuts and the world clock stay free.",
            "Already bought Pro? Your key or access code keeps working as Pro. Donors and $2 supporters get Ultimate free; ask on GitHub.",
        ]),
        ReleaseNote(version: "1.15.3", date: "3 October 2026", headline: "Clearer cricket scores", items: [
            "Cricket fixtures show each side's score under its name, LIVE or Result between them, and the match status (\"West Indies require 166 runs\") on its own line instead of squeezed into the score column.",
        ]),
        ReleaseNote(version: "1.15.2", date: "3 October 2026", headline: "Windows, charts and a full view", items: [
            "Capture a single window: hold the capture button and choose Window under the pointer, or make it the default in Settings → AI.",
            "Charts and tables are recognised (\"Looks like a chart or table\") with Explain, Summarize and Extract suggested.",
            "Open full view: the conversation in a resizable window for long answers.",
            "First-run AI setup in the AI tab: pick free Gemini or private Ollama, test it, then try a capture.",
            "Settings → AI → Temperature, and Settings → Appearance → Settings window (System, Light or Dark).",
        ]),
        ReleaseNote(version: "1.15.1", date: "3 October 2026", headline: "Match day, cricket and games", items: [
            "Sports: match alerts (30 minutes before kick-off, plus a flash in the notch on goals and at full time), a league table next to the fixtures, and match details with goalscorers, cards and lineups.",
            "Cricket: India's internationals and the IPL. National teams: the World Cup, qualifiers, Nations League, Euro, Copa América, Asian Cup and friendlies.",
            "If ESPN is down or changes, Sports says it's unavailable instead of showing an empty tab.",
            "Notch Games: 2048, Snake and a reaction test for short breaks (Settings → Modules).",
            "Fixed: an old \"Update available\" notification could stay around after you'd updated.",
        ]),
        ReleaseNote(version: "1.15.0", date: "3 October 2026", headline: "See it, capture it, understand it", items: [
            "Capture anything with ⌃⌥S: drag a box on the display under the pointer (Retina-sharp), take the whole display, or every display.",
            "Paste or drop an image or PDF onto the AI tab, or use the text you copied or selected.",
            "One-click modes: Solve, Explain, Explain simply, Answer only, Hint, Summarize, Translate, Extract text, Rewrite, Code and Ask, with suggestions from a quick on-device look at what you captured.",
            "Answers stream in. Stop keeps what's written, Retry asks again (with a new provider if you switched), Edit resends your question, and follow-ups remember the image.",
            "Readable math instead of raw LaTeX, plus code blocks with Copy and real tables.",
            "History keeps the image, mode and model, with search, reopen-and-continue, export, and a retention setting. It all stays on this Mac.",
            "Settings → AI: Test connection, an images/text-only badge, a Privacy summary and capture defaults. Retired models switch to a current one automatically.",
            "F1: pick a favourite team as well as a driver.",
        ]),
        ReleaseNote(version: "1.14.6", date: "2 October 2026", headline: "Sports", items: [
            "Follow your team (Barcelona by default): next match with a countdown, every competition, recent results and the live score beside the notch.",
            "Fixtures and scores for the big football leagues, the NBA, NFL, MLB and NHL.",
        ]),
        ReleaseNote(version: "1.14.5", date: "2 October 2026", headline: "F1 in the notch", items: [
            "The live running order during every session, then the full classification with gaps, tyres and lap times.",
            "The weekend schedule with a countdown, driver and team standings, and a followed driver beside the notch.",
        ]),
        ReleaseNote(version: "1.14.4", date: "1 October 2026", headline: "Updates that install", items: [
            "The Update button downloads, checks and installs the new version, then relaunches.",
        ]),
        ReleaseNote(version: "1.14.2", date: "1 October 2026", headline: "Get Pro", items: [
            "A product key for $1 in Litecoin (or $2 to cover fees and support the developer), or free with a promo code. Older access codes keep working.",
        ]),
        ReleaseNote(version: "1.14.1", date: "30 September 2026", headline: "Now Playing like the iPhone", items: [
            "Anything playing on your Mac with album art beside the notch and bars that move with the song; Charging with time to full.",
            "Sign in with Google to bring your setup and Pro to any Mac; iCloud sync and backup files.",
        ]),
        ReleaseNote(version: "1.14.0", date: "30 September 2026", headline: "22 new features", items: [
            "Timer, Snippets, Shortcuts, Devices, Live scores, Alerts, Plugins, Voice Notes, Screen Time and Quick Add.",
        ]),
    ]

    static var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    static var seenVersion: String {
        get { UserDefaults.standard.string(forKey: "whatsNew.seenVersion") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "whatsNew.seenVersion") }
    }

    /// True once after updating to a version that has notes.
    static var hasUnseen: Bool {
        !seenVersion.isEmpty && seenVersion != currentVersion && releases.contains { $0.version == currentVersion }
    }

    /// First launch ever: nothing to announce, just remember the version.
    static func noteLaunch() {
        if seenVersion.isEmpty { seenVersion = currentVersion; markOffered() }
    }

    // MARK: Offers after an update

    /// Optional things introduced in a release, offered once after updating. Only free, safe-to-try settings.
    static let offers: [(version: String, items: [NewFeatureOffer])] = [
        ("2.0.27", [
            NewFeatureOffer(id: "weeklyupdates", title: "Update at most once a week", detail: "Instead of hearing about every release, get one update prompt a week. Required security updates still appear straight away. You can change this in Settings → Notch or Updates.", key: "updates.weekly"),
        ]),
        ("1.31.0", [
            NewFeatureOffer(id: "devtools", title: "Dev Tools tab", detail: "JSON, Base64, JWT, hashes, timestamps, regex and a QR code maker, right in the notch.", key: Module.devTools.storageKey),
            NewFeatureOffer(id: "wellbeing", title: "Wellbeing tab", detail: "Breathing, break reminders and a bedtime nudge.", key: Module.wellbeing.storageKey),
            NewFeatureOffer(id: "claudeflash", title: "Flash the screen when Claude Code needs you", detail: "A brief whole-screen colour flash along with the status dot.", key: "claudeCode.screenFlash"),
        ]),
        ("1.32.1", [
            NewFeatureOffer(id: "blackout", title: "⌥A blacks out the screen", detail: "Press Option+A to take the screen and keyboard brightness to zero and again to bring it back. The key stops typing å while this is on.", key: "ui.brightnessBlackout", defaultOn: true),
        ]),
    ]

    private static var offeredVersion: String {
        get { UserDefaults.standard.string(forKey: "whatsNew.offeredVersion") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "whatsNew.offeredVersion") }
    }

    /// Offers newer than the last time the person was asked, up to this version.
    static func pendingOffers() -> [NewFeatureOffer] {
        let last = offeredVersion
        return offers.filter { VersionMath.isNewer($0.version, than: last.isEmpty ? "0" : last) && !VersionMath.isNewer($0.version, than: currentVersion) }
            .flatMap(\.items)
    }

    static func markOffered() { offeredVersion = currentVersion }

    static func markSeen() { seenVersion = currentVersion }
}
