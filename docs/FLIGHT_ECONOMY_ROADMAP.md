# Flight Economy roadmap

Flight Economy is the private airline tycoon game. It is not in the app or this repository: the game page lives in the license worker
(`server/license-worker/private/flight-economy.js`, git-ignored, bundled into the Worker) and is sent to a device after it accepts an
access code (`/game/unlock`) or an Ultimate or admin key (`/game/ultimate`). Mac: `NotchApple/Modules/Games/PrivateGame.swift`.
Windows: `NotchWindows/src/js/services/privategame.js`. Access rules: `docs/PROTECTING_PAID_FEATURES.md`.

Status words: **done**, **built, not deployed**, **next**, **idea**.

## Difficulty and realism

- **Built, not deployed (18 Nov 2026):** slightly harder. Fuel +7.5% (`ECON.fuel` 2.0 to 2.15), crew cost +3%, airport and landing fees +10%
  (`ECON.fee` 1.5 to 1.65), airframe wear +20% per flight hour (0.35 to 0.42), unscheduled failures start at 30% condition and are
  likelier (8% a flight, was 6% under 25%).
- **Next:** make the model follow real flying more closely, one change at a time and each small:
  - fuel price that moves with a slow market cycle and a hedge that costs something,
  - weather and seasons that change demand (summer leisure, winter de-icing and delays),
  - crew duty limits and rest, so one plane cannot fly all day,
  - slot limits at busy airports (peak hours, night curfews),
  - ageing aircraft: cheaper to buy used, dearer to keep safe, scheduled heavy checks,
  - route maturity: a new route fills slowly, a neglected one loses its passengers.
- **Idea:** difficulty setting at the start of a new game (Relaxed, Realistic, Hard) so the harder rules do not surprise players with an old save.

## Admin cheats (key J)

- **Built, not deployed:** an admin key opens the game and gets a cheat panel on J (+$1M, +$100M, reputation 100%, repair every aircraft,
  minimum fuel price, clear crises). The server adds the script only for an admin key, so nobody else receives it
  (`FLIGHT_ECONOMY_ADMIN`, `private/flight-economy-admin.js`). A test checks that an Ultimate key never gets it.
- **Idea:** more cheats (set the date, unlock every aircraft type, free route slots), and a note in the panel that cheated games do not count.
- **Rule:** a game saved with cheats must never reach a leaderboard, if one is ever added.

## Delivery and upkeep

- **To do:** run `npx wrangler deploy` in `server/license-worker` on a network where npm works. If the admin page ever uploaded a game file
  (KV `gamefile:flight-economy`), that overrides the bundled one, so re-upload or clear it, or the changes will not show.
- **To do:** the game source is only a generated string, there is no `flight-economy.html` in any repository. Keep the readable HTML in the
  private repository (`AdityaJainDXB/NotchApples-Premium`) so it can be edited and diffed.
- **Idea:** show the game's version in the Games card, and tell the player when a new version downloaded.

## Not verified

The difficulty and cheat changes were syntax-checked and the worker tests pass (78), but nobody has played the changed game on a Mac or
a Windows PC yet. Play a few in-game weeks before promoting it.
