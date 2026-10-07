# Status audit (6 October 2026, updated 7 October)

What is built, what is not, checked against the code at Mac 1.30.3 and Windows 1.26.5 BETA. Evidence is the repo, not the README (the README was out of date: it still described the 1.14-era Windows app and its release notes stopped at 1.24.0).

## The three headline jobs

| Job | Status | Evidence |
| --- | --- | --- |
| **1. Windows as a 1:1 remake of the Mac app** | **Partly done.** Shell, tab bar, line icons, Settings sidebar, open/close animation and first-run chooser match the Mac. Most tab *contents* still use the old layout. | Today, Timer (and others) differ from the Mac screenshots; Windows lacks Claude Code dot, Cookie Clicker, Runner/Breakout/Memory, notification peek, volume/brightness gauge, low-battery warning |
| **2. Admin panel for keys** | **Done and live.** `/admin` on the license server: generate (batch of up to 50), list and search, suspend and unsuspend, reissue, email a key, notes, device slots, promo codes. Sign-in is the single `ADMIN_TOKEN` (extra personal codes only if set). 10 wrong tries lock an address for an hour. | `server/license-worker`, 22 server tests |
| **3. Remove releases that have no key system** | **Done.** Every Mac release before 1.16.0 and every Windows release before win-v1.24.0 is deleted. All 36 remaining releases are 1.16.0+ (Mac) or win-v1.24.0+ (Windows). | `gh release list` |

Note: git tags and the source history still contain the old code. Only release downloads were removed.

## Your pasted ideas

| Idea | Status |
| --- | --- |
| Customizable hide/show hotkey (Windows) | Done (Settings → Shortcuts) |
| Claude Code status dot (green 4 s, yellow 4 s) | **Mac done (1.30.0). Windows not done.** |
| Bring-your-own VPN (Mac), simple VPN page, no "VPN off" chip next to Settings | Done on Mac (1.30.0 and 1.30.3). Windows keeps its own VPN tab |
| Share page: AirDrop drag fix, pin button, text and code sending | Mac done (1.30.0) |
| Live sports merged into Sports; Live tab becomes "Parcels & Flights" with a "not recommended" note | Mac done (1.30.0). **Windows: not done** (label missing) |
| Cookie Clicker and another game | Mac done (Cookie Clicker, Runner, Breakout, Memory). **Windows: not done** (2048, Snake, Reaction only) |
| Lid Fold for unsupported Macs | Done on Mac (1.29.0, off by default, with Acknowledgements) |

## The 52-item plan

Done on both platforms unless noted. ✗ means not built.

- **Free tier 1–16:** all built on Mac. On Windows missing: **#6 low-battery pulse, #7 volume/brightness gauge, #10 Claude Code dot, #11 Cookie Clicker, #12 second mini-game (Windows has Snake, which the plan did not name, so counted), #14 notification peek.** #16 Do Not Disturb has no public Windows switch (the app opens the Windows setting).
- **Pro 17–36:** built on Mac. Windows missing only **#36 the "not recommended" label** and #22 (Mac-only by design).
- **Ultimate 37–52:** built except:
  - **#38 detailed Claude usage tracker (tokens, limits): not built on either platform.**
  - **#42 cross-device clipboard: not built.**
  - **#45 Smart Home: not built** (HomeKit is not available to a non-sandboxed Mac app without Apple's entitlement; Home Assistant and Hue are possible).
  - #46 Lid Fold is Mac only.

## Mac features Windows still lacks (from `NotchWindows/src/js/features.js` and the code)

Cannot exist on Windows (Apple-only): iCloud notes, Apple Reminders and Things, iPhone companion, Purge, trackpad gestures, screen ruler overlay, per-display notch tabs, Do Not Disturb switch.

Can exist, not built yet: Claude Code dot, the four Mac games, notification peek, volume and brightness gauge, low-battery warning, parcels label, hot corners.

## README

Stale: "locked until you enter an access code", the 1.14-era Windows tab table, "What's new" ending at 1.24.0, and the "doesn't carry over" table. To be rewritten with this release.

## Update, 7 October 2026 (built on `main`, not yet released)

Built since the audit above. Nothing here is released, and the license server changes are **not deployed**.

- **Windows now has:** the Claude Code dot, Cookie Clicker plus Runner, Breakout and Memory, the low-battery and disk warnings, internet drop notice, speed test, secret protection on the clipboard, panic hide, Claude usage tracker, Smart Home (Home Assistant), clipboard link between devices, dev tools, wellbeing (breathe, reminders, habits), snippet variables, quick answers, text size and skins, repeating to-dos, a "3 due" badge on the pill, and stay-awake presets.
- **Mac now has:** the same Claude usage tracker, Smart Home, clipboard link, dev tools, wellbeing and habits, panic hide, quick answers, snippet variables, accessible colour themes, and a light/dark switch for macOS.
- **Admin panel:** keys made per day (30 days) and by source, an activity log of every change (no emails, no full keys), and device names. The apps send only a generic label ("Mac (macOS 26.0)", "Windows PC"), never the computer's own name. Needs a deploy of `server/license-worker` to go live.
- **Built later the same day:** pinned notes on Today (#19), emoji and symbol search in the command palette (#32), named timers (#37, Pro), focus time by project (#46, Pro), meeting notes from a calendar event (#47, Pro), a Links page in the Shelf (#48), and full-screen lyrics (#50, Pro: a full-screen window on the Mac; on Windows the lyrics fill the notch because a real full-screen window needs native code that can't be tested here).
- **Built after that (Windows, off by default, not yet released):** a brightness gauge (laptop screens, read through the display driver) and an experimental notification peek (reads Windows' own notification list, read-only). The Rust compiles and its 7 new unit tests pass on a Windows runner, but neither has been tried on a real PC: that needs a laptop for brightness and a real notification list for the peek, and the peek relies on an undocumented Windows file that may differ between versions.
- **Still not built:** nothing from the top 50.
- **Impossible or skipped:** mirroring iPhone notifications and step counts (no public API); a dollar-cost estimate for Claude usage (prices not verified).
