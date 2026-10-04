// Makes the production Ed25519 signing key, once.
//   private/license-signing-key.jwk  → upload with `npx wrangler secret put SIGNING_KEY`, then keep a
//                                       backup somewhere safe (password manager). Never commit it.
//   prints the public key            → goes in NotchApple/Core/Licensing.swift (LicenseKey.publicKey)
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
const out = new URL('../../../private/license-signing-key.jwk', import.meta.url);
if (existsSync(out)) { console.error('private/license-signing-key.jwk already exists; not replacing it.'); process.exit(1); }
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
mkdirSync(new URL('../../../private/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), { mode: 0o600 });
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
console.log('Public key (base64):', btoa(String.fromCharCode(...raw)));
