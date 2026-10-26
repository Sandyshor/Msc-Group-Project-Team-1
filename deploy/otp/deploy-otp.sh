#!/usr/bin/env bash
# Runs ON YOUR LAPTOP. Uploads the OTP jar and graph.obj to the Azure VM and (re)starts OTP there.
# Use it for the first deployment and every time you rebuild graph.obj with new timetables.
#
# Usage: bash deploy/otp/deploy-otp.sh azureuser@<vm-public-ip> [OTP_FOLDER]
#   OTP_FOLDER defaults to ~/dublin-otp (must contain otp-shaded-2.10.0.jar and graph.obj)
set -euo pipefail

TARGET="${1:?Usage: $0 azureuser@<vm-public-ip> [OTP_FOLDER]}"
OTP_FOLDER="${2:-$HOME/dublin-otp}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REMOTE_DIR=otp-upload

for f in "$OTP_FOLDER/otp-shaded-2.10.0.jar" "$OTP_FOLDER/graph.obj"; do
  [[ -f $f ]] || { echo "Missing $f" >&2; exit 1; }
done

echo "Uploading to $TARGET:~/$REMOTE_DIR (about 370 MB the first time; later runs only send changes)..."
ssh "$TARGET" "mkdir -p ~/$REMOTE_DIR"
rsync -P --checksum \
  "$OTP_FOLDER/otp-shaded-2.10.0.jar" "$OTP_FOLDER/graph.obj" \
  "$HERE/otp.service" "$HERE/setup-otp-vm.sh" \
  "$TARGET:$REMOTE_DIR/"

echo "Installing and starting OTP on the VM..."
ssh -t "$TARGET" "sudo bash ~/$REMOTE_DIR/setup-otp-vm.sh ~/$REMOTE_DIR"
