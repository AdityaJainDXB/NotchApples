#!/bin/bash
# Proves the Mac's PairDrop code (Swift) and the Windows engine (Rust) understand each other, both ways:
# files of several sizes, an empty file, a chat hello and a chat message. Runs on any Mac, no Windows needed.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; fails=0
ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fails=$((fails+1)); }

swiftc -swift-version 5 -O -o "$work/swift-pd" "$root/NotchApple/Modules/Sharing/PairDropLogic.swift" "$root/NotchApple/Modules/Sharing/PairDropTransport.swift" "$root/scripts/pairdrop-loopback/main.swift" 2>&1 | grep -E "error:" -A3
cargo build -q --manifest-path "$root/NotchWindows/src-tauri/pairdrop-core/Cargo.toml" --example interop 2>&1 | grep -E "^error" -A5
rs="$root/NotchWindows/src-tauri/pairdrop-core/target/debug/examples/interop"

head -c 5000000 /dev/urandom > "$work/five.bin"; : > "$work/empty.bin"; printf 'hello from a file' > "$work/note.txt"
head -c 30000000 /dev/urandom > "$work/big.bin"

echo "== Windows engine (Rust) sends to the Mac's code (Swift)"
mkdir -p "$work/mac-dl"
"$work/swift-pd" serve "$work/mac-dl" > "$work/swift.out" 2>&1 & swpid=$!
for i in $(seq 1 50); do grep -q CODE "$work/swift.out" && break; sleep 0.2; done
port=$(awk '/PORT/{print $2}' "$work/swift.out"); code=$(awk '/CODE/{print $2}' "$work/swift.out")
for f in note.txt empty.bin five.bin big.bin; do
  "$rs" send "$port" "$code" "$work/$f" >/dev/null && sleep 1 && cmp -s "$work/$f" "$work/mac-dl/$f" && ok "Rust → Swift: $f arrives byte for byte" || bad "Rust → Swift: $f"
done
out=$("$rs" send "$port" 000000 "$work/note.txt"); echo "$out" | grep -q WrongCode && ok "Rust → Swift: a wrong code is refused" || bad "Rust → Swift: wrong code ($out)"
"$rs" hello "$port" "$code" | grep -q Delivered && ok "Rust → Swift: a chat opens" || bad "Rust → Swift: chat hello"
kill $swpid 2>/dev/null

echo "== The Mac's code (Swift) sends to the Windows engine (Rust)"
mkdir -p "$work/win-dl"
"$rs" serve "$work/win-dl" > "$work/rust.out" 2>&1 & rspid=$!
for i in $(seq 1 50); do grep -q CODE "$work/rust.out" && break; sleep 0.2; done
port=$(awk '/PORT/{print $2}' "$work/rust.out"); code=$(awk '/CODE/{print $2}' "$work/rust.out")
for f in note.txt empty.bin five.bin big.bin; do
  "$work/swift-pd" send "$port" "$code" "$work/$f" >/dev/null && sleep 1 && cmp -s "$work/$f" "$work/win-dl/$f" && ok "Swift → Rust: $f arrives byte for byte" || bad "Swift → Rust: $f"
done
out=$("$work/swift-pd" send "$port" 000000 "$work/note.txt"); echo "$out" | grep -q wrongCode && ok "Swift → Rust: a wrong code is refused" || bad "Swift → Rust: wrong code ($out)"
"$work/swift-pd" hello "$port" "$code" | grep -q delivered && ok "Swift → Rust: a chat opens" || bad "Swift → Rust: chat hello"
"$work/swift-pd" message "$port" "$code" "hi from the Mac" | grep -q delivered && ok "Swift → Rust: a chat message is delivered" || bad "Swift → Rust: chat message"
sleep 1; grep -q "hi from the Mac" "$work/rust.out" && ok "Swift → Rust: the PC received the message text" || bad "Swift → Rust: message text"
kill $rspid 2>/dev/null

echo; echo "$fails failures"; exit $((fails > 0))
