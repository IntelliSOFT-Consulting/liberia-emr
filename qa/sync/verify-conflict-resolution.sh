#!/usr/bin/env bash
# QA check that a sync conflict is resolved with dbsync's own procedure and the alert clears
# (sync-eip.md 5.6). Registers a patient at the facility, waits for it at central, edits it at
# central outside sync and then twice at the facility, so the receiver raises a real conflict
# with an update waiting behind it. Resolves it with scripts/sync/conflicts.sh, and asserts
# that the waiting update applies on the retry run, that a later change applies without a new
# conflict, and that no payload reached the receiver's log.
#
#   qa/sync/verify-conflict-resolution.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user ...] [--central-password ...] [--prom-url http://127.0.0.1:9190] \
#     [--timeout 900]
#
# Both stacks must be up with a healthy baseline (verify-e2e-push.sh).
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
PROM_URL="http://127.0.0.1:9190"
TIMEOUT=900

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url)     FACILITY_URL="$2"; shift 2 ;;
    --central-url)      CENTRAL_URL="$2"; shift 2 ;;
    --user)             USER="$2"; shift 2 ;;
    --password)         PASSWORD="$2"; shift 2 ;;
    --central-user)     CENTRAL_USER="$2"; shift 2 ;;
    --central-password) CENTRAL_PASSWORD="$2"; shift 2 ;;
    --prom-url)         PROM_URL="$2"; shift 2 ;;
    --timeout)          TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$CENTRAL_USER" ]] || CENTRAL_USER="$USER"
[[ -n "$CENTRAL_PASSWORD" ]] || CENTRAL_PASSWORD="$PASSWORD"

if [[ "$CENTRAL_URL" == *moh.gov.lr* || "$FACILITY_URL" == *moh.gov.lr* ]]; then
  echo "REFUSING: this check fabricates a patient and edits it at central; never production." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFLICTS="$HERE/../../scripts/sync/conflicts.sh"
PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

facility() { curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@"; }
central() { curl -sk -u "$CENTRAL_USER:$CENTRAL_PASSWORD" -H 'Content-Type: application/json' "$@"; }
person_field() { # api-function uuid field
  "$1" "$2/openmrs/ws/rest/v1/person/$3?v=custom:($4)" | python3 -c "import json,sys; print(json.load(sys.stdin)['$4'])"
}
until_true() { # seconds command...
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    (( SECONDS < deadline )) || return 1
    sleep 10
  done
}

register() {
  "$HERE/verify-sender-capture.sh" --base-url "$FACILITY_URL" --user "$USER" --password "$PASSWORD" \
    | sed -n 's/.*patient \([0-9a-f-]\{36\}\).*/\1/p' | head -1
}
at_central() { [[ "$(central -o /dev/null -w '%{http_code}' "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$1")" == "200" ]]; }
conflict_row() { "$CONFLICTS" list | awk -F'|' -v u="$1" '{for (i=2;i<=6;i++) gsub(/ /,"",$i)} $4==u && $2 ~ /^[0-9]+$/ {print $2, $3, $6; exit}'; }
conflict_for() { conflict_row "$1" | cut -d' ' -f2; }
has_conflict() { [[ -n "$(conflict_for "$1")" ]]; }
no_conflict() { [[ -z "$(conflict_for "$1")" ]]; }

RECEIVER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]sync-receiver[-_]')"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "== registering a patient at the facility =="
UUID="$(register)"
[[ -n "$UUID" ]] || fail "a patient is registered and captured"
until_true "$TIMEOUT" at_central "$UUID" || fail "the patient reaches central"
pass "the patient reaches central"

flip() { [[ "$1" == "True" ]] && echo false || echo true; }
other_gender() { [[ "$1" == "M" ]] && echo F || echo M; }

echo "== editing it at central outside sync, then twice at the facility =="
central -X POST -d "{\"birthdateEstimated\": $(flip "$(person_field central "$CENTRAL_URL" "$UUID" birthdateEstimated)")}" \
  "$CENTRAL_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
facility -X POST -d "{\"gender\": \"$(other_gender "$(person_field facility "$FACILITY_URL" "$UUID" gender)")\"}" \
  "$FACILITY_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
until_true "$TIMEOUT" has_conflict "$UUID" || fail "the receiver raises a conflict" "$("$CONFLICTS" list)"
facility -X POST -d "{\"gender\": \"$(other_gender "$(person_field facility "$FACILITY_URL" "$UUID" gender)")\"}" \
  "$FACILITY_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
waiting() { [[ "$(conflict_row "$UUID" | cut -d' ' -f3)" -ge 1 ]]; }
until_true "$TIMEOUT" waiting || fail "the facility's next update waits behind the conflict" "$("$CONFLICTS" list)"
read -r CONFLICT TABLE _ <<<"$(conflict_row "$UUID")"
pass "the receiver raises conflict $CONFLICT in table $TABLE, with the next update waiting behind it"

alert_is() { # firing|none
  local state
  state="$(curl -s "$PROM_URL/api/v1/alerts" | python3 -c 'import json,sys
print(" ".join(a["state"] for a in json.load(sys.stdin)["data"]["alerts"] if a["labels"].get("alertname") == "ReceiverConflicts"))' 2>/dev/null || true)"
  [[ "$1" == "none" && -z "$state" ]] || [[ "$1" != "none" && "$state" == *"$1"* ]]
}
until_true 300 alert_is firing || fail "ReceiverConflicts fires"
pass "ReceiverConflicts fires"

echo "== resolving with dbsync's procedure =="
output="$("$CONFLICTS" resolve --table "$TABLE" --conflict "$CONFLICT" --by "qa/sync/verify-conflict-resolution.sh" \
  --reason "QA: the facility's copy stands" 2>&1)" || fail "conflict $CONFLICT is resolved" "$output"
grep -q "^resolved conflicts $CONFLICT in $TABLE by qa/sync/verify-conflict-resolution.sh" <<<"$output" \
  || fail "the resolution is recorded with who decided" "$output"
pass "conflict $CONFLICT is resolved and the decision recorded"
no_conflict "$UUID" || fail "the conflict leaves the queue"
pass "the conflict leaves the queue"
until_true 300 alert_is none || fail "ReceiverConflicts clears"
pass "ReceiverConflicts clears"

matches_facility() {
  local field
  for field in gender birthdateEstimated; do
    [[ "$(person_field central "$CENTRAL_URL" "$UUID" "$field" 2>/dev/null)" == "$(person_field facility "$FACILITY_URL" "$UUID" "$field")" ]] || return 1
  done
}
# The waiting update carries the whole record, so central converges without another save.
until_true "$TIMEOUT" matches_facility || fail "the waiting update applies on the receiver's retry run"
pass "the waiting update applies on the receiver's retry run"

facility -X POST -d "{\"birthdateEstimated\": $(flip "$(person_field facility "$FACILITY_URL" "$UUID" birthdateEstimated)")}" \
  "$FACILITY_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
until_true "$TIMEOUT" matches_facility && no_conflict "$UUID" \
  || fail "the facility's next change applies without a new conflict"
pass "the facility's next change applies without a new conflict"

payloads="$(docker logs --since "$started" "$RECEIVER" 2>&1 | grep -c 'tableToSyncModelClass' || true)"
[[ "$payloads" == "0" ]] || fail "no payload reached the receiver's log" "$payloads line(s)"
pass "no payload reached the receiver's log"

echo
echo "PASS: all $PASSES conflict resolution checks held."
