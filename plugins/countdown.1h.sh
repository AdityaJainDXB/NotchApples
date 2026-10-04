#!/bin/zsh
# Days until a date. Edit TARGET (YYYY-MM-DD) and LABEL.
TARGET="2026-12-25"
LABEL="Holidays"
now=$(date +%s)
then=$(date -j -f "%Y-%m-%d" "$TARGET" +%s 2>/dev/null)
days=$(( (then - now + 86399) / 86400 ))
echo "$days days to $LABEL"
echo "$TARGET"
echo "activity: title=$LABEL text=${days}d symbol=calendar color=BF5AF2"
