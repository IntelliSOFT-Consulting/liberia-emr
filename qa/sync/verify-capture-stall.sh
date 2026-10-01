#!/usr/bin/env bash
# QA check for the capture exporter: a sender that is running but no longer reading the binlog
# raises SyncCaptureStalled, and the alert clears once capture resumes.
#
#   qa/sync/verify-capture-stall.sh [--facility-url https://localhost] \
#     [--prom-url http://127.0.0.1:9090] [--user admin] [--password ...] [--timeout 1500]
#
# Needs the facility stack with --profile sync. It reproduces what a power cut does to the last
# event of a binary log file: the sender's saved position is moved one byte into an event, so
# Debezium fails on it and retries forever while the sender stays up. A patient registered
# meanwhile is the record left waiting. The original position is put back at the end, so the
# sender then captures that patient as usual. The rule waits 15 minutes before firing.
set -euo pipefail

FACILITY_URL="https://localhost"
PROM_URL="http://127.0.0.1:9090"
USER="admin"
PASSWORD="Admin123"
TIMEOUT=1500

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url) FACILITY_URL="$2"; shift 2 ;;
    --prom-url)     PROM_URL="$2"; shift 2 ;;
    --user)         USER="$2"; shift 2 ;;
    --password)     PASSWORD="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$FACILITY_URL" != *moh.gov.lr* ]] || { echo "REFUSING: this check stalls sync and fabricates a patient; never production." >&2; exit 1; }

SYNC="$(docker ps --format '{{.Names}}' | grep -v facility2 | grep -m1 -E 'facility[-_]sync[-_][0-9]+$' || true)"
[[ -n "$SYNC" ]] || { echo "FAIL: no running facility sync container" >&2; exit 1; }
OFFSETS=/opt/eip/.debezium/offsets.txt
WORK="$(mktemp -d)"
restored=false
restore() {
  $restored && return 0
  docker stop "$SYNC" >/dev/null
  tar --no-xattrs -C "$WORK/orig" --uid 999 --gid 999 -cf - offsets.txt | docker cp - "$SYNC:$(dirname "$OFFSETS")" \
    || echo "WARNING: could not put the saved position back; restore $WORK/orig/offsets.txt by hand" >&2
  docker start "$SYNC" >/dev/null
  restored=true
}
trap 'restore; rm -rf "$WORK"' EXIT

prom() { curl -s "$PROM_URL/api/v1/query" --data-urlencode "query=$1" | python3 -c '
import json,sys
r = json.load(sys.stdin)["data"]["result"]
print(r[0]["value"][1] if r else "")'; }
alert_state() { curl -s "$PROM_URL/api/v1/alerts" | python3 -c '
import json,sys
states = [a["state"] for a in json.load(sys.stdin)["data"]["alerts"] if a["labels"].get("alertname") == "SyncCaptureStalled"]
print(states[0] if states else "none")'; }
wait_for() { # seconds description command...
  local deadline=$((SECONDS + $1)) what="$2"; shift 2
  until "$@"; do (( SECONDS < deadline )) || { echo "FAIL: $what" >&2; exit 1; }; sleep 15; done
}
api() { curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
register() { # prints the new patient's uuid
  local base="$FACILITY_URL/openmrs/ws/rest/v1" location types gen ids
  location="$(api "$base/location?tag=Login%20Location&v=custom:(uuid)" | json 'd["results"][0]["uuid"]')"
  types="$(api "$base/patientidentifiertype?v=custom:(uuid,name)")"
  gen() {
    local source
    source="$(api "$base/idgen/identifiersource?v=custom:(uuid,name)" | json "next(s['uuid'] for s in d['results'] if '$1' in s['name'])")"
    api "$base/idgen/identifiersource/$source/identifier" -X POST -d '{}' | json 'd["identifier"]'
  }
  ids="[{\"identifier\":\"$(gen "OpenMRS ID")\",\"identifierType\":\"$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="OpenMRS ID")' <<<"$types")\",\"location\":\"$location\",\"preferred\":true},"
  ids="$ids{\"identifier\":\"$(gen "MOH ID Gen")\",\"identifierType\":\"$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="MOH Health Record Number")' <<<"$types")\",\"location\":\"$location\"}]"
  api "$base/patient" -X POST -d "{\"identifiers\":$ids,\"person\":{\"names\":[{\"givenName\":\"Qa$(date +%s)\",\"familyName\":\"Stall\"}],\"gender\":\"F\",\"birthdate\":\"1990-01-01\"}}" \
    | json 'd.get("uuid") or d.get("error",{}).get("message")'
}

echo "== baseline =="
[[ "$(prom 'up{job="sync-capture"}')" == "1" ]] || { echo "FAIL: Prometheus is not scraping sync-capture" >&2; exit 1; }
[[ "$(alert_state)" == "none" ]] || { echo "FAIL: SyncCaptureStalled already active before the drill" >&2; exit 1; }
echo "   exporter scraped; no stall"

echo "== moving the sender's saved position into the middle of an event =="
docker stop "$SYNC" >/dev/null
mkdir -p "$WORK/orig" "$WORK/torn"
docker cp "$SYNC:$OFFSETS" "$WORK/orig/offsets.txt"
python3 - "$WORK/orig/offsets.txt" "$WORK/torn/offsets.txt" <<'PY'
import re, sys
data = open(sys.argv[1], "rb").read()
m = re.search(rb'\{[^{}]*"pos":(\d+)[^{}]*\}', data)
assert m, "no Debezium position in the offset file"
old = m.group(0)
new = old.replace(b'"pos":' + m.group(1), b'"pos":' + str(int(m.group(1)) + 1).encode())
start = m.start()
assert int.from_bytes(data[start - 4:start], "big") == len(old), "unexpected offset file layout"
open(sys.argv[2], "wb").write(data[:start - 4] + len(new).to_bytes(4, "big") + new + data[m.end():])
print("   position", m.group(1).decode(), "->", int(m.group(1)) + 1)
PY
tar --no-xattrs -C "$WORK/torn" --uid 999 --gid 999 -cf - offsets.txt | docker cp - "$SYNC:$(dirname "$OFFSETS")"
docker start "$SYNC" >/dev/null
moved_at=$(date +%s)

# The patient must arrive after the exporter has taken the new position as its baseline, or it
# is counted as already captured.
new_baseline() {
  local unchanged; unchanged="$(prom 'sync_capture_offset_unchanged_seconds')"
  [[ -n "$unchanged" ]] && (( ${unchanged%.*} < $(date +%s) - moved_at ))
}
wait_for 300 "the exporter never saw the moved position" new_baseline

patient="$(register)"
[[ "$patient" =~ ^[0-9a-f-]{36}$ ]] || { echo "FAIL: could not register a patient: $patient" >&2; exit 1; }
echo "   registered $patient while the sender cannot read on"

stall_counting() { [[ "$(prom 'sync_capture_stalled_seconds')" =~ ^[1-9] ]]; }
wait_for 300 "the exporter never saw the patient waiting" stall_counting
sender_up() { [[ "$(prom 'up{job="sync-sender"}')" == "1" ]]; }
wait_for 300 "the sender is not up, so this is not the silent case" sender_up
echo "   the exporter counts the patient as waiting; the sender reports itself healthy"

firing() { [[ "$(alert_state)" == "firing" ]]; }
wait_for "$TIMEOUT" "SyncCaptureStalled did not fire within ${TIMEOUT}s (state: $(alert_state))" firing
echo "   SyncCaptureStalled FIRING at $PROM_URL/alerts"

echo "== putting the original position back =="
restore
cleared() { [[ "$(prom 'sync_capture_stalled_seconds')" == "0" && "$(alert_state)" == "none" ]]; }
wait_for 900 "the stall did not clear after the sender resumed" cleared
echo "   capture resumed; the alert resolved"

echo
echo "PASS: a running sender that stopped capturing raised SyncCaptureStalled, and it cleared on recovery."
