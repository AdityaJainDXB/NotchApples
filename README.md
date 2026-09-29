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

| | |
| --- | --- |
| ![Today](docs/screenshots/today.png) | ![Focus timer](docs/screenshots/focus.png) |
| **Today**: weather, next events, battery | **Focus**: Pomodoro timer |
| ![Messenger](docs/screenshots/messenger.png) | ![AirDrop and PairDrop](docs/screenshots/share.png) |
| **Messenger**: an anonymous, end-to-end-encrypted room | **Share**: AirDrop and PairDrop |
| ![File Shelf](docs/screenshots/shelf.png) | ![Audio](docs/screenshots/audio.png) |
| **File Shelf**: drop files into the notch | **Audio**: output, master and per-app volume and EQ |
| ![VPN](docs/screenshots/vpn.png) | ![Now Playing](docs/screenshots/nowplaying.png) |
| **VPN**: your profiles and free servers | **Now Playing** |
| ![Settings: Permissions](docs/screenshots/settings-permissions.png) | ![Settings: Authentication](docs/screenshots/settings-authentication.png) |
| **First launch**: every permission in one place | **Face unlock**: Face ID-style |
| ![Settings](docs/screenshots/settings-general.png) | ![Settings: Modules](docs/screenshots/settings-modules.png) |
| **Settings**: a sidebar of panes, like System Settings | **Settings → Modules**: every feature is optional |
| ![Settings: AI History](docs/screenshots/settings-ai-history.png) | ![AI tab](docs/screenshots/claude.png) |
| **Settings → AI History**: every chat, with the model that answered | **AI**: free providers, switch in the notch |
| ![Windows](docs/screenshots/windows.png) | ![Snap zones under the notch](docs/screenshots/window-snap-zones.png) |
| **Windows**: snap, tile and save window layouts | **Drag a window to the notch** and drop it on a zone |
| ![Settings: Windows](docs/screenshots/settings-windows.png) | ![Settings: VPN](docs/screenshots/settings-vpn.png) |
| **Settings → Windows**: snap zones, shortcuts, gaps | **Settings → VPN**: free servers and your profiles |
| ![Settings: Audio](docs/screenshots/settings-audio.png) | |
| **Settings → Audio**: built-in per-app engine | |

## Features

Every module is **optional** and can be switched on or off in **Settings → Modules**.

| Module | What it does |
| --- | --- |
| ☀️ **Today** | The date, current weather, your next calendar events (with a **Now** badge for meetings in progress) and battery at a glance. |
| ⏱ **Focus** | A Pomodoro timer: 25-minute focus sessions and 5-minute breaks, with a long break every 4th session. While it runs, **the countdown shows beside the closed notch**. You get a notification and a sound when each session ends. Lengths are adjustable in **Settings → Focus**. |
| 🔋 **Charging** | Plug in or unplug the charger and the notch briefly shows your battery level. Turn it off in **Settings → General**. |
| ✨ **AI** | Chat from the notch with **free** AI (Google Gemini, Groq, OpenRouter's free models, or Ollama on your Mac) or with your own key for **DeepSeek**, Claude or ChatGPT. **Ask "what's on my screen?"** and it takes a screenshot and answers about what you're actually looking at. One-click actions summarise, translate or fix what you copied. Every chat is saved in **Settings → AI History** with the model that answered. See [AI in the notch](#ai-in-the-notch). |
| 🪟 **Windows** | A split-screen window manager. **Drag any window up to the notch** and a strip of snap zones drops down: halves, quarters (4 windows on one screen), thirds, two-thirds, fill and center. Or snap from the Windows tab, or with `⌃⌥` + arrow keys. **Arrange all** tiles every window on the screen at once (split screen, 3 columns, a 4/6/9 grid, main + stack, cascade). Save a whole layout and put every window back in one click. See [Window management](#window-management). |
| 📝 **Notes** | Quick notes in the notch: several notes, search, a "new note from clipboard" button, and saved automatically on your Mac. |
| 💬 **Messenger** | Chat anonymously with **people on the same Wi-Fi** (found automatically, encrypted between Macs), or **create or join an anonymous room** with a code, like `cafe-study` or `8821`. Rooms are end-to-end encrypted, and nothing is stored anywhere. You get a random handle like `PurplePanda#402`, and there are no accounts. See [Using Messenger](#using-messenger). |
| 📋 **Clipboard** | Everything you copy (text, links, images and files) is saved to a searchable history in the notch. Click an item to copy it again, pin the ones you want to keep, and filter by type. Items that password managers mark as secret are never saved, and history stays on your Mac. Choose how many items to keep in **Settings → Clipboard**. |
| 🗂 **File Shelf** | Drag a file onto the notch and it opens straight to the shelf. Files stay there across relaunches thanks to security-scoped bookmarks. Double-click to open, or drag them back out. There's also an **Add files…** button. |
| 📡 **Share** | Send files with **AirDrop**, or use **PairDrop** between devices on the same Wi-Fi. To receive, just show your 6-digit code. To send, type the other device's code; there's no need to pick the device. No server is involved. |
| 🔊 **Audio** | Pick the output device, set the master volume, and change **per-app volume (0–150%)** and a **10-band per-app EQ** with presets. It's built in on macOS 14.2+, with nothing to install. |
| 🛡 **VPN** | A built-in list of **free OpenVPN servers** from [Zoult/.ovpn](https://github.com/Zoult/.ovpn) and [VPN Gate](https://www.vpngate.net), or import your own `.ovpn` / `.conf`. See [Using the VPN](#using-the-vpn). |
| 🎵 **Now Playing** | Shows the current track from Apple Music or Spotify. |
| 🔐 **Biometric Lock** | Requires Touch ID, Apple Watch, your password, or **face unlock** (your Mac's camera) before the notch opens. See [Face unlock](#face-unlock). |
| 🧩 **Widget** | Small, medium and large desktop widgets with local weather, now playing, and your next calendar events. (macOS has no lock screen widget type yet; Apple's lock screen widget sizes are iPhone and iPad only.) |

**Live activities:** like the iPhone's Dynamic Island, the closed notch shows small indicators on either side: the focus countdown, battery when charging, and a purple dot for unread messages.

![Focus countdown beside the notch](docs/screenshots/live-activity.png)

**Open the notch by clicking it, pressing `⌘E` in any app, or dragging a file onto it.** Press `Esc` or `⌘E`, or click anywhere else, to close it.

**Open on hover (optional, off by default):** turn it on in **Settings → General**. The notch then opens when the pointer rests on it and closes when the pointer moves away. Click inside to keep it open while you type or drag. With the option off, hovering only highlights the notch.

`⌘E` is a system-wide shortcut registered through Carbon, so it needs no Accessibility permission. While it's on, other apps won't receive `⌘E` (for example "Use Selection for Find"). You can turn it off in **Settings → General**.

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

The gap between windows, the drag-to-notch zones and the shortcuts can be changed in **Settings → Windows**. Accessibility is tied to the app's signature, so after an update macOS may stop honouring it: if snapping stops working, remove Notch apple from the Accessibility list and turn it on again.

Other things new in 1.11: the notch **remembers the last tab** you had open.

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
| [**1.11.0**](https://github.com/AdityaJainDXB/NotchApples/releases/download/v1.11.0/NotchApple-1.11.0.dmg) | 31 MB | **Windows**: drag a window to the notch to snap it, split screen, 4-window grid, thirds, tile all windows, saved layouts, `⌃⌥` shortcuts. The notch remembers its last tab. The latest version. |  |

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
| Accessibility | Windows (snapping and tiling) | When you first use the Windows tab. Only used to move and resize windows |
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

Model lists are loaded live from each provider, so new models appear automatically, and you can type any model ID. The official DeepSeek API has no free tier; free DeepSeek models sometimes appear in Groq's and OpenRouter's free lists. Keys are stored in your Keychain and sent only to that provider.

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

How it works: Apple's Vision framework finds your face in each photo and turns it into a *feature print* (a list of numbers). Only those numbers and a match threshold calibrated from your own photos are saved, in the **macOS Keychain** (this Mac only, readable only while it's unlocked). The photos themselves are never saved or sent anywhere. Unlocking needs several matching frames **and a blink**, which stops a printed photo from working. **Delete face data…** removes the template; it asks for Touch ID or your password first.

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
  Core/       SettingsManager (module toggles), Keychain, Theme
  UI/         NotchRootView (glass shell), SettingsView
  Modules/
    Biometrics/  LocalAuthentication gate + Vision webcam face unlock
    Claude/      Messages API client, ScreenCaptureKit capture, chat UI
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
  - `open-meteo.com` for weather
  - `api.github.com` / `raw.githubusercontent.com` for the free VPN server list, and `vpngate.net`, only when you open the VPN tab
- PairDrop and Nearby Wi-Fi chat never leave your local network.
- Anonymous room messages are end-to-end encrypted before they leave your Mac, and the relay (`ntfy.sh`, or a public MQTT broker as a fallback) stores nothing.
- Per-app audio is processed in memory on your Mac. Nothing is recorded.
- Window management only reads window positions, sizes and titles to arrange them. Saved layouts stay on your Mac.
- Your API key and face-unlock template are stored in the macOS Keychain (`WhenUnlockedThisDeviceOnly`). Face photos are never saved.

## License

[MIT](LICENSE)
