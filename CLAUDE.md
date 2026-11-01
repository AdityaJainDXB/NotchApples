# Notes for any Claude agent working in this repo

## Releases: keep the newest Mac AND Windows build findable (standing rule from the owner)

Mac releases are far more frequent than Windows ones, so Windows users could not find theirs. Always:

- Never delete the newest Mac release (`v*`) or the newest Windows release (`win-v*`). `scripts/prune-releases.sh` already
  protects both; use that script, never `gh release delete` by hand.
- GitHub cannot pin a release. So if a Windows release has not been published for a while, say so to the owner, and keep the
  website's Windows download link (`windows-latest` / `web/latest.json`) pointing at the newest Windows build.
- After every release, run `scripts/prune-releases.sh` so the list stays short while both newest builds stay in it.
- Mac and Windows share one version number (docs/VERSIONING.md). Pull and check `git tag -l` before choosing the next one.

## Release notes and the README (keep the README short)

The README is the front page, not the history. For every release:

- write `release-notes/X.md` and `release-notes/win-X.md`, and add the entry to `NotchApple/Core/WhatsNew.swift`;
- add the entry at the top of `CHANGELOG.md` (the full history, newest first);
- put the same entry at the top of the README's "What's new", and drop the oldest so only the latest three stay there;
- long how-tos live in `docs/` (`docs/BUILDING.md`, `docs/GUIDES.md`), with a short stub and link in the README. Keep the README headings that other places link to by anchor: Download, Donate, Plugins, Live activities API, Want a lighter version?.

