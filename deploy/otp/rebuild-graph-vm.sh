#!/usr/bin/env bash
# Runs ON THE AZURE OTP VM, as root. rebuild-graph.sh (on your laptop) uploads it and runs it for you.
#
# Builds a new graph.obj ON THE VM, covering Dublin AND the commuter belt out to Maynooth (Kildare) and
# north County Dublin (Balbriggan, Skerries, the Naul), with the latest TFI timetable:
#   1. downloads the Ireland OpenStreetMap extract (Geofabrik) and cuts out the Greater Dublin box
#   2. downloads the latest TFI GTFS timetable (GTFS_All.zip)
#   3. stops OTP (the journey planner is offline for ~15-30 minutes), builds the graph
#   4. swaps it in, starts OTP and checks it answers, including a trip to Maynooth University
# The old graph is kept (graph.obj.previous) and put back automatically if anything fails.
#
# Usage: sudo bash rebuild-graph-vm.sh
set -euo pipefail

OTP_DIR=/opt/otp
BUILD_DIR=$OTP_DIR/build
# Greater Dublin box: Maynooth/Kilcock in the west, Balbriggan/the Naul in the north, Bray in the south
BBOX="-6.75,53.15,-5.95,53.70"
OSM_URL=https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf
GTFS_URL=https://www.transportforireland.ie/transitData/Data/GTFS_All.zip
BUILD_HEAP="${BUILD_HEAP:-6G}"   # 8 GB VM with OTP stopped: plenty

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
[[ -x $OTP_DIR/java && -f $OTP_DIR/otp-shaded.jar ]] || { echo "OTP isn't installed in $OTP_DIR - run deploy-otp.sh first" >&2; exit 1; }

echo "== 1/4 Map: Ireland extract, cut to the Greater Dublin box ($BBOX)"
command -v osmium >/dev/null || { apt-get update -q && apt-get install -y -q osmium-tool; }
install -d -o otp -g otp "$BUILD_DIR"
rm -f "$BUILD_DIR"/*.osm.pbf "$BUILD_DIR"/*.zip "$BUILD_DIR"/graph.obj
curl -fL --retry 3 -o /tmp/ireland.osm.pbf "$OSM_URL"
osmium extract --overwrite -b "$BBOX" /tmp/ireland.osm.pbf -o "$BUILD_DIR/greater-dublin.osm.pbf"
rm -f /tmp/ireland.osm.pbf

echo "== 2/4 Timetable: latest TFI GTFS"
curl -fL --retry 3 -o "$BUILD_DIR/GTFS_All.zip" "$GTFS_URL"
chown -R otp:otp "$BUILD_DIR"
ls -lh "$BUILD_DIR"

echo "== 3/4 Building the graph (the journey planner is offline until this finishes)"
systemctl stop otp
swapped=0
restore() {
  # only undo a swap this run made (an older graph.obj.previous must not replace the current graph)
  if [[ $swapped -eq 1 ]]; then
    echo "Something went wrong - putting the previous graph back." >&2
    mv -f "$OTP_DIR/graph/graph.obj.previous" "$OTP_DIR/graph/graph.obj"
  else
    echo "Something went wrong - the current graph was not changed." >&2
  fi
  systemctl restart otp
}
trap restore ERR
sudo -u otp "$OTP_DIR/java" -Xmx"$BUILD_HEAP" -jar "$OTP_DIR/otp-shaded.jar" --build --save "$BUILD_DIR"
[[ -s $BUILD_DIR/graph.obj ]] || { echo "The build didn't produce graph.obj" >&2; false; }
cp -f "$OTP_DIR/graph/graph.obj" "$OTP_DIR/graph/graph.obj.previous"
swapped=1
install -o otp -g otp -m 0644 "$BUILD_DIR/graph.obj" "$OTP_DIR/graph/graph.obj"

echo "== 4/4 Starting OTP with the new graph"
systemctl start otp
up=0
for _ in $(seq 1 72); do
  if curl -fsS -m 5 -H 'Content-Type: application/json' -d '{"query":"{feeds{feedId}}"}' \
       http://127.0.0.1:8080/otp/gtfs/v1 2>/dev/null | grep -q feedId; then up=1; break; fi
  systemctl is-active --quiet otp || break
  sleep 5
done
[[ $up -eq 1 ]] || { journalctl -u otp -n 40 --no-pager >&2; false; }

# A trip that only works with the bigger map: Dublin city centre -> Maynooth University
TOMORROW_9=$(date -d 'tomorrow 09:00' +%Y-%m-%dT%H:%M:%S%:z)
QUERY='{"query":"query($t: OffsetDateTime!){ planConnection(origin:{location:{coordinate:{latitude:53.3485,longitude:-6.2515}}}, destination:{location:{coordinate:{latitude:53.3842,longitude:-6.6010}}}, dateTime:{latestArrival:$t}, modes:{transit:{transit:[{mode:BUS},{mode:TRAM},{mode:RAIL}]}}, first:1){ edges { node { duration } } routingErrors { code } } }","variables":{"t":"'"$TOMORROW_9"'"}}'
if curl -fsS -m 60 -H 'Content-Type: application/json' -d "$QUERY" http://127.0.0.1:8080/otp/gtfs/v1 | grep -q '"duration"'; then
  echo "Check passed: the planner finds a trip from the city centre to Maynooth University."
else
  echo "WARNING: OTP is up, but the test trip to Maynooth University found no route." >&2
fi
trap - ERR
rm -f "$BUILD_DIR"/*.osm.pbf "$BUILD_DIR"/GTFS_All.zip "$BUILD_DIR"/graph.obj
echo "Done. The previous graph is kept as $OTP_DIR/graph/graph.obj.previous (delete it once you're happy)."
