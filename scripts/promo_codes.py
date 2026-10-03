#!/usr/bin/env python3
"""Promo codes for Notch apple Pro.

Each promo code gives one free product key, once. Only SHA-256 hashes are
published (Firestore rules and the website); the codes themselves stay in
private/promo-codes.txt, which git ignores.

  python3 scripts/promo_codes.py --add 25            # make 25 new codes
  python3 scripts/promo_codes.py --sync --site ../notchapples-site/pro.html

--add appends new random codes (never sequential) and then syncs.
--sync rewrites the hash list in firestore.rules and, with --site, in the
website's pro.html. Then publish the rules: Firebase console → Firestore →
Rules → paste firestore.rules → Publish, and push the site.
"""
import argparse, hashlib, pathlib, re, secrets

ROOT = pathlib.Path(__file__).resolve().parent.parent
CODES = ROOT / "private" / "promo-codes.txt"
RULES = ROOT / "firestore.rules"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O or 1/I


def read_codes():
    if not CODES.exists():
        return []
    return [m.group(0) for m in re.finditer(r"PROMO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}", CODES.read_text())]


def code_hash(code):
    return hashlib.sha256(("PROMO" + code[6:].replace("-", "")).encode()).hexdigest()


def add(n):
    existing = set(read_codes())
    new = []
    while len(new) < n:
        body = "".join(secrets.choice(ALPHABET) for _ in range(12))
        code = f"PROMO-{body[:4]}-{body[4:8]}-{body[8:]}"
        if code not in existing:
            existing.add(code); new.append(code)
    CODES.parent.mkdir(exist_ok=True)
    header = "" if CODES.exists() else "Notch apple promo codes (each gives one free product key, one time only).\nKeep this file private: it is git-ignored.\n\n"
    with CODES.open("a") as f:
        f.write(header + "\n".join(new) + "\n")
    print(f"Added {n} codes to {CODES.relative_to(ROOT)}:")
    print("\n".join(new))


def sync(site):
    hashes = [code_hash(c) for c in read_codes()]
    rules = RULES.read_text()
    rules = re.sub(r"request\.resource\.data\.ref in \[[^\]]*\]",
                   "request.resource.data.ref in [" + ",".join(f"'{h}'" for h in hashes) + "]", rules)
    RULES.write_text(rules)
    print(f"firestore.rules now lists {len(hashes)} promo codes.")
    if site:
        p = pathlib.Path(site)
        html = re.sub(r"const PROMOS=new Set\(\[[^\]]*\]\);",
                      "const PROMOS=new Set([" + ",".join(f'"{h}"' for h in hashes) + "]);", p.read_text())
        p.write_text(html)
        print(f"{p.name} now lists {len(hashes)} promo codes.")
    print("Next: publish firestore.rules in the Firebase console, and push the site.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--add", type=int, default=0, help="number of new codes to create")
    ap.add_argument("--sync", action="store_true", help="only rewrite the published hash lists")
    ap.add_argument("--site", help="path to the website's pro.html")
    a = ap.parse_args()
    if a.add:
        add(a.add)
    if a.add or a.sync:
        sync(a.site)
    else:
        ap.print_help()
