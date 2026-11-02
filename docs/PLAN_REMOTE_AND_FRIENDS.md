# Plan: Friends chat and remote view/control (staged)

Status: **plan, nothing built yet.** Written 2 November 2026 after reading `CompanionKit/`, `NotchCompanion/`,
`NotchApple/Core/CompanionServer.swift`, `NotchApple/Modules/Messenger/*`, `server/room-relay`, `NotchWindows/src/js/modules/messenger.js`.
The wire format for Friends is in [FRIENDS_PROTOCOL.md](FRIENDS_PROTOCOL.md).

## 0. What the code is today (what we extend)

- **iPhone companion:** the Mac listens on a random TCP port (`NWListener`), advertises `_notchapple._tcp` over Bonjour, pairs with a
  12-character one-time code (60 bits, 5 tries, 2 minutes, ephemeral X25519 mixed in), then every request is one connection:
  `[4-byte length][JSON envelope]`, body sealed with ChaChaPoly under a key from a 32-byte token, with a rising counter
  (`checkSequence`). Phone side: `CompanionClient.swift` finds the Mac with Bonjour only. Ultimate-tier feature.
- **Messenger:** `Mode { nearby, room }` in `NotchMessengerView.swift`. Rooms: hash the room code twice (topic + AES-GCM key), live
  relay over Notch Apple's Cloudflare Worker (`server/room-relay`, Durable Object `Room`, **no storage**) plus ntfy/MQTT backups.
  `MessengerNotifier` handles the macOS notification and the unread dot. Windows has a 39-line `messenger.js`.
- **Toolchain note:** you said there's no Xcode locally, but `scripts/release.sh` has just compiled and archived 2.1.78 here
  (`xcode-select -p` → `/Applications/Xcode.app`, Xcode 27.1). So real compiles and the Mac app's own tests *can* run on this
  machine; I will use them instead of only `swiftc -parse`, and still say clearly what could not be run (no second Mac, no phone
  on cellular, no Windows machine).

## 1. Order, and what each release is

Version numbers: Mac and Windows share `2.1.N` (docs/VERSIONING.md). Latest published is **2.1.78**; I run `git fetch --tags` and
`gh release list` before each release and only go up.

| Stage | Contents | Mac version | Windows |
| --- | --- | --- | --- |
| **b** | Friends on the Mac + the server (Mailbox in `server/room-relay`) | 2.1.79 | unchanged |
| **c** | Remote reach over Tailscale + view-only streaming (phone app + Mac) | 2.1.80 | unchanged |
| **d** | Remote control + notch content on the phone | 2.1.81 | unchanged |
| **e** | Windows ports of Friends and the companion protocol | 2.1.82 | 2.1.82 BETA, "untested on real hardware" |

A stage that can't be finished safely ships smaller rather than late. Every stage: tests, build, launch the Mac app, then release,
install on your Mac, prune.

## 2. Feature 2: Friends (details in the protocol doc)

**Server (stage b).** Extend `server/room-relay` (it already has Durable Objects, WebSockets and rate limiting, and it is the only
thing that has to be deployed for this feature). New class `Mailbox` (SQLite-backed, free plan), new routes under `/f/`; `/<topic>/ws`
and `/clip/…` stay untouched, so Nearby and Room keep working. **No paid service:** DO SQLite storage is in the Workers free plan
(5 GB, 100k requests/day); WebSocket hibernation keeps idle sockets from costing duration. If the free limits ever bite I will ask
before touching anything paid.

**What you deploy by hand (stage b):**

```bash
cd ~/Documents/Software\ Projects/NotchApples/server/room-relay
git pull
npx wrangler deploy
```

The deploy applies migration `v2` (`new_sqlite_classes = ["Mailbox"]`) from `wrangler.toml`. No new secrets, no KV, no new account.
Check afterwards with `curl https://notchapple-rooms.adityajain1225.workers.dev/f/key/00000000000000000000000000000000` (expect `404`).

**Mac client (stage b).** New `NotchApple/Modules/Messenger/Friends/`: `FriendIdentity` (Keychain keys + code), `FriendCrypto` (seal/open per the
protocol), `FriendsStore` (sealed local history), `FriendsClient` (WebSocket + HTTP, reconnect), `FriendsView` (list, request
sheet, chat with sent/delivered/read and typing, safety number), a "Friends" case in `Mode`, a Settings → Messenger section (your
code, Copy, QR, nicknames, receipts, block list, remove, "Delete all my chat data"). Notification: a small badge top-right of the
open-or-closed notch and the existing `MessengerNotifier`, with its preview setting, skipping delivery while a Focus is on.
New files go into `project.yml` and the pbxproj (regenerated with XcodeGen as the repo does); pure logic (`FriendCrypto`, the state machine)
goes in a file with no AppKit so `scripts/run-app-tests.sh` can test it.

**Tests:** shared test vectors (Swift, JS, server); server tests with a fake DO (claim, 409, request cap, token required,
revocation, ack, TTL, 507, wipe, rate limits, replay); Swift logic tests; a two-process end-to-end test against `wrangler dev`
locally if it runs here.

### Threat model: Friends

Assets: message text and who talks to whom; your identity keys; your friend list.
Attackers considered: a stranger who learns your code; someone who guesses codes; a network observer; **the relay operator
(Cloudflare, or a hacked relay)**; a friend who turns hostile; someone with your unlocked Mac; someone who steals the files.

| Threat | Defence |
| --- | --- |
| Stranger with your code messages you | The code only allows a `req`. Messages need a `sendToken` you issue at Accept. Requests are capped, rate limited, signed, blockable. |
| Guessing codes to find users | 50-bit codes, 30 key lookups/min/IP; `/f/req` always answers 202. (Not a hard guarantee: a determined botnet could enumerate slowly; the space is 10^15.) |
| Relay reads messages | Sealed to the recipient's key with AES-GCM; the relay holds ciphertext, random box ids and token hashes. |
| Relay (or a hacked one) swaps public keys at add time | QR adds are checked against `fp`. Typed adds are **not**: use the safety number compare. |
| Forged messages "from a friend" | Every inner body is Ed25519-signed by the sender and verified against the key pinned at Accept. |
| Replay of an old blob | Message ids are remembered; a duplicate id is dropped. Server auth has timestamp + monotonic guard. |
| Stolen disk | History is AES-GCM sealed under a Keychain key. |
| Spam from a blocked person | Silent drop locally; their token is revoked on remove. A new identity can request again (limits apply). |

**Not protected (said plainly):**
- **Metadata.** The relay and Cloudflare see when a mailbox is read or written, blob sizes, IP addresses at connect time, how many
  tokens a mailbox has issued (its number of friends), and the pending-request count. We don't log IPs, but we can't stop Cloudflare seeing them.
- **No recipient-side forward secrecy.** If someone steals your private `dh` key *and* a recorded ciphertext, they can read that
  ciphertext. (Fix is a double-ratchet; planned for a later version, not v1.)
- **A malicious Mac or malware** reads the Keychain and the history.
- **A friend can screenshot or forward** what you send.
- **Typed-code adds without a safety-number check** can be intercepted by a malicious relay.
- **Deleting my data** wipes the server mailbox and local data, but cannot delete what a friend already stored.
- **Availability.** Whoever runs the relay can stop it; messages queue for 14 days at most.

## 3. Feature 1: Remote view and control over Tailscale

**Stage c: reach the Mac and view-only.**
- The Mac companion keeps its sealed request protocol and pairing unchanged (`protocolVersion` stays 1; `stream` is additive, phones that
  don't know it are untouched). It listens on a **fixed, configurable port** (default 47813) instead of a random one, and
  Settings → iPhone shows the Tailscale address (the `100.64.0.0/10` address on the `utun` interface, plus the MagicDNS name if present)
  with a status: Tailscale not running, Mac asleep, listening.
- **Nothing exposed publicly:** the listener accepts only peers in private ranges (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`,
  `100.64/10`, `fd00::/8`, `fe80::/10`); anything else is closed at accept. Pairing still needs the code; every later call still needs
  the token; the Mac never opens a port on the router.
- The phone: "Connect over Tailscale" takes the address (typed, or filled in from the QR the Mac shows next to the pairing code) and shows
  states: Tailscale off (can't reach `100.x` / no route), Mac asleep (timeout), wrong key (reply `error`), connected.
- **Stream:** new long-lived connection `type: stream` (same framing; session key `HKDF(token, salt = nonceMac||nonceIphone, info = "stream-v1")`;
  frames carry a counter used as the AES-GCM nonce so frames can't be replayed or reordered). ScreenCaptureKit → VideoToolbox H.264
  (hardware encoder, keyframe every 2 s, bitrate adapts to send-queue depth and RTT, cap 15 fps, scaled to the phone's size);
  JPEG tiles as a fallback if VideoToolbox is unavailable. Display choice from the phone. Phone decodes with
  `AVSampleBufferDisplayLayer`, with pinch-zoom and pan. Screen Recording not granted → the Mac replies `permission`, the phone shows how to fix it.

**Stage d: control and notch content.**
- Separate switch on the Mac: **Allow remote control** (off by default) *and* a per-phone "this phone may control" toggle set on the
  Mac in advance (you can't click Allow when you're away). While a control session is active: a red indicator in the menu bar and on the
  notch ears, a notification, and a **kill switch** (button in the notch, ⌃⌥⇧K, ends on lock/sleep/phone disconnect). Controls are
  `input` messages (tap, drag, scroll, key, shortcut) replayed with `CGEvent`, rate limited (200/s), clamped to the chosen display,
  need Accessibility (existing permission flow, reusing the Do It input helpers where they fit).
- Notch content: new `snapshot`/`push` message kinds for Now Playing, clipboard, notes, to-do and alerts. **Live Activity:** local updates
  are possible with the free Apple ID build; *remote* updates through push need a paid developer account (APNs), so on the free route
  it will only update while the phone app is connected. I'll say so in the app.
- **Fallback if our own stream is too heavy:** macOS Screen Sharing (VNC) or Windows Remote Desktop over Tailscale, with a setup
  page in Settings → iPhone.

### Threat model: Remote view and control

Assets: everything on your screen; the ability to act as you.
| Threat | Defence |
| --- | --- |
| Someone on the internet reaches the Mac | No public port; listener accepts only private/Tailscale peers; Tailscale is an authenticated WireGuard tunnel (use Tailscale ACLs to limit to your phone). |
| Someone on the same Wi-Fi/tailnet sniffs or replays | Sealed with the pairing token; per-session key; frame counters; the existing request counter. |
| A stolen phone | Revoke it in Settings → iPhone (token deleted); control is off unless that phone was explicitly allowed; kill switch. Lock the phone (the app uses Face ID gate, planned). |
| Pairing code guessed | Unchanged: 60 bits, 5 tries, 2 minutes, ephemeral keys. |
| Silent control | Indicator + notification while controlled; session ends on lock/sleep; off by default. |

**Not protected:** a compromised Tailscale account or an over-permissive tailnet ACL (anyone on the tailnet can *try* the port;
they still need the token); malware on the Mac or phone; someone looking at your screen; the stream is sensitive data and metadata (when
you connect) is visible to Tailscale; macOS can't inject input into secure password fields; control **can** click "Allow" prompts,
so keep it off unless you need it.

## 4. iPhone app: free Apple ID vs a paid developer account

Today: sideloaded with Sideloadly, free Apple ID, 7-day expiry (it asks you to reinstall weekly). I keep that route working in every
stage (no entitlement that needs a paid team in the default build: no push, no App Groups, no associated domains).

If you get a paid Apple Developer account ($99/yr; I won't enrol or pay for you), you do by hand: enrol; create the App ID
`com.notchapple.companion` and enable Push Notifications and Live Activities (and App Groups if we add a widget); create a Distribution
certificate and provisioning profile; set `DEVELOPMENT_TEAM` and signing in `project.yml`; create the app in App Store Connect; archive and upload with
`xcodebuild archive` + `xcodebuild -exportArchive` (or Transporter); add yourself in TestFlight; for remote Live Activity updates also create an APNs key (.p8) and tell me
where it goes (a Worker secret). Until then, remote Live Activity updates are not possible.

## 5. Honest limits of testing

- Swift: I can compile with `xcodebuild` here and run `scripts/run-app-tests.sh`, but I can't run two Macs or a phone on cellular. The
  Tailscale path, ScreenCaptureKit permission prompts and CGEvent control need your hands: I'll give you an exact checklist per stage.
- JS (Windows): `node --test` for the protocol and crypto vectors; the Tauri side can only be compiled by CI, and a real Windows PC is needed
  to confirm capture, SendInput and the credential store. Windows ships as **BETA, untested on real hardware**.
- Server: unit tests with a fake DO, plus `wrangler dev` end-to-end if it runs on this machine; real deployment is yours.

## 6. Decisions I'm making unless you object

1. Message sealing is **AES-256-GCM** (not ChaCha) so Mac, Windows WebCrypto and Rust all match; the existing companion keeps ChaChaPoly.
2. v1 has **no recipient-side forward secrecy** (ratchet later) and **text only** (no files/images yet); 14-day offline delivery, 300 messages max per mailbox.
3. Friends is **free** for everyone (not Pro/Ultimate); the remote view/control stays under the existing **Ultimate** iPhone companion gate.
4. The remote stream uses a **fixed port 47813**, configurable.
