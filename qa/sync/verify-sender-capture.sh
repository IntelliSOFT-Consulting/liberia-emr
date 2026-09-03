#!/usr/bin/env bash
# QA check for the sync sender (LE-35, capture stage): registers a patient through the
# facility REST API and asserts the dbsync sender captures it off the binary log.
#
#   qa/sync/verify-sender-capture.sh [--base-url https://localhost] \
#     [--user admin] [--password ...] [--timeout 120]
#
# Run it against a facility stack started WITH the sync profile:
#   docker compose --profile sync ... up -d
#
# What it proves end to end: UI/REST write -> MariaDB -> binlog -> Debezium -> dbsync
# payload for the new patient's UUID. It reads the sender's console log through docker,
# so it must run where the stack runs. It asserts on UUIDs only; patient names never
# appear in sender logs (that is itself part of the contract, and worth spot-checking).
set -euo pipefail

BASE_URL="https://localhost"
USER="admin"
PASSWORD="Admin123"
TIMEOUT=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --user)     USER="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

api() { curl -sk -u "$USER:$PASSWORD" "$@"; }

# This script fabricates a patient, and the sender will push whatever it captures. It
# must never feed the real central: refuse outright if the running sender is pointed at
# an moh.gov.lr broker. No override flag on purpose; point the sender somewhere else.
SYNC_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'facility.*[-_]sync[-_]' || true)"
[[ -n "$SYNC_CONTAINER" ]] || { echo "FAIL: no running sync container found; start the stack with --profile sync" >&2; exit 1; }
SENDER_TARGET="$(docker inspect "$SYNC_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ARTEMIS_URL=' | cut -d= -f2-)"
if [[ "$SENDER_TARGET" == *moh.gov.lr* ]]; then
  echo "REFUSING: the sender pushes to '$SENDER_TARGET'; this script must never register" >&2
  echo "          a fabricated patient into the real central path." >&2
  exit 1
fi

# After a restart the sender replays its recorded schema history before re-attaching to
# the binlog, which can take minutes. Registering before it re-attaches is NOT lost (the
# offset guarantees catch-up) but would make this check flake, so wait for the attach.
echo "== waiting for the sender to attach to the binlog (timeout ${TIMEOUT}s) =="
deadline=$((SECONDS + TIMEOUT))
# Not grep -q: under pipefail an early grep exit kills docker logs with SIGPIPE and the
# pipeline reports failure even on a match, so these loops read the stream to the end.
until docker logs "$SYNC_CONTAINER" 2>&1 | grep -a 'Connected to MySQL binlog' >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "FAIL: sender never attached to the binlog within ${TIMEOUT}s; check its logs" >&2
    exit 1
  fi
  sleep 5
done

echo "== resolving registration metadata =="
# Both identifier types the site configuration marks required. OpenMRS ID comes from its
# own idgen generator; the MOH Health Record Number from the MOH ID Gen source.
OPENMRS_ID_TYPE="$(api "$BASE_URL/openmrs/ws/rest/v1/patientidentifiertype?v=custom:(uuid,name)" \
  | python3 -c 'import json,sys; print(next(t["uuid"] for t in json.load(sys.stdin)["results"] if t["name"]=="OpenMRS ID"))')"
MOH_ID_TYPE="$(api "$BASE_URL/openmrs/ws/rest/v1/patientidentifiertype?v=custom:(uuid,name)" \
  | python3 -c 'import json,sys; print(next(t["uuid"] for t in json.load(sys.stdin)["results"] if t["name"]=="MOH Health Record Number"))')"
LOCATION="$(api "$BASE_URL/openmrs/ws/rest/v1/location?tag=Login%20Location&v=custom:(uuid)" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["uuid"])')"

gen_identifier() {
  local source
  source="$(api "$BASE_URL/openmrs/ws/rest/v1/idgen/identifiersource?v=custom:(uuid,name)" \
    | python3 -c 'import json,sys; print(next(s["uuid"] for s in json.load(sys.stdin)["results"] if "'"$1"'" in s["name"]))')"
  api -H 'Content-Type: application/json' -X POST \
    "$BASE_URL/openmrs/ws/rest/v1/idgen/identifiersource/$source/identifier" -d '{}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["identifier"])'
}
OPENMRS_ID="$(gen_identifier "OpenMRS ID")"
MOH_ID="$(gen_identifier "MOH ID Gen")"

echo "== registering a QA patient (identifiers $OPENMRS_ID / $MOH_ID) =="
STAMP="$(date +%s)"
RESPONSE="$(api -H 'Content-Type: application/json' "$BASE_URL/openmrs/ws/rest/v1/patient" -d '{
  "person": {"names": [{"givenName": "Qa'"$STAMP"'", "familyName": "SyncCapture"}],
             "gender": "F", "birthdate": "1990-01-01"},
  "identifiers": [
    {"identifier": "'"$OPENMRS_ID"'", "identifierType": "'"$OPENMRS_ID_TYPE"'",
     "location": "'"$LOCATION"'", "preferred": true},
    {"identifier": "'"$MOH_ID"'", "identifierType": "'"$MOH_ID_TYPE"'",
     "location": "'"$LOCATION"'"}
  ]
}')"
PATIENT_UUID="$(python3 -c 'import json,sys
d = json.loads(sys.argv[1])
if "uuid" not in d:
    sys.exit("FAIL: registration rejected: " + json.dumps(d.get("error", d))[:300])
print(d["uuid"])' "$RESPONSE")"
echo "   patient $PATIENT_UUID"

echo "== waiting for the sender to capture it (timeout ${TIMEOUT}s) =="
deadline=$((SECONDS + TIMEOUT))
until docker logs --since 5m "$SYNC_CONTAINER" 2>&1 | grep -a "$PATIENT_UUID" >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "FAIL: sender did not log patient $PATIENT_UUID within ${TIMEOUT}s" >&2
    exit 1
  fi
  sleep 5
done

if docker logs --since 5m "$SYNC_CONTAINER" 2>&1 | grep -a "SyncCapture" >/dev/null; then
  echo "FAIL: the patient's NAME appears in sender logs; the no-PHI-in-logs contract is broken" >&2
  exit 1
fi

echo "PASS: sender captured patient $PATIENT_UUID from the binlog, and logged no PHI"
