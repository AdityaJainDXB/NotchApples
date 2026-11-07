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
queue     ordered sealed blobs             deleted on ack, on /f/purge, or after 14 days (each also keeps the hash of the send token that
                                           queued it and, if the sender gave one, an opaque `tag`; see "Clear chat" below)
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
| `POST /f/send {to, token, blob, live?, tag?}` | `token` | A sealed message. Needs `sha256(token) ∈ allow(to)`, else **403**. `live:true` (typing) is forwarded to open sockets and never stored. `tag` (8–64 characters of `A-Za-z0-9_-`, optional) labels the queued item with the chat it belongs to; anything that is not a valid tag is simply not kept. |
| `POST /f/purge {to, token, tag}` | `token` | **Clear chat.** Deletes from `to`'s queue every item that was queued with this same token and this same `tag`, and answers `{ok:true, removed:n}`. Needs `sha256(token) ∈ allow(to)`, else **403**, so only a friend that mailbox accepted can ask, and it can only ever remove what that same friend queued, never another friend's messages and never another chat's. Rate limited to 30 a minute per token. A relay from before 2.2.43 answers **404**; clients ignore that. |
| `PUT /f/allow {hash}` / `DELETE /f/allow/{hash}` | owner | Add or revoke one `sha256(sendToken)` in my `allow`. Max 500. |
| `GET /f/ws/{box}` (WebSocket) | owner (header or `?a=<ts>.<sig>`) | Live delivery. On open the server sends `{requests:[…], queue:[…]}`, then pushes new items. |
| `{ack:[ids]}` over the socket | owner | Deletes those items from `queue` / `requests`. |
| `POST /f/wipe` | owner | Deletes keys, `allow`, `queue`, `requests`. |

Item ids are `<seq>` numbers the server assigns. Blob limits: request ≤ 4 KB, message ≤ 16 KB. A mailbox holds at most 700
queued messages and 4.5 MB (a 2 MB file is 250 pieces); past that `/f/send` answers **507** ("their mailbox is full") and nothing is dropped silently.

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
- `/f/key`: 30 per IP hash. `/f/send`: 300 per token. `/f/claim`: 5 per IP hash per hour.
- WebSocket: one live socket per owner key (a new one replaces the old); 60 frames per second as the rooms relay does.
- The IP hash is `SHA-256(day + ip)` computed in memory for the limiter; no IP is written to storage or logs.

## 8. Platform notes

- **Mac / iPhone:** CryptoKit (`Curve25519.KeyAgreement`, `Curve25519.Signing`, `AES.GCM`, `HKDF<SHA256>`).
- **Windows:** the same primitives from the platform WebCrypto where the WebView supports X25519/Ed25519 (WebView2 on current
  Windows 10/11), otherwise Rust (`x25519-dalek`, `ed25519-dalek`, `aes-gcm`, `hkdf`) behind Tauri commands. A shared test vector file
  (`server/room-relay/test/friends-vectors.json`) is checked by the Swift, JS and server tests so all three agree byte for byte.

## Files and groups (Mac 2.2.4 and the Windows port; additive, no server change)

New body types inside the same sealed `msg` blobs. Older clients ignore keys and `t` values they do not know, so nothing breaks.

| `t` | Fields | Meaning |
| --- | --- | --- |
| `chunk` | `from, id, fname, fn, fi, fd, g?` | One piece of a file. `id` is the file's message id, `fn` the chunk count (1…250), `fi` this piece (0-based), `fd` up to 8,000 bytes as base64url. The receiver keeps the pieces until all `fn` have arrived, then stores the file and shows one message. Files are at most 2,000,000 bytes (Mac 2.2.8; before that 160,000 and 20 pieces, so an older app silently ignores a file of more than 20 pieces): a sealed blob is limited to about 16 KB by the relay (`MAX_MSG_BLOB`), so a file goes as one message per piece, paced at about 4 a second and retried when the relay answers 429; a mailbox holds 4.5 MB for a friend who is offline. A partial file is dropped after 10 minutes. |
| `grp` | `from, g, gname, gm, ts` | Invite or change for a group: `gm` lists every member's mailbox including the sender's and the receiver's. Accepted only from an active friend who is in `gm`, only if the receiver is in `gm`, and a change only from whoever made the group. Up to 20 members. |
| `gmsg` | `from, g, id, text, ts` | A group message. Accepted only from a member who is an active friend of the receiver. |
| `gleave` | `from, g` | The sender left the group. |

There is no group server. A group message is sealed and sent once per member over the existing friend links, so everyone only receives from members who are also their friends. File names are reduced to their last path component and never opened automatically: the Mac shows the file in Finder.

**Windows.** The Windows app (`NotchWindows/src/js/services/friendslogic.js` for the rules, `friends.js` for the network and disk, `modules/messengerfriends.js` for the screen) sends and accepts the same `chunk`, `grp`, `gmsg` and `gleave` bodies with the same field names (`g, gname, gm, fname, fn, fi, fd`) and the same limits, so Mac and Windows friends see each other's files and group messages. Differences in how each app keeps things, none of which show on the wire: the Windows vault has a `groups` array (a vault saved before groups existed loads as "no groups"); received and sent files are stored one sealed file each next to the vault (`Friends\f-<sha256 of the id>.bin`, AES-GCM under the vault key) and shown in Explorer, never opened; a partial file is kept in memory only. `NotchWindows/tests/friendsfiles.test.mjs` checks the rules, and that a worst-case sealed chunk (8,000 bytes, 64-character ids, an 80-character name that JSON must escape) is about 15,200 characters, under the relay's 22,000 (`MAX_MSG_BLOB`). **2 MB files on Windows (matches Mac 2.2.8).** `MAX_CHUNKS` is 250 and `MAX_FILE_BYTES` 2,000,000 in `friendslogic.js`; the sender uses `sendPieces` there, the same as the Mac's `deliverFile`: about 220 ms between pieces, and when `/f/send` answers 429 it waits 8 s and sends the same piece again, up to 8 times per piece, then stops and marks the message failed. A Windows app from before this change drops a file of more than 20 pieces without telling the sender, the same as an older Mac. A received file is staged for Explorer by the `friends_stage_file` command, whose limit was raised to 2,000,000 bytes (it was 200,000, which would have refused the file in the last step). Tests: `friendsfiles.test.mjs` (250 pieces, 2,000,000 bytes, pacing and retry). **Status: written and unit-tested in Node, but not yet run on real Windows hardware or against a real Mac.**

## Clear chat (Mac 2.2.43 and Windows 2.2.43; additive, and one new relay call)

Either person in a one-to-one chat, or any member of a group, can wipe that chat for everybody in it. The friendship or group stays; only the conversation goes. **Notch Apple removes its own copies. It cannot erase screenshots, anything a person copied or saved outside the app, or a modified client that ignores the request.** An app from before 2.2.43 does not know the message and ignores it (below), so both people need the new version for a clear to take effect on their side.

**Wire.** One new body type in the same sealed `msg` blobs, signed like every other:

| `t` | Fields | Meaning |
| --- | --- | --- |
| `clr` | `from, ce, ts, g?` | "I cleared this chat." `ce` is the chat's new **clear epoch** (an integer, 1 to 1,000,000), `ts` is when it was made (milliseconds), and `g` is the group id for a group chat (absent for a one-to-one chat). Sent to the friend, or to every member who is an active friend for a group. |

`msg`, `gmsg` and `chunk` bodies gain one optional field, `ce`: the sender's clear epoch for that chat when the message was written (0 if it was never cleared). Older apps skip fields they do not know.

**Epochs (ordering).** Every chat has an epoch on each device, 0 until the first clear. Clearing sets it to `max(own epoch, highest `ce` seen in the chat) + 1`. A receiver applies `clr` only if the sender is an active friend (for a group: a member of it) and `ce` is greater than its own epoch for that chat; the same or an older clear is ignored, so applying twice is harmless. Applying it:

- removes every message whose `ce` is **lower** than the new epoch, keeps those with an equal or higher `ce` (they were sent after the clear and happened to arrive before it), and puts one line in the chat, "<name> cleared this chat";
- deletes the saved files of the removed messages, half-received file pieces of that chat, copies placed in the temp folder for Finder/Explorer, delivered Mac notifications for the chat, and resets the unread count;
- from then on drops any message, file piece or receipt-bearing message whose `ce` is lower than the epoch, which is what stops an old message that is retried, queued or delivered late from coming back.

Messages from apps that predate clearing carry no `ce`. For those the clear's `ts` decides: a message with no epoch dated at or before the newest clear's time is dropped (clocks differ between devices, so this one case is best effort). Two people clearing at the same moment both reach epoch N+1 and each ignores the other's equal clear, so the result is the same on both sides. In a group, a member whose app was offline past the relay's 14 days misses the clear, and its later messages (still on the old epoch) are dropped by the others until it catches up; it keeps its own copy of the old messages until then.

**On the relay.** A message is queued for an offline friend as usual and waits until they connect, so a clear sent to an offline friend waits behind the earlier messages and is applied when they come online (the old messages are applied first and then wiped, in order). To also remove what is *still queued* for that chat, the sender labels each queued message with `tag = hex(SHA-256("notchapple-clear-v1|" + sendToken + "|" + chatKey))[0..32)` (`chatKey` is the friend's `box` for a one-to-one chat, `g:<id>` for a group) and, when clearing, first calls `POST /f/purge` for each recipient with the same token and tag, **then** sends the `clr` (so the purge can never remove the clear). The tag is different for every friend link, so the relay cannot tell that messages in two mailboxes belong to one group, and it contains nothing readable. What a relay deploy changes: it adds `/f/purge`, the optional `tag` on `/f/send`, and two small fields (`th`, `tag`) on newly queued items. Without the deploy, clearing still works through the `clr` message itself; only the early removal of still-queued items is missing, and the receiver's epoch rule drops those items on arrival anyway.

**Delivery.** The sender keeps a small list of members that have not been told yet (`pendingClears`, in the sealed local history), tries again whenever the connection comes up, and forgets a member when the relay accepts the `clr` or answers 403 (they removed us). A message that was written before the clear and is still waiting to be sent when the clear happens is not sent.

**Versions.** An older app has no case for `t:"clr"` and ignores it, so its history stays; the sender cannot know that. The docs and the confirmation dialog say so. A newer app that sees a `clr` with extra unknown fields still applies it. A `clr` whose epoch is missing, not an integer, zero, negative or above 1,000,000, whose type is wrong, or from someone who is not an active friend (or not in the group) is ignored.

**What is not touched.** Two-player games in progress are kept in memory only and are not part of the history; they are left alone. The friend's name, safety number and block list are unchanged. Message ids stay in a short list of recent ids (`seen`, 500 at most) used to drop repeats; the ids are random and contain nothing of the text. **Windows** cannot take back a toast it has already shown (the Mac removes its delivered notifications for the chat); it does delete the copies it staged in the temp folder (`friends_unstage`, which only accepts paths made by `friends_stage_file`). Tests: Mac `FriendsTests.testClear…`, Windows `tests/friendsclear.test.mjs`, relay `test/friends.test.mjs` ("clear chat"). **Status: written and unit-tested; the Windows app has not been run on real Windows hardware, and the relay change needs `npx wrangler deploy` in `server/room-relay` before the early removal works.**

## Two-player games (Mac client and the Windows port; additive)

Connect Four (`g:"c4"`), Rock Paper Scissors (`"rps"`), Battleship (`"bs"`), Chess (`"ch"`, Mac 2.2.8) and Checkers (`"ck"`, Mac 2.2.8) travel as `t:"play"` bodies with a `play` object (a friend chat) or as `play` envelopes (an anonymous room). The rules and the message fields are documented at the top of `NotchApple/Modules/Messenger/TwoPlayerGames.swift`. Older apps ignore unknown `t` values and unknown envelope kinds. There is no referee: Rock Paper Scissors picks and Battleship fleets are committed as SHA-256 hashes first and revealed later, so a changed pick or a fleet that does not match its answers is detected. **Windows.** The Windows port speaks the same messages. The rules, the stash for early messages (12 at most), the SHA-256 commits (`"pick:salt"` for Rock Paper Scissors, `"<100-character fleet>:salt"` for Battleship) and the checks are in `NotchWindows/src/js/games/twoplayer-logic.js` (a port of `TwoPlayerGames.swift` and `PlayController.swift`), the screens in `games/playui.js`, and `NotchWindows/tests/twoplayer.test.mjs` runs the Mac's rule tests plus two simulated players through the controller (including a lying Battleship opponent and shuffled delivery). The Windows hash is a small synchronous SHA-256 in that file, checked against the platform's SHA-256 in the tests. **Chess and Checkers** use only `op:"move"` once the game has started (the lobby ops are the same as for every game): `a` = the square the piece moves from, `b` = the square it moves to, both 0…63 numbered row by row from the top-left (row 0 is the far side from the first player), `n` = the move number (0…800; the number of half-moves played, and in Checkers every single hop of a multi-jump counts), `r` = the round, and in Chess an optional `s` = `"q"`, `"r"`, `"b"` or `"n"` for the piece a pawn becomes on the last row (a queen when missing). The first player (`x` of `start`) is white in Chess and red in Checkers, moves up the board, and swaps with the other player on a rematch. Both sides run the same rules on every message: a move that is illegal, out of turn, or has the wrong `n` changes nothing, and an early one (messages can swap order) waits in the stash. Chess ends by checkmate (the mover wins), stalemate, fifty moves without a capture or pawn move, the same position three times, or only kings (and at most one knight or bishop) left, all of which but checkmate are draws; Checkers is won when the opponent has no move, with compulsory captures, the same piece continuing a jump, a man ending its jump when it is crowned, and a draw after 80 moves with no capture or man's move. The Windows rules are in `games/twoplayer-logic.js` (`newChess`/`chessPlay`/`chessLegalTargets`, `newCheckers`/`checkersPlay`), the board in `games/playui.js` and the tests in `NotchWindows/tests/boardgames.test.mjs` (the Mac's cases, move counts from the start position and from a position full of special moves that match the known chess values, and the wire format). Windows also sends and accepts friend-chat tic-tac-toe (`t:"game"` with a `ttt` object, same fields as in rooms: `g:"ttt"`, `op`, `gid`, `mark`, `x`, `o`, `r`, `n`, `cell`). A game is kept in memory only and is dropped when a friend is removed or blocked. **Status: written and unit-tested in Node and drawn in Chromium, but not yet run on real Windows hardware or against a real Mac.**

## Rooms: big files (Mac 2.2.8 and the Windows port; additive, no server change)

Anonymous rooms (not Friends) carry files too. An envelope (`MessengerEnvelope`: `v, kind, id, senderID, sender, text?, fileData?, fileName?, game?, play?, fid?, fi?, fn?, ts`; `fileData` is standard base64 of the bytes, `ts` is seconds since 1 Jan 2001) is sealed and sent as `{"event":"message","message":"<base64 of nonce(12) | ciphertext | tag(16)>"}` over the WebSocket `wss://<relay>/<topic>/ws` of Notch Apple's own relay (`server/room-relay/src/relay.js`: frames up to 16 KB, 60 per second per connection with a burst of 120, nothing stored, the sender does not get its own frame back). The topic and key are derived from the room code as for text (see `services/messenger.js`).

- **Up to 8,000 bytes:** one ordinary `kind:"message"` envelope with `fileData` and `fileName` (and no `text`).
- **More than 8,000 and up to 2,000,000 bytes:** numbered pieces in envelopes of `kind:"chunk"`: `fid` (a string that names the file; with `senderID` it is the key the receiver uses), `fi` (this piece, 0-based), `fn` (how many pieces, 2…250), `fileData` (the piece, exactly 8,000 bytes except the last, which may be shorter but not empty) and `fileName`. A sealed full piece is about 14,700 characters, under the relay's frame limit. The sender paces about 30 ms between pieces and sends pieces only through the own relay (ntfy takes about 4 KB per message, and the Mac skips it for pieces, so as not to use up its daily quota). Older apps skip `chunk` envelopes.
- **Receiving** (`FileAssembly` in `NotchApple/Modules/Messenger/FileChunks.swift`; `NotchWindows/src/js/services/roomfileslogic.js`): refuse `fn` above 250 or below 2, `fi` outside 0…`fn`-1, an empty piece, a piece over 8,000 bytes, and a piece that is not the last but is short; a second piece that disagrees about `fn` is ignored; at most 6 files in flight (a seventh is ignored until one finishes or is dropped); a file that has not completed 180 seconds after its first piece is dropped and the user is told; the file name is cut to its last path component with control characters removed and at most 100 characters (Windows treats `\` as a folder mark too); the assembled file must be at most 2,000,000 bytes; each envelope ID is handled once (every relay delivers a copy).

**Windows.** `services/messenger.js` connects to both ntfy and the own relay at the same time, like the Mac, sends text, presence and game messages through both (duplicates are dropped by envelope ID), and sends and receives files through the own relay only. What Windows room sending can and cannot do: it can send files up to 2 MB (as pieces, or one message for 8,000 bytes or less) to Mac and Windows rooms **whenever the own relay is connected**; it cannot send a file while only ntfy is up (a network that blocks `workers.dev`), and then the paperclip says so instead of failing silently. Windows keeps the newest 12 files in memory while a room is open (the Mac keeps all of them) and writes one to a temporary folder and shows it in Explorer only when the user clicks it (`friends_stage_file`, limit 2,000,000 bytes). `NotchWindows/tests/roomfiles.test.mjs` runs the Mac's `RoomFileTests` against the assembler; `roomfiles-service.test.mjs` runs the real room service against a fake relay and a peer that seals envelopes like the Mac. **Status: written and unit-tested in Node, but not yet run on real Windows hardware, against the live relay or a real Mac.**

**Rocket League (Mac 2.2.10).** `g:"rl"` uses only the lobby ops (`invite`, `accept`, `start`, `quit`, `cancel`, `rematch`): there are no moves in the session. After `start`, each side's chat opens the same web page (`rocket.js`) pointed at an online room whose code is the first six characters of the game id (upper case; the game id alphabet is the room-code alphabet), the one who moves first being the host and playing Blue. The match itself runs live over the room relay (`/<topic>/ws`, topic = first 20 bytes of SHA-256 of `notchapple-rocket-v1|<CODE>` in hex), not through mailboxes: the host runs the physics at 60 steps a second and sends a snapshot of about 450 bytes 30 times a second, the guest sends its four keys up to 30 times a second. Older apps ignore the unknown game id; in a room they show the text invite line. **Windows** (`games/twoplayer-logic.js` knows `rl` as a lobby-only kind, `games/playui.js` opens the live game in the chat card, kept alive between repaints, and the notch grows to at least 900 x 720) speaks the same messages and plays against the Mac. Built and unit-tested, with the chat card checked in a real browser; not yet run on real Windows hardware.

**Scribble (Mac).** `g:"sk"` uses only the lobby ops, like Rocket League: after `start` each side's chat opens `scribble.js` pointed at an online room whose code is the first six characters of the game id, the one who moves first being the host. In a room, anyone may press *Join the game* and join the same web room as a guest (the session itself only tracks the two players who accepted and started). The game runs live over the room relay (`/<topic>/ws`, topic = first 20 bytes of SHA-256 of `notchapple-scribble-v1|<CODE>`). The host runs the rules (`games/scribble-logic.js`) and the computer players and sends the public state (`t:"s"`) a few times a second; the drawer sends strokes (`t:"ink"`, 40 points at most per message) straight to everyone, and a late joiner asks the host for the picture so far (`needink`, `inklog`). Private things never travel in the clear: each guest sends a P-256 public key when it joins, the host derives an AES-GCM key with each (ECDH), and the word to draw, the three words to choose from, and each guess are `t:"p"` messages sealed with that key. Older apps ignore the unknown game id. **Windows** does the same as for Rocket League (`sk` is a lobby-only kind; the card opens `scribble.js` on the room, and a room member who is not one of the two players gets a *Join the game* button). Built and unit-tested, with the chat card checked in a real browser; not yet run on real Windows hardware.
