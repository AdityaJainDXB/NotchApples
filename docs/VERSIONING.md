# Version numbers

**Mac** is `major.minor.patch`, for example `2.1.3`. Every release bumps the patch. Before the patch would reach 100 it rolls over: `2.0.100` is `2.1.0`, `2.0.102` is `2.1.2`, so the release after `2.0.102` is **2.1.3** (not `2.0.103`), and the one after `2.1.99` is `2.2.0`.

Apps compare versions number by number (`2.1.3` is newer than `2.0.102`), so installed copies update across the rollover without trouble, and old releases keep their numbers.

`scripts/release.sh` refuses a patch of 100 or more and prints the number to use.

**Windows** is `1.N.0`, where N goes up by one for every Windows release (`1.101.0`, then `1.102.0`). Windows installers are matched by tag (`win-vX`), so nothing else depends on N staying small.

When you bump a version, change it in `project.yml` (Mac), `NotchWindows/src-tauri/tauri.conf.json`, `Cargo.toml` and `Cargo.lock` (Windows), the README, `WhatsNew.swift` and `release-notes/`.
