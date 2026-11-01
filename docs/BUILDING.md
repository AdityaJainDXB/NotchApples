# Building Notch Apple from source

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

Run the tests (pure logic: readable maths, answer parsing, input suggestions, provider errors). They don't launch the app:

```bash
xcodebuild test -project NotchApple.xcodeproj -scheme NotchAppleTests
```

Retake the README and website screenshots (needs [Ollama](https://ollama.com/download) with `ollama pull gemma3:4b`; it builds a separate demo copy with sample data and captures only its windows):

```bash
scripts/screenshots.sh --site web
```

Add promo codes for Pro (codes go to the git-ignored `private/` folder; only hashes are published). Add the new hashes to `PROMOS` in `server/license-worker/src/worker.js` too, then redeploy the license server:

```bash
python3 scripts/promo_codes.py --add 25 --site web/pro.html
```

### Contributing

Issues and pull requests are welcome.

1. Open an [issue](https://github.com/AdityaJainDXB/NotchApples/issues) first for anything bigger than a small fix, so we can agree on the approach.
2. Keep each module optional and off the main thread; follow the surrounding code's style and comments.
3. Run the tests and build the app before opening a pull request. If you change the UI, run `scripts/screenshots.sh` and include the updated screenshots.
4. Never commit API keys, promo codes or anything from `private/`.

> **Building from the public source:** the Ultimate modules are not in this repository (they are in a private one and built into official releases only). Everything else builds and runs; the Convert, Smart Home, Claude usage, Do It and Purge tabs show a note saying they are in the official build.

### Build the Windows app

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

That tag also refreshes the one-click link behind the **Download for Windows** button (the `windows-latest` release, with the fixed file name `NotchApple-Windows-Setup.exe`), so the README never needs editing for a new version.

### Mac project layout

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

### Windows project layout

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

## Why some features need a paid Apple Developer account

Notch Apple is built to cost nothing, so the public DMG is **ad-hoc signed**. A few Apple capabilities are only available to builds signed by a paid developer team. The free build handles each of these gracefully:

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
| [f1-circuits](https://github.com/bacinger/f1-circuits) map data by Tomislav Bacinger | The real F1 circuit layouts in the Racing game | MIT |

### Per-app audio on macOS 14.0–14.1

Per-app volume and EQ use Core Audio process taps, which arrived in macOS 14.2. On 14.0–14.1, install the **BackgroundMusic** audio driver from **Settings → Audio → Install BackgroundMusic driver…** (it's included in the app) to get per-app volume. BackgroundMusic is © Kyle Neideck and contributors, GPL-2.0, and is included unmodified with its licence. Source: [kyleneideck/BackgroundMusic](https://github.com/kyleneideck/BackgroundMusic).
