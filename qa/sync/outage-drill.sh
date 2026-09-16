#!/usr/bin/env bash
# QA drill for LE-35 acceptance criterion 2: the pipeline survives a simulated 24h
# connectivity outage with zero data loss and zero duplicates, and the facility never
# stops registering.
#
#   qa/sync/outage-drill.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user ...] [--central-password ...] [--batch 10] [--timeout 600] \
#     [--outage-cmd '...'] [--restore-cmd '...'] [--allow-short-retention]
#
# Both stacks must be up, the facility with --profile sync, and a healthy baseline
# (verify-e2e-push.sh) must already pass. The default outage/restore commands stop and
# start the central broker container, which from the sender's side is indistinguishable
# from a WAN outage; on a staging pair with separate hosts, pass firewall commands
# instead, e.g. --outage-cmd 'ssh central sudo ufw deny 61617'.
#
# What "simulated 24h" means: the clock is compressed, the dangers are not. The drill
# exercises what makes a long outage dangerous: queue volume during the outage,
# container restarts mid-outage (a facility power cut), retry cycles, and the binlog
# retention window (asserted as configuration, since only real time can consume it).
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
BATCH=10
TIMEOUT=600
OUTAGE_CMD=""
RESTORE_CMD=""
ALLOW_SHORT_RETENTION=false
# MariaDB caps binlog_expire_logs_seconds at 8553600 (99 days), so the architecture's
# six-month floor is unreachable through this variable; the drill asserts the cap and
# the gap is risk F1's problem (binlog archiving, or an accepted shorter ceiling).
RETENTION_FLOOR=8553600

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url)     FACILITY_URL="$2"; shift 2 ;;
    --central-url)      CENTRAL_URL="$2"; shift 2 ;;
    --user)             USER="$2"; shift 2 ;;
    --password)         PASSWORD="$2"; shift 2 ;;
    --central-user)     CENTRAL_USER="$2"; shift 2 ;;
    --central-password) CENTRAL_PASSWORD="$2"; shift 2 ;;
    --batch)            BATCH="$2"; shift 2 ;;
    --timeout)          TIMEOUT="$2"; shift 2 ;;
    --outage-cmd)       OUTAGE_CMD="$2"; shift 2 ;;
    --restore-cmd)      RESTORE_CMD="$2"; shift 2 ;;
    --allow-short-retention) ALLOW_SHORT_RETENTION=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$CENTRAL_USER" ]] || CENTRAL_USER="$USER"
[[ -n "$CENTRAL_PASSWORD" ]] || CENTRAL_PASSWORD="$PASSWORD"

if [[ "$CENTRAL_URL" == *moh.gov.lr* || "$FACILITY_URL" == *moh.gov.lr* ]]; then
  echo "REFUSING: this drill fabricates patients and must never touch production." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
api() { curl -sk -u "$USER:$PASSWORD" "$@"; }

find_container() {
  docker ps --format '{{.Names}}' | grep -m1 -E "$1" || true
}
SYNC_CONTAINER="$(find_container 'facility.*[-_]sync[-_]')"
DB_CONTAINER="$(find_container 'facility.*[-_]db[-_]')"
ARTEMIS_CONTAINER="$(find_container 'central.*[-_]artemis[-_]')"
[[ -n "$SYNC_CONTAINER" && -n "$DB_CONTAINER" ]] || { echo "FAIL: facility sync/db containers not found; start the stack with --profile sync" >&2; exit 1; }
if [[ -z "$OUTAGE_CMD" ]]; then
  [[ -n "$ARTEMIS_CONTAINER" ]] || { echo "FAIL: no central artemis container and no --outage-cmd given" >&2; exit 1; }
  OUTAGE_CMD="docker stop $ARTEMIS_CONTAINER"
  RESTORE_CMD="docker start $ARTEMIS_CONTAINER"
fi
[[ -n "$RESTORE_CMD" ]] || { echo "FAIL: --outage-cmd requires --restore-cmd" >&2; exit 1; }

echo "== 0. binlog retention configuration =="
retention="$(docker exec "$DB_CONTAINER" sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "SELECT @@binlog_expire_logs_seconds;"' 2>/dev/null | tr -d '[:space:]')"
echo "   binlog_expire_logs_seconds=$retention (floor $RETENTION_FLOOR)"
if [[ "$retention" -lt "$RETENTION_FLOOR" ]]; then
  if [[ "$ALLOW_SHORT_RETENTION" == "true" ]]; then
    echo "   WARNING: below the retention floor; allowed by flag (never allow this on a facility)"
  else
    echo "FAIL: binlog retention below the floor (risk F1); set BINLOG_EXPIRE_SECONDS=8553600 or pass --allow-short-retention on a lab stack" >&2
    exit 1
  fi
fi

echo "== 1. healthy baseline =="
"$HERE/verify-e2e-push.sh" --facility-url "$FACILITY_URL" --central-url "$CENTRAL_URL" \
  --user "$USER" --password "$PASSWORD" --central-user "$CENTRAL_USER" \
  --central-password "$CENTRAL_PASSWORD" --timeout "$TIMEOUT" | tail -1

echo "== 2. cutting the link: $OUTAGE_CMD =="
eval "$OUTAGE_CMD"

# Resolve registration metadata once, before the batch.
OPENMRS_ID_TYPE="$(api "$FACILITY_URL/openmrs/ws/rest/v1/patientidentifiertype?v=custom:(uuid,name)" \
  | python3 -c 'import json,sys; print(next(t["uuid"] for t in json.load(sys.stdin)["results"] if t["name"]=="OpenMRS ID"))')"
MOH_ID_TYPE="$(api "$FACILITY_URL/openmrs/ws/rest/v1/patientidentifiertype?v=custom:(uuid,name)" \
  | python3 -c 'import json,sys; print(next(t["uuid"] for t in json.load(sys.stdin)["results"] if t["name"]=="MOH Health Record Number"))')"
LOCATION="$(api "$FACILITY_URL/openmrs/ws/rest/v1/location?tag=Login%20Location&v=custom:(uuid)" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["uuid"])')"
gen_identifier() {
  local source
  source="$(api "$FACILITY_URL/openmrs/ws/rest/v1/idgen/identifiersource?v=custom:(uuid,name)" \
    | python3 -c 'import json,sys; print(next(s["uuid"] for s in json.load(sys.stdin)["results"] if "'"$1"'" in s["name"]))')"
  api -H 'Content-Type: application/json' -X POST \
    "$FACILITY_URL/openmrs/ws/rest/v1/idgen/identifiersource/$source/identifier" -d '{}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["identifier"])'
}
register_once() {
  local n="$1" oid mid
  oid="$(gen_identifier "OpenMRS ID")"
  mid="$(gen_identifier "MOH ID Gen")"
  api -H 'Content-Type: application/json' "$FACILITY_URL/openmrs/ws/rest/v1/patient" -d '{
    "person": {"names": [{"givenName": "Outage'"$n"'", "familyName": "Drill'"$(date +%s)"'"}],
               "gender": "F", "birthdate": "1991-01-0'"$(( (n % 9) + 1 ))"'"},
    "identifiers": [
      {"identifier": "'"$oid"'", "identifierType": "'"$OPENMRS_ID_TYPE"'",
       "location": "'"$LOCATION"'", "preferred": true},
      {"identifier": "'"$mid"'", "identifierType": "'"$MOH_ID_TYPE"'",
       "location": "'"$LOCATION"'"}
    ]
  }' | python3 -c 'import json,sys
d=json.load(sys.stdin)
if "uuid" not in d: sys.exit("registration rejected: " + str(d)[:200])
print(d["uuid"])'
}
# A facility clerk retries a failed save; so does the drill. Transient rejections right
# after the mid-outage restart are expected while idgen warms back up.
register_one() {
  local n="$1" attempt uuid
  for attempt in 1 2 3 4 5; do
    if uuid="$(register_once "$n" 2>/dev/null)" && [[ -n "$uuid" ]]; then
      echo "$uuid"; return 0
    fi
    sleep 10
  done
  echo "FAIL: registration $n rejected after 5 attempts" >&2
  return 1
}

HALF=$((BATCH / 2))
echo "== 3. registering $HALF patients during the outage (facility must not block) =="
UUIDS=()
for i in $(seq 1 "$HALF"); do UUIDS+=("$(register_one "$i")"); done
echo "   ${#UUIDS[@]} registered while offline"

echo "== 4. power cut mid-outage: restarting sender and database =="
docker restart "$SYNC_CONTAINER" >/dev/null
docker restart "$DB_CONTAINER" >/dev/null
until api "$FACILITY_URL/openmrs/ws/rest/v1/session" | grep -q authenticated; do sleep 5; done
# Session answering is not enough; idgen must be generating again before the batch resumes.
until gen_identifier "OpenMRS ID" >/dev/null 2>&1; do sleep 5; done
echo "   facility answering again"

echo "== 5. registering $((BATCH - HALF)) more after the restarts =="
for i in $(seq $((HALF + 1)) "$BATCH"); do UUIDS+=("$(register_one "$i")"); done
echo "   total batch: ${#UUIDS[@]}"

echo "== 6. restoring the link: $RESTORE_CMD =="
eval "$RESTORE_CMD"

echo "== 7. waiting for the drain (timeout ${TIMEOUT}s) =="
deadline=$((SECONDS + TIMEOUT))
missing=("${UUIDS[@]}")
while ((${#missing[@]} > 0)); do
  still=()
  for u in "${missing[@]}"; do
    code="$(curl -sk -o /dev/null -w '%{http_code}' -u "$CENTRAL_USER:$CENTRAL_PASSWORD" \
      "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$u" || true)"
    [[ "$code" == "200" ]] || still+=("$u")
  done
  missing=("${still[@]+"${still[@]}"}")
  ((${#missing[@]} == 0)) && break
  if (( SECONDS >= deadline )); then
    echo "FAIL: ${#missing[@]} of $BATCH patients never reached central: ${missing[*]}" >&2
    exit 1
  fi
  echo "   ${#missing[@]} still in flight..."
  sleep 15
done
echo "   all $BATCH delivered"

echo "== 8. zero duplicates, clean queues =="
# Belt and braces: the uuid unique constraint already forbids duplicates, so the SQL
# count only runs when central's db container is reachable (local pair); on a remote
# central the delivered-by-uuid check in step 7 is the assertion.
CENTRAL_DB="$(find_container 'central.*[-_]db[-_]')"
if [[ -n "$CENTRAL_DB" ]]; then
  for u in "${UUIDS[@]}"; do
    count="$(docker exec "$CENTRAL_DB" sh -c \
      "mariadb -uroot -p\"\$MARIADB_ROOT_PASSWORD\" -N openmrs -e \"SELECT COUNT(*) FROM person WHERE uuid='$u';\"" 2>/dev/null | tr -d '[:space:]')"
    [[ "$count" == "1" ]] || { echo "FAIL: uuid $u has $count person rows at central" >&2; exit 1; }
  done
else
  echo "   central db container not local; uuid-uniqueness rests on step 7 plus the schema constraint"
fi
leftovers="$(docker exec "$DB_CONTAINER" sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N openmrs_mgmt -e "SELECT COUNT(*) FROM sender_retry_queue;"' 2>/dev/null | tr -d '[:space:]')"
[[ "$leftovers" == "0" ]] || { echo "FAIL: $leftovers items still in the sender retry queue" >&2; exit 1; }

echo
echo "PASS: $BATCH patients registered through an outage with mid-outage restarts,"
echo "      all delivered exactly once after reconnect; retry queue empty."
