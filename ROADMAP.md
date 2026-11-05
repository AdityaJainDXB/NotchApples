# Roadmap: parked for later

Things we decided to do later, not now. Newest ideas at the top of each list. See [docs/ROADMAP_100.md](docs/ROADMAP_100.md) for the older long-range list.

## Ideas to build

- **More two-player games:** Pong, Uno and Gartic Phone (drawing chain game). They would use the same room relay and friend-chat game engine as Rocket League and Scribble (`games/` on Windows, `Modules/Messenger/` on Mac).
- **Custom domain:** buy a real domain for the site and the license/site links. `notch.cc.cd` is a free `cc.cd` name that could be reclaimed, so the site's tags deliberately point at the permanent `adityajaindxb.github.io/NotchApples/` address for now. When a domain is bought and pointed at GitHub Pages: switch the canonical, `og:url` and `og:image` tags in `web/*.html` and the `notch.cc.cd` forwarding repo, update `web/sitemap.xml` and `web/robots.txt`, and keep `github.io/NotchApples/api.json` serving for installed apps.

## To keep an eye on (email protection, shipped in 2.2.15 and 2.2.16)

- **First real new-device sign-in:** `BIND_REQUIRE` is `"1"` on the license worker. Watch that the code email and the "activated and locked to your email" email arrive the first time a customer or friend adds a device. If anyone is locked out: set `BIND_REQUIRE` back to `"0"` in `server/license-worker/wrangler.toml` and deploy.
- **Windows:** the email gate and Security screens have not been seen on a real Windows PC.
- **Mac with no email set:** the locked notch ("Please set up your email") has only been checked on the build, not on a second Mac.
- **Authenticator app (Google or Microsoft Authenticator):** set up and tested only by the automated tests (RFC 6238 vector); try it once on a real phone.

## Small things

- **GitHub social preview image:** `docs/social-preview.png` (the "hello" card) is ready; upload it by hand in the repo's Settings → Social preview if wanted (GitHub has no way to set it from code).
- **Notch Apple AI and Security wording:** none pending.
