#!/bin/bash
# Deletes the oldest GitHub releases so the list does not grow for ever.
#
#   scripts/prune-releases.sh [--keep N] [--max N] [--dry-run]
#   scripts/prune-releases.sh --oldest N [--dry-run]     (the N oldest releases overall, Mac and Windows together)
#
# Mac releases (tags v*) and Windows releases (tags win-v*) are pruned separately: the newest N of each (default 4) are kept,
# and at most --max of the oldest ones beyond that are deleted per kind (default 1, which is what the weekly routine uses
# after it publishes a release). Never touched: the release marked Latest and the rolling `windows-latest` release (the
# website's Windows download links point at it), and the newest Mac and the newest Windows release (--oldest never deletes
# those two, so each platform's latest download stays in the list). Only the release page and its files are deleted; the git tags
# stay, unless --tags is given with --oldest, which deletes the tag of each deleted release too.
set -euo pipefail
keep=4; max=1; dry=0; oldest=0; deltags=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="$2"; shift 2 ;;
    --max) max="$2"; shift 2 ;;
    --oldest) oldest="$2"; shift 2 ;;
    --tags) deltags=1; shift ;;
    --dry-run) dry=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
list="$(gh release list --limit 500 --json tagName,isLatest,createdAt,isDraft)"
if [ "$oldest" -gt 0 ]; then
  # The N oldest published releases of both kinds; never the one marked Latest, a draft, or the rolling windows-latest.
  tags=$(printf '%s' "$list" | python3 -c "
import json,re,sys
allr=[r for r in json.load(sys.stdin) if re.match(r'^(v|win-v)[0-9]', r['tagName']) and not r['isDraft']]
allr.sort(key=lambda r:r['createdAt'])
# Always kept: the newest Mac release and the newest Windows release, so neither platform's download sinks out of the list.
keepers={max((r for r in allr if re.match(pat, r['tagName'])), key=lambda r:r['createdAt'])['tagName'] for pat in (r'^v[0-9]', r'^win-v[0-9]') if any(re.match(pat, r['tagName']) for r in allr)}
rel=[r for r in allr if not r['isLatest'] and r['tagName'] not in keepers]
print('\n'.join(r['tagName'] for r in rel[:$oldest]))")
  for t in $tags; do
    if [ $dry = 1 ]; then echo "would delete release $t"; elif [ $deltags = 1 ]; then gh release delete "$t" --yes --cleanup-tag && echo "deleted release and tag $t"; else gh release delete "$t" --yes && echo "deleted release $t (tag kept)"; fi
  done
  exit 0
fi
for kind in 'v[0-9]' 'win-v[0-9]'; do
  tags=$(printf '%s' "$list" | python3 -c "
import json,re,sys
rel=json.load(sys.stdin); pat=re.compile(r'^$kind')
mine=sorted([r for r in rel if pat.match(r['tagName'])], key=lambda r:r['createdAt'], reverse=True)
old=[r['tagName'] for r in mine[$keep:] if not r['isLatest'] and r['tagName']!='windows-latest']
print('\n'.join(reversed(old)))   # oldest first
" | head -n "$max")
  for t in $tags; do
    if [ $dry = 1 ]; then echo "would delete release $t"; else gh release delete "$t" --yes && echo "deleted release $t (tag kept)"; fi
  done
done
