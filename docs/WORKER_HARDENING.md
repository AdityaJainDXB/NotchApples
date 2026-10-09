# Licence Worker: rate limiting and claim safety (proposal)

This is a plan, not a change. `server/license-worker/src/worker.js` is the live licence and payment server; it can't be run or
deployed from a code review, so the patch below is for you to read, test with `wrangler dev` and deploy yourself.

## What is actually exposed

Checked against the code (not just the audit):

| Endpoint | Problem | Real impact |
| --- | --- | --- |
| `POST /order` | No limit. Each open order holds one of about 99 amounts per price (`amount:<litoshi>` in KV) for `ORDER_TTL`. | Someone can open orders until checkout says "busy" for everyone. Denial of service, no money lost. |
| `POST /recover` | No limit; emails the key to the address on file. | Mail-bombing a buyer, and burning the free Brevo quota (300/day) so real key emails stop. |
| `POST /promo` | No limit. | Code guessing. |
| `POST /activate`, `/deactivate`, `/entitle` | No limit; the key text is the only credential. | Someone holding a leaked key can fill or free the 3 device slots. |
| `POST /claim` | The check `tx:<txid>` then the write is not atomic (KV is eventually consistent). | Two parallel claims of the same order can both succeed and issue two keys for one payment. Low impact: same buyer, same order. |
| `/admin/*` | A lockout exists (10 failures per IP per hour) but `adminfail` is a read-modify-write on KV. | Racing requests can slip a few extra guesses past it. |

One thing the audit overstated: a stranger can't simply front-run someone else's payment. `claim` needs the order's 128-bit
secret id, and `order` reserves each amount while it is open (best-effort: KV is eventually consistent), so two open orders
don't normally share an amount. The narrow window left is an unconfirmed transaction claimed against a new order for the same
amount after the first order has expired, and that is closed by confirming the payment before issuing a key (see "Claim safely").

## A limiter that fits this Worker

The Worker already has the right tool: `PlaneRate` is a Durable Object that allows N hits a minute from one address, and it is
atomic (a Durable Object handles one request at a time). Generalise it, keep one object per `route|address`:

```js
/** Allows `limit` hits per `windowMs` for whatever key the object is named after. Atomic: one request at a time per object. */
export class RateLimit {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const { limit, windowMs } = await request.json();
    const now = Date.now();
    const hits = ((await this.state.storage.get('t')) || []).filter((t) => now - t < windowMs);
    if (hits.length >= limit) return Response.json({ ok: false, retryAfter: Math.ceil((hits[0] + windowMs - now) / 1000) });
    hits.push(now);
    await this.state.storage.put('t', hits);
    return Response.json({ ok: true });
  }
}

async function limited(env, request, route, limit, windowMs, who) {
  const key = await sha256(`${route}|${who ?? request.headers.get('cf-connecting-ip') ?? 'unknown'}`);
  const r = await (await env.RATE.get(env.RATE.idFromName(key)).fetch('https://rate/', { method: 'POST', body: JSON.stringify({ limit, windowMs }) })).json();
  if (!r.ok) throw new HTTPError(429, `Too many tries. Try again in ${r.retryAfter} seconds.`);
}
```

`wrangler.toml` needs a binding and a migration, like the Plane ones:

```toml
[[durable_objects.bindings]]
name = "RATE"
class_name = "RateLimit"

[[migrations]]
tag = "v3"
new_sqlite_classes = ["RateLimit"]
```

Suggested limits (per address unless noted), applied at the top of each handler, before any KV or mail work:

| Route | Limit | Also |
| --- | --- | --- |
| `/order` | 10 per hour | cap open orders: refuse with 503 once about 60 of the ~99 amounts are taken, so one address can't hold them all |
| `/claim` | 30 per 10 minutes | the buyer polls while waiting, so keep this generous |
| `/recover` | 3 per hour | **and** 3 per day per email hash (`limited(..., 'recover-email', 3, 86_400_000, await emailHash(env, body.email))`), so a victim can't be flooded from many addresses |
| `/promo` | 10 per hour | |
| `/activate`, `/deactivate` | 30 per hour | **and** 20 per hour per key id, so one leaked key can't be hammered from many addresses |
| `/entitle` | 120 per hour | the app asks on launch and wake |
| `/admin/*` failed logins | 10 per hour | move the existing `adminfail` counter into the same Durable Object so it is atomic |

Behind a shared network (a school, an office) many people share one address; the numbers above are loose enough for that, and
a 429 here only slows a checkout, it doesn't lose one.

## Claim safely

1. Serialize claims per order through a Durable Object (one object per order id): its `fetch` runs the `tx:` check, the
   payment lookup and the `tx:` write, so two parallel claims queue instead of both passing the check.
2. Refuse unconfirmed transactions for key issue (`pay.blockTime == null` returns `pending`), so a payment can't be claimed
   before it is final. This also removes the narrow window described above. It does make buyers wait for a confirmation, so
   consider it a product choice for the $1 Pro tier; for $1 many shops accept zero confirmations, which is why it was skipped.

## Beyond code

- `workers.dev` addresses can't use Cloudflare's WAF rate-limiting rules; with a custom domain on Cloudflare you could add a
  zone-level rate rule on `/order` and `/recover` as a first layer, and Turnstile (Cloudflare's CAPTCHA alternative) on the
  checkout and "Lost my key?" forms. The in-code limiter above works either way.
- `/admin` is served by the Worker, and `admin.html` is also published on the public site (see the site audit). Serve the admin
  page from one place only, behind Cloudflare Access if you can.

## How I would test it

`server/license-worker/test` exists; add a test that sends `limit + 1` requests to each route and checks the last one is a 429
and that a different address is unaffected, and one that fires two `/claim` requests for the same order at once and checks
only one key is issued. Run against `wrangler dev --local`, and against the `testnet` environment before mainnet.
