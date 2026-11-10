#!/usr/bin/env bash
# Runs ON YOUR LAPTOP. Rebuilds the journey planner's graph ON the Azure OTP VM, so it covers Maynooth
# University (Kildare) and north County Dublin as well as the city, with the latest TFI timetable.
# Nothing big is uploaded: the VM downloads the map and timetable itself and builds there (8 GB RAM).
# The planner is offline for about 15-30 minutes while it builds; the old graph comes back if anything fails.
#
# Usage: bash deploy/otp/rebuild-graph.sh azureuser@<vm-public-ip>
set -euo pipefail

TARGET="${1:?Usage: $0 azureuser@<vm-public-ip>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

scp "$HERE/rebuild-graph-vm.sh" "$TARGET:rebuild-graph-vm.sh"
ssh -t "$TARGET" "sudo bash ~/rebuild-graph-vm.sh"
