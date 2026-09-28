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

---

## Features

Every module is **optional** and can be switched on or off in **Settings → Modules**.

| Module | What it does |
| --- | --- |
| ✨ **Claude** | Chat with Claude from the notch using **your own** Anthropic API key, which is stored in the Keychain. Tap **Share Screen** to attach a screenshot so Claude can see what you're looking at. |
| 🗂 **File Shelf** | Drag files and folders onto the notch. They stay there across relaunches thanks to security-scoped bookmarks. Double-click to open, or drag them back out. |
| 📡 **Share** | Send files with **AirDrop**, or use **PairDrop**: sharing between devices on the same Wi-Fi, found over Bonjour and paired with a 6-digit code. No server is involved. |
| 🔊 **Audio** | Pick the output device, set the master volume, and change **per-app volume** and **per-app EQ** through the free [BackgroundMusic](https://github.com/kyleneideck/BackgroundMusic) driver. |
| 🛡 **VPN** | Import WireGuard `.conf` or OpenVPN `.ovpn` profiles, or browse the free [VPN Gate](https://www.vpngate.net) relays. |
| 🎵 **Now Playing** | Shows the current track from Apple Music or Spotify. |
| 🔐 **Biometric Lock** | Requires Touch ID, Apple Watch, or your password before the notch opens. |
| 🧩 **Widget** | A desktop widget (and Lock Screen widget on newer macOS) showing weather, now playing, and your next calendar events. |

**The notch opens only when you click it.** There are no hover triggers anywhere in the app. Press `Esc` or click anywhere else to close it.

## Install

1. Download the latest `NotchApple-x.y.z.dmg` from [**Releases**](../../releases).
2. Open it and drag **Notch apple** into **Applications**.
3. The app is ad-hoc signed, not notarized, so on first launch right-click the app and choose **Open**, then confirm. (Or run `xattr -dr com.apple.quarantine "/Applications/Notch apple.app"`.)
4. Click the notch, or the menu-bar icon, to get started.

On a Mac without a notch, a slim pill appears at the top center of the menu bar instead.

## Permissions

| Permission | Used by | When it's asked |
| --- | --- | --- |
| Screen Recording | Claude → Share Screen | The first time you share your screen |
| Local Network | PairDrop | When you turn PairDrop on |
| Calendars | Widget | When the widget first loads |
| Touch ID / password | Biometric Lock | Each time you open the notch while the lock is on |

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
    Biometrics/  LocalAuthentication gate
    Claude/      Messages API client, ScreenCaptureKit capture, chat UI
    Shelf/       Drop zone + security-scoped bookmarks
    Sharing/     AirDrop + PairDrop (Network.framework / Bonjour)
    Audio/       CoreAudio routing, BackgroundMusic per-app volume, EQ
    VPN/         NetworkExtension manager, VPN Gate, profile import
    NowPlaying/  Music / Spotify distributed-notification monitor
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

Per-app volume needs the open-source BackgroundMusic driver. Per-app EQ settings are saved, and `EQStore.apply(_:)` is the hook where a DSP backend plugs in.

## Privacy

- Everything runs on your Mac. The only network requests are:
  - `api.anthropic.com`, using your own key, when you chat with Claude
  - `open-meteo.com` for weather
  - `vpngate.net`, only when you open the relay list
- PairDrop traffic never leaves your local network.
- Your API key is stored in the macOS Keychain (`WhenUnlockedThisDeviceOnly`).

## License

[MIT](LICENSE)
