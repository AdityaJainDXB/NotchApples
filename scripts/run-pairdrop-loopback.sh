#!/bin/bash
# Runs the real PairDrop transfer code over loopback sockets (no app, no Bonjour, no UI): big and empty files,
# wrong codes and the lockout, chat auth, a silent peer, a failing receiver, an older-style receiver.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
swiftc -swift-version 5 -O -o "$out/loopback" \
  "$root/NotchApple/Modules/Sharing/PairDropLogic.swift" "$root/NotchApple/Modules/Sharing/PairDropTransport.swift" \
  "$root/scripts/pairdrop-loopback/main.swift" 2>&1 | grep -E "error" -A3 || true
"$out/loopback"
