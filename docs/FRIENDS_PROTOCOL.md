# Friends protocol v1 (Messenger → Friends)

One document for every client (Mac Swift, Windows JS/Rust) and the server (`server/room-relay`). If a byte layout here and the
code disagree, the code is wrong. Primitives are the ones both platforms have natively: **X25519, Ed25519, HKDF-SHA256,
AES-256-GCM, SHA-256**. Nothing here is a new cipher.

## 1. Identity (made once, kept forever)

Each install holds, in the Keychain (Mac) or the OS credential store (Windows):

| Item | What | Size |
| --- | --- | --- |
| `sign` | Ed25519 key pair (signs everything this install sends) | 32 B public |
| `dh` | X25519 key pair (receives sealed messages) | 32 B public |
| `code` | **Friend code**: 10 random characters from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U), 50 bits. Shown as `ABCDE-FGHJK`. | 10 chars |

The code is an **address, not a secret**. Knowing it lets someone send a *friend request*, never a message (§5).

Derived values:

- `box = hex( SHA-256("notchapple-friends-v1|box|" + CODE)[0..16] )` (32 hex characters). The server only ever sees `box`,
  never the code. Code and `box` are different lengths and unrelated by anything but this hash.
- `fp = SHA-256( signPub || dhPub )[0..16]`: the key fingerprint, used in QR codes.
- **Safety number** between A and B: order the two byte strings `signPub||dhPub` by their lowercase hex (smaller first), `h1 = SHA-256(first||second)`,
  `bytes = h1 || SHA-256(h1)`; group *i* (0…11) is `uint32BigEndian(bytes[4i..4i+4]) mod 100000`, zero-padded to 5 digits, groups joined by spaces.
  Both people see the same 60 digits; reading them aloud proves no one is in the middle.

QR / link form of a code: `notchapple://friend?c=<CODE>&k=<base64url fp>`. When a friend is added from this form the client
checks the keys the server returns against `fp`, so a malicious server cannot swap keys. A **typed** code has no `fp`; for those
the safety number is the check.

## 2. Server objects (Durable Object `Mailbox`, one per `box`, SQLite-backed, free plan)

```
keys      { sign, dh, claimedAt }          set once by /claim
allow     set of sha256(sendToken)         who may send messages here
queue     ordered sealed blobs             deleted on ack or after 14 days
requests  ordered sealed friend requests   max 20 pending
lastAuth  highest auth timestamp seen      replay guard
```

The server stores no names, codes, texts or friend lists. It cannot tell which tokens belong to which person.

## 3. Requests and authentication

All endpoints are under `https://<relay>/f/`. Bodies are JSON, UTF-8, ≤ 24 KB.

**Owner-authenticated** calls (reading your own mailbox, changing `allow`, wiping) carry the header
`x-nf-auth: <ts>.<sigB64url>` (plus `x-nf-box: <box>` on `PUT /f/allow`, `DELETE /f/allow/{hash}` and `POST /f/wipe`, so the front door knows which mailbox) where `ts` is milliseconds and
`sig = Ed25519(sign, "nf1\n" + METHOD + "\n" + path + "\n" + ts + "\n" + hex(SHA-256(body)))`. The server checks the signature
with the stored `sign`, requires `|now − ts| ≤ 5 min` and `ts > lastAuth`, then sets `lastAuth = ts`. The client uses
`max(now, lastSent + 1)`.

| Call | Auth | Purpose |
| --- | --- | --- |
| `POST /f/claim {box, sign, dh}` | self-signed with `sign` over the body, `ts` as above | First use of a `box` stores the keys. Same keys again: 200. Different keys for a claimed box: **409**. |
| `GET /f/key/{box}` | none | `{sign, dh}` of a claimed box, else 404. Rate limited (§7). |
| `POST /f/req {to, blob}` | none | A sealed friend request into `to`'s `requests`. Always answers `202`, whether or not `to` exists. |
| `POST /f/send {to, token, blob, live?}` | `token` | A sealed message. Needs `sha256(token) ∈ allow(to)`, else **403**. `live:true` (typing) is forwarded to open sockets and never stored. |
| `PUT /f/allow {hash}` / `DELETE /f/allow/{hash}` | owner | Add or revoke one `sha256(sendToken)` in my `allow`. Max 500. |
| `GET /f/ws/{box}` (WebSocket) | owner (header or `?a=<ts>.<sig>`) | Live delivery. On open the server sends `{requests:[…], queue:[…]}`, then pushes new items. |
| `{ack:[ids]}` over the socket | owner | Deletes those items from `queue` / `requests`. |
| `POST /f/wipe` | owner | Deletes keys, `allow`, `queue`, `requests`. |

Item ids are `<seq>` numbers the server assigns. Blob limits: request ≤ 4 KB, message ≤ 16 KB. A mailbox holds at most 300
queued messages and 512 KB; past that `/f/send` answers **507** ("their mailbox is full") and nothing is dropped silently.

## 4. Sealing

Every blob is `sealed(recipientDH, kind, inner)`:

```
eph      = fresh X25519 key pair
shared   = X25519(eph.private, recipientDH)
key      = HKDF-SHA256(ikm = shared, salt = "notchapple-friends-v1", info = "seal|" + recipientBox + "|" + base64url(eph.public), 32 B)
nonce    = 12 random bytes
blob     = base64url( eph.public (32) || nonce (12) || AES-256-GCM(key, nonce, plaintext = inner, aad = recipientBox + "|" + kind) || tag (16) )
```

`kind` is `req` or `msg`. The inner plaintext is JSON `{ "b": <string>, "s": <sigB64url> }` where `b` is the body **serialised once, as a JSON string** by the sender and
`s = Ed25519(sender.sign, "nf1-inner\n" + recipientBox + "\n" + kind + "\n" + b)`. The receiver verifies `b` exactly as received and
only then parses it, so there is no canonical-JSON problem between Swift and JavaScript. A sealed box alone is anonymous
(anyone can seal to a public key), so the signature is what proves the sender; the recipient verifies it with the friend's
`sign` key and drops anything that fails.

Properties: only the recipient can read it; the sender is authenticated; a fresh ephemeral key per message gives
sender-side forward secrecy. It does **not** give recipient-side forward secrecy (see the threat model; a ratchet is v2).

## 5. Friend lifecycle (this is what stops "a code alone lets a stranger message you")

Bodies (`t` = type):

```
req   {t:"req", box, sign, dh, nick?, token, ts}       token = a fresh random 32-byte sendToken for the REQUESTER'S mailbox
acc   {t:"acc", box, sign, dh, nick?, token, ts}       token = a fresh sendToken for the ACCEPTER'S mailbox
msg   {t:"msg", id, ts, text}                           text ≤ 2000 characters
rcpt  {t:"rcpt", id, state:"delivered"|"read"}
typing{t:"typing"}                                      sent with live:true
gone  {t:"gone"}                                        "I removed you"; optional courtesy
```

1. **A adds B** by code or QR. A computes `boxB`, calls `GET /f/key/{boxB}` (verifying against `fp` if it came from a QR), registers
   a fresh `tokenA` for its own box (`PUT /f/allow`), seals `req` to B's `dh`, and `POST /f/req`. A's client shows **Pending**.
2. B's socket delivers the request. The client verifies the signature, checks the sender's fingerprint is not on the block list,
   and shows a small notification: *"Someone wants to be friends"* with `nick` (sanitised, 32 chars, shown as untrusted text)
   and the safety number. **Accept** or **Block**.
3. **Accept:** B registers a fresh `tokenB` for its own box, seals `acc` to A (containing `tokenB`), and posts it with
   `/f/send` using `tokenA` (from the request). B may now send messages to A, A may send to B once it reads `acc`. Both clients mark
   the friendship **Active** only when each has the other's keys **and** a token. Before that, an incoming `msg` is dropped.
4. **Block:** B stores A's fingerprint on a local block list, never replies, never revokes anything on the server (A's
   `req` is simply dropped, nothing tells A). Later requests from the same fingerprint are dropped silently; a new identity (new
   install) would arrive as a new request, which is why the per-mailbox cap and the rate limits exist.
5. **Remove friend:** revoke `tokenA`-equivalent: `DELETE /f/allow/{hash(tokenOfThatFriend)}`; delete the local
   conversation; send `gone` if still allowed. **Delete all my chat data:** `POST /f/wipe`, delete the local history, friends,
   tokens and block list, and (optionally) the identity.

Delivery states: **sent** = the server answered 2xx; **delivered** = the friend's client posted `rcpt delivered`; **read** =
`rcpt read` when the chat is open and visible. Receipts are optional and can be switched off (then the state stops at sent).

## 6. Local storage

History, friends, nicknames and tokens live on the device only: `~/Library/Application Support/Notch Apple/Friends/` (Mac) as one
file sealed with AES-GCM under a random key kept in the Keychain; the private keys and the code are in the Keychain itself. Nothing
is synced to iCloud or included in the settings export.

## 7. Limits (per rolling minute unless said)

- `/f/req`: 3 per sender-IP-hash per `to`, 10 per sender-IP-hash per hour overall, 20 pending per mailbox.
- `/f/key`: 30 per IP hash. `/f/send`: 120 per token. `/f/claim`: 5 per IP hash per hour.
- WebSocket: one live socket per owner key (a new one replaces the old); 60 frames per second as the rooms relay does.
- The IP hash is `SHA-256(day + ip)` computed in memory for the limiter; no IP is written to storage or logs.

## 8. Platform notes

- **Mac / iPhone:** CryptoKit (`Curve25519.KeyAgreement`, `Curve25519.Signing`, `AES.GCM`, `HKDF<SHA256>`).
- **Windows:** the same primitives from the platform WebCrypto where the WebView supports X25519/Ed25519 (WebView2 on current
  Windows 10/11), otherwise Rust (`x25519-dalek`, `ed25519-dalek`, `aes-gcm`, `hkdf`) behind Tauri commands. A shared test vector file
  (`server/room-relay/test/friends-vectors.json`) is checked by the Swift, JS and server tests so all three agree byte for byte.

## Files and groups (Mac client; additive, no server change)

New body types inside the same sealed `msg` blobs. Older clients ignore keys and `t` values they do not know, so nothing breaks.

| `t` | Fields | Meaning |
| --- | --- | --- |
| `chunk` | `from, id, fname, fn, fi, fd, g?` | One piece of a file. `id` is the file's message id, `fn` the chunk count (1…20), `fi` this piece (0-based), `fd` up to 8,000 bytes as base64url. The receiver keeps the pieces until all `fn` have arrived, then stores the file and shows one message. Files are at most 160,000 bytes: a sealed blob is limited to about 16 KB by the relay (`MAX_MSG_BLOB`), and a mailbox to 512 KB. A partial file is dropped after 10 minutes. |
| `grp` | `from, g, gname, gm, ts` | Invite or change for a group: `gm` lists every member's mailbox including the sender's and the receiver's. Accepted only from an active friend who is in `gm`, only if the receiver is in `gm`, and a change only from whoever made the group. Up to 20 members. |
| `gmsg` | `from, g, id, text, ts` | A group message. Accepted only from a member who is an active friend of the receiver. |
| `gleave` | `from, g` | The sender left the group. |

There is no group server. A group message is sealed and sent once per member over the existing friend links, so everyone only receives from members who are also their friends. File names are reduced to their last path component and never opened automatically: the Mac shows the file in Finder.
