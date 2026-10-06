# Third-party notices

Notch apple adapts ideas and code from the open-source projects below. Each keeps its own license; the full
text of each is in this folder.

| Project | License | Used for | Files |
|---|---|---|---|
| Still (Akshay Sharma and Kavish Shah) <https://github.com/kavishshahh/iphone-duo-animation> | MIT | Lid Fold: projection math, gesture state, screen snapshot, Metal shader | `Still-MIT.txt` |
| Purge (Jithin Sabu) <https://github.com/jithin-sabu/purge-app> | MIT | Cleaner: safety allowlist, scan policies, delete rules | `Purge-MIT.txt` |
| LidAngleSensor (Sam Henri Gold) <https://github.com/samhenrigold/LidAngleSensor> | Apache License 2.0 | Lid Fold: how the lid-angle sensor is found and read (device match, HID feature report layout) | `LidAngleSensor-Apache-2.0.txt` |

## Apache License 2.0 notice (LidAngleSensor)

The lid-angle sensor discovery and report decoding in Notch apple follows the approach of Sam Henri Gold's
LidAngleSensor, through Still's adaptation of it. LidAngleSensor is licensed under the Apache License,
Version 2.0 (`LidAngleSensor-Apache-2.0.txt`). It publishes no NOTICE file. Notch apple's version is a
modified rewrite: it reads the sensor behind a protocol, adds a mock for Macs without one, and changes
error handling. Files that contain such adapted code say so in their header.

Every ported source file starts with a header naming where it came from, its license, and what was changed.
