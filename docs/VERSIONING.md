# Version numbers

**Mac** is `major.minor.patch`, for example `2.1.3`. Every release bumps the patch. Before the patch would reach 100 it rolls over: `2.0.100` is `2.1.0`, `2.0.102` is `2.1.2`, so the release after `2.0.102` is **2.1.3** (not `2.0.103`), and the one after `2.1.99` is `2.2.0`.

Apps compare versions number by number (`2.1.3` is newer than `2.0.102`), so installed copies update across the rollover without trouble, and old releases keep their numbers.

`scripts/release.sh` refuses a patch of 100 or more and prints the number to use.

**Windows** uses the same number as the Mac for the same release (Mac `2.1.3` and Windows `2.1.3`, tag `win-v2.1.3`). Windows was `1.N.0` up to `1.101.0`; the apps compare numbers part by part, so `2.1.3` is newer than `1.101.0` and updates carry across.

When you bump a version, change it in `project.yml` (Mac), `NotchWindows/src-tauri/tauri.conf.json`, `Cargo.toml` and `Cargo.lock` (Windows), the README, `WhatsNew.swift` and `release-notes/`.
