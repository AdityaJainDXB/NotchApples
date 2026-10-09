# How the paid features are protected

Notch apple's code is source-available (see [LICENSE](../LICENSE)), so anyone can read it and build it. This page says
what that does and does not give them, and how the paid features are kept on the server where they can be.

## What a copy of the code never contains

- **The signing key.** Licence keys are signed with an Ed25519 private key that exists only as a secret on the licence
  server (a Cloudflare Worker). The app has only the matching public key, which can check a key but can't make one.
- **The admin codes.** The admin panel and `/admin/*` need a token that is a server secret (or the hashes of personal
  codes). Neither is in the repository or its history.
- **Customers.** Keys, device hashes and email hashes live in the server's storage, not in the code.

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

## Next steps (in order of value)

1. **Open core.** Move the code of the Ultimate-only modules (Convert, Smart Home, Claude usage, Do It…) into a private
   repository that only the official release build pulls in. A build from the public repository then simply does not
   contain them. This is the strongest protection for local features.
2. **Hosted AI for Pro and Ultimate.** A Worker endpoint that calls an AI provider with the project's own key for entitled
   devices, rate-limited per key. Real, ongoing value that exists only behind a valid token (it costs API usage).
3. **Premium content, regularly.** New themes, sound packs and aircraft added through `assets.mjs` never touch the
   repository.
4. **Close the open relay path** for Messenger once it sends a pass too.
