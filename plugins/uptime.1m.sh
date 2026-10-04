#!/bin/zsh
# How long the Mac has been on, and the load average.
up=$(uptime | sed -E 's/.*up ([^,]*(, [0-9]+:[0-9]+)?),.*/\1/')
load=$(sysctl -n vm.loadavg | awk '{print $2}')
cores=$(sysctl -n hw.ncpu)
echo "Up $up"
echo "Load $load on $cores cores"
echo "Activity Monitor | run=open -a 'Activity Monitor'"
