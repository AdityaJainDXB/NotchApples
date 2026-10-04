# Contributing to Notch apple

Thanks for helping! Notch apple is MIT-licensed and built by a high school developer, so every issue, idea and pull request helps.

## Reporting a bug

Open **Settings → Help & Feedback → Review the bug report** in the app. It fills in your app version, macOS version and Mac model. You see all of it before it's sent, and it opens a GitHub issue that you submit yourself.

## Code

- **Build:** see [Build from source](README.md#build-from-source). The project is generated with XcodeGen from `project.yml`.
- **Tests:** run `xcodebuild test -project NotchApple.xcodeproj -scheme NotchAppleTests` and `node server/license-worker/test/test.mjs`.
- **Style:** match the code around you. Each file starts with a comment saying what it does and why.
- **Tiers:** paid features are gated in one place, `Feature` in `NotchApple/Core/LicenseKey.swift`. See [docs/TIERS.md](docs/TIERS.md). Please don't move free features behind a tier.
- **Privacy:** no analytics, tracking or ads in the app. Any new network request must be listed in the README's Privacy section and in Settings → Privacy.

## Plugins

Share a plugin through the gallery. See [docs/PLUGINS.md](docs/PLUGINS.md#gallery-ultimate).

## Translations

The app is in English for now. To start a translation:
1. Open an issue titled "Translation: <language>" so work isn't duplicated.
2. Contribute an Xcode String Catalog (`Localizable.xcstrings`) with your language. Keep the plain, friendly tone, and keep product names (Notch apple, Pro, Ultimate) as they are.
