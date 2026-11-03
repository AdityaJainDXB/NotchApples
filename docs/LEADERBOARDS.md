# Friends leaderboards

Optional, **off by default**, and the same on Mac and Windows. Friends share a 6-character **board code**; everyone who has it sees one top-20 table per game. There is no public list, no search and no account.

## What the player sees

Move the mouse over a supported game and a small 🏆 appears in the corner. It opens the **Friends leaderboard** panel:

1. **Share my scores with friends** switch (off). Next to it: exactly what is sent.
2. A display name (max 20 characters), then **Create a board** (makes a new code) or **Join** (type a friend's code).
3. **Share this code** copies the code. **Leave** stops sending.
4. A top-20 table for the game you pick (racing: a track; plane: a mode). Offline, the table shows "Can't reach the leaderboard" and the game is unaffected.

Supported: Racing (best lap per circuit), Tetris (score), Plane (Hoop Rush, Time Trial, Landing, Battle), Daily Word (streak). The service also accepts Daily Trivia streaks (`trivia`); the Trivia game only needs to call `NotchLeaderboard.button(...)` and `NotchLeaderboard.submit('trivia', streak)`.

## Privacy facts

- Nothing is sent until you switch sharing on **and** join a board. Opening the panel to look (after joining) only reads the table.
- A score send contains: the **game**, the **score**, the **display name you typed**, a **SHA-256 hash of the board code** (the service never sees the code), and a **random id** made on your device (kept in the app's local storage, not linked to you or your computer).
- The service stores per entry: the game, score, name, the day, and a hash of the random id. No IP addresses are stored or logged; they are used in memory, as a daily hash, only to rate-limit (the same counter Friends uses).
- Anyone who has the board code can see the names and scores on it. Pick a name you are happy to share.
- Scores older than **90 days** are dropped. **Leave** the board and clear the app's local data to forget the random id.
- **Scores are honour-system, not anti-cheat.** The service only rejects impossible values (below). A friend with the code can still post a high score.

## Service (in `server/room-relay`, `src/scores.js`)

Same Worker as the rooms and Friends mailboxes; one SQLite Durable Object (`Board`) per board-code hash. CORS is open (`*`) because the apps call it from web views.

| Request | Body / query | Answer |
|---|---|---|
| `POST /s/score` | `{ game, board, name, score, id }` | `{ ok, rank, changed }` (a device keeps its best; a new name always applies) |
| `GET /s/top?board=<64 hex>&game=<game>` | | `{ top: [{ name, score, at }] }`, best 20 |

Limits: body 1 KB; name cleaned to at most 20 characters (no control or markup characters); 100 entries per game and 600 per board (a full game only admits a better score); 30 posts per hour and 120 reads per minute per address; errors are `{ error }` with 400, 404, 409, 413 or 429.

Games and the range accepted (anything outside is rejected):

| `game` | Better | Accepted |
|---|---|---|
| `racing:<track id>` | lower | best lap 5 s to 15 min, in milliseconds |
| `tetris` | higher | 1 to 5,000,000 |
| `plane:hoops` | higher | 1 to 500 hoops |
| `plane:trial` | lower | 5 s to 15 min, in milliseconds |
| `plane:landing` | higher | 1 to 1,000 |
| `plane:war` | higher | 1 to 500,000 |
| `wordle`, `trivia` | higher | streak of 1 to 3,650 days |

## Client

`NotchWindows/src/js/games/leaderboard.js` (`window.NotchLeaderboard`) is shared by both apps. Each game adds one `button(...)` call and one `submit(game, score)` call; `submit` does nothing unless the player opted in and joined a board. Mac loads it from the game's HTML page (a bundled resource); Windows loads it before the game script. The Windows content-security policy allows the service host in `tauri.conf.json`.

## Deploying (owner only)

See the pull request: `wrangler deploy` in `server/room-relay` applies migration `v3` (the `Board` class). No secrets and no new bindings besides `BOARD`; rate limiting reuses the existing `FRIEND_RATE` counter. Tests: `node server/room-relay/test/scores.test.mjs` and `node --test NotchWindows/tests/leaderboard.test.mjs`.
