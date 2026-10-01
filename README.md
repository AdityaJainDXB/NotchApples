<p align="center">
  <img src="docs/icon.png" width="128" alt="Notch apple icon">
</p>

<h1 align="center">Notch apple</h1>

<p align="center">
  Turn your MacBook notch into a sleek, purple productivity hub.<br>
  Free, open source, and fully local: no accounts, no servers, no tracking.
</p>

<p align="center">
  <img alt="macOS 14+" src="https://img.shields.io/badge/macOS-14%2B-8a5cf6">
  <img alt="Swift" src="https://img.shields.io/badge/Swift-SwiftUI%20%2B%20AppKit-8a5cf6">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-8a5cf6">
</p>

<p align="center">
  <a href="https://github.com/AdityaJainDXB/NotchApples/releases/latest"><b>⬇️ Download the latest DMG</b></a>
  &nbsp;·&nbsp; <a href="https://virajsinghchadha.github.io/notchapples-site/"><b>🌐 Website</b></a>
  &nbsp;·&nbsp; or install with <a href="#with-homebrew"><b>Homebrew</b></a>
  &nbsp;·&nbsp; want it smaller? <a href="#want-a-lighter-version"><b>Lighter versions</b></a>
</p>

```bash
brew tap adityajaindxb/notchapples https://github.com/AdityaJainDXB/NotchApples
brew install --cask notch-apple
```

<p align="center">
  <img src="docs/screenshots/claude.png" width="720" alt="Notch apple expanded, showing the Claude tab">
</p>

---

## Screenshots

### New in 1.14.2

- **Nothing that was free became paid.** Now Playing, windows, clipboard, shelf, focus, tools and the rest stay free forever; Pro is the same features as before.
- **Get Pro on the website**: a product key for $1 in Litecoin (or $2 to cover fees and support a high school developer), or free with a promo code. Keys are made instantly, work once, on one Mac. [Get Pro →](https://virajsinghchadha.github.io/notchapples-site/pro.html)
- Product keys (NOTCH-XXXX-XXXX-XXXX) are checked online and re-verified against the blockchain; older access codes keep working.

### New in 1.14.1

| | |
| --- | --- |
| ![Now Playing](docs/screenshots/nowplaying.png) | ![Music in the notch](docs/screenshots/island-music.png)<br>![Charging](docs/screenshots/island-charging.png) |
| **Now Playing**: any app, album cover, progress and controls | **Beside the notch**: album cover with live bars; charging time |
| ![Voice Notes](docs/screenshots/voice-notes.png) | ![Screen Time](docs/screenshots/screen-time.png) |
| **Voice Notes** *(Pro)*: transcribed on your Mac, AI summary | **Screen Time** *(Pro)*: time per app, limits, Focus Blocker |
| ![Quick Add](docs/screenshots/quick-add.png) | ![Timer](docs/screenshots/timer.png) |
| **Quick Add** *(Pro)*: plain words into Calendar or Reminders | **Timer & stopwatch** |
| ![Live](docs/screenshots/live.png) | ![Devices](docs/screenshots/devices.png) |
| **Live**: scores and parcel/flight tracking | **Devices**: accessory battery, mic & camera |
| ![Notifications](docs/screenshots/notifications.png) | ![Plugins](docs/screenshots/plugins.png) |
| **Notifications**: reply to iMessages from the notch | **Plugins**: your own widgets from any script |
| ![Snippets](docs/screenshots/snippets.png) | ![Notch Extras](docs/screenshots/settings-extras.png) |
| **Snippets**: paste saved text anywhere | **Settings → Notch Extras** |
| ![Account sign-in](docs/screenshots/settings-license.png) | ![Backup & Sync](docs/screenshots/settings-backup.png) |
| **Sign in with Google** to unlock Pro on every Mac | **Backup & Sync**: account, iCloud and backup files |

All screenshots use sample data.

All screenshots use sample data.

| | |
| --- | --- |
| ![Today](docs/screenshots/today.png) | ![AI](docs/screenshots/claude.png) |
| **Today**: weather, next events, battery | **AI**: free providers, switch in the notch |
| ![Windows](docs/screenshots/windows.png) | ![Snap zones under the notch](docs/screenshots/window-snap-zones.png) |
| **Windows**: snap, tile and save window layouts | **Drag a window to the notch** and drop it on a zone |
| ![Tools](docs/screenshots/tools.png) | ![Settings: Updates](docs/screenshots/settings-updates.png) |
| **Tools**: Keep Awake, colour picker, calculator | **Settings → Updates**: new versions from GitHub, Update or Not now |
| ![Mirror](docs/screenshots/mirror.png) | ![World Clock](docs/screenshots/world-clock.png) |
| **Mirror** add-on: flip, zoom, ring light (camera placeholder shown) | **World Clock** add-on: cities, day or night, time difference |
| ![Clipboard](docs/screenshots/clipboard.png) | ![Notes](docs/screenshots/notes.png) |
| **Clipboard**: searchable history, pins and filters | **Notes**: quick notes, saved automatically |
| ![Messenger](docs/screenshots/messenger.png) | ![Focus timer](docs/screenshots/focus.png) |
| **Messenger**: anonymous, end-to-end-encrypted rooms | **Focus**: Pomodoro timer |
| ![AirDrop and PairDrop](docs/screenshots/share.png) | ![File Shelf](docs/screenshots/shelf.png) |
| **Share**: AirDrop and PairDrop | **File Shelf**: drop files into the notch |
| ![Audio](docs/screenshots/audio.png) | ![VPN](docs/screenshots/vpn.png) |
| **Audio**: output, master and per-app volume and EQ | **VPN**: your profiles and free servers |
| ![Now Playing](docs/screenshots/nowplaying.png) | ![Settings: Permissions](docs/screenshots/settings-permissions.png) |
| **Now Playing** | **First launch**: every permission in one place |
| ![Settings](docs/screenshots/settings-general.png) | ![Settings: Modules](docs/screenshots/settings-modules.png) |
| **Settings**: a sidebar of panes, like System Settings | **Settings → Modules**: every feature is optional |
| ![Settings: AI](docs/screenshots/settings-ai.png) | ![Settings: AI History](docs/screenshots/settings-ai-history.png) |
| **Settings → AI**: provider, model and keys | **Settings → AI History**: every chat, with the model that answered |
| ![Settings: Windows](docs/screenshots/settings-windows.png) | ![Settings: Authentication](docs/screenshots/settings-authentication.png) |
| **Settings → Windows**: snap zones, shortcuts, gaps | **Face unlock**: Face ID-style |
| ![Settings: Messenger](docs/screenshots/settings-messenger.png) | ![Settings: Clipboard](docs/screenshots/settings-clipboard.png) |
| **Settings → Messenger** | **Settings → Clipboard** |
| ![Settings: Focus](docs/screenshots/settings-focus.png) | ![Settings: Audio](docs/screenshots/settings-audio.png) |
| **Settings → Focus** | **Settings → Audio**: built-in per-app engine |
| ![Settings: VPN](docs/screenshots/settings-vpn.png) | ![Settings: Widget](docs/screenshots/settings-widget.png) |
| **Settings → VPN**: free servers and your profiles | **Settings → Widget**: location or a city |

## Features

Every module is **optional** and can be switched on or off in **Settings → Modules**. **Pro** features (AI, Messenger, Audio, VPN, Voice Notes, Screen Time & Focus Blocker, Quick Add) need an access code; everything else, including Now Playing, is free.

| Module | What it does |
| --- | --- |
| ☀️ **Today** | The date, current weather, your next calendar events (with a **Now** badge for meetings in progress) and battery at a glance. |
| ⏱ **Focus** | A Pomodoro timer: 25-minute focus sessions and 5-minute breaks, with a long break every 4th session. While it runs, **the countdown shows beside the closed notch**. You get a notification and a sound when each session ends. Lengths are adjustable in **Settings → Focus**. |
| 🔋 **Charging** | Plug in or unplug the charger and the notch briefly shows your battery level. Turn it off in **Settings → General**. |
| ✨ **AI** | Chat from the notch with **free** AI (Google Gemini, Groq, OpenRouter's free models, or Ollama on your Mac) or with your own key for **DeepSeek**, Claude or ChatGPT. **Ask "what's on my screen?"** and it takes a screenshot and answers about what you're actually looking at. One-click actions summarise, translate or fix what you copied. Every chat is saved in **Settings → AI History** with the model that answered. See [AI in the notch](#ai-in-the-notch). |
| 🪟 **Windows** | A split-screen window manager. **Drag any window up to the notch** and a strip of snap zones drops down: halves, quarters (4 windows on one screen), thirds, two-thirds, fill and center. Or snap from the Windows tab, or with `⌃⌥` + arrow keys. **Arrange all** tiles every window on the screen at once (split screen, 3 columns, a 4/6/9 grid, main + stack, cascade). Save a whole layout and put every window back in one click. See [Window management](#window-management). |
| 🧰 **Tools** | **Text Grab** copies the text from any area of the screen (even images and videos), recognised on your Mac. **Keep Awake** stops your Mac sleeping for 30 minutes, 1 or 2 hours, or until you turn it off. **Color Picker** picks any colour on screen and copies its hex code (right-click a swatch for RGB). **Calculator** answers as you type (`(12.5 + 7) × 3`), and Return copies the result. |
| 🪞 **Mirror** *(add-on)* | A live mirror from your Mac's camera to check how you look before a call. Flip, zoom, pick a camera, and a white **ring light** frame for dark rooms. The camera only runs while the tab is open, and nothing is recorded. Turn it on in **Settings → Modules**. |
| 🌍 **World Clock** *(add-on)* | The time in the cities you choose, with day or night and how far ahead or behind they are. Turn it on in **Settings → Modules**. |
| 📝 **Notes** | Quick notes in the notch: several notes, search, a "new note from clipboard" button, and saved automatically on your Mac. |
| 💬 **Messenger** | Chat anonymously with **people on the same Wi-Fi** (found automatically, encrypted between Macs), or **create or join an anonymous room** with a code, like `cafe-study` or `8821`. Rooms are end-to-end encrypted, and nothing is stored anywhere. You get a random handle like `PurplePanda#402`, and there are no accounts. See [Using Messenger](#using-messenger). |
| 📋 **Clipboard** | Everything you copy (text, links, images and files) is saved to a searchable history in the notch. Click an item to copy it again, pin the ones you want to keep, and filter by type. Items that password managers mark as secret are never saved, and history stays on your Mac. Choose how many items to keep in **Settings → Clipboard**. |
| 🔍 **Search** | Find files, apps and folders from the notch, powered by Spotlight, so results appear instantly with no indexing of its own. Use `↑`/`↓` to choose, `Return` to open, `⌘R` or `⌥`-click to show it in Finder, or drag a result onto the File Shelf or into any app. Choose the scope (your home folder or the whole Mac) and file types (apps, documents, images, PDFs, Downloads) in **Settings → File Search**. See [File Search](#file-search). |
| 🌐 **Translator** | Add-on: translate between Arabic, English, French, Spanish, Hindi, Mandarin and German, with a swap button, read-aloud and copy. Non-Latin results also show a pronunciation line you can read (pinyin for Mandarin, Latin letters for Arabic and Hindi), made on your Mac. The text you type is sent to the free MyMemory translation service (up to 500 characters at a time). |
| 📊 **Mac Stats** | Add-on: live RAM, CPU, network speed, battery and disk space. The **MacBook Center** widget (Small and Medium) shows the same in Notification Center; macOS limits how often widgets refresh, so use this tab for a live view. |
| 🌐 **Browser** | Add-on: browse the web and search from the notch. Type a website or a search in the address bar (it searches with DuckDuckGo, Google, Bing, Brave or Ecosia, your choice in **Settings → Browser**), with back, forward, reload, a start page with quick links, and a button to open the page in your default browser. It uses the same web engine as Safari and keeps your last page. |
| 🚀 **Launcher** | Add-on: a shelf of apps you choose. Add as many as you like from the list of installed apps, by dragging an app in, or with **Other…**; click a tile to open it from the notch, drag tiles to reorder, right-click to remove. |
| 🗂 **File Shelf** | Drag a file onto the notch and it opens straight to the shelf. Files stay there across relaunches thanks to security-scoped bookmarks. Double-click to open, or drag them back out. There's also an **Add files…** button. |
| 📡 **Share** | Send files with **AirDrop**, or use **PairDrop** between devices on the same Wi-Fi. To receive, just show your 6-digit code. To send, type the other device's code; there's no need to pick the device. No server is involved. |
| 🔊 **Audio** | Pick the output device, set the master volume, and change **per-app volume (0–150%)** and a **10-band per-app EQ** with presets. It's built in on macOS 14.2+, with nothing to install. |
| 🛡 **VPN** | A built-in list of **free OpenVPN servers** from [Zoult/.ovpn](https://github.com/Zoult/.ovpn) and [VPN Gate](https://www.vpngate.net), or import your own `.ovpn` / `.conf`. See [Using the VPN](#using-the-vpn). |
| 🎵 **Now Playing** | Shows what's playing on your Mac: **Apple Music, Spotify, Anghami, browsers, podcasts**, anything in Control Center's Now Playing. Or pick one app to follow. Includes the **album cover**, a progress bar, previous / play / next and synced lyrics. While music plays, the closed notch shows the **album cover and moving bars**, like the iPhone's Dynamic Island; click it to open Now Playing. |
| ⏲ **Timer** *(add-on, new)* | A countdown timer with one-click presets (1 min to 1 hr, or any length) and a stopwatch with laps. The time left shows **beside the closed notch**, and you get a sound and notification when it ends. |
| ✂️ **Snippets** *(add-on, new)* | Saved bits of text (addresses, sign-offs, replies, code). Click one and it's **pasted straight into the app you were using** (copied instead if Accessibility is off). |
| 🧱 **Shortcuts** *(add-on, new)* | Run any of your **Apple Shortcuts** from the notch, with a **Focus modes** row for shortcuts that switch Focus / Do Not Disturb. Shortcuts can drive the notch too, with [`notchapple://` links](#control-the-notch-from-shortcuts). |
| 🎧 **Devices** *(add-on, new)* | Battery for **AirPods** (left, right, case), **Magic Mouse, Keyboard and Trackpad**, with a low-battery alert at 15%. Shows **which apps are using your mic** and whether a **camera** is on, with a one-click **mic mute**. Shows your **iPhone's battery** when it's connected over Bluetooth, and **Ring my iPhone** opens Find My. |
| 🏟 **Live** *(add-on, new)* | **Live scores** for the Premier League, Champions League, La Liga, MLS, NBA, NFL, MLB and NHL (ESPN's public scoreboard). Follow a team and its score shows beside the notch while it plays. Paste a **parcel or flight number** and it recognises UPS, FedEx, USPS, DHL or a flight and opens the right tracking page. |
| 🔔 **Notifications** *(add-on, new)* | Notifications from your other apps, in the notch, with a bell and count beside it when new ones arrive. **Reply to iMessages** without opening Messages. It reads Notification Center's own database (read-only, on your Mac), so it needs **Full Disk Access**. |
| 🧩 **Plugins** *(add-on, new)* | Make your own notch widgets in any language. See [Plugins](#plugins). |
| 🎙 **Voice Notes** *(Pro)* | Record a voice note from the notch. It's **transcribed on your Mac**, and one click turns it into an **AI summary with action items** (using your AI from Settings → AI). Play, copy or delete each one; the closed notch shows a timer while you record. |
| ⏳ **Screen Time** *(Pro)* | How long you spend in each app, today and over the week, with **daily limits** that nudge you when you go over. The **Focus Blocker** hides distracting apps you pick whenever a Focus session is running. It counts only while you're at your Mac, and everything stays on it. |
| 📅 **Quick Add** *(Pro)* | Type naturally, like "Dentist tomorrow 3pm", "Lunch with Sara friday 1pm for 90 min" or "remind me to pay rent on the 1st", and it goes straight into **Calendar or Reminders**, with a preview first. |
| 🔐 **Biometric Lock** | Requires Touch ID, Apple Watch, your password, or **face unlock** (your Mac's camera) before the notch opens. See [Face unlock](#face-unlock). |
| 🧩 **Widget** | Small, medium and large desktop widgets with local weather, now playing, and your next calendar events. (macOS has no lock screen widget type yet; Apple's lock screen widget sizes are iPhone and iPad only.) |

**Live activities:** like the iPhone's Dynamic Island, the closed notch shows small indicators on either side:
- the focus countdown
- battery when charging, plus a **low battery warning at 20% and 10%**
- a purple dot for unread messages
- **timers and the stopwatch**
- the **screen recording timer**
- **download and copy progress** (Safari, Chrome, Finder, AirDrop)
- the **Keep Awake countdown**
- **"Join"** from 2 minutes before a Zoom, Meet, Teams or Webex call in your calendar (click the notch, then Join)
- **"rain in 15 min"**
- the **mic or camera** being in use
- a followed team's **live score**
- **new notifications**

Choose which ones show in **Settings → Notch Extras**.

**Gestures:** scroll with two fingers on the closed notch to change the volume, and swipe sideways to skip to the next or previous track.

**External displays:** the notch can live on your built-in display, on the display with the pointer (it follows you from screen to screen), or on the main display. Displays without a notch get a virtual one. Set this in **Settings → Notch Extras**.

**Also new in 1.14:**
- **Screen recording:**
  - pause and resume
  - a live timer beside the notch
  - the notch is left out of the video
  - a **trim** step when you stop
- **Synced lyrics** in Now Playing (from LRCLIB), plus previous, play/pause and next buttons.
- **Rain alerts** and **Join** buttons for video calls in Today.
- **Paste** straight from Clipboard history.
- **AirDrop everything on the File Shelf**.
- A **7-day focus chart**, and **Do Not Disturb during focus sessions** (via a shortcut; see Settings → Focus).
- A RAM graph and heat level in Mac Stats.

![Focus countdown beside the notch](docs/screenshots/live-activity.png)

**Open the notch by clicking it, pressing `⌘E` (`⌃⌥N` on new installs; changeable in **Settings → Shortcuts & Hotkeys**) in any app, or dragging a file onto it.** Press `Esc` or `⌘E`, or click anywhere else, to close it.

**Open on hover (optional, off by default):** turn it on in **Settings → General**. The notch then opens when the pointer rests on it and closes when the pointer moves away. Click inside to keep it open while you type or drag. With the option off, hovering only highlights the notch.

`⌘E` is a system-wide shortcut registered through Carbon, so it needs no Accessibility permission. While it's on, other apps won't receive `⌘E` (for example "Use Selection for Find"). You can turn it off in **Settings → General**.

**Hide the notch with `⌘O`** (change it in **Settings → Shortcuts & Hotkeys**): press it from anywhere to make the notch and its menu-bar icon disappear, and press it again to bring them back. Everything keeps running while it's hidden (music, timers, Messenger), and `⌘E` also brings it back. **Settings → Shortcuts & Hotkeys** shows whether it's visible or hidden and has the on/off switch.

When the VPN module is on, a **VPN On/Off** pill in the notch header shows the tunnel status. The full VPN setup (importing profiles and loading free servers) is under **Settings → VPN**.

## Window management

The **Windows** module arranges your app windows without leaving the notch. It needs one permission: **System Settings → Privacy & Security → Accessibility → Notch apple** (the Windows tab has a button that takes you there).

- **Drag to the notch:** start dragging any window by its title bar and move the pointer up to the notch. Snap zones appear underneath; move onto one (its name lights up) and let go.
- **Snap from the notch:** open the Windows tab and click a layout. It applies to the window you were just using.
- **Arrange all windows:** *Split screen* (2 side by side), *3 columns*, *Grid* (4, 6 or 9 windows, depending on how many are open), *Main + stack* (one large window with the rest stacked beside it), or *Cascade*.
- **Saved layouts:** press **+** to remember where every window is, and click the saved layout later to put them all back. Apps that aren't open are skipped.
- **Next display** moves the window to your other screen, keeping its relative size and position.
- **Undo** puts the last snapped window back where it was.

| Shortcut | Action |
| --- | --- |
| `⌃⌥←` / `⌃⌥→` | Left / right half |
| `⌃⌥↑` / `⌃⌥↓` | Top / bottom half |
| `⌃⌥↩` | Fill the screen |
| `⌃⌥C` | Center |
| `⌃⌥⌫` | Undo the last snap |

The gap between windows, the drag-to-notch zones and the shortcuts can be changed in **Settings → Windows**. If you allowed Accessibility for a version before 1.12.0 and snapping doesn't work, remove Notch apple from the Accessibility list with −, then turn it on again. From 1.12.0 the permission carries over to future updates.

Other things new in 1.11: the notch **remembers the last tab** you had open. Notch apple is no longer sandboxed, because macOS only gives Accessibility to sandboxed apps from the App Store. Your settings, notes, clipboard and AI history are moved over automatically the first time 1.11 opens.

## File Search

The **Search** tab searches your Mac with Spotlight, the same index Finder and ⌘Space use, so it's instant and never walks folders on its own. Start typing and it shows the 30 best matches: exact names first, then names that start with what you typed, with apps ranked higher. Hidden files, caches, `node_modules`, build folders and system folders are skipped.

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the highlight |
| `Return` or click | Open |
| `⌘R` or `⌥`-click | Reveal in Finder |
| Drag | Drop onto the File Shelf, or into any app |

**Settings → File Search** turns the tab on or off, sets the scope (**User home folder only**, the default, or **Entire Mac**) and picks the file types to include. With every type ticked, folders and all other files are included too.

If macOS stops Notch apple reading **Downloads**, **Documents** or **Desktop**, a warning appears with a **Grant Full Disk Access in System Settings** button that opens the right page.

Other things new in 1.12: **no more keychain password prompts.** Earlier versions saved API keys and face-unlock data in the login Keychain, and because the app is ad-hoc signed, macOS asked for your login password again after every update. They're now stored in a private file only your user account can read. After updating, paste your AI API keys again and set up face unlock again.

## Backup and sync your setup

**Settings → Backup & Sync** keeps your whole notch setup safe:
- **Notch apple account:** **Continue with Google** (Sign in with Apple is coming) and your setup and access code are saved to your account, then restored on any Mac you sign in on, with Pro unlocked. It's stored in Firebase, where only you can read it; the access code is kept as a secure fingerprint, never the code itself. You'll find it in **Settings → Backup & Sync** and **Settings → License & Activation**.
- **Sync with your Apple ID:** turn on *Keep my notch setup in iCloud* and it's saved to iCloud Drive → Notch apple every time you change something. On a new Mac, install Notch apple, open this page and click **Restore from iCloud**. There's no separate account to create.
- **Backup file:** **Export settings…** saves a `.notchsettings` file, and **Import settings…** brings it back, on this Mac or another.

It covers your modules, tab order, theme, shortcuts, Notch Extras, snippets, launcher apps, cities and more. AI keys, your access code and your Messenger identity are never included.

## Plugins

Put a script in `~/Library/Application Support/Notch apple/Plugins` (or click **Add example** in the Plugins tab), and its output shows as a card in the notch. Any language works: shell, Python, Ruby, anything with a `#!` line.

- The **first line** of output is the card's headline; the **other lines** are its text.
- Add `| href=https://…` to a line to make it a link, or `| run=command` to run a shell command when it's clicked.
- The **file name sets how often it runs**: `weather.10m.sh`, `cpu.5s.py`, `news.1h.rb` (default every 5 minutes). Scripts are stopped after 10 seconds.

```bash
#!/bin/zsh
echo "Disk: $(df -h / | awk 'NR==2 {print $4}') free"
echo "Uptime $(uptime | sed 's/.*up \([^,]*\),.*/\1/')"
echo "Open GitHub | href=https://github.com"
```

## Control the notch from Shortcuts

Use the **Open URL** action in Apple Shortcuts (or `open` in Terminal) with these links:

| Link | Does |
| --- | --- |
| `notchapple://open/timer` | Opens the notch on a tab (any tab name: `today`, `claude`, `snippets`…) |
| `notchapple://toggle`, `close`, `hide`, `show` | Opens / closes / hides / shows the notch |
| `notchapple://timer?minutes=10`, `timer/stop` | Starts or stops a timer |
| `notchapple://stopwatch`, `stopwatch/stop` | Starts or stops the stopwatch |
| `notchapple://focus/start`, `focus/stop` | Starts or pauses a focus session |
| `notchapple://keepawake?minutes=30`, `keepawake/off` | Keep Awake on (optionally for a while) or off |
| `notchapple://snippet?name=Thanks` | Pastes a saved snippet |
| `notchapple://record`, `screenshot` | Starts or stops a screen recording, or takes a screenshot |

## Updates

From 1.12.0, Notch apple updates itself from this repository's GitHub releases:

- When a new release is published, you get a notification (**"Update available. Would you like to update?"**), an **Update** button appears in the notch, and **Settings → Updates** shows a badge with the release notes.
- Press **Update** and it downloads the new DMG, checks the app inside is genuine Notch apple, replaces your copy and reopens. Your settings and data are kept.
- Press **Not now** to skip that version. You'll only be asked again when a newer one comes out.
- Don't want updates at all? Turn off **Check for updates automatically** in Settings → Updates. You can still press **Check now** any time.

Checking only asks GitHub for the latest release. Nothing about you is sent.

## Install

### With Homebrew

```bash
brew tap adityajaindxb/notchapples https://github.com/AdityaJainDXB/NotchApples
brew install --cask notch-apple
```

Update later with `brew upgrade --cask notch-apple`. The first time you open it, macOS may block it because it isn't notarized: go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Manually

<p align="center"><img src="docs/screenshots/dmg-installer.png" width="520" alt="The Notch apple installer window: drag the app onto Applications"></p>

1. Download the latest `NotchApple-x.y.z.dmg` from [**Releases**](../../releases).
2. Open it and drag **Notch apple** into **Applications**.
3. The app is ad-hoc signed, not notarized, so on first launch right-click the app and choose **Open**, then confirm. (Or run `xattr -dr com.apple.quarantine "/Applications/Notch apple.app"`.)
4. Click the notch, or the menu-bar icon, to get started.

On a Mac without a notch, a slim pill appears at the top center of the menu bar instead.

## Want a lighter version?

Every feature is optional, so the easiest way to slim Notch apple down is to **turn off what you don't need in Settings → Modules**. Turned-off modules disappear from the notch and stop running in the background.

If you'd rather install an older, smaller build, every version is still available. Each release **includes everything from the ones above it**, so pick the first one that has what you want. Click a version number to download its DMG, or see the [full release notes](https://github.com/AdityaJainDXB/NotchApples/releases).

| Version | Download size | What it adds | Known issues (fixed later) |
| --- | --- | --- | --- |
| [**1.0.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.0.0/NotchApple-1.0.0.dmg) | 1.8 MB | The original notch hub: Claude chat with screen sharing, File Shelf, AirDrop and PairDrop, audio output and volume, VPN profile import, Now Playing, biometric lock, desktop widget. | Settings doesn't open from the notch (fixed in 1.1.0). |
| [**1.1.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.1.0/NotchApple-1.1.0.dmg) | 1.9 MB | Working Settings window, **⌘E** to open and close the notch from anywhere, a VPN status pill in the notch. |  |
| [**1.2.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.2.0/NotchApple-1.2.0.dmg) | 3.6 MB | Free VPN server list, easier PairDrop (just type a code), drag files onto the notch, **native per-app volume and EQ**, a redesigned Settings window. |  |
| [**1.3.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.3.0/NotchApple-1.3.0.dmg) | 3.7 MB | **Messenger**: chat on the same Wi-Fi or in anonymous encrypted rooms. | Messenger can crash if the network drops (fixed in 1.7.0). |
| [**1.3.1**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.3.1/NotchApple-1.3.1.dmg) | 3.7 MB | Create Messenger rooms, and a rounded notch shape like the real MacBook notch. | Same Messenger crash as 1.3.0. |
| [**1.4.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.4.0/NotchApple-1.4.0.dmg) | 3.8 MB | **Face unlock** for Notch apple's lock (webcam). | Same Messenger crash as 1.3.0. |
| [**1.4.1**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.4.1/NotchApple-1.4.1.dmg) | 3.8 MB | Optional **open on hover**. **The last small version (under 4 MB).** | Same Messenger crash as 1.3.0. |
| [**1.5.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.5.0/NotchApple-1.5.0.dmg) | 30 MB | The VPN connects out of the box (the Tunnelblick helper is included, **which is why the app grows to about 30 MB**), message notifications, Homebrew install. | Same Messenger crash as 1.3.0. |
| [**1.6.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.6.0/NotchApple-1.6.0.dmg) | 30 MB | **Clipboard** history. | Same Messenger crash as 1.3.0. Face unlock needs setting up again after upgrading from 1.4–1.5. |
| [**1.7.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.7.0/NotchApple-1.7.0.dmg) | 31 MB | **Today** tab (weather, calendar, battery), **Focus** timer, live activities beside the notch, the charging indicator. |  |
| [**1.8.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.8.0/NotchApple-1.8.0.dmg) | 31 MB | Local weather (uses your location), a Permissions screen on first launch, Face ID-style face unlock, a large widget, the styled installer. |  |
| [**1.9.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.9.0/NotchApple-1.9.0.dmg) | 31 MB | **Free AI choices**: Gemini, Groq, OpenRouter and Ollama, alongside paid Claude and ChatGPT. |  |
| [**1.10.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.10.0/NotchApple-1.10.0.dmg) | 31 MB | The AI can **see your screen when you ask**, one-click AI actions, DeepSeek, **AI History**, **Notes**, smoother notch opening. |  |
| [**1.11.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.11.0/NotchApple-1.11.0.dmg) | 31 MB | **Windows**: drag a window to the notch to snap it, split screen, 4-window grid, thirds, tile all windows, saved layouts, `⌃⌥` shortcuts. The notch remembers its last tab. |  |
| [**1.12.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.12.0/NotchApple-1.12.0.dmg) | 31 MB | **Search** tab (Spotlight file search), `⌃⌥O` to hide the notch, no more keychain password prompts, **built-in updates** (Settings → Updates), **Tools** tab (Keep Awake, colour picker, calculator), hide shortcut moved to `⌃⌥O`, **Mirror** and **World Clock** add-ons, permission buttons that open System Settings when macOS doesn't ask. | After updating, paste your AI API keys again and set up face unlock again. |
| [**1.13.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.13.0/NotchApple-1.13.0.dmg) | 6 MB | **Access code** unlocks AI, Messenger, Audio, Now Playing and VPN (everything else stays free), **Translator** and **Mac Stats** add-ons with the **MacBook Center** widget, **colour themes** (Settings → Appearance), volume and brightness gauge and a recording dot on the notch, Screenshot and Record buttons in Today, shortcuts you can change (`⌘O` hides the notch by default; `⌃⌥N` opens it on new installs), a fresh install shows only Today and AI. | Doesn't include the Tunnelblick VPN helper; install [Tunnelblick](https://tunnelblick.net) yourself to use the VPN. |
| [**1.13.1**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.13.1/NotchApple-1.13.1.dmg) | 31 MB | Screen-aware AI fixed (asks for Screen Recording, then offers a **Relaunch**), **drag to reorder notch tabs** (Settings → Appearance), a colour-coded **Settings / Relaunch / Quit** menu, macOS volume and brightness pop-ups replaced by the notch gauge, **Text Grab** (copy text from anywhere on screen). |  |
| [**1.13.5**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.13.5/NotchApple-1.13.5.dmg) | 6 MB | **Browser** tab (web and search from the notch), **Launcher** tab (open your favourite apps), the AI now **retries and switches to a free model that can read images** when OpenRouter's free models are busy, **Settings follow the colour theme**, `⌘O` hides the notch again by default, a permissions guide in Settings and a **Read Me First** in the DMG. The latest version. | For the VPN tab, also download the separate **Tunnelblick** file listed on the [1.13.5 release](https://github.com/AdityaJainDXB/NotchApples/releases/tag/v1.13.5) (the unmodified official Tunnelblick 9.0.1). |

Good to know:
- **1.4.1 is the last version under 4 MB.** From 1.5.0 on, the app includes the Tunnelblick VPN helper, which accounts for most of the extra size. If you don't use the VPN, 1.4.1 or earlier stays small.
- Older versions don't get fixes. The Messenger crash in 1.3.0–1.6.0 only happens when the network drops, but it's worth knowing about.
- Homebrew always installs the latest version. For an older one, download its DMG above and drag it to Applications in the same way. Remove the current version first.
- Going back to 1.5.0 or earlier after setting up face unlock in 1.6.0 or later means setting face unlock up again.

## Permissions

On first launch, Notch apple opens **Settings → Permissions**. It shows everything in one place, with a switch or **Allow** button for each, and all of it is optional:

- **Open at login / run in the background:** registers Notch apple as a login item. If macOS asks, approve it under **System Settings → General → Login Items & Extensions** ("Allow in the Background").
- **Notifications:** messages and focus timer alerts.
- **Location:** local weather in Today and the widget (approximate location only). Without it, weather uses the city you choose in **Settings → Widget**.
- **Calendars:** your next events.
- **Camera:** only for face unlock.

The table below lists when each is asked for.

| Permission | Used by | When it's asked |
| --- | --- | --- |
| Screen Recording | Claude → Share Screen | The first time you share your screen |
| Local Network | PairDrop, Messenger (Nearby Wi-Fi) | The first time either looks for nearby devices |
| Calendars | Widget | When the widget first loads |
| Touch ID / password | Biometric Lock | Each time you open the notch while the lock is on |
| Location | Weather | The first time you open Today (approximate location, weather only) |
| Camera | Face unlock | When you set up or use face unlock. Only a face template is saved, never photos |
| Full Disk Access (optional) | Search, Notifications add-on | Never asked automatically. Only if you choose to, so Search can include protected folders, or the Notifications tab can read Notification Center's list |
| Automation (Music, Spotify, Messages) | Lyrics, iMessage replies | The first time lyrics look up the song position, or you send a reply |
| Microphone status | Devices add-on | Never asked: it only checks whether the mic is in use, and never records |
| Accessibility | Windows (snapping and tiling), Snippets and Clipboard paste | When you first use the Windows tab. Used to move and resize windows, and to paste snippets into the app in front |
| System audio recording | Audio → per-app volume / EQ | The first time you change an app's volume or EQ. Audio is processed on your Mac and never recorded or sent anywhere |

## AI in the notch

### Choose your AI

The AI tab doesn't require a paid account. Pick a provider in the notch or in **Settings → AI**:

| Provider | Cost | Get a key | Notes |
| --- | --- | --- | --- |
| **Google Gemini** | Free tier, no billing | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Fast; can see screenshots. The default. |
| **Groq** | Free tier, no billing | [console.groq.com/keys](https://console.groq.com/keys) | Very fast open models (Llama, Qwen, DeepSeek-distilled and more). |
| **OpenRouter** | Free models, no billing | [openrouter.ai/keys](https://openrouter.ai/keys) | Only the free models are listed. The selection changes over time. |
| **Ollama** | Free, runs on your Mac | No key. [Download Ollama](https://ollama.com/download) | Private and offline. Run e.g. `ollama run llama3.2` once. |
| **DeepSeek** | Paid, low cost (top up a balance) | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | The official DeepSeek API (`deepseek-chat`, `deepseek-reasoner`). Text only. |
| Claude | Paid (your Anthropic account) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | |
| ChatGPT (OpenAI) | Paid (your OpenAI account) | [platform.openai.com](https://platform.openai.com/api-keys) | The OpenAI API has no free tier. |

Free OpenRouter models are shared and often busy, and many can't read images. When you ask about your screen, Notch apple picks an image-capable free model, retries once if the host is busy, then falls back to other free models and tells you which one answered. Model lists are loaded live from each provider, so new models appear automatically, and you can type any model ID. The official DeepSeek API has no free tier; free DeepSeek models sometimes appear in Groq's and OpenRouter's free lists. Keys are stored in a private file on your Mac that only your user account can read, and sent only to that provider.

### It can see your screen when you ask

Ask something about your screen and Notch apple takes a screenshot for you (leaving the notch itself out) and sends it with your question, so the answer is about what's really there. For example:

- "What's on my screen?" / "What am I looking at?"
- "Explain this error" / "What does this button do?"
- "Summarise this page" / "Translate this page"

Questions that aren't about the screen ("What's the capital of France?") are sent as plain text. If the selected model can't see images (DeepSeek, most Groq and Ollama models), no screenshot is sent and the notch suggests switching to a model that can, such as Gemini. Turn this off in **Settings → AI → Share my screen when I ask about it**. The first time, macOS asks for Screen Recording permission.

### One-click actions

On a new chat, one click runs:

- **What's on my screen?**
- **Summarise what I copied**
- **Translate what I copied**
- **Fix grammar of what I copied** (replies with just the corrected text)

### Chat history

Every conversation is saved in **Settings → AI History**:

- your first question, the provider and model(s) used, the date, and the full back-and-forth, with each reply labelled with the model that wrote it;
- **Continue** a chat in the notch, **Copy** the transcript, search, or delete one or all.

Screenshots aren't stored, only a note that one was attached. History stays on your Mac. Turn saving off with **Save AI chats**.

## Face unlock

Unlock Notch apple by looking at your Mac's camera.

1. Go to **Settings → Authentication** and turn on **Lock Notch apple**.
2. Click **Set up face unlock…** and allow camera access. Follow the prompts (look straight, turn slightly left and right, tilt up and down) while it takes six photos.
3. Click **Test…** to check it recognises you. Good, even lighting helps.
4. Now when you open the notch, a **Face ID-style** animation asks you to look at the camera and **blink**. It turns into a green check with a trackpad tap when it recognises you, and shakes red if it doesn't. **Use Touch ID** is always there as a fallback.

How it works: Apple's Vision framework finds your face in each photo and turns it into a *feature print* (a list of numbers). Only those numbers and a match threshold calibrated from your own photos are saved in a private file on this Mac that only your user account can read. The photos themselves are never saved or sent anywhere. Unlocking needs several matching frames **and a blink**, which stops a printed photo from working. **Delete face data…** removes the template; it asks for Touch ID or your password first.

> **Limits:** a regular FaceTime camera is 2D, unlike Apple's Face ID, which uses a 3D depth camera. Someone who looks like you, or a good enough video, might get through, so treat face unlock as a convenience rather than strong security. It unlocks Notch apple only. macOS doesn't let third-party apps unlock the Mac itself or replace its login.

## Using Messenger

Open the notch and click the 💬 tab. Your handle (for example `MistyOwl#769`) is shown top right; change it in **Settings → Messenger**.

**Nearby Wi-Fi.** Anyone on the same network with Notch apple and Messenger open appears automatically ("2 people nearby on Wi-Fi"). Just type. This uses Apple's MultipeerConnectivity with encryption required, and works without internet.

**Create a room.** In **Anonymous room** mode, press **New room**. Notch apple makes a private, hard-to-guess code (like `ember-puffin-4576-2rjc`), joins it, and copies it to your clipboard. Paste it to your friends; they paste it into the room box and press **Join**. **Copy code** copies it again at any time.

**Join a room.** Type any room code and press **Join**. Everyone who enters the same code (`#Cafe-Study`, `cafe-study` and `CAFE-STUDY ` all count as the same) is in the same room and shown as "3 online".

How rooms stay private:
- The code is hashed on your Mac with SHA-256 into two separate values: a topic name for the relay, and a 256-bit AES-GCM key.
- The relay only ever sees a random-looking topic and encrypted bytes. It never sees the room name, your handle or your messages.
- Messages are relayed live through the free, open-source [ntfy.sh](https://ntfy.sh) service over HTTPS (port 443, so it works on school and office Wi-Fi). Each message is sent with `Cache: no`, so the relay stores nothing. Public MQTT brokers are used as a fallback.
- Chat history only lives in memory. **Settings → Messenger → Clear chat history and disconnect** wipes it.

> Anyone who knows the code can join the room, and short numeric codes are easy to guess. For a private chat, use **New room**, which makes a code with about a trillion possibilities.

**Notifications.** When someone messages you while the notch is closed or you're on another tab, you get a macOS notification (sender, message and room), the closed notch grows a small purple dot, and the Messenger tab shows a badge. Click the notification to jump straight to the chat. Messenger keeps listening in the background, rejoining your last room when Notch apple starts. Turn notifications or message previews off in **Settings → Messenger**.

Turn off **Allow local network discovery** in **Settings → Messenger** to stay invisible on your Wi-Fi.

## Using the VPN

Notch apple doesn't run any VPN servers. It organises free VPN profiles and connects them for you. A **profile** is a small text file that says which server to connect to and how: `.ovpn` for **OpenVPN** or `.conf` for **WireGuard**.

Notch apple hands the profile to a VPN helper app that makes the actual connection. **You don't need to download anything yourself:** the free, open-source [Tunnelblick](https://tunnelblick.net) installer (notarized by its developer) is **included inside Notch apple**.

### Step 1: One-time setup (automatic)

The first time you click **Connect** on an OpenVPN server, Notch apple shows **"One-time setup: install the VPN helper"**. Click **Install**, follow Tunnelblick's installer, and Notch apple finishes connecting your server automatically once it's installed. After that, every **Connect** goes straight through.

You can also install it with Homebrew: `brew install --cask tunnelblick`. For WireGuard `.conf` profiles, Notch apple offers the free [WireGuard](https://apps.apple.com/app/wireguard/id1451685025) app from the Mac App Store the same way.

### Step 2: Turn on the VPN module

Go to **Settings → Modules** and switch **VPN** on. A **VPN** tab and a **VPN on/off** pill appear in the notch.

### Step 3: Pick a free server (nothing to download)

1. Open the notch and go to the **VPN** tab. The **Free library** list loads automatically. It has about 270 free OpenVPN servers from [github.com/Zoult/.ovpn](https://github.com/Zoult/.ovpn), grouped by country. Type in **Search country** to filter.
2. Click **Connect**. Notch apple downloads that server's `.ovpn`, saves it to **Downloads**, and opens it in Tunnelblick or OpenVPN Connect.
3. In Tunnelblick, click **OK / Install**, then click **Connect**.
4. If it asks for a username and password, use the login for that provider:

| Server label | Username and password |
| --- | --- |
| **IPSpeed** | None needed |
| **VPNBook** | Shown on [vpnbook.com/freevpn](https://www.vpnbook.com/freevpn). It changes regularly, so copy it fresh |
| **FreeVPN4You** | Shown on that country's page at [freevpn4you.net](https://freevpn4you.net) |
| **FreeOpenVPN** | Shown on that country's page at [freeopenvpn.org](https://www.freeopenvpn.org) |
| **VPN Gate** (second tab) | `vpn` / `vpn` |

Notch apple opens the right login page for you when you click **Connect**. Click ☆ to keep a server in **My profiles**.

### Or use your own `.ovpn` / `.conf`

- **VPN Gate website:** at [vpngate.net](https://www.vpngate.net/en/), click **OpenVPN Config file** next to any server and download the TCP or UDP `.ovpn`. The login is `vpn` / `vpn`.
- **Proton VPN free plan (most reliable):** create a free account at [protonvpn.com](https://protonvpn.com). Then go to **Account → Downloads**, choose **OpenVPN configuration files** (macOS, a free server) or **WireGuard configuration**. For OpenVPN, log in with the **OpenVPN / IKEv2 username** shown in your account, not your normal login.
- **Work or your own server:** use the file your admin gives you.

Import it with **VPN → +** in the notch, or **Settings → VPN → Import .ovpn or .conf file…**, then click **Connect**.

### Check it's working

Tunnelblick or WireGuard shows **Connected**, and [whatismyipaddress.com](https://whatismyipaddress.com) shows the server's country. Disconnect from Tunnelblick or WireGuard.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| "One-time setup: install the VPN helper" | Click **Install** and follow the Tunnelblick installer (Step 1). |
| A server won't connect | Free servers come and go. Try another, or switch between TCP and UDP. |
| "Auth failed" | The password has changed. Copy the current one from the provider's page (see the table above). |
| The server list won't load | GitHub or vpngate.net may be blocked on your network. Import a Proton VPN file instead. |

> **Privacy note:** free public servers are run by third parties and may keep logs. They're fine for getting around region blocks or on public Wi-Fi, but use a provider you trust for anything sensitive. The server list is fetched live from GitHub; no configs are bundled in the app.

## Build from source

> **Releasing?** Always build the DMG with `./scripts/build_dmg.sh`. It signs the app with a stable identity, so permissions like Accessibility and Screen Recording keep working after people update. A DMG built another way makes macOS treat every build as a new app, and approved permissions stop working.

Requirements: Xcode 16 or later, and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
git clone <this repo>
cd NotchApples
xcodegen generate
open NotchApple.xcodeproj
```

To build a DMG:

```bash
scripts/build_dmg.sh
```

The DMG is written to `dist/`.

### Project layout

```
NotchApple/
  App/        AppDelegate, NotchPanel + window controller (click-only notch)
  Core/       SettingsManager (module toggles), secret storage, Theme
  UI/         NotchRootView (glass shell), SettingsView
  Modules/
    Biometrics/  LocalAuthentication gate + Vision webcam face unlock
    Claude/      Messages API client, ScreenCaptureKit capture, chat UI
    Search/      Spotlight (NSMetadataQuery) file search + results UI
    Shelf/       Drop zone + security-scoped bookmarks
    Sharing/     AirDrop + PairDrop (Network.framework / Bonjour)
    Messenger/   Nearby Wi-Fi chat (MultipeerConnectivity) + encrypted rooms (CryptoKit, ntfy / MQTT relay)
    Audio/       CoreAudio routing, native process-tap volume + EQ, BackgroundMusic fallback
    VPN/         NetworkExtension manager, free server library, VPN Gate, profile import
    NowPlaying/  Music / Spotify distributed-notification monitor
    Windows/     Accessibility window snapping, drag-to-notch snap zones, tiling, saved layouts
NotchWidget/  WidgetKit extension
Shared/       Code shared by the app and widget (weather, shared store)
```

## Why some features need a paid Apple Developer account

Notch apple is built to cost nothing, so the public DMG is **ad-hoc signed**. A few Apple capabilities are only available to builds signed by a paid developer team. The free build handles each of these gracefully:

| Capability | Free build | Signed build |
| --- | --- | --- |
| **VPN tunnels** (Network Extension entitlement) | Hands the profile to the free WireGuard, Tunnelblick, or OpenVPN Connect app | Connects natively. Add a Packet Tunnel Provider target (`com.notchapple.app.tunnel`, for example with wireguard-apple) and the Network Extension entitlement |
| **WeatherKit** | Uses [Open-Meteo](https://open-meteo.com), which is free and needs no key | Add the WeatherKit capability and set the Swift flag `-D WEATHERKIT` |
| **App Group** (widget now-playing) | The widget shows weather and calendar only | Add `group.com.notchapple.shared` to both targets |

### Included third-party software

| Software | Why | Licence |
| --- | --- | --- |
| [Tunnelblick](https://github.com/Tunnelblick/Tunnelblick) 9.0.1 installer, unmodified and notarized by its developer | Connects OpenVPN profiles | GPL-2.0 (licence and source link shipped in the app) |
| [BackgroundMusic](https://github.com/kyleneideck/BackgroundMusic) 0.5.0 installer, unmodified | Optional per-app audio on macOS 14.0–14.1 | GPL-2.0 |

### Per-app audio on macOS 14.0–14.1

Per-app volume and EQ use Core Audio process taps, which arrived in macOS 14.2. On 14.0–14.1, install the **BackgroundMusic** audio driver from **Settings → Audio → Install BackgroundMusic driver…** (it's included in the app) to get per-app volume. BackgroundMusic is © Kyle Neideck and contributors, GPL-2.0, and is included unmodified with its licence. Source: [kyleneideck/BackgroundMusic](https://github.com/kyleneideck/BackgroundMusic).

## Privacy

- Everything runs on your Mac. The only network requests are:
  - the AI provider you chose (Gemini, Groq, OpenRouter, Anthropic or OpenAI), using your own key, when you chat. Ollama stays on your Mac
  - `api.github.com` to check for updates (can be turned off) and `github.com` to download one you accept
  - `open-meteo.com` for weather
  - `api.github.com` / `raw.githubusercontent.com` for the free VPN server list, and `vpngate.net`, only when you open the VPN tab
- PairDrop and Nearby Wi-Fi chat never leave your local network.
- Anonymous room messages are end-to-end encrypted before they leave your Mac, and the relay (`ntfy.sh`, or a public MQTT broker as a fallback) stores nothing.
- Per-app audio is processed in memory on your Mac. Nothing is recorded.
- Window management only reads window positions, sizes and titles to arrange them. Saved layouts stay on your Mac.
- Your API keys and face-unlock template are stored in `~/Library/Application Support/Notch apple/secrets.json`, readable only by your user account (and encrypted at rest by FileVault if it's on). Face photos are never saved.
- Search only asks Spotlight's local index. Nothing you search for leaves your Mac.

## License

[MIT](LICENSE)
