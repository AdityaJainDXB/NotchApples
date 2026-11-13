# Handoff (updated 13 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`) before relying on them.

## 2.2.70 is released (updated 13 November 2026)

Mac **2.2.70** (`v2.2.70`) is the Latest release and **Windows 2.2.70** (`win-v2.2.70`) is a pre-release with its `.exe` and `.msi`; both were published from the signing Mac, and the website's `latest.json` says 2.2.70. It contains the rest of the NotchAI roadmap: more voice engines (Piper, Whisper, OpenAI), hands-free and an optional wake word, drawing on the screen and a hand-drawn style, diagrams and real 3D files, folders and search in Documents, one-press connectors (Notion, Linear, Sentry, GitHub), drafting from the screen, and a NotchAI chat tab on Windows. Details, and what was and was not verified: `docs/NOTCHAI_ROADMAP.md` (backlog and living status).

- Checked before release: 648 Mac logic tests, 553 Windows tests, a whole-app type-check and the Release compile in CI (passed). **Not run on a real device:** anything with a microphone, speaker, screen capture, browser sign-in or a Windows PC. The wake word is labelled experimental for that reason.
- Mac builds must come from the Mac that holds `~/Library/Keychains/notchapple-signing.keychain-db` (fixed signing keeps Accessibility across updates). Never push a `mac-v*` tag from CI, and never run `scripts/setup-signing.sh` on another Mac.
- Still open from the roadmap: real-device verification (backlog 1) and the Do It check (backlog 2; the private branch `notchai-doit-bridge` is still not merged into the private `main`).

## Update 13 November (later): Xcode is installed, liquid metal started on Windows

- **Xcode 27.2 is installed and set up on the second Mac** (licence accepted, `xcode-select` points at it, first-launch components installed). The Debug app builds there: `xcodegen generate` (after `scripts/fetch-premium.sh` and a placeholder `NotchApple/Resources/GoogleService-Info.plist`), then `xcodebuild -project NotchApple.xcodeproj -scheme NotchApple -configuration Debug -destination 'platform=macOS' -derivedDataPath <dir> build CODE_SIGNING_ALLOWED=NO` gave BUILD SUCCEEDED on 2.2.70's source. That Mac still lacks the signing keychain, so it cannot make the official Mac release. The app has **not been launched** there yet (no real-device checks, see backlog 1 and 2 in `docs/NOTCHAI_ROADMAP.md`).
- **UTM:** that Mac has a Windows ARM VM (`Windows.utm`, 4 GB RAM, stopped). It is the place to look at the Windows app on a real Windows desktop.
- **Windows liquid metal: draft PR #82 (`liquid-metal-and-widgets`), not merged.** Settings has "Liquid metal (experimental)", off by default: metal on the open tab and a metal rim while the pointer is on the notch (Jakub Antalik's metal-fx, MIT, bundled in `NotchWindows/src/js/vendor/metalfx.js`; glue in `liquidmetal.js`). In a browser preview the metal draws and the rim fades in, but the active-tab highlight looked wrong, so it must be looked at on a real Windows PC (the UTM VM) before merging. Mac liquid metal is not started (needs a Metal or SwiftUI shader port).
- Desktop widgets: not started; the three questions below are still open.

## Asked for by the owner, not started (design and an idea)

1. **Liquid metal for the notch.** The owner wants the real notch UI to use the liquid-metal look, and the notch to show liquid metal in the current theme's colour when the pointer hovers over it. Only browser prototypes exist; nothing is in the app. The prototypes are in this repo, open them in a browser:
   - `docs/prototypes/liquid-metal-notch.html`: the notch with liquid-metal buttons, a different metal on hover, and a theme-coloured metal rim when hovering over the notch. The owner approved this one ("really good").
   - `docs/prototypes/notch-orb-prototype.html`: the earlier orb prototype for searching and solving states.
   They are built from Jakub Antalik's MIT-licensed repos (github.com/Jakubantalik: `metal-fx` and the transitions.dev tokens). The effect is a WebGL shader, so the Mac app needs a port to Metal or a SwiftUI shader (it cannot be dropped in as is); Windows (Tauri) can use the web code directly. Keep the MIT notice with any code that is reused, respect Reduce Motion, and check CPU and battery use before turning it on for everyone.
2. **Idea: desktop widgets, Mac and Windows.** Let people put widgets on the desktop for the apps or tabs they choose, and one for the notch itself. Not designed. Questions to settle with the owner first: which tabs make sense as widgets, whether Mac uses WidgetKit (a widget extension, new for this project) or the app's own desktop-level windows, how Windows does it (Tauri windows pinned to the desktop), and which plan it belongs to.

## State right now

- **Mac 2.2.70** (`v2.2.70`) is the Latest release; **Windows 2.2.70** (`win-v2.2.70`) is a pre-release. `latest.json` on the website says 2.2.70 (checked 13 November). Run `scripts/prune-releases.sh` after each release.
- Why a website deploy had failed earlier: PR #73 (new homepage) replaced `web/index.html` with a design that lacks what the site tests check (download box that reads `latest.json`, cookie banner, Ask helper, nav). It was reverted on main (`fa4f0e28`); the new design is kept on branch `site-homepage-metal` and needs to pass `web/tests` before it can go back. The "Deploy website" workflow runs a ~18 minute browser-test gate; check `gh run list --workflow "Deploy website" --limit 3` after any site change.

## Done this session

- Merged: #79 (VPN claims off the site), #74 (one-time "What should stay on your screen?" choice), #77 (NotchAI follow-up chats). #73 was merged then reverted (see above). #64 and #71 are already in main (shipped in 2.2.63); #71 can be closed by hand.
- Releases: 2.2.67 (fixed signing so Accessibility survives updates), 2.2.68, 2.2.69 (Now Playing helper no longer left running after quit; NotchAI Screen buttons work when the switch is off).
- Site (pushed to main, live only after the deploy passes): buttons in the supplied style (indigo glossy primary, white secondary) on `web/index.html`, `web/pro.html` and `web/new`; the headline word that changes (AI, games, clipboard, live sports, a browser, Do It); paying with Whop now asks for an email on our page first.

## Not done / needs a human

1. **The Whop site (`notchapples.whop.site`) must be kept an exact copy of the GitHub site (owner's standing rule: "always update the WHOP site").** Done on 13 Nov 2026 (build `apbu_Nz4KDH0AUMBgE`, in production): it matches `web/` at 2.2.70. Redo it after every site change. The Whop MCP connector cannot publish it; the **`whop` CLI** can (it is installed and signed in; use the `whop` skill). The site is app `app_OiQobGSrhkPBge`, a TanStack Start project serving the pages as raw HTML. Recipe: `whop apps pull --app app_OiQobGSrhkPBge` into an empty folder that is not inside a git repo; copy `web/{index,pro,support,community}.html` into `src/pages/` and `web/{index,terms,thanks,cookie-policy,legacy,admin,passkey}.html`, `robots.txt`, `sitemap.xml`, `llms.txt`, `api.json`, `feedback-summary.json` and the live `latest.json` into `public/`; copy `web/assets/` to `public/notch-assets/`. Every page gets two rewrites: `https://adityajaindxb.github.io/NotchApples/` becomes `https://notchapples.whop.site/`, and relative `assets/` becomes `/notch-assets/` (checked: this reproduces the existing support and community pages byte for byte). Leave out `web/new/` (the liquid-metal page) and the tests. Then `npm install`, and because `whop apps deploy` calls `bun` (not installed) put a one-line `bun` shim that runs `npm "$@"` on PATH, run `whop apps deploy --preview`, then `whop apps builds promote <build id>`. To roll back, promote the previous build (`apbu_hS9lIUzHkG8uL` is the one before this). A preview has no URL, so check the live site after promoting.
2. **Accessibility:** the owner must remove and re-add Notch Apple in System Settings → Privacy & Security → Accessibility once (security setting; an agent must not change it). After that it should survive updates because the app is signed with a fixed certificate (`scripts/setup-signing.sh`).
3. **Screen Recording** must also be allowed for NotchAI Screen awareness, then Notch Apple restarted. The 2.2.69 Screen-button change has **not** been run on a real screen.
4. **Memory/CPU report:** the owner said the app overloaded memory and they quit it. At idle it measured about 0.1% CPU and 80–120 MB; the cause was not reproduced. Ask which tab was open, then profile that (`sample`, `vmmap -summary`).
5. **Issue #65** (revoked Ultimate key): the owner said they will handle it.
6. **Refund wording:** the owner says there is a no-refund policy, but `web/terms.html` says "handled case by case". Ask which to keep.
7. The NotchAI roadmap items that were not built (voice engines and hands-free, drawing and real 3D models, NotchAI chat on Windows, the parity re-audit) are built in 2.2.70: see the section at the top. Most NotchAI features are only unit-tested, not run on a real mic, speaker or screen.

## Rules to keep

- Never delete the newest Mac (`v*`) or newest Windows (`win-v*`) release; use `scripts/prune-releases.sh`, never `gh release delete`. Mac and Windows share one version number (`docs/VERSIONING.md`).
- Every release: `release-notes/X.md` and `release-notes/win-X.md`, `NotchApple/Core/WhatsNew.swift`, top of `CHANGELOG.md`, README "What's new" (latest three only), then `scripts/release.sh`, tag `win-vX` on the cask commit, mark the Windows release a pre-release, run the prune script, install the Mac build on the owner's Mac.
- NotchAI stays local-first and fails closed; do not touch licensing, Do It, Convert, Smart Home, Claude Usage or Purge without the owner's say-so; no helper app, localhost server or bridge.
- The auto-mode classifier may block merging PRs and posting comments; ask the owner to run `gh pr merge` rather than working around it.
- The Mac Release build needs the private `NotchApples-Premium` modules (`scripts/fetch-premium.sh`); do it in `~/Documents/Software Projects/NotchApples-release`, not in a plain worktree.
