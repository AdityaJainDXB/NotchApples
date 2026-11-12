# Handoff (12 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`) before relying on them.

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
7. Not built from the NotchAI roadmap (`docs/NOTCHAI_ROADMAP.md`): voice engines and hands-free, drawing and real 3D models, NotchAI on Windows, final parity audit. Most NotchAI features are only unit-tested, not run on a real mic, speaker or screen.

## Rules to keep

- Never delete the newest Mac (`v*`) or newest Windows (`win-v*`) release; use `scripts/prune-releases.sh`, never `gh release delete`. Mac and Windows share one version number (`docs/VERSIONING.md`).
- Every release: `release-notes/X.md` and `release-notes/win-X.md`, `NotchApple/Core/WhatsNew.swift`, top of `CHANGELOG.md`, README "What's new" (latest three only), then `scripts/release.sh`, tag `win-vX` on the cask commit, mark the Windows release a pre-release, run the prune script, install the Mac build on the owner's Mac.
- NotchAI stays local-first and fails closed; do not touch licensing, Do It, Convert, Smart Home, Claude Usage or Purge without the owner's say-so; no helper app, localhost server or bridge.
- The auto-mode classifier may block merging PRs and posting comments; ask the owner to run `gh pr merge` rather than working around it.
- The Mac Release build needs the private `NotchApples-Premium` modules (`scripts/fetch-premium.sh`); do it in `~/Documents/Software Projects/NotchApples-release`, not in a plain worktree.
