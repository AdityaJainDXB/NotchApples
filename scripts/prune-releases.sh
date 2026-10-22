#!/bin/bash
# Deletes the oldest GitHub releases so the list does not grow for ever.
#
#   scripts/prune-releases.sh [--keep N] [--max N] [--dry-run]
#   scripts/prune-releases.sh --oldest N [--dry-run]     (the N oldest releases overall, Mac and Windows together)
#
# Mac releases (tags v*) and Windows releases (tags win-v*) are pruned separately: the newest N of each (default 4) are kept,
# and at most --max of the oldest ones beyond that are deleted per kind (default 1, which is what the weekly routine uses
# after it publishes a release). Never touched: the release marked Latest and the rolling `windows-latest` release (the
# website's Windows download links point at it). Only the release page and its files are deleted; the git tags stay.
set -euo pipefail
keep=4; max=1; dry=0; oldest=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep="$2"; shift 2 ;;
    --max) max="$2"; shift 2 ;;
    --oldest) oldest="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
list="$(gh release list --limit 500 --json tagName,isLatest,createdAt,isDraft)"
if [ "$oldest" -gt 0 ]; then
  # The N oldest published releases of both kinds; never the one marked Latest, a draft, or the rolling windows-latest.
  tags=$(printf '%s' "$list" | python3 -c "
import json,re,sys
rel=[r for r in json.load(sys.stdin) if re.match(r'^(v|win-v)[0-9]', r['tagName']) and not r['isLatest'] and not r['isDraft']]
rel.sort(key=lambda r:r['createdAt'])
print('\n'.join(r['tagName'] for r in rel[:$oldest]))")
  for t in $tags; do
    if [ $dry = 1 ]; then echo "would delete release $t"; else gh release delete "$t" --yes && echo "deleted release $t (tag kept)"; fi
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
