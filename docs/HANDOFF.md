# Handoff (updated 13 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`, `gh pr list`) before relying on them. Things that are already pushed and finished are not listed here; they are in the Releases page, `CHANGELOG.md` and git history.

## Open pull requests (draft, not merged, not released)

- **#85** Flight Economy opens with an Ultimate key without the code box (Mac and Windows).
- **#83** Desktop widgets (Ultimate), Mac and Windows: clock, to-do, Now Playing.
- **#84** Mac liquid metal, marked Recommended in Settings → Appearance (stacked on #83: merge #83 first).
- **#82** Windows liquid metal, marked Recommended in Settings.

None needs more code; each needs the owner's go-ahead to merge, and a look on a real desktop (Windows: the UTM VM on the owner's second Mac). Check the newest "Module test build" run for #84 first: `gh run list --workflow module-build.yml --branch mac-liquid-metal`. Mac builds need Xcode's Metal toolchain.

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
