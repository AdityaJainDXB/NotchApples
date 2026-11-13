# Handoff (12 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`) before relying on them.

## 2.2.70 is RELEASED (13 November 2026)

- **Mac 2.2.70** (`v2.2.70`) is the Latest release, built on the signing Mac with the fixed certificate (checked: the shipped app's requirement names the same certificate as 2.2.67), and installed on the owner's Mac. **Windows 2.2.70** (`win-v2.2.70`) is a pre-release with its `.exe` and `.msi`. `scripts/prune-releases.sh` has been run.
- What it contains: more NotchAI voice engines (Piper, Whisper, OpenAI), hands-free and an optional wake word (experimental), drawing on the screen and a hand-drawn style, diagrams and real 3D files, folders and search in Documents, and a NotchAI chat tab on Windows. Before releasing: 648 Mac logic tests, 0 failures; the Release compile in CI (`module-rel-2.2.70`) passed.
- **Do not push a `mac-v*` tag.** A CI build is signed ad-hoc, which would undo the fixed-certificate signing and make every Mac lose Accessibility again. Mac releases are built only on the Mac that holds `~/Library/Keychains/notchapple-signing.keychain-db`; never run `scripts/setup-signing.sh` anywhere else (it makes a NEW identity).
- **Not run on a real device:** anything with a microphone, speaker, screen capture, browser sign-in or a Windows PC. Real-device verification (NotchAI roadmap backlog 1) and the Do It check (backlog 2; the private branch `notchai-doit-bridge` is still not merged into the private `main`) are still open.
- The website deploy passed on 12 Nov and `latest.json` serves 2.2.69 at the time of writing; it moves to 2.2.70 after the next "Deploy website" run. Check `gh run list --workflow "Deploy website" --limit 1` and the live `latest.json`.

## Asked for by the owner, not started (design and an idea)

1. **Liquid metal for the notch.** The owner wants the real notch UI to use the liquid-metal look, and the notch to show liquid metal in the current theme's colour when the pointer hovers over it. Only browser prototypes exist; nothing is in the app. The prototypes are in this repo, open them in a browser:
   - `docs/prototypes/liquid-metal-notch.html`: the notch with liquid-metal buttons, a different metal on hover, and a theme-coloured metal rim when hovering over the notch. The owner approved this one ("really good").
   - `docs/prototypes/notch-orb-prototype.html`: the earlier orb prototype for searching and solving states.
   They are built from Jakub Antalik's MIT-licensed repos (github.com/Jakubantalik: `metal-fx` and the transitions.dev tokens). The effect is a WebGL shader, so the Mac app needs a port to Metal or a SwiftUI shader (it cannot be dropped in as is); Windows (Tauri) can use the web code directly. Keep the MIT notice with any code that is reused, respect Reduce Motion, and check CPU and battery use before turning it on for everyone.
2. **Idea: desktop widgets, Mac and Windows.** Let people put widgets on the desktop for the apps or tabs they choose, and one for the notch itself. Not designed. Questions to settle with the owner first: which tabs make sense as widgets, whether Mac uses WidgetKit (a widget extension, new for this project) or the app's own desktop-level windows, how Windows does it (Tauri windows pinned to the desktop), and which plan it belongs to.

## State right now

- **Mac 2.2.69** (`v2.2.69`) is the Latest release, installed on the owner's Mac. **Windows 2.2.69** (`win-v2.2.69`) is published as a pre-release with its `.exe` and `.msi`. `scripts/prune-releases.sh` has been run.
- **Website deploy (GitHub Pages) may still be running or may have failed.** The "Deploy website" workflow runs a ~18 minute browser-test gate before publishing. Until it passes, `https://adityajaindxb.github.io/NotchApples/latest.json` stays on 2.2.67, which means installed Macs are **not offered 2.2.68 or 2.2.69**. First thing to do: `gh run list --workflow "Deploy website" --limit 3`, then confirm `latest.json` says 2.2.69. If it failed, read the log with `gh run view <id> --log-failed`.
- Why the deploy had failed before: PR #73 (new homepage) replaced `web/index.html` with a design that lacks what the site tests check (download box that reads `latest.json`, cookie banner, Ask helper, nav). I reverted it on main (`fa4f0e28`). The new design is kept on branch `site-homepage-metal`; it needs to pass `web/tests` before it can go back.

## Done this session

- Merged: #79 (VPN claims off the site), #74 (one-time "What should stay on your screen?" choice), #77 (NotchAI follow-up chats). #73 was merged then reverted (see above). #64 and #71 are already in main (shipped in 2.2.63); #71 can be closed by hand.
- Releases: 2.2.67 (fixed signing so Accessibility survives updates), 2.2.68, 2.2.69 (Now Playing helper no longer left running after quit; NotchAI Screen buttons work when the switch is off).
- Site (pushed to main, live only after the deploy passes): buttons in the supplied style (indigo glossy primary, white secondary) on `web/index.html`, `web/pro.html` and `web/new`; the headline word that changes (AI, games, clipboard, live sports, a browser, Do It); paying with Whop now asks for an email on our page first.

## Not done / needs a human

1. **The Whop site (`notchapples.whop.site`) is not updated.** The Whop connector cannot publish it (the account has no apps; the connector edits product listings only). The owner wants it to be an exact copy of the GitHub site. Upload the contents of `web/` (minus `tests/`, `node_modules/`, `admin.html`, `new/`, dev files). Re-upload after the deploy passes so its `latest.json` is current. Ask the owner how the Whop site was first set up.
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
