# Status audit (6 October 2026)

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
