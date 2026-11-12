#!/usr/bin/env bash
# Creates the free self-signed certificate that official builds are signed with (once per Mac that builds releases).
# Why: an ad-hoc signature is a new identity for every build, so macOS drops the Accessibility permission on every update and the
# notch's volume and brightness gauge disappears. A fixed certificate keeps the same identity, so the permission survives updates.
# The certificate lives in its own keychain file (~/Library/Keychains/notchapple-signing.keychain-db, no password, nothing in the
# login keychain). BACK THAT FILE UP: a new certificate is a new identity, and everyone must re-allow Accessibility once more.
set -euo pipefail
KC="$HOME/Library/Keychains/notchapple-signing.keychain-db"
if [ -f "$KC" ]; then echo "Already set up: $KC"; security find-identity -p codesigning "$KC" | sed -n 2,3p; exit 0; fi
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/cert.cnf" <<'CNF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=Notch Apple Self-Signed
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/key.pem" -out "$T/cert.pem" -days 7300 -config "$T/cert.cnf" 2>/dev/null
openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/id.p12" -passout pass:notch -legacy 2>/dev/null \
  || openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/id.p12" -passout pass:notch
security create-keychain -p "" "$KC"
security set-keychain-settings "$KC"
security unlock-keychain -p "" "$KC"
security import "$T/id.p12" -k "$KC" -P notch -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KC" >/dev/null 2>&1
chmod 600 "$KC"
echo "Created $KC"; security find-identity -p codesigning "$KC" | sed -n 2,3p
