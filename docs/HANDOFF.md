# Handoff (12 November 2026)

For the next agent (or person) picking this up. Read `CLAUDE.md` first: its release, README and safety rules apply. Facts below were true when written; check them (`gh release list`, `gh run list`) before relying on them.

## TODO for a person with normal internet: put the GitHub Pages site on Whop (13 November 2026)

The owner wants `https://notchapples.whop.site` to be a full, **independent copy** of the GitHub Pages site (the `web/` folder): same pages and look, **no redirect** to GitHub Pages. The Whop app is **Notch Apple, `app_OiQobGSrhkPBge`**, business **`biz_YKoevU4ePr9Osl`** (title "Notch"). The owner's network blocks `registry.npmjs.org` (TLS certificate errors), so the agent could not finish. Do these steps on a network where `npm view @tanstack/cli version` works. Nothing here needs a secret in a file: log in through the browser.

What is already known:
- The live Whop site was uploaded with **no source**, so `whop apps pull` says `APP_HAS_NO_SOURCE`, and `whop apps init --app app_OiQobGSrhkPBge` refuses (`APP_ALREADY_DEPLOYED`, it already has builds). Do not "fix" that with `--force` tricks; use the steps below.
- Whop sites must be a **Vite** project using the `whop()` plugin from `@whop/cli/vite` (otherwise `NO_BUILD_ARCHIVE`). Never hand-write `whop.app.json`, `package.json` or the vite config; let the CLI scaffold them.
- A stray, empty, temporary app was registered by mistake: **`app_D1wWODuQoGzwy2`** ("Notch Apple scaffold tmp", address `notchapple-scaffold-tmp.whop.site`). Reuse it for the scaffold (step 3), then delete it (step 7).

### Steps

1. **Install the Whop CLI** (skip if `whop --version` works). macOS or Linux: `curl -fsSL https://whop.com/install.sh -o install.sh`, read it, then `sh install.sh`. If `whop` is not found, run `export PATH="$HOME/.local/bin:$PATH"`. Windows PowerShell: `irm https://github.com/whopio/whop-public-cli/releases/latest/download/install.ps1 | iex`, then `$env:PATH = "$HOME\.local\bin;$env:PATH"`. If already installed, run `whop upgrade`.
2. **Sign in to the right business.** `whop auth status`; if not logged in: `whop login --method oauth --account-id biz_YKoevU4ePr9Osl` (it opens a browser; approve it and keep the tab open until it says "Logged in to Whop"). If it is a different business: `whop auth account biz_YKoevU4ePr9Osl`. The owner must be the one who approves the sign-in (or share their screen).
3. **Scaffold a Vite project.** `whop skills add`, then `whop apps init --app app_D1wWODuQoGzwy2 --dir scaffold`. If npm fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, you are still on a restricted or intercepting network (VPN, school or work filter): switch networks, do not turn off TLS checking.
4. **Copy the site in.** In the scaffold, replace the starter pages with the contents of `web/` from this repo, served as plain static files, so every URL on GitHub Pages (`/`, `/pro.html`, `/terms.html`, `/support.html`, `/community.html`, `/thanks.html`, `/cookie-policy.html`, `/legacy.html`, `/passkey.html`, `/admin.html`, `/new/`, `/assets/...`, `/api.json`, `/latest.json`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`) exists with the same name on Whop. Easiest way: put everything from `web/` (except `node_modules/`, `test-results/`, `tests/`, `package*.json`, `playwright.config.ts`, `PRODUCT.md`, `README.md`) into the scaffold's `public/` folder so Vite copies it unchanged, and make `/` serve `index.html`. Keep `index.html` working at the root. Run `whop apps dev` and click through every page; the receipt demo, download box and admin link must behave as on GitHub Pages.
5. **Link and deploy to the real app.** From the scaffold: `whop apps deploy --app app_OiQobGSrhkPBge --preview` first, open the preview and compare it with https://adityajaindxb.github.io/NotchApples/ page by page. When it matches: `whop apps builds promote abld_xxx` (the id the preview printed), or simply `whop apps deploy --app app_OiQobGSrhkPBge`. This **replaces** the current live Whop site, which is what the owner asked for.
6. **Check it.** Open `https://notchapples.whop.site` (`whop apps get app_OiQobGSrhkPBge` shows `base_url` and the domain status). Confirm: no redirect to github.io, download links go to the GitHub releases, `/api.json` and `/latest.json` answer, and the site is still correct on a phone. If the output lists `domain_steps`, show them to the owner.
7. **Clean up.** Delete the temporary app `app_D1wWODuQoGzwy2` (`whop apps --help` shows the delete command; confirm with the owner first). Keep the scaffold in a private place or commit it to the **private** repo, not here, and do not commit `.whop`, tokens or API keys.
8. **Keep them in step from now on.** Whenever `web/` changes, copy it into the scaffold's `public/` and run `whop apps deploy` again. Tell the owner, since the two copies drift otherwise. Do not add a redirect.

Things not to do: do not run `whop apps init --name ...` again (it registers yet another app), do not use `--skip_typecheck` or disable TLS verification to get past errors, and do not paste the sign-in URL anywhere (it is long and single use).

## Added later on 12 November: 2.2.70 is on `main` but NOT released yet (read this first)

A second session (on a Mac with no Xcode and without the signing keychain) built the rest of the NotchAI roadmap and prepared **2.2.70**: more voice engines (Piper, Whisper, OpenAI), hands-free and an optional wake word, drawing on the screen and a hand-drawn style, diagrams and real 3D files, folders and search in Documents, one-press connectors (Notion, Linear, Sentry, GitHub), drafting from the screen, and a NotchAI chat tab on Windows. Notes are in `release-notes/2.2.70.md` and `release-notes/win-2.2.70.md`; `project.yml`, `WhatsNew.swift`, `CHANGELOG.md` and the README already say 2.2.70. Details and what was and was not verified: `docs/NOTCHAI_ROADMAP.md` (backlog and living status).

- **Nothing of 2.2.70 is released yet, Mac or Windows.** It is merged into `main` only.
- **To do, Windows:** once the Mac release below is out (or before, they are independent), tag the cask commit or `main`: `git tag win-v2.2.70 && git push origin win-v2.2.70`, wait for "Windows build", then `gh release edit win-v2.2.70 --prerelease --title "Notch Apple for Windows 2.2.70 (beta)" --notes-file release-notes/win-2.2.70.md`.
- **To do first:** confirm the Release compile passed: `gh run list --workflow module-build.yml --limit 1` (run 43278669697 on `module-rel-2.2.70` was still building when this was merged, at the owner's request). If it failed, fix the compile error before releasing.
- **Cannot be done on the second session's Mac:** installing Xcode (needs the owner's Apple ID in the App Store) and the signing keychain (its private key exists only on the release Mac; running `scripts/setup-signing.sh` elsewhere makes a NEW identity and breaks Accessibility for everyone, so do not).
- **Mac 2.2.70 was deliberately not released.** A CI build (`mac-v*` tag) is signed ad-hoc, which would undo the fixed-certificate signing from 2.2.67 and make every Mac lose Accessibility again. It has to be built on the Mac that holds `~/Library/Keychains/notchapple-signing.keychain-db`. **Do not push a `mac-v2.2.70` tag.** On that Mac, in the release checkout: `git pull`, `scripts/fetch-premium.sh`, `scripts/run-app-tests.sh` (648 tests), then
  `scripts/release.sh "NotchAI: more voices, drawing, diagrams, and a Windows chat" release-notes/2.2.70.md "Mac 2.2.70"`.
  If something else has to ship first, bump the version and move the 2.2.70 notes up with it; never lower the number.
- Checked before merging: 648 Mac logic tests, 553 Windows tests and a whole-app type-check. The Release compile in CI had not finished (see above). **Not run on a real device:** anything with a microphone, speaker, screen capture, browser sign-in or a Windows PC. The wake word is labelled experimental for that reason.
- Still open from the roadmap: real-device verification (backlog 1) and the Do It check (backlog 2; the private branch `notchai-doit-bridge` is still not merged into the private `main`).

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
