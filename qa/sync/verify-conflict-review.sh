#!/usr/bin/env bash
# QA check for the Sync conflicts page and the receiver applying decisions by itself. Raises a
# real conflict, reviews and decides it through the page's endpoint, checks the refusals, and
# asserts the receiver applies it: the conflict leaves the queue, the held update lands, and
# ReceiverConflicts clears.
#
#   qa/sync/verify-conflict-review.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user ...] [--central-password ...] [--prom-url http://127.0.0.1:9190] \
#     [--timeout 900]
#
# Both stacks must be up (verify-e2e-push.sh), with central started with
# SYNC_CONFLICT_WINDOW=00:00-00:00 and SYNC_CONFLICT_CHECK_SECONDS=30 so decisions apply now.
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
PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

facility() { curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@"; }
central() { curl -sk -u "$CENTRAL_USER:$CENTRAL_PASSWORD" -H 'Content-Type: application/json' "$@"; }
person_field() { # api-function base-url uuid field
  "$1" "$2/openmrs/ws/rest/v1/person/$3?v=custom:($4)" | python3 -c "import json,sys; print(json.load(sys.stdin)['$4'])"
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {'d': d}))" "$1"; }
until_true() { # seconds command...
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    (( SECONDS < deadline )) || return 1
    sleep 10
  done
}

RECEIVER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]sync-receiver[-_]' || true)"
[[ -n "$RECEIVER" ]] || fail "the central receiver is running"
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p"; }
window="$(env_of "$RECEIVER" SYNC_CONFLICT_WINDOW)"
window_from="${window%%-*}"
[[ -n "$window" && "$window_from" == "${window#*-}" ]] \
  || fail "central was started with SYNC_CONFLICT_WINDOW=00:00-00:00 (all day)" "the receiver has '$window'"

CONFLICTS_URL="$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/syncconflicts"
list() { central "$CONFLICTS_URL"; }
conflict_id_for() { # uuid
  list | python3 -c 'import json,sys
for c in json.load(sys.stdin).get("conflicts", []):
    if c["identifier"] == sys.argv[1]: print(c["id"]); break' "$1"
}
has_conflict() { [[ -n "$(conflict_id_for "$1")" ]]; }
no_conflict() { [[ -z "$(conflict_id_for "$1")" ]]; }

register() {
  "$HERE/verify-sender-capture.sh" --base-url "$FACILITY_URL" --user "$USER" --password "$PASSWORD" \
    | sed -n 's/.*patient \([0-9a-f-]\{36\}\).*/\1/p' | head -1
}
at_central() { [[ "$(central -o /dev/null -w '%{http_code}' "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$1")" == "200" ]]; }
flip() { [[ "$1" == "True" ]] && echo false || echo true; }
other_gender() { [[ "$1" == "M" ]] && echo F || echo M; }

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "== the page is on at central and reads the receiver's queue =="
body="$(list)"
[[ "$(json 'd["enabled"]' <<<"$body")" == "True" ]] || fail "the page is on at central" "$(head -c 200 <<<"$body")"
[[ "$(json 'd["available"]' <<<"$body")" == "True" ]] \
  || fail "the EMR can read the receiver's schema (the initdb grant)" "$(head -c 200 <<<"$body")"
pass "the page is on at central and reads the conflict queue"

echo "== registering a patient at the facility =="
UUID="$(register)"
[[ -n "$UUID" ]] || fail "a patient is registered and captured"
until_true "$TIMEOUT" at_central "$UUID" || fail "the patient reaches central"
pass "the patient reaches central"

echo "== editing it at central outside sync, then twice at the facility =="
central -X POST -d "{\"birthdateEstimated\": $(flip "$(person_field central "$CENTRAL_URL" "$UUID" birthdateEstimated)")}" \
  "$CENTRAL_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
facility -X POST -d "{\"gender\": \"$(other_gender "$(person_field facility "$FACILITY_URL" "$UUID" gender)")\"}" \
  "$FACILITY_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
until_true "$TIMEOUT" has_conflict "$UUID" || fail "the page lists the conflict" "$(list | head -c 400)"
facility -X POST -d "{\"gender\": \"$(other_gender "$(person_field facility "$FACILITY_URL" "$UUID" gender)")\"}" \
  "$FACILITY_URL/openmrs/ws/rest/v1/person/$UUID" >/dev/null
CONFLICT="$(conflict_id_for "$UUID")"
waiting() {
  [[ "$(list | python3 -c 'import json,sys
print(next((c["waiting"] for c in json.load(sys.stdin)["conflicts"] if c["id"] == int(sys.argv[1])), 0))' "$CONFLICT")" -ge 1 ]]
}
until_true "$TIMEOUT" waiting || fail "the page shows the facility's next update waiting behind the conflict"
pass "the page lists conflict $CONFLICT, undecided, with the next update waiting behind it"

echo "== the two versions side by side =="
detail="$(central "$CONFLICTS_URL/$CONFLICT")"
# A patient's person fields travel as dbsync's PatientModel, so the conflict can be either.
[[ "$(json 'd["table"]' <<<"$detail")" =~ ^(person|patient)$ ]] || fail "the conflict is in the person or patient table" "$(head -c 300 <<<"$detail")"
[[ "$(json 'd["facility"]' <<<"$detail")" != "None" ]] || fail "the conflict names the facility that sent it"
field_of() { json "next(f for f in d['fields'] if f['field'] == '$1')['$2']" <<<"$detail"; }
[[ "$(field_of birthdateEstimated differs)" == "True" ]] \
  || fail "the field edited at central shows as differing" "$(field_of birthdateEstimated facility) vs $(field_of birthdateEstimated central)"
[[ "$(field_of birthdateEstimated central)" == "$(person_field central "$CENTRAL_URL" "$UUID" birthdateEstimated | tr 'TF' 'tf')" ]] \
  || fail "central's side shows central's current value"
[[ "$(field_of uuid differs)" == "False" ]] || fail "a field both sides agree on does not show as differing"
pass "the facility's and central's versions differ exactly where central was edited"

echo "== decisions the page must refuse =="
decide() { # id json-body -> http code
  central -o /dev/null -w '%{http_code}' -X POST -d "$2" "$CONFLICTS_URL/$1/decision"
}
code="$(decide "$CONFLICT" '{"identifier": "not-this-record", "decision": "FACILITY_STANDS", "reason": "QA"}')"
[[ "$code" == "409" ]] || fail "a decision naming another record is refused" "got HTTP $code"
code="$(decide "$CONFLICT" "{\"identifier\": \"$UUID\", \"decision\": \"FACILITY_STANDS\", \"reason\": \"  \"}")"
[[ "$code" == "400" ]] || fail "a decision without a reason is refused" "got HTTP $code"
code="$(decide "$CONFLICT" "{\"identifier\": \"$UUID\", \"decision\": \"MERGE\", \"reason\": \"QA\"}")"
[[ "$code" == "400" ]] || fail "a decision that is not one of the two choices is refused" "got HTTP $code"
# The QA sync account holds Sync Receiver, which does not carry Resolve Sync Conflicts.
SYNC_USER="$(env_of "$RECEIVER" OPENMRS_REST_USER)"
SYNC_PASSWORD="$(env_of "$RECEIVER" OPENMRS_REST_PASSWORD)"
code="$(curl -sk -u "$SYNC_USER:$SYNC_PASSWORD" -o /dev/null -w '%{http_code}' "$CONFLICTS_URL/$CONFLICT")"
[[ "$code" == "403" ]] || fail "a user without Resolve Sync Conflicts cannot read the conflict" "got HTTP $code for $SYNC_USER"
pass "the wrong record, no reason, an unknown choice and a user without the privilege are all refused"

alert_is() { # firing|none
  local state
  state="$(curl -s "$PROM_URL/api/v1/alerts" | python3 -c 'import json,sys
print(" ".join(a["state"] for a in json.load(sys.stdin)["data"]["alerts"] if a["labels"].get("alertname") == sys.argv[1]))' "$1" 2>/dev/null || true)"
  [[ "$2" == "none" && -z "$state" ]] || [[ "$2" != "none" && "$state" == *"$2"* ]]
}
until_true 300 alert_is ReceiverConflicts firing || fail "ReceiverConflicts fires"
pass "ReceiverConflicts fires"

echo "== recording the decision; the receiver applies it by itself =="
code="$(decide "$CONFLICT" "{\"identifier\": \"$UUID\", \"decision\": \"FACILITY_STANDS\", \"reason\": \"QA: the facility's copy stands\"}")"
[[ "$code" == "201" ]] || fail "the decision is recorded" "got HTTP $code"
pass "the decision is recorded"

applied() {
  list | python3 -c 'import json,sys
d = json.load(sys.stdin)
gone = all(c["id"] != int(sys.argv[1]) for c in d["conflicts"])
stamped = any(r["conflictId"] == int(sys.argv[1]) and r["dateApplied"] and r["decidedBy"] for r in d["recent"])
sys.exit(0 if gone and stamped else 1)' "$CONFLICT"
}
until_true "$TIMEOUT" applied || fail "the receiver applies the decision in its window" "$(list | head -c 400)"
pass "the receiver applied it: the conflict left the queue and the decision is stamped applied, with who decided"
docker logs --since "$started" "$RECEIVER" 2>&1 | grep -q "conflict decisions: applied conflicts .*$CONFLICT" \
  || fail "the receiver logs what it applied"
pass "the receiver logs what it applied"

until_true 300 alert_is ReceiverConflicts none || fail "ReceiverConflicts clears"
pass "ReceiverConflicts clears"
# Only the two JVM starts leave the receiver unscraped, so ReceiverDown may go pending, not fire.
! alert_is ReceiverDown firing || fail "ReceiverDown did not fire while the hashes were rebuilt"
pass "ReceiverDown did not fire while the hashes were rebuilt"

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
echo "PASS: all $PASSES conflict review checks held."
