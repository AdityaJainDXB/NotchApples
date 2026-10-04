#!/bin/zsh
# Free space on the startup disk. Shows a bar beside the notch when less than 15% is free.
read size used avail pct <<< $(df -k /System/Volumes/Data | awk 'NR==2 {print $2, $3, $4, $5}')
free_gb=$(( avail / 1048576 ))
used_pct=${pct%\%}
echo "${free_gb} GB free"
echo "${used_pct}% of your disk is used"
echo "Open Storage settings | run=open x-apple.systempreferences:com.apple.settings.Storage"
if (( used_pct > 85 )); then
  echo "activity: text=${free_gb}GB symbol=internaldrive.fill color=FF9F0A"
fi
