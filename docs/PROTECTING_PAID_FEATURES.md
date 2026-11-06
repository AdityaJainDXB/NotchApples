# How the paid features are protected

Notch Apple's code is source-available (see [LICENSE](../LICENSE)), so anyone can read it and build it. This page says
what that does and does not give them, and how the paid features are kept on the server where they can be.

## What a copy of the code never contains

- **The signing key.** Licence keys are signed with an Ed25519 private key that exists only as a secret on the licence
  server (a Cloudflare Worker). The app has only the matching public key, which can check a key but can't make one.
- **The admin codes.** The admin panel and `/admin/*` need a token that is a server secret (or the hashes of personal
  codes). Neither is in the repository or its history.
- **Customers.** Keys, device hashes and email hashes live in the server's storage, not in the code.

## Leaked keys: a key belongs to one email

Keys that end up on the internet are made useless by tying each key to one email address (`BIND_REQUIRE=1` on the licence server):

- A key is bound to the email it was bought with. A key with no email (old or admin-issued) is bound by the first address that proves
  it owns its inbox, and only from a device that already uses the key, so a thief with just the key cannot claim it.
- A device new to the key must enter a 6-digit code emailed through Brevo (the default), valid 10 minutes, five tries, one email a
  minute. A wrong address gets the same answer and no email, so nobody learns which address owns a key. The server stores only a
  salted hash of the email.
- Optional: an authenticator app (Google or Microsoft Authenticator, via a QR code in Settings) whose code replaces the email code.
- Asked once per device. Registered devices, app launches and deactivate then activate again never ask. Without a registered device
  there are no tokens for AI, paid assets or Ultimate rooms, whatever the app says.

## What a modified build can still do

A copy of the app can be rebuilt with its own licence checks switched off, and then every feature that runs entirely on
the Mac or PC unlocks for that copy. No licence can stop that technically, only the law (the [LICENSE](../LICENSE) forbids
it). So the aim is to keep more of the value somewhere a modified copy can't reach.

## What lives on the server now

A real, unrevoked key on a registered device (the 3-device limit applies) gets two short-lived signed tokens from
`POST /entitle` (72 hours, renewed by the app):

| Token | For | Contains |
| --- | --- | --- |
| `ent1` (full) | downloading server-held content: `GET /asset/<id>` | tier, key ID, device |
| `pass1` (anonymous) | joining Clipboard Link rooms on the relay: `/clip/<topic>/ws?p=…` | tier only, no key, no device |

Both are signed with the licence key under a different prefix (`NOTCHAPPLE-ent1` / `NOTCHAPPLE-pass1`), so a token can
never pass for a key and a key never for a token. A suspended or revoked key stops getting tokens and its assets stop
downloading at once.

What is behind them today:

- **Premium Klick sounds** (Cherry MX Black, Gateron Ink, Alps, Buckling spring): kept as encrypted-in-transit packs in the
  server's storage, never in the repository. A build without a real key gets a 401 or 403 and falls back to a free sound.
- **Clipboard Link (Ultimate)**: its rooms exist only on `/clip/…`, which the relay opens only for an unexpired Ultimate
  pass. The relay holds just the public key.

Server-held content is uploaded with `node server/license-worker/scripts/assets.mjs` (admin only) and is listed in the
admin panel's audit log.

## What this does not protect

- Anything already in the public repository or its history (the nine free Klick sounds, the generator script, every
  feature that runs locally) stays readable. Only content added from now on, and kept out of the repository, is protected.
- Messenger's anonymous rooms still use `/<topic>/ws` without a pass, because Messenger also falls back to public brokers.

## Open core: the Ultimate modules are private

From 2.0.33 the code of the Ultimate-only modules is no longer in this repository. It lives in a private repository
(`NotchApples-Premium`) and is built into the official releases only:

- Mac: Convert, Smart Home, Claude usage, Do It and the Purge launcher.
- Windows: Convert, Smart Home, Claude Usage and Do It (and their services).

A build made from the public source compiles and runs fine, with free and Pro features as before, but those five tabs show
"this is in the official Ultimate build". The two halves connect through `PremiumRegistry` (Mac) and the `premium()` loader
(Windows). `scripts/fetch-premium.sh` copies the private files into places this repository ignores: from a local clone next to
it, from a read-only deploy key in GitHub Actions, or from your own GitHub login. Official releases use `--require`, and
`release.sh` checks the finished DMG, so a release can't go out without the modules.

What this does **not** do: the old versions of those files are still in this repository's history, so anyone can read the code as
it was up to 2.0.32 (and rebuild an old, unlocked copy of it). Only changes from now on stay private. Rewriting the history to
remove them would break every clone and fork, and copies that already exist can't be taken back.

## Notch Apple AI (hosted)

Pro and Ultimate include **Notch Apple AI**: the app sends an OpenAI-style chat request with its token to the licence server
(`POST /ai/v1/chat/completions`). The server checks the key, counts a daily allowance per key (a Durable Object per key, so no KV
writes; Pro 60, Ultimate 200 a day by default), cleans the request (text and embedded images only; the server chooses the model)
and calls an AI provider with the project's own key (the `AI_API_KEY` secret, never in the app or repository). Without a real
key there is nothing to call, however the app is modified. It stays off ("isn't switched on yet") until the secret is set:

```
cd server/license-worker && npx wrangler secret put AI_API_KEY      # paste a provider key, e.g. a Gemini key from aistudio.google.com/apikey
```

`AI_BASE` can point at any OpenAI-compatible provider, `AI_MODEL` picks the model, and `AI_LIMIT_PRO` / `AI_LIMIT_ULTIMATE` the daily
allowance (in `wrangler.toml`). A free provider tier is shared by every user, so watch it and raise the limits only with a paid key.

## Next steps (in order of value)

1. **Move more Ultimate work private** as it is written, and the Pro modules that are large and self-contained.
2. **Premium content, regularly.** New themes, sound packs and aircraft added through `assets.mjs` never touch the repository.
3. **Close the open relay path** for Messenger once it sends a pass too.


## Passkeys: Touch ID or Windows Hello to confirm a new device

A key can also have a **passkey**, instead of (or as well as) an email. It is for people who do not want to use an email code, and it lets a
second Mac or PC confirm itself with Touch ID or Windows Hello.

**Why it is a web page.** Apple's own passkey API needs the "associated domains" entitlement, which only a paid Apple Developer account can sign.
The app is ad-hoc signed, so it cannot use it. Instead the app opens `web/passkey.html` in the browser, and the browser does the passkey
(WebAuthn). The passkey lives in the browser or password manager (iCloud Keychain, Google, 1Password) and syncs between the person's devices;
the app and this server only ever see the public half.

**The flow** (all in `server/license-worker/src/worker.js`, "MARK: Passkeys"):

1. The app asks `POST /passkey/begin {key, device, purpose}` (purpose `add`, `verify` or `remove`) for a short-lived **ticket** (5 minutes, one use)
   and gets the page address `…/passkey.html#t=TICKET`. The key never goes in the address.
2. The page asks `POST /passkey/options {ticket}` for a challenge, the browser asks for Touch ID, and the page sends the answer to
   `POST /passkey/finish`. The server checks the challenge, the origin, the site hash, that the user was verified (not just present), and for a
   sign-in the ES256 signature; a copied passkey (a signature counter that goes back) is refused.
3. The app polls `POST /passkey/status {ticket}` until it says `approved`, then calls `POST /passkey/activate` (a new device) or
   `POST /passkey/remove`.

**Rules.** Adding or removing a passkey needs a device that already uses the key. A key with a passkey and no email cannot be given an email by
a thief on a new device. A key may have up to 5 passkeys. A passkey is required to be a "resident" credential with user verification.

**Keep the site where it is.** A passkey is tied to `PASSKEY_RP_ID` (default `adityajaindxb.github.io`, with `PASSKEY_ORIGIN`). If the website
moves to another domain, existing passkeys stop working until the owner adds new ones (the email code still works). `notch.cc.cd` only forwards
to the GitHub Pages address, so the page must be opened on the GitHub Pages address, which the app does.

**Tests.** `server/license-worker/test/test.mjs` has a software passkey (WebCrypto) that goes through add, a new device, remove, a bad
signature, no Touch ID, the wrong site, a copied passkey and reused or expired tickets.
