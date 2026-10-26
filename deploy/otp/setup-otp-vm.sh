#!/usr/bin/env bash
# Runs ON THE AZURE VM (Ubuntu 24.04), as root. deploy-otp.sh uploads this folder and runs it for you.
#
# Installs Java 25 (needed by OTP 2.10), installs the OTP jar and graph from the upload folder,
# runs OTP as a systemd service on port 8080, and waits until it answers.
# Safe to re-run: use it again whenever you upload a new graph.obj.
#
# Usage: sudo bash setup-otp-vm.sh [UPLOAD_DIR]     (default: the folder this script is in)
set -euo pipefail

UPLOAD_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
JAR="$UPLOAD_DIR/otp-shaded-2.10.0.jar"
GRAPH="$UPLOAD_DIR/graph.obj"
OTP_DIR=/opt/otp
NEED_JAVA=25

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
for f in "$JAR" "$GRAPH" "$UPLOAD_DIR/otp.service"; do
  [[ -f $f ]] || { echo "Missing $f - upload it first (see deploy/otp/README.md)" >&2; exit 1; }
done

java_major() { "$1" -version 2>&1 | awk -F'"' '/version/{split($2, v, "."); print v[1]; exit}'; }

find_java() {
  local candidate
  for candidate in /usr/lib/jvm/*/bin/java /usr/bin/java; do
    [[ -x $candidate ]] || continue
    if [[ "$(java_major "$candidate")" -ge $NEED_JAVA ]]; then
      readlink -f "$candidate"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------- Java 25
if ! JAVA_BIN="$(find_java)"; then
  echo "Installing Java $NEED_JAVA..."
  apt-get update -q
  if ! apt-get install -y -q "openjdk-$NEED_JAVA-jre-headless"; then
    echo "Ubuntu has no openjdk-$NEED_JAVA package; installing Eclipse Temurin $NEED_JAVA from Adoptium."
    apt-get install -y -q wget apt-transport-https gpg
    wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/adoptium.gpg
    echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release) main" \
      > /etc/apt/sources.list.d/adoptium.list
    apt-get update -q
    apt-get install -y -q "temurin-$NEED_JAVA-jdk"
  fi
  JAVA_BIN="$(find_java)" || { echo "Java $NEED_JAVA install failed" >&2; exit 1; }
fi
echo "Using Java: $JAVA_BIN ($("$JAVA_BIN" -version 2>&1 | head -1))"

# ---------------------------------------------------------------- OTP files
id otp >/dev/null 2>&1 || useradd --system --home "$OTP_DIR" --shell /usr/sbin/nologin otp
install -d -o otp -g otp "$OTP_DIR" "$OTP_DIR/graph"
install -o otp -g otp -m 0644 "$JAR" "$OTP_DIR/otp-shaded.jar"
install -o otp -g otp -m 0644 "$GRAPH" "$OTP_DIR/graph/graph.obj"
ln -sfn "$JAVA_BIN" "$OTP_DIR/java"

# Heap: leave ~2 GB for the OS. OTP needs about 3 GB for the Ireland graph.
mem_gb=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo)
heap_gb=$(( mem_gb - 2 ))
(( heap_gb >= 3 )) || { echo "WARNING: only ${mem_gb} GB RAM; OTP needs ~3 GB heap. Use a VM with 8 GB (e.g. Standard_B2ms)." >&2; heap_gb=3; }
echo "OTP_HEAP=${heap_gb}G" > /etc/default/otp

install -m 0644 "$UPLOAD_DIR/otp.service" /etc/systemd/system/otp.service
systemctl daemon-reload
systemctl enable otp >/dev/null
systemctl restart otp
echo "OTP starting with ${heap_gb} GB heap; loading the graph can take a few minutes..."

# ---------------------------------------------------------------- health check
for _ in $(seq 1 60); do
  if curl -fsS -m 5 -H 'Content-Type: application/json' -d '{"query":"{feeds{feedId}}"}' \
       http://127.0.0.1:8080/otp/gtfs/v1 2>/dev/null | grep -q feedId; then
    echo "OTP is up: http://$(hostname -I | awk '{print $1}'):8080/otp/gtfs/v1"
    exit 0
  fi
  if ! systemctl is-active --quiet otp; then break; fi
  sleep 5
done
echo "OTP did not come up. Last log lines:" >&2
journalctl -u otp -n 40 --no-pager >&2
exit 1
