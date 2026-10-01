# Notch apple for Windows

A Windows build of [Notch apple](../README.md), written with [Tauri 2](https://tauri.app)
(Rust shell + web UI). It is a **separate app, not a port of the Swift code** —
the macOS app is ~91% SwiftUI/AppKit and Apple-only frameworks, none of which
exist on Windows.

Windows PCs have no camera notch, so the collapsed state is a slim pill pinned
to the **top centre of your screen**. Clicking it drops the panel down, the same
way the Mac version opens out of the notch.

## What's in it

| Tab | Notes |
| --- | --- |
| ☀️ **Today** | Date, clock, local weather (free Open-Meteo, no key), battery, uptime |
| ✨ **AI** | Gemini, OpenRouter, Groq, Ollama, ChatGPT, Claude. Asks about your screen by taking a screenshot. Carries over the OpenRouter retry/fallback, so a busy free model switches to one that works |
| 🌐 **Browser** | Address bar + search (DuckDuckGo, Google, Bing, Brave, Ecosia). Pages open in a separate always-on-top window, because the panel is only ~450 px tall |
| 🚀 **Launcher** | Pick from everything in your Start Menu, click a tile to open it |
| 🔍 **Search** | Finds files and folders in Desktop, Documents, Downloads, Pictures, Music, Videos and OneDrive |
| 📋 **Clipboard** | History of what you copy while the app runs |
| 📝 **Notes** · ⏱ **Focus** · 🕐 **World Clock** · 🛠 **Tools** | Same as macOS |
| 🈯 **Translator** | 7 languages with a pronunciation line (pinyin, Latin for Arabic/Hindi) |
| 📊 **PC Stats** | Live RAM, CPU, network speed, disk and battery |
| 🗂 **Shelf** | Drop files to keep them handy |
| ⚙️ **Settings** | All 14 colour themes, module switches, AI keys, licence, shortcuts |

**Access codes carry over.** The same 50 codes work on Windows and macOS — the app
ships only their SHA-256 hashes, exactly like the Mac build. On Windows a code
unlocks the **AI** tab (Messenger, Audio and VPN are listed too, for when they
arrive). The Mac app's code additionally unlocks Voice Notes, Screen Time and
Quick Add, which have no Windows equivalent yet.

### Shortcuts

| Keys | What it does |
| --- | --- |
| `Ctrl + Alt + N` | Open or close the notch, from any app |
| `Ctrl + Alt + O` | Hide or show the notch completely |
| `Esc` | Close the notch while it is open |

Windows reserves most Win-key combinations, so `Ctrl + Alt` is used instead of
the Mac's `⌃⌥N` / `⌘O`.

## What doesn't carry over

| Feature | Why |
| --- | --- |
| AirDrop | Apple-only. PairDrop could be added later; it is web-based |
| Face unlock | Built on Apple's Vision framework; Windows Hello is not open to apps the same way |
| Notification Center widget | Windows widgets are a different system entirely |
| Window snapping | Windows already has Snap Layouts and PowerToys FancyZones |
| Per-app volume | Windows has this built into the volume mixer |
| VPN tab | Tunnelblick is macOS-only; use the OpenVPN GUI for Windows |

## Building

The frontend is plain HTML/CSS/ES modules — **no Node, no bundler, no build step**.
Only Rust is needed.

```bash
cargo install tauri-cli --version "^2" --locked
cd NotchWindows/src-tauri
cargo tauri dev     # run it
cargo tauri build   # installers in target/release/bundle/
```

**A Windows build cannot be produced on a Mac.** Push a tag starting with
`win-v` (or run the *Windows build* workflow by hand from the Actions tab) and
GitHub Actions builds the `.exe` and `.msi` on a real Windows runner —
see [.github/workflows/windows-build.yml](../.github/workflows/windows-build.yml).

## Layout

```
NotchWindows/
├── src/                     frontend (no build step)
│   ├── index.html
│   ├── css/app.css          shell, pill, tab bar, shared widgets
│   └── js/
│       ├── app.js           tab routing, collapse/expand, feature gating
│       ├── themes.js        the 14 colour themes
│       ├── license.js       access-code hashes, shared with macOS
│       ├── store.js         persistence + DOM helpers
│       └── modules/         one file per tab
└── src-tauri/               Rust
    ├── src/main.rs          commands, tray, global shortcuts, window placement
    ├── src/system.rs        RAM, CPU, network, disk, battery
    ├── src/apps.rs          installed apps (Start Menu on Windows)
    └── src/files.rs         file search
```
