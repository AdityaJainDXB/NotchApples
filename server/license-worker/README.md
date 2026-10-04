# License server

A Cloudflare Worker (free plan) that sells and signs Notch apple product keys. See the comment at the top of [src/worker.js](src/worker.js) for every endpoint.

- **Keys** are `NTCH-PRO-…` / `NTCH-ULTM-…`: a 12-byte payload (version, tier, key ID, issue day) and its Ed25519 signature. The app checks them offline with the public key in `NotchApple/Core/LicenseKey.swift`. The private key is only the Worker's `SIGNING_KEY` secret.
- **Payments** are Litecoin, straight to the wallet. Every order reserves its own exact amount for 48 hours; a key is issued only to the holder of the secret order ID, for a payment of exactly that amount, made after the order. Someone watching the public blockchain can't claim a buyer's payment.
- **Email** (Brevo, or Resend with your own domain) sends the key, and "Lost my key?" re-sends it. After payment only a salted hash of the email is kept.
- **Device limit**: 3 Macs per key, using a per-key salted hash of the Mac. **Revocation**: a signed list the app downloads about once a day.

## Test

```bash
node server/license-worker/test/test.mjs
```

This runs the whole flow (Pro, Ultimate, the $4 upgrade, promo codes, recovery, the device limit, revoke and reissue, and the attacks) against a fake blockchain with a throwaway key. It writes `test/fixture.json`, which the Swift tests use to check the app reads the same keys.

## Set up (once)

1. `node server/license-worker/scripts/genkey.mjs` makes the signing key in the git-ignored `private/` folder. This has already been done; the public half is built into the app. **Back up `private/license-signing-key.jwk` in your password manager.**
2. Create a free account at [cloudflare.com](https://dash.cloudflare.com/sign-up). For email, also create a free account at [brevo.com](https://www.brevo.com) and verify your sender address.
3. Sandbox first: `server/license-worker/scripts/setup.sh testnet`. Pay with testnet coins (from a Litecoin testnet faucet) to check a real Pro purchase, an Ultimate purchase and an upgrade end to end.
4. Then the real one: `server/license-worker/scripts/setup.sh`.
5. Put the Worker URL into the website: `const WORKER = "https://…workers.dev"` in `pro.html`, and `{"licenseServer": "https://…workers.dev"}` in `api.json`.

Ultimate stays off sale (`ULTIMATE_ON = "0"` in `wrangler.toml`) until its first features ship.

## Status

Live since 4 October 2026 at the Worker URL in the website's `api.json`. Email is sent through Brevo.

The signing key and admin token are backed up in the login Keychain as **Notch apple license signing key** and **Notch apple license admin token** (account `notchapple`). To read them:

```bash
security find-generic-password -a notchapple -s "Notch apple license signing key" -w
```

## Admin

Use the token in `private/admin-token.txt`:

```bash
# A free key for an early supporter (donor or $2 buyer), emailed to them
curl -X POST https://…workers.dev/admin/issue -H "authorization: Bearer $(cat private/admin-token.txt)" \
  -d '{"tier":"ultimate","email":"them@example.com","note":"donor"}'

# A key was shared publicly: turn it off and send the buyer a new one
curl -X POST https://…workers.dev/admin/reissue -H "authorization: Bearer $(cat private/admin-token.txt)" \
  -d '{"key":"NTCH-PRO-…","email":"buyer@example.com","reason":"shared publicly"}'

# Refund: turn the key off
curl -X POST https://…workers.dev/admin/revoke -H "authorization: Bearer $(cat private/admin-token.txt)" \
  -d '{"key":"NTCH-PRO-…","reason":"refund"}'
```
