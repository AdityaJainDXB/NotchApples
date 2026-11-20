# Handoff (updated 19 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`, `gh pr list`) before relying on them. Things that are already pushed and finished are not listed here; they are in the Releases page, `CHANGELOG.md` and git history.

## 2.2.81 is RELEASED on Mac and Windows (19 November 2026)

- **What it is:** only the hello-animation fix (issue #131: the lettering was re-worked out every frame; it is now parsed once and drawn as one GPU layer). Windows has no code change; it moves to 2.2.81 to stay in step.
- **Mac `v2.2.81`:** built by the "Mac build" workflow (run 44462118591, started by hand from `main` after PR #132), published with `NotchApple-2.2.81.dmg` and its `.sig`; the cask commit is `75f8e6f6`.
- **Windows `win-v2.2.81`:** tag on that cask commit, built by the "Windows build" run 44463952770, marked a pre-release; the rolling `windows-latest` assets were refreshed by CI at the same time.
- **Pruned:** `scripts/prune-releases.sh` deleted v2.2.63 and win-v2.2.67 (the tags stay). The newest Mac and Windows releases and `windows-latest` are all still there.
- **Hello animation timed (19 Nov, Debug build, one run each, Instruments "Animation Hitches", test copy with its own bundle id):** 2.2.80 code: 260 frames in the 5.75 s hello (about 45 fps), 28 gaps over 20 ms, a stall of about 0.8 s. 2.2.81 code: 333 frames (about 58 fps), 10 gaps over 20 ms, worst one 158 ms (the first frame, when the window opens), nothing else over 50 ms. The Settings button "Play it now" could not be clicked in the test copy, so the launch-time hello (same `HelloView`) was timed instead. The owner then watched the hello on their Mac (20 November 2026) and said it is not glitchy any more (they did not say which build they ran).
- **Issue #131 is CLOSED and stays closed.** It closed itself 3 seconds after PR #132 merged ("Fixes #131"), before the owner had confirmed; the owner confirmed the fix on 20 November 2026 and chose to leave it closed.
- **Open: Mac 2.2.81 is NOT installed on the owner's Mac (still 2.2.80).** The CI build is ad-hoc signed, but the installed app is signed "Notch Apple Self-Signed", so installing the CI DMG over it would reset the Accessibility and Screen Recording permissions (see "Not done / needs a human", item 2). This Mac has no Self-Signed identity either. Either the owner re-grants after installing, or the next release is built on the signing Mac with `scripts/release.sh`.
- **Open: the website still showed 2.2.80 for both platforms** right after the release (the "Deploy website" run was still going). Check `https://adityajaindxb.github.io/NotchApples/latest.json` says 2.2.81, and redo the Whop site copy (the owner's standing rule: the Whop site must match).

## Waiting on the license server deploy (checked 19 November 2026)

The live worker answers `POST /humanizer/redeem` (400 on a malformed code), so the Humanizer top-up code from 2.2.77 looks deployed. Not confirmed: that the Pro AI limit change (below) is live, and that the Whop webhook sends `payment.succeeded` and `refund.created` for the top-up product (`prod_z1MUAuGyOxU5H`, plan `plan_SUevPE2JR5KDc`). No top-up has been bought yet, so delivery of a WORD- code has never run for real.

**Owner reported (19 Nov): "I'm not receiving a code for my keys."** Not solved yet. Whop's recent payments (checked 19 Nov) show no top-up purchase; the newest paid order is a Notch Apple Pro (UAE) on 14 Nov. Find out which purchase, then check that its plan is in the worker's plan map and that the key email was sent.

## Added on 17 November: Notch Apple AI has no daily limit on Pro (server change, NOT deployed until someone runs `wrangler deploy`)

The owner asked to remove the daily message limit for the lowest paid tier. In `server/license-worker/src/worker.js` (`aiLimit`), Pro now has **no limit** (it only gets one if `AI_LIMIT_PRO` is a number above 0; `wrangler.toml` now says `AI_LIMIT_PRO = "0"`). **Ultimate still has 200 a day**, so Ultimate currently has a lower cap than Pro: ask the owner whether to remove it too (set `AI_LIMIT_ULTIMATE = "0"` there and make the same change for it). `/ai/status` reports `null` for "no limit". 77 server tests pass (one new). The website text (README, `docs/FEATURES.md`, `web/assets/faq.json`, `web/pro.html`, the Ask helper's `knowledge.js`) now says "no daily limit". **To do:** (1) deploy the worker from `server/license-worker` (`npx wrangler deploy`): until then the old 60 a day still applies, because the limit is enforced only on the server; (2) redo the Whop site copy (the `web/` pages changed); (3) the hosted AI uses the project's own provider key, so watch its cost now that Pro is unlimited (`docs/PROTECTING_PAID_FEATURES.md`).

## Racing: the F1 simulation (2.2.71, 14 November 2026)

All four phases of `PLAN.md` are built (`NotchWindows/src/js/games/f1/*.js`, glued into `racing.js`, opt-in via Menu → F1 Weekend, F1 car only). 660 node tests pass (`node --test NotchWindows/tests/*.test.mjs`); headless Chromium runs of a race, the Safety Car / Medical Car / VSC scenarios and the weekend hub were clean. **Not done:** real-device play on a Mac or Windows PC, a full 60-minute practice or 18-minute qualifying played through by hand (tested only up to starting the sessions), pit-lane starters after parc fermé breaks, and driving the Safety Car / Medical Car by hand in a browser (logic is unit-tested). Keys: U telemetry, I MFD, C race control messages, J (old) steering panel.

**F1 game sweep (15 Nov 2026):** the BATT gauge overlap and the "NaN kW" telemetry are fixed (PR #94, merged).

## Still open from 2.2.72 to 2.2.77 (everything else in those releases shipped)

- **ZeroGPT** in the AI Detector needs the owner's API key and docs; it must be opt-in (text leaves the device). The detector is local only.
- **Not seen on real hardware:** liquid metal and widgets on a Windows desktop; Music Wall moving with real sound on Windows (the CI machine has no sound device).
- **Humanizer words are per install:** a redeemed code does not follow a key to another computer.
- **Test copies:** never run a Debug copy with the real bundle id (`com.notchapple.app`) next to the installed app; it can overwrite secrets.json and the Friends vault.

## 2.2.78 and the Teleprompter (18 November 2026)

- **Mac 2.2.78 is released** (update-reminder fix, Voxel Wall renamed Music Wall). **Windows 2.2.78 was never published:** its build failed on a flaky worker test (fixed in `4f004ff8`) and the tag was not moved. The next release (2.2.79) carries the Windows side, so Windows goes 2.2.77 to 2.2.79.
- **Teleprompter (Tools, Mac and Windows) is built as a basic version:** type or paste a script, Start or Pause, speed 1 to 10 (60 to 240 words a minute), text size, mirror. Rules in `TeleprompterLogic.swift` and `teleprompterlogic.js`.
- **Later ideas for the Teleprompter (not built):** follow your voice so it scrolls as you speak; control it from the iPhone companion; a countdown before it starts; a pop-out window that stays on top of other apps; import a script from a file; keep several saved scripts; a speed ramp; keyboard keys for faster, slower, pause.
- **F1 game HUD redesign (released 18 Nov 2026 as Mac 2.2.80 and Windows 2.2.80):** the Racing HUD now has a broadcast-style tower (lap line, flag block, purple fastest-lap row), lap panel, top-centre banners, radio subtitles, sector-coloured minimap, finish card and a white-bar MFD selector, for every track and car. Study of the reference video, what was built and what was left out: `docs/F1_HUD_REDESIGN.md`. Logic in `NotchWindows/src/js/games/f1/hud.js`. Open: play it in the installed Mac app and on a real Windows PC (it was checked only in headless Chromium), and decide whether the tower should default to the gap to the leader.

## Not done / needs a human

1. **The Whop site (`notchapples.whop.site`) must be kept an exact copy of the GitHub site (owner's standing rule: "always update the WHOP site").** Done on 13 Nov 2026 (build `apbu_Nz4KDH0AUMBgE`, in production): it matches `web/` at 2.2.70. Redo it after every site change. The Whop MCP connector cannot publish it; the **`whop` CLI** can (it is installed and signed in; use the `whop` skill). The site is app `app_OiQobGSrhkPBge`, a TanStack Start project serving the pages as raw HTML. Recipe: `whop apps pull --app app_OiQobGSrhkPBge` into an empty folder that is not inside a git repo; copy `web/{index,pro,support,community}.html` into `src/pages/` and `web/{index,terms,thanks,cookie-policy,legacy,admin,passkey}.html`, `robots.txt`, `sitemap.xml`, `llms.txt`, `api.json`, `feedback-summary.json` and the live `latest.json` into `public/`; copy `web/assets/` to `public/notch-assets/`. Every page gets two rewrites: `https://adityajaindxb.github.io/NotchApples/` becomes `https://notchapples.whop.site/`, and relative `assets/` becomes `/notch-assets/` (checked: this reproduces the existing support and community pages byte for byte). Leave out `web/new/` (the liquid-metal page) and the tests. Then `npm install`, and because `whop apps deploy` calls `bun` (not installed) put a one-line `bun` shim that runs `npm "$@"` on PATH, run `whop apps deploy --preview`, then `whop apps builds promote <build id>`. To roll back, promote the previous build (`apbu_hS9lIUzHkG8uL` is the one before this). A preview has no URL, so check the live site after promoting.
2. **Accessibility:** the owner must remove and re-add Notch Apple in System Settings → Privacy & Security → Accessibility once (security setting; an agent must not change it). After that it should survive updates because the app is signed with a fixed certificate (`scripts/setup-signing.sh`).
3. **Screen Recording** must also be allowed for NotchAI Screen awareness, then Notch Apple restarted. The 2.2.69 Screen-button change has **not** been run on a real screen.
4. **Memory/CPU report:** the owner said the app overloaded memory and they quit it. At idle it measured about 0.1% CPU and 80–120 MB; the cause was not reproduced. Ask which tab was open, then profile that (`sample`, `vmmap -summary`).
5. **Issue #65** (revoked Ultimate key): the owner said they will handle it.
6. **Refund wording:** the owner says there is a no-refund policy, but `web/terms.html` says "handled case by case". Ask which to keep.
7. NotchAI: real-device verification (microphone, speaker, screen, sign-in, a Windows PC) and the Do It test (private branch `notchai-doit-bridge` is not merged) are still open; see `docs/NOTCHAI_ROADMAP.md`.

## Rules to keep

- Never delete the newest Mac (`v*`) or newest Windows (`win-v*`) release; use `scripts/prune-releases.sh`, never `gh release delete`. Mac and Windows share one version number (`docs/VERSIONING.md`).
- Every release: `release-notes/X.md` and `release-notes/win-X.md`, `NotchApple/Core/WhatsNew.swift`, top of `CHANGELOG.md`, README "What's new" (latest three only), then `scripts/release.sh`, tag `win-vX` on the cask commit, mark the Windows release a pre-release, run the prune script, install the Mac build on the owner's Mac.
- NotchAI stays local-first and fails closed; do not touch licensing, Do It, Convert, Smart Home, Claude Usage or Purge without the owner's say-so; no helper app, localhost server or bridge.
- The auto-mode classifier may block merging PRs and posting comments; ask the owner to run `gh pr merge` rather than working around it.
- The Mac Release build needs the private `NotchApples-Premium` modules (`scripts/fetch-premium.sh`); do it in `~/Documents/Software Projects/NotchApples-release`, not in a plain worktree.
