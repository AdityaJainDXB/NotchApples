#!/bin/bash
# The Windows PairDrop engine (Rust, no Windows code in it): its own tests, including real transfers over TCP.
# Add --include-ignored to also run the Bonjour discovery test (two copies finding each other; needs multicast).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cargo test --manifest-path "$root/NotchWindows/src-tauri/pairdrop-core/Cargo.toml" "$@"
