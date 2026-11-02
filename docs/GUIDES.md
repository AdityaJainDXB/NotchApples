# Guides

How to use the bigger features of Notch Apple. Back to the [README](../README.md).

## Face unlock

Unlock Notch Apple by looking at your Mac's camera.

1. Go to **Settings → Authentication** and turn on **Lock Notch Apple**.
2. Click **Set up face unlock…** and allow camera access. Follow the prompts (look straight, turn slightly left and right, tilt up and down) while it takes six photos.
3. Click **Test…** to check it recognises you. Good, even lighting helps.
4. Now when you open the notch, a **Face ID-style** animation asks you to look at the camera and **blink**. It turns into a green check with a trackpad tap when it recognises you, and shakes red if it doesn't. **Use Touch ID** is always there as a fallback.

How it works: Apple's Vision framework finds your face in each photo and turns it into a *feature print* (a list of numbers). Only those numbers and a match threshold calibrated from your own photos are saved in a private file on this Mac that only your user account can read. The photos themselves are never saved or sent anywhere. Unlocking needs several matching frames **and a blink**, which stops a printed photo from working. **Delete face data…** removes the template; it asks for Touch ID or your password first.

> **Limits:** a regular FaceTime camera is 2D, unlike Apple's Face ID, which uses a 3D depth camera. Someone who looks like you, or a good enough video, might get through, so treat face unlock as a convenience rather than strong security. It unlocks Notch Apple only. macOS doesn't let third-party apps unlock the Mac itself or replace its login.

## Using Messenger

Open the notch and click the 💬 tab. Your handle (for example `MistyOwl#769`) is shown top right; change it in **Settings → Messenger**.

**Nearby Wi-Fi.** Anyone on the same network with Notch Apple and Messenger open appears automatically ("2 people nearby on Wi-Fi"). Just type. This uses Apple's MultipeerConnectivity with encryption required, and works without internet.

**Create a room.** In **Anonymous room** mode, press **New room**. Notch Apple makes a private, hard-to-guess code (like `ember-puffin-4576-2rjc`), joins it, and copies it to your clipboard. Paste it to your friends; they paste it into the room box and press **Join**. **Copy code** copies it again at any time.

**Join a room.** Type any room code and press **Join**. Everyone who enters the same code (`#Cafe-Study`, `cafe-study` and `CAFE-STUDY ` all count as the same) is in the same room and shown as "3 online".

**Friends (private chat with people you know).** Pick **Friends** in the mode switch. Every install has a random **friend code** (10 letters and numbers, like `7KQ2M-X4PTB`), shown with a Copy button and a QR code in **Settings → Messenger → Friends**. To add someone, type or paste their code (or a picture of their QR, copied to the clipboard, with **Paste a QR image**) and press the person icon. They get a small notification and choose **Accept** or **Block**. Until they accept, neither of you can send a message, so a code on its own never lets a stranger write to you.

Each friend has their own chat with *sent / delivered / read* and a "typing…" line. If they are offline, the encrypted message waits on the server for up to 14 days and is deleted as soon as it arrives. Messages are encrypted on your Mac and only your friend's Mac can read them; the server sees random IDs and encrypted data, never names, codes or text. Press **Safety number** in a chat and read the numbers out (in person or on a call): if they match on both Macs, nobody is in the middle. Right-click a friend for **Nickname**, **Remove friend** and **Block**. **Delete all my chat data** in Settings wipes your friends, history and block list here and on the server (your friend code stays). History is stored only on your Mac. The technical details and what is not protected (for example the server can see *when* messages are sent) are in [docs/FRIENDS_PROTOCOL.md](FRIENDS_PROTOCOL.md) and [docs/PLAN_REMOTE_AND_FRIENDS.md](PLAN_REMOTE_AND_FRIENDS.md).

**On Windows (BETA).** Windows has the same Friends and the two apps can chat with each other. In Messenger, pick **Friends** next to **Rooms**. **My code** shows your friend code (Copy, Copy link, QR code), the name shown in requests, the receipts switch and **Delete all my chat data**; **Add** takes a typed code or a `notchapple://friend?c=…&k=…` link (there is no "Paste a QR image" on Windows yet; paste the link from the QR instead). Unread messages and waiting requests show on the closed notch like Rooms. Your keys, vault key and the encrypted history are three small files in the app's data folder (`Friends\`), not in the Windows Credential Manager, and are never synced. It has been tested against the real relay software and the Mac's test vectors, but not yet on real Windows hardware, so please report anything odd.

How rooms stay private:
- The code is hashed on your Mac with SHA-256 into two separate values: a topic name for the relay, and a 256-bit AES-GCM key.
- The relay only ever sees a random-looking topic and encrypted bytes. It never sees the room name, your handle or your messages.
- Messages are relayed live through the free, open-source [ntfy.sh](https://ntfy.sh) service over HTTPS (port 443, so it works on school and office Wi-Fi). Each message is sent with `Cache: no`, so the relay stores nothing. Public MQTT brokers are used as a fallback.
- Chat history only lives in memory. **Settings → Messenger → Clear chat history and disconnect** wipes it.

> Anyone who knows the code can join the room, and short numeric codes are easy to guess. For a private chat, use **New room**, which makes a code with about a trillion possibilities.

**Notifications.** When someone messages you while the notch is closed or you're on another tab, you get a macOS notification (sender, message and room), the closed notch grows a small purple dot, and the Messenger tab shows a badge. Click the notification to jump straight to the chat. Messenger keeps listening in the background, rejoining your last room when Notch Apple starts. Turn notifications or message previews off in **Settings → Messenger**.

Turn off **Allow local network discovery** in **Settings → Messenger** to stay invisible on your Wi-Fi.

## Using the VPN

Notch Apple doesn't run any VPN servers. It organises free VPN profiles and connects them for you. A **profile** is a small text file that says which server to connect to and how: `.ovpn` for **OpenVPN** or `.conf` for **WireGuard**.

Notch Apple hands the profile to a VPN helper app that makes the actual connection. **You don't need to download anything yourself:** the free, open-source [Tunnelblick](https://tunnelblick.net) installer (notarized by its developer) is **included inside Notch Apple**.

### Step 1: One-time setup (automatic)

The first time you click **Connect** on an OpenVPN server, Notch Apple shows **"One-time setup: install the VPN helper"**. Click **Install**, follow Tunnelblick's installer, and Notch Apple finishes connecting your server automatically once it's installed. After that, every **Connect** goes straight through.

You can also install it with Homebrew: `brew install --cask tunnelblick`. For WireGuard `.conf` profiles, Notch Apple offers the free [WireGuard](https://apps.apple.com/app/wireguard/id1451685025) app from the Mac App Store the same way.

### Step 2: Turn on the VPN module

Go to **Settings → Modules** and switch **VPN** on. A **VPN** tab and a **VPN on/off** pill appear in the notch.

### Step 3: Pick a free server (nothing to download)

1. Open the notch and go to the **VPN** tab. The **Free library** list loads automatically. It has about 270 free OpenVPN servers from [github.com/Zoult/.ovpn](https://github.com/Zoult/.ovpn), grouped by country. Type in **Search country** to filter.
2. Click **Connect**. Notch Apple downloads that server's `.ovpn`, saves it to **Downloads**, and opens it in Tunnelblick or OpenVPN Connect.
3. In Tunnelblick, click **OK / Install**, then click **Connect**.
4. If it asks for a username and password, use the login for that provider:

| Server label | Username and password |
| --- | --- |
| **IPSpeed** | None needed |
| **VPNBook** | Shown on [vpnbook.com/freevpn](https://www.vpnbook.com/freevpn). It changes regularly, so copy it fresh |
| **FreeVPN4You** | Shown on that country's page at [freevpn4you.net](https://freevpn4you.net) |
| **FreeOpenVPN** | Shown on that country's page at [freeopenvpn.org](https://www.freeopenvpn.org) |
| **VPN Gate** (second tab) | `vpn` / `vpn` |

Notch Apple opens the right login page for you when you click **Connect**. Click ☆ to keep a server in **My profiles**.

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
