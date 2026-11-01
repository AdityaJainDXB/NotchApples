# Reference

Permissions, keyboard shortcuts, troubleshooting, the live activities API and privacy. Back to the [README](../README.md).

## Permissions

On first launch, Notch Apple opens **Settings → Permissions**. It shows everything in one place, with a switch or **Allow** button for each, and all of it is optional:

- **Open at login / run in the background:** registers Notch Apple as a login item. If macOS asks, approve it under **System Settings → General → Login Items & Extensions** ("Allow in the Background").
- **Notifications:** messages and focus timer alerts.
- **Location:** local weather in Today and the widget (approximate location only). Without it, weather uses the city you choose in **Settings → Widget**.
- **Calendars:** your next events.
- **Camera:** only for face unlock.

The table below lists when each is asked for.

| Permission | Used by | When it's asked |
| --- | --- | --- |
| Screen Recording | AI capture (<kbd>⌃⌥S</kbd>), "what's on my screen?", Text Grab | The first time you capture. macOS applies it after Notch Apple restarts; the AI tab offers **Open System Settings** and **Relaunch** if it's missing |
| Local Network | PairDrop, Messenger (Nearby Wi-Fi) | The first time either looks for nearby devices |
| Calendars | Widget | When the widget first loads |
| Touch ID / password | Biometric Lock | Each time you open the notch while the lock is on |
| Location | Weather | The first time you open Today (approximate location, weather only) |
| Camera | Face unlock | When you set up or use face unlock. Only a face template is saved, never photos |
| Full Disk Access (optional) | Search, Notifications add-on | Never asked automatically. Only if you choose to, so Search can include protected folders, or the Notifications tab can read Notification Center's list |
| Automation (Music, Spotify, Messages) | Lyrics, iMessage replies | The first time lyrics look up the song position, or you send a reply |
| Microphone status | Devices add-on | Never asked: it only checks whether the mic is in use, and never records |
| Accessibility | Windows (snapping and tiling), Snippets and Clipboard paste, AI → Use selected text | When you first use the Windows tab. Used to move and resize windows, to paste snippets into the app in front, and to read the text you selected. Copy and paste works without it |
| System audio recording | Audio → per-app volume / EQ | The first time you change an app's volume or EQ. Audio is processed on your Mac and never recorded or sent anywhere |

## Keyboard shortcuts

| Shortcut | Does |
| --- | --- |
| <kbd>⌃⌥S</kbd> | Capture for AI, from any app (even with the notch hidden) |
| <kbd>⌘J</kbd> | Open or close the notch (it was <kbd>⌘E</kbd> or <kbd>⌃⌥N</kbd> before 2.0.24) |
| <kbd>⌃⌥O</kbd> | Hide or show the whole notch (`⌘O` before 2.0.6) |
| <kbd>⌃⌥</kbd> + arrows, <kbd>↩</kbd>, <kbd>C</kbd>, <kbd>⌫</kbd> | Snap the front window: halves, maximise, centre, restore |
| <kbd>Esc</kbd> | Close the notch, or cancel a capture |
| In the AI tab: <kbd>↩</kbd> | Send / run |
| <kbd>⌘⇧V</kbd> | Paste an image or text as the input |
| <kbd>⌘.</kbd> · <kbd>⌘R</kbd> | Stop · Retry |
| <kbd>⌘⇧C</kbd> · <kbd>⌘N</kbd> | Copy the answer · New task |

Change the three global shortcuts in **Settings → Shortcuts & Hotkeys**. They use macOS's built-in hot keys, so they need no Accessibility permission and work in full-screen apps.

## Troubleshooting

- **Captures show only the wallpaper, or say Screen Recording is needed.** Turn on Notch Apple in System Settings → Privacy & Security → Screen & System Audio Recording, then relaunch it (the AI tab has both buttons). After an update, if it still fails, remove Notch Apple from that list with **−** and add it again.
- **⌃⌥S does nothing.** Another app may own the combination: Settings → Shortcuts & Hotkeys shows a warning; pick another shortcut.
- **"Can't read images".** The selected model is text only. Pick a vision model (any Gemini model, or `gemma3:4b` in Ollama).
- **"Isn't available" / "rate-limiting you".** The model was retired (Notch Apple switches automatically) or the free tier is busy: wait a minute and press Retry, or switch provider.
- **Ollama isn't running.** Install it from [ollama.com](https://ollama.com/download), open it, and run `ollama pull gemma3:4b`.
- **macOS says the app can't be opened.** It isn't notarized: right-click → Open, or System Settings → Privacy & Security → Open Anyway.
- **A payment for Pro couldn't be verified.** Use the **Need help?** link under the error on the Get Pro page; it fills in your transaction ID.

## Live activities API

*Ultimate.* Show your own live activity beside the closed notch, from Terminal, Shortcuts or your own app. Activities only exist on your Mac, in memory.

```bash
open -g "notchapple://activity?id=build&title=Build&text=42%25&symbol=hammer.fill&progress=0.42&color=34C759&seconds=600"
open -g "notchapple://activity/end?id=build"
```

Or use the helper in [scripts/notch-activity](../scripts/notch-activity) (also `notch activity …` in [scripts/notch](../scripts/notch), which can open tabs, start timers, ask the AI, add notes and to-dos, and switch themes):

```bash
scripts/notch-activity build --title Build --symbol hammer.fill --progress 0.3
scripts/notch-activity build --end
```

From an app, post a distributed notification named `com.notchapple.activity` with the same keys in `userInfo` (add `end: true` to remove it).

| Key | Meaning |
|---|---|
| `id` | Required. Updating the same id replaces it |
| `title` | Up to 14 characters, left ear |
| `text` | Up to 16 characters, right ear |
| `symbol` | Any SF Symbol name |
| `progress` | 0 to 1; without `text` it draws a bar |
| `color` | `RRGGBB` |
| `seconds` | How long it stays (default 10 minutes, up to 12 hours) |

Up to five at a time; the most recently updated one shows (two with **Two activities at once**).

## Privacy

- Everything runs on your Mac. **Settings → Privacy** shows all of this live. The only network requests are:
  - the AI provider you chose (Gemini, Groq, OpenRouter, DeepSeek, Anthropic or OpenAI), using your own key, and only when you ask: your question, the image you captured or pasted, and that conversation. With **Ollama** or **Apple Intelligence** nothing leaves your Mac, and the notch shows **On this Mac**
  - `api.github.com` to check for updates (can be turned off) and `github.com` to download one you accept
  - `open-meteo.com` for weather (and the cities you add to the forecast, Pro)
  - `site.api.espn.com` for public scores in Sports, Live, F1 and Tennis, and `api.jolpi.ca` / `api.openf1.org` / F1's public timing archive for F1: nothing about you is sent
  - the plugin gallery's list and the plugins you choose to install, from `raw.githubusercontent.com` (Ultimate)
  - iCloud Drive, only for settings, notes and to-dos you choose to sync
  - your own iPhone on your local Wi-Fi, only if you turn on the iPhone companion (Ultimate); nothing leaves your network
  - `api.github.com` / `raw.githubusercontent.com` for the free VPN server list, and `vpngate.net`, only when you open the VPN tab
  - open.er-api.com for currency rates, only when you convert a currency (Pro)
  - DuckDuckGo, only when you turn on web search in the AI tab (Pro): just your question
  - CoinGecko and Yahoo Finance for Markets (Pro), ADSB.lol for live flight status (Pro) and the Flight Radar tab: only the symbols and flight numbers you add, and your location rounded to about 1 km while the Flight Radar tab is open
  - Apple's speech recognition when you dictate (on this Mac when your Mac supports it)
  - your plugins, which run whatever their scripts do (you install them)
  - GitHub, only when you choose to send feedback, a bug report or a crash report (you review it and submit it yourself)
  - your own Home Assistant on your local network, only if you set up Smart Home (Ultimate): the token is kept in the Keychain
  - the clipboard link relay (`notchapple-rooms`, Cloudflare), only if you set a link code: it forwards sealed bytes it cannot read and stores nothing; secrets are never sent
  - `speed.cloudflare.com` for the speed test and a tiny Cloudflare page for the internet-drop check, only when you run them or turn the check on
  - Windows only, if you turn on the experimental notification peek: Windows' own notification list on this PC is read (read-only) to flash the newest notification beside the pill. It stays on the PC: nothing is stored or sent, and the temporary copy used when Windows has the list locked is deleted straight away
  - the license server, only if you agree to the anonymous user count or send feedback (a random install id, app version, OS version and plan; the text you typed), and if you activate a signed key: activating or deactivating sends the key and a one-way hash of your Mac (salted per key, so it can't be linked across keys) to enforce the 3-Mac limit, and about once a day it downloads the signed list of turned-off keys (nothing about you is sent). The website's `api.json` says where the server is. Keys are checked offline; without internet, activation still works
- PairDrop and Nearby Wi-Fi chat never leave your local network.
- Anonymous room messages are end-to-end encrypted before they leave your Mac, and the relay (`ntfy.sh`, or a public MQTT broker as a fallback) stores nothing.
- Per-app audio is processed in memory on your Mac. Nothing is recorded.
- Window management only reads window positions, sizes and titles to arrange them. Saved layouts stay on your Mac.
- Your API keys and face-unlock template are stored in `~/Library/Application Support/Notch apple/secrets.json`, readable only by your user account (and encrypted at rest by FileVault if it's on). Face photos are never saved.
- Search only asks Spotlight's local index. Nothing you search for leaves your Mac.
- Captures are kept in memory while you work. AI history (with captured images, up to 1600 px) is saved only in `~/Library/Application Support/Notch apple/`; turn it off, stop keeping images, or set it to delete old chats in Settings → AI History. **Extract text** runs entirely on your Mac.
- At checkout your email is used only to send your key and for "Lost my key?"; once you've paid, the server keeps only a salted hash of it.
- No telemetry or analytics unless you switch it on. Settings → Help & Feedback → **Count this Mac in the user numbers** (off until you say yes, on Windows under Settings → Feedback and numbers) sends a random id made on your computer, the app version, the OS version and your plan about once a day, and nothing else: no name, email, licence or address, and the server keeps no IP address. The feedback card in the notch (about every three to four weeks; Not now skips it) sends only what you type, when you press Send. Signing in with Google is optional and only syncs your setup and Pro to your other Macs.
