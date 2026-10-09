# Feature tiers (draft for approval)

**Status: approved 4 October 2026. Built in 1.16.0 (`Feature` in NotchApple/Core/LicenseKey.swift).** Edit the *Proposed* column, or tell me which features to move, and this becomes the source of truth for the `Entitlements` layer.

## How to read the table

- **Spec** is the tier from the super prompt.
- **Today** is what 1.15.3 actually does, from a scan of the code:
  - Free: exists and works without a key.
  - Pro: exists and needs a key today.
  - Partial: some of it exists.
  - —: not built.
- **Proposed** is my recommendation. ⚠️ marks the features that are free today but marked Pro in the spec. You chose a 50/50 split:
  - **10 stay free (kept):** sports, privacy indicators, F1, clipboard, AirDrop, screenshot/record, window snapping, Shortcuts, world clock, backup.
  - **Klick** (2.0.19): mechanical keyboard sounds as you type, Pro.
  - **Convert** (2.0.21 / Windows 1.38.0): turn any file into another kind (pictures, PDFs, documents, slides, tables, audio, video, zip), Ultimate.
  - **9 move to Pro** (notch resize turned out not to exist yet, so it's simply a future Pro feature): meeting alert and join button, download progress, Focus/Pomodoro, launcher, snippets, rain alert, lyrics, Mirror, iCloud/Google sync.
  - What's New for that release will say which features moved.

| # | Feature | Spec | Today | Proposed |
|---|---|---|---|---|
| **A** | **Notch core** | | | |
| 1 | Spring expand/collapse | FREE | Free | FREE |
| 2 | Hover to open, adjustable delay | FREE | Partial (hover, no delay slider) | FREE |
| 3 | Click-to-open mode | FREE | Free | FREE |
| 4 | Global hotkey toggle | FREE | Free | FREE |
| 5 | Virtual notch on non-notch Macs | FREE | Partial | FREE |
| 6 | Launch at login | FREE | Free | FREE |
| 7 | Menu bar icon + quick menu | FREE | Free | FREE |
| 8 | Auto-hide in fullscreen | FREE | Partial | FREE |
| 9 | Multi-display, per-screen layouts | PRO | Partial (follows screen, free) | Following the screen stays FREE; per-screen layouts PRO |
| 10 | Remappable gestures | PRO | Partial (gestures free, fixed) | Default gestures FREE; remapping PRO |
| 11 | Notch resize with live preview | PRO | — (not built yet) | PRO, hidden until built |
| 12 | Mouse-edge trigger zones | PRO | — | PRO |
| **B** | **Live activities** | | | |
| 13 | Now Playing + album art | FREE | Free | FREE |
| 14 | Music visualizer | FREE | Free | FREE |
| 15 | Timer and stopwatch | FREE | Free | FREE |
| 16 | Battery / charging | FREE | Free | FREE |
| 17 | Live score, single match | FREE | Free | FREE |
| 18 | Sports favourites, alerts, ball-by-ball, multi-match | PRO | Free (followed team, alerts, table, details) ⚠️ | FREE what exists (kept); ball-by-ball and multi-match PRO |
| 19 | Next-event countdown | FREE | Free | FREE |
| 20 | Join-meeting button + pulse | PRO | Free (meeting alert) ⚠️ | PRO (alert and join button move from free) |
| 21 | AirPods/Bluetooth popup + battery | FREE | Free | FREE |
| 22 | Volume/brightness HUD | FREE | Free | FREE |
| 23 | Download/upload progress | PRO | Free (downloads) ⚠️ | PRO (moves from free) |
| 24 | Mic/camera/recording indicators | PRO | Free ⚠️ | FREE (kept) |
| 25 | Live Activities API for other apps | ULTIMATE | Partial (`notchapple://` scheme, free) | Existing URL commands FREE; push API ULTIMATE |
| 26 | Flight tracker | PRO | Partial | PRO for new depth |
| 27 | Food/package tracking | PRO | Partial | PRO |
| 28 | Stock and crypto ticker | PRO | Partial | PRO for new depth |
| 29 | F1 live timing | PRO | Free ⚠️ | FREE (kept) |
| 30 | Two activities at once (ears) | ULTIMATE | — | ULTIMATE |
| **C** | **AI** | | | |
| 31 | Ask-anything, streaming | FREE | Pro | FREE, with your own key or Ollama (see AI cost) |
| 32 | Keep asking follow-ups | FREE | Pro | FREE |
| 33 | Choose provider, bring your own key | PRO | Pro | FREE (the free tier needs your own key, so choosing the provider has to be free) |
| 34 | On-device model (Ollama / Apple Intelligence) | PRO | Pro | FREE (it's the free-of-cost path) |
| 35 | Ask about screen / selected text (⌃⌥S) | PRO | Pro | PRO |
| 36 | Voice input + spoken answers | PRO | — | PRO |
| 37 | Personas and saved prompts | PRO | — | PRO |
| 38 | Clipboard quick actions | PRO | Partial | PRO |
| 39 | History search and export | PRO | Pro | PRO |
| 40 | Image/file drop | PRO | Pro | PRO |
| 41 | Slash commands | PRO | — | PRO |
| 42 | AI automations | ULTIMATE | — | ULTIMATE |
| 43 | Copy / regenerate / stop | FREE | Pro | FREE |
| 44 | Markdown, math and code rendering | FREE | Pro | FREE |
| 45 | Web-search answers with sources | PRO | — | PRO |
| **D** | **Productivity** | | | |
| 46 | Clipboard history (last 20) | FREE | Free, 200 items ⚠️ | FREE, 200 items (kept) |
| 47 | Clipboard pins, search, images, unlimited | PRO | Partial (free) | What exists FREE; unlimited and sensitive-item exclusion PRO |
| 48 | Quick notes | FREE | Free | FREE |
| 49 | Markdown notes with tags | PRO | Partial | PRO |
| 50 | To-do list | FREE | Partial | FREE |
| 51 | Reminders/Todoist/Things | PRO | Partial (Quick Add, Pro) | PRO |
| 52 | Pomodoro + focus stats | PRO | Free (Focus timer) ⚠️ | PRO (moves from free) |
| 53 | File shelf | FREE | Free | FREE |
| 54 | AirDrop drop zone | PRO | Free ⚠️ | FREE (kept) |
| 55 | Shelf expiry, folders, quick share | PRO | Partial | PRO |
| 56 | App launcher grid | PRO | Free ⚠️ | PRO (moves from free) |
| 57 | Text snippets | PRO | Free ⚠️ | PRO (moves from free) |
| 58 | Screenshot/record + annotate | PRO | Free (no annotate) ⚠️ | FREE capture (kept); annotate PRO |
| 59 | Color picker and ruler | PRO | Partial (free) | Picker FREE; ruler PRO |
| 60 | Converter and calculator | PRO | Partial (free) | Existing FREE; currency PRO |
| 61 | OCR any region | PRO | Partial (inside AI capture) | PRO |
| 62 | Window snapping | PRO | Free ⚠️ | FREE (kept) |
| 63 | Command palette | PRO | — | PRO |
| 64 | Shortcuts integration | PRO | Free ⚠️ | FREE (kept) |
| 65 | AppleScript / URL scheme / CLI | ULTIMATE | Partial (URL scheme free) | URL scheme FREE; AppleScript dictionary and CLI ULTIMATE |
| **E** | **System and media** | | | |
| 66 | CPU/RAM mini stats | FREE | Free | FREE |
| 67 | Detailed system monitor | PRO | Partial (free) | Existing FREE; per-app, temperatures and disk PRO |
| 68 | Current weather | FREE | Free | FREE |
| 69 | Hourly/week weather, rain alerts, cities | PRO | Partial (rain alert free) ⚠️ | PRO (rain alert moves from free) |
| 70 | World clock (2 zones) | FREE | Free (more than 2) ⚠️ | FREE (kept) |
| 71 | Meeting-time planner | PRO | — | PRO |
| 72 | Focus / DND toggle | PRO | Partial | PRO |
| 73 | Caffeine | FREE | Free | FREE |
| 74 | Mic mute / camera toggle | PRO | Partial | PRO |
| 75 | HomeKit | ULTIMATE | — | ULTIMATE (needs Mac Catalyst, so very hard) |
| 76 | Synced lyrics | PRO | Partial (free) ⚠️ | PRO (moves from free) |
| 77 | Browser video controls | PRO | Partial (Now Playing) | PRO |
| 78 | Podcast speed controls | PRO | — | PRO |
| 79 | Webcam mirror | PRO | Free ⚠️ | PRO (moves from free) |
| 80 | Reply to notifications in the notch | ULTIMATE | Partial (Notifications module free) | Showing FREE; replying ULTIMATE |
| **F** | **Customization** | | | |
| 81 | Light/Dark/Auto + 3 themes | FREE | Free | FREE |
| 82 | 20+ themes, custom colours, glow | PRO | Partial | PRO |
| 83 | Theme editor, import/export | PRO | — | PRO |
| 84 | Icons, fonts, accent colours | PRO | Partial (accent free) | Accent FREE; the rest PRO |
| 85 | Choose and reorder widgets | FREE | Free | FREE |
| 86 | Layout builder with sizes | PRO | — | PRO |
| 87 | Auto-switching profiles | PRO | — | PRO |
| 88 | Per-app rules | PRO | Partial | PRO |
| 89 | Animation packs | PRO | — | PRO |
| 90 | Custom sounds and haptics | PRO | — | PRO |
| 91 | Plugin SDK | ULTIMATE | Partial (Plugins module free) | Existing script plugins FREE; SDK ULTIMATE |
| 92 | Community widget gallery | ULTIMATE | — | ULTIMATE (needs hosting) |
| **G** | **Platform and trust** | | | |
| 93 | In-app updates + Homebrew | FREE | Free (own updater, not Sparkle) | FREE |
| 94 | What's New | FREE | Free | FREE |
| 95 | English UI, translations welcome | FREE | Free | FREE |
| 96 | iCloud sync of settings, notes, themes | ULTIMATE | Partial (iCloud sync and Google account, free) ⚠️ | PRO (moves from free; notes and themes sync ULTIMATE) |
| 97 | iPhone companion | ULTIMATE | — | ULTIMATE (needs the $99/yr Apple Developer Program to ship) |
| 98 | Apple Watch | ULTIMATE | — | ULTIMATE (same) |
| 99 | Local backup/restore | PRO | Free ⚠️ | FREE (kept) |
| 100 | Privacy dashboard | FREE | Partial (AI Privacy summary) | FREE |
| 101 | Feedback + bug-report bundle | FREE | Partial (payment help link) | FREE |
| 102 | Donate + Compare tiers | FREE | Partial (Donate) | FREE |
| 103 | Priority support + beta channel | ULTIMATE | — | ULTIMATE |
| 104 | Purge disk cleaner tab (opens the Purge app) (1.26.1) | ULTIMATE | — (built in 1.26.0) | ULTIMATE |
| **H** | **Licensing** | | | |
| 104–110 | License screen, recovery, grandfathering, restore, terms, upgrade, crash reports | FREE | Partial (License pane) | FREE |

## Not in the spec but in the app today

| Module | Today | Proposed |
|---|---|---|
| Messenger | Pro | PRO |
| Audio (per-app volume) | Pro | PRO |
| VPN | Pro | PRO |
| Voice Notes | Pro | PRO |
| Screen Time and Focus Blocker | Pro | PRO |
| Quick Add | Pro | PRO |
| Notch Games | Free | FREE |
| Browser, Translator, Search, Devices, Biometric Lock | Free | FREE |

## What's built (as of 1.22.0)

| Release | Phase | Built |
|---|---|---|
| 1.16.0 | 0 | `Entitlements` and signed keys; License screen; recovery; grandfathering; pricing page; license server |
| 1.17.0 | 1 | Notch behaviour (1–12): hover delay, fullscreen/recording auto-hide, resize, edge zones, per-display tabs, remappable gestures, keyboard control. Onboarding, Settings search, sounds/haptics, Increase Contrast. Themes (81–84): 8 Pro themes and the theme editor |
| 1.18.0 | 2 | 20 meeting pulse, 26 flight status, 28 Markets, 18 more teams, 25 Live Activities API, 30 two activities at once |
| 1.19.0 | 3 | 34 Apple Intelligence, 36 voice, 37 personas and saved prompts, 38 clipboard AI, 41 slash commands, 42 automations, 45 web search with sources |
| 1.20.0 | 4 | 50 to-do, 49 Markdown notes and tags, 51 Reminders, 55 shelf folders/expiry/share, 47 clipboard 5,000 and ignored apps, 57 text expander, 58 markup, 59 ruler, 60 converter, 63 command palette, 65 CLI and scripting |
| 1.21.0 | 5 | 86 Home dashboard, 87 profiles, 88 per-app rules, 89 animation styles, 90 sounds/haptics, 84 fonts and menu bar icon, 91 plugin SDK, 92 plugin gallery |
| 1.24.0 | Companion | 97 iPhone companion (sideloaded .ipa, local Wi-Fi, encrypted), 77/78 browser video speed and skip |
| 1.23.0 | Gaps | Peek state, swipe down to open, 19 next-event countdown, undo, Focus via Shortcuts (87 profiles by Focus), 65 AppleScript, 72 Do Not Disturb toggle, 51 Things and Todoist, 86 drag-and-drop Home, one widget protocol with lifecycle tests, measured idle CPU |
| 1.22.0 | 6 | 100 privacy dashboard, 101 feedback and bug-report bundle, 110 opt-in crash reports, 103 beta channel and priority support, 96 notes/to-do iCloud sync, 69 week forecast and cities, 71 meeting planner, 74 mic mute, 67 top apps |

## Not built yet (hidden, never sold)

| # | Feature | Why |
|---|---|---|
| 98 | Apple Watch | Sideloading watch apps with a free Apple ID isn't reliable. The iPhone app's Shortcuts actions run from the Watch's Shortcuts app instead |
| 75 | HomeKit | HomeKit isn't available to a regular Mac app (needs Mac Catalyst and the paid program) |
| 80 | Reply to notifications | macOS has no public API for other apps' notifications |
| 74 (camera) | Camera on/off toggle | No public API; mic mute is built |
| 27 (live status) | Package tracking status | No free universal tracking API; tracking links work |
| 18 (ball-by-ball) | Cricket ball-by-ball | ESPN's free feed doesn't give reliable commentary |
| 23 (uploads) | Upload progress | Apps don't expose uploads publicly; downloads are built |
| 78 (apps) | Speed in Apple Podcasts or Spotify | Those apps have no scripting for speed. Browser video and podcasts get speed and skip (1.24.0) |
