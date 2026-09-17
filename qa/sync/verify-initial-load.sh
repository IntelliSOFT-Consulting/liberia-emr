#!/usr/bin/env bash
# QA drill for a facility's initial load (sync-eip.md section 5.10). Stops the facility sender,
# records a patient and a clinical day it cannot see, and moves its saved position aside as if
# sync had never run there. On restart the sender must send every record already in the
# database (SYNC_SNAPSHOT_MODE=initial), including ones central already has, while central
# skips the records every install shares. Asserts that every record in a synced table at the
# facility then exists at central with no conflicts, retries or dead letters, that sync carries
# on, and that a restart does not send everything again.
#
#   qa/sync/verify-initial-load.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user admin] [--central-password ...] [--timeout 600]
#
# Staging only: it resends the facility's whole database. Both stacks must be up, the facility
# with --profile sync. The old saved position is kept in the sender's volume until the drill
# passes, and the command to put it back is printed if it fails.
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
TIMEOUT=600

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url)     FACILITY_URL="$2"; shift 2 ;;
    --central-url)      CENTRAL_URL="$2"; shift 2 ;;
    --user)             USER="$2"; shift 2 ;;
    --password)         PASSWORD="$2"; shift 2 ;;
    --central-user)     CENTRAL_USER="$2"; shift 2 ;;
    --central-password) CENTRAL_PASSWORD="$2"; shift 2 ;;
    --timeout)          TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$CENTRAL_USER" ]] || CENTRAL_USER="$USER"
[[ -n "$CENTRAL_PASSWORD" ]] || CENTRAL_PASSWORD="$PASSWORD"

if [[ "$CENTRAL_URL" == *moh.gov.lr* || "$FACILITY_URL" == *moh.gov.lr* ]]; then
  echo "REFUSING: this drill fabricates records and resends a facility's whole database;" >&2
  echo "          never run it against production." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
RECEIVER_TEMPLATE="$HERE/../../distribution/sync/receiver-application.properties.template"
# shellcheck source=qa/sync/facility-records.sh
. "$HERE/facility-records.sh"

container() { # compose project pattern, service
  docker ps -a --filter "label=com.docker.compose.service=$2" --filter label=com.docker.compose.oneoff=False --format '{{.Names}} {{.Label "com.docker.compose.project"}}' \
    | awk -v p="$1" '$2 ~ p {print $1; exit}'
}
SENDER="$(container facility sync)"
FACILITY_DB="$(container facility db)"
RECEIVER="$(container central sync-receiver)"
CENTRAL_DB="$(container central db)"
PROMETHEUS="$(container central prometheus)"
[[ -n "$SENDER" && -n "$FACILITY_DB" && -n "$RECEIVER" && -n "$CENTRAL_DB" && -n "$PROMETHEUS" ]] \
  || fail "both stacks are running" "need the facility sync and db, and the central sync-receiver, db and prometheus"
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p"; }
if [[ "$(env_of "$SENDER" ARTEMIS_URL)" == *moh.gov.lr* ]]; then
  echo "REFUSING: $SENDER pushes to the real central broker; point it at a staging broker first." >&2
  exit 1
fi
sql() { # db-container app-container user-var password-var database-var statement
  { env_of "$2" "$4"; printf '%s\n' "$6"; } | docker exec -i "$1" sh -c \
    'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mariadb --batch --skip-column-names -u "$1" "$2"' \
    sh "$(env_of "$2" "$3")" "$(env_of "$2" "$5")"
}
facility_sql() { sql "$FACILITY_DB" "$SENDER" OPENMRS_DB_USER OPENMRS_DB_PASSWORD OPENMRS_DB_NAME "$1"; }
central_sql() { sql "$CENTRAL_DB" "$RECEIVER" OPENMRS_DB_USER OPENMRS_DB_PASSWORD OPENMRS_DB_NAME "$1"; }
sender_mgmt_sql() { sql "$FACILITY_DB" "$SENDER" MGMT_DB_USER MGMT_DB_PASSWORD MGMT_DB_NAME "$1"; }
receiver_mgmt_sql() { sql "$CENTRAL_DB" "$RECEIVER" MGMT_DB_USER MGMT_DB_PASSWORD MGMT_DB_NAME "$1"; }
# These set a variable rather than print, so that a failure ends the drill instead of a subshell.
read_depth() { # broker-queue variable
  local depth
  depth="$(docker exec "$PROMETHEUS" wget -qO- http://artemis:8161/metrics/ 2>/dev/null \
    | awk -v q="queue=\"$1\"" 'index($0, "artemis_message_count{") == 1 && index($0, q) {print int($2); exit}' || true)"
  [[ -n "$depth" ]] || fail "the broker reports the depth of $1" "no artemis_message_count for it at artemis:8161/metrics/"
  printf -v "$2" '%s' "$depth"
}
read_central_state() { # variable
  local retries conflicts dead_letters
  retries="$(receiver_mgmt_sql 'SELECT COUNT(*) FROM receiver_retry_queue')" || fail "central's retry queue can be read"
  conflicts="$(receiver_mgmt_sql 'SELECT COUNT(*) FROM receiver_conflict_queue')" || fail "central's conflict queue can be read"
  read_depth DLQ dead_letters
  printf -v "$1" 'retries=%s conflicts=%s dead_letters=%s' "$retries" "$conflicts" "$dead_letters"
}
sender_log() { docker logs --since "$1" "$SENDER" 2>&1 || true; }

# Tables the sender watches that carry a uuid; patient and the order subclasses share theirs
# with person and orders.
TABLES="person person_name person_address person_attribute patient_identifier relationship visit
visit_attribute encounter encounter_provider encounter_diagnosis obs conditions allergy
diagnosis_attribute patient_program patient_state patient_program_attribute orders order_group
order_attribute order_group_attribute users provider"
# Skipped at central by design: the receiver's excluded records and dbsync's daemon user.
SKIPPED="$(sed -n 's/^db-sync\.excludedEntities=//p' "$RECEIVER_TEMPLATE" | tr ',' '\n' | cut -d: -f2 \
  | tr '[:upper:]' '[:lower:]'; echo a4f30a1b-5eb9-11df-a648-37a07f9c90fb)"
WORK="$(mktemp -d)"
# Writes the facility records central lacks to $WORK/missing and the count compared per table to
# $WORK/counts. A query that fails ends the drill rather than reading as an empty table.
all_at_central() {
  local t
  : > "$WORK/missing"
  : > "$WORK/counts"
  for t in $TABLES; do
    facility_sql "SELECT LOWER(uuid) FROM $t" > "$WORK/facility" || fail "the facility database lists $t"
    central_sql "SELECT LOWER(uuid) FROM $t" > "$WORK/central" || fail "central's database lists $t"
    { grep -vxF "$SKIPPED" "$WORK/facility" || true; } | sort > "$WORK/compared"
    comm -23 "$WORK/compared" <(sort "$WORK/central") | sed "s/^/$t:/" >> "$WORK/missing"
    echo "$t $(wc -l < "$WORK/compared")" >> "$WORK/counts"
  done
  [[ ! -s "$WORK/missing" ]]
}
drained() { # in the order records flow, so none slips between two reads
  local waiting
  [[ "$(sender_mgmt_sql 'SELECT (SELECT COUNT(*) FROM debezium_event_queue) + (SELECT COUNT(*) FROM sender_retry_queue)')" == 0 ]] \
    || return 1
  read_depth DB-SYNC-REC.DB-SYNC-RECEIVER waiting
  [[ "$waiting" == 0 && "$(receiver_mgmt_sql 'SELECT COUNT(*) FROM receiver_sync_msg')" == 0 ]]
}

ASIDE=""
PASSED=""
before=""
after=""
finish() {
  rm -rf "$WORK"
  if [[ "$(docker inspect -f '{{.State.Running}}' "$SENDER")" != "true" ]]; then
    docker start "$SENDER" >/dev/null || echo "WARNING: start $SENDER by hand" >&2
  fi
  if [[ -n "$ASIDE" && -z "$PASSED" ]]; then
    echo "The sender's previous saved position is in its volume as /opt/eip/$ASIDE. To go back to it:" >&2
    echo "  docker stop $SENDER && docker run --rm --volumes-from $SENDER --entrypoint sh $IMAGE \\" >&2
    echo "    -c 'rm -rf /opt/eip/.debezium && mv -T /opt/eip/$ASIDE /opt/eip/.debezium' && docker start $SENDER" >&2
  fi
}
trap finish EXIT
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$SENDER")"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
read_central_state before
drained || fail "sync is idle before the drill" "wait for the facility and central queues to empty, then run it again"

echo "== recording a patient and a clinical day while the sender is stopped =="
docker stop "$SENDER" >/dev/null
PATIENT="$(register_patient SyncLoad)"
echo "   patient $PATIENT"
record_clinical_day "$PATIENT"
pass "a patient and their clinical day are recorded while the sender is stopped"

echo "== starting the sender with no saved position =="
aside=".debezium.before-drill-$(date -u +%Y%m%dT%H%M%SZ)"
docker run --rm --volumes-from "$SENDER" --entrypoint sh "$IMAGE" \
  -c 'mv -T /opt/eip/.debezium "/opt/eip/$1"' sh "$aside"
ASIDE="$aside"
restarted="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker start "$SENDER" >/dev/null
snapshot_ended() { # status
  sender_log "$restarted" | grep -aq "Snapshot ended with SnapshotResult \[status=$1"
}
until_true "$TIMEOUT" snapshot_ended COMPLETED \
  || fail "the sender reads the existing records within ${TIMEOUT}s" "$(sender_log "$restarted" | grep -aiE 'snapshot|error' | tail -5)"
sender_log "$restarted" | grep -aq 'snapshot.mode = initial' \
  || fail "the sender starts with snapshot mode initial"
# The clinic can save during the load only if the global read lock is gone before the data is read.
sender_log "$restarted" | awk '/Releasing global read lock/ {released = NR} /Snapshot step 7 - Snapshotting data/ {data = NR}
  END {exit !(released && data && released < data)}' \
  || fail "the sender releases the database lock before reading the data"
pass "the sender reads every existing record on a start with no saved position, with the database unlocked"

echo "== waiting for everything to reach central (timeout ${TIMEOUT}s) =="
until_true "$TIMEOUT" drained || fail "the facility and central queues drain within ${TIMEOUT}s"
until_true "$TIMEOUT" all_at_central \
  || fail "every record in the facility's synced tables reaches central" "$(head -10 "$WORK/missing")"
checked="$(awk '{n += $2} END {print n + 0}' "$WORK/counts")"
(( checked > 0 )) || fail "the facility has records in its synced tables to compare"
pass "all $checked records in the facility's synced tables are at central"
empty="$(awk '$2 == 0 {print $1}' "$WORK/counts" | paste -sd' ' -)"
[[ -z "$empty" ]] || echo "   nothing to compare in: $empty"
clinical_day_at_central && at_central "patient/$PATIENT" \
  || fail "the patient recorded while the sender was stopped reaches central with their clinical day"
pass "the patient recorded while the sender was stopped arrives with their clinical day"

receiver_log="$(docker logs --since "$started" "$RECEIVER" 2>&1 || true)"
grep -aq 'Skipping sync of entity: org.openmrs.eip.dbsync.model.UserModel, identifier=82f18b44-6814-11e8-923f-e9a88dcb533f' <<<"$receiver_log" \
  || fail "central skips the admin account every install shares"
! grep -aq 'Failed to find the existing hash' <<<"$receiver_log" \
  || fail "central applies or skips every record, none refused for a missing hash"
[[ "$(central_sql "SELECT username FROM users WHERE uuid = '82f18b44-6814-11e8-923f-e9a88dcb533f'")" == "admin" ]] \
  || fail "central's own admin account is untouched"
pass "records every install shares are skipped, and central's admin account is untouched"

read_central_state after
[[ "$after" == "$before" ]] || fail "the load raises no conflicts, retries or dead letters" "before: $before" "after:  $after"
pass "the load raises no conflicts, retries or dead letters ($after)"

echo "== checking sync carries on =="
NEXT="$(register_patient SyncAfterLoad)"
until_true "$TIMEOUT" at_central "patient/$NEXT" || fail "a patient registered after the load reaches central"
pass "a patient registered after the load reaches central"

echo "== restarting the sender =="
restarted="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker restart "$SENDER" >/dev/null
until_true "$TIMEOUT" snapshot_ended SKIPPED \
  || fail "a restarted sender resumes from its saved position" "$(sender_log "$restarted" | grep -aiE 'snapshot|error' | tail -5)"
! snapshot_ended COMPLETED || fail "a restarted sender does not read everything again"
pass "a restarted sender resumes from its saved position and sends nothing again"

PASSED=1
docker run --rm --volumes-from "$SENDER" --entrypoint sh "$IMAGE" -c 'rm -rf "/opt/eip/$1"' sh "$ASIDE"
echo "PASS: all $PASSES initial load checks held; patient $PATIENT arrived through the load"
