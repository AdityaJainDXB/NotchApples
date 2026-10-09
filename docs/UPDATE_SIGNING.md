# Signed updates

The Mac app is only ad-hoc signed, so macOS's own checks (`codesign --verify`, the bundle ID) say nothing about who built a
download: anyone can make an app that passes them. The in-app updater therefore checks one more thing before it mounts or
opens a download: an Ed25519 signature made with a **release key that is never on GitHub**.

## How it works

- Each release publishes `NotchApple-<version>.dmg` and `NotchApple-<version>.dmg.sig` (one line of base64).
- The signature covers `notchapple-update-v1\n<version>\n<sha256 of the DMG>\n`, so it can't be moved to another file or
  another version (an old, validly signed DMG can't be passed off as a new release).
- The app pins the matching public key(s) in `NotchApple/Core/UpdateSigning.swift` and checks the signature **before**
  `hdiutil attach`. A signature that is present but wrong is always refused.
- If the signature can't be fetched, the update is refused; only a clean "no such file" (404) counts as unsigned. Blocking
  the request can't turn a signed release into an unsigned one.
- `scripts/sign-update.swift` signs and verifies. It refuses to sign with a key the app doesn't pin.

## What you need to do once

1. The key pair was generated for you. The **private** half is in `private/update-signing-key.b64` (git-ignored, owner-only).
   Back it up somewhere safe; if it is lost, releases can't be signed with it and a new key has to be shipped in an update first.
2. Add it as the GitHub secret `UPDATE_SIGNING_KEY`. Better: create an Environment named `release` (Settings → Environments),
   restrict it to the `mac-v*` tags, add yourself as a required reviewer, and put the secret there. The Mac release job already
   declares `environment: release`.
3. Cut a release. The "Sign the DMG for the updater" step signs it and publishes the `.sig` next to the DMG.
   Check it: `swift scripts/sign-update.swift verify NotchApple-<version>.dmg <version>`.

## Turning enforcement on

`UpdateSigning.requireSignature` ships as `false`. That is a deliberate transition, not the end state: while it is `false`, a
release **without** a signature still installs (otherwise every release made before signing was set up, and any run without the
key, would strand people on their current version). It means that until you flip it, someone who can publish a release asset
can still publish an unsigned one.

Once at least one signed release is out and the next update from it has been tested:

1. Set `requireSignature = true` in `UpdateSigning.swift` and ship that version (signed).
2. From then on, apps on that version refuse any update without a valid signature.

Older apps, which have no check at all, can't be protected retroactively.

## Rotating the key

Add the new public key to `UpdateSigning.publicKeys` next to the old one, ship that version (signed with the old key), then
sign releases with the new key. Remove the old key in a later version.

## What this does not cover

- A person's first download (from the website or Homebrew) is only as trustworthy as that download. Homebrew's cask pins the
  DMG's SHA-256, but it is written by the same workflow.
- Developer ID signing and notarization remain the proper long-term answer for the app itself; this is the layer that makes the
  update channel safe while it is ad-hoc signed.
- Anyone with write access to the repo can read repo-level Actions secrets by pushing a workflow, which is why the signing key
  belongs in a protected Environment and not in the repository's secrets. `module-build.yml` also receives the premium deploy key
  on pushes to `module-**` branches; move that secret into an Environment with branch rules too.
