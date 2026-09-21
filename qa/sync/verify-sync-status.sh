#!/usr/bin/env bash
# QA check for the national sync status endpoint the status page reads
# (modules/liberiaemr, /ws/rest/v1/liberiaemr/syncstatus). Asserts that it answers at central,
# that its numbers match what the broker and the receiver actually report, that it refuses a
# user without the View Sync Status privilege, and that a facility server reports the feature
# off rather than showing a national view.
#
#   qa/sync/verify-sync-status.sh [--central-url https://localhost:8443] [--user admin]
#     [--password ...] [--facility-url https://localhost] [--timeout 60]
#
# The central stack must be up, with its monitoring running.
set -euo pipefail

CENTRAL_URL="https://localhost:8443"
FACILITY_URL="https://localhost"
USER="admin"
PASSWORD="Admin123"
TIMEOUT=60

while [[ $# -gt 0 ]]; do
  case "$1" in
    --central-url)  CENTRAL_URL="$2"; shift 2 ;;
    --facility-url) FACILITY_URL="$2"; shift 2 ;;
    --user)         USER="$2"; shift 2 ;;
    --password)     PASSWORD="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

central() { curl -sk -m "$TIMEOUT" -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@"; }
field() { python3 -c 'import json,sys; d=json.load(sys.stdin)
for k in sys.argv[1].split("."): d = d[int(k)] if k.isdigit() else d[k]
print(d)' "$1"; }

STATUS_PATH="/openmrs/ws/rest/v1/liberiaemr/syncstatus"

echo "== reading the endpoint at central =="
body="$(central "$CENTRAL_URL$STATUS_PATH")"
[[ "$(field enabled <<<"$body")" == "True" ]] || fail "the endpoint reports the page on at central" "$(head -c 200 <<<"$body")"
[[ "$(field available <<<"$body")" == "True" ]] || fail "the endpoint can reach monitoring" "$(head -c 200 <<<"$body")"
pass "central answers with the page on and monitoring reachable"

# Every facility the broker knows must appear, so an enrolled facility cannot go unnoticed.
RECEIVER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]sync-receiver[-_]' || true)"
PROMETHEUS="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]prometheus[-_]' || true)"
[[ -n "$RECEIVER" && -n "$PROMETHEUS" ]] || fail "the central receiver and prometheus containers are running"
broker_facilities="$(docker exec "$PROMETHEUS" wget -qO- http://artemis:8161/metrics/ 2>/dev/null \
  | sed -n 's/^artemis_routed_message_count{address="sync\.facility\.\([^"]*\)".*/\1/p' | sort -u)"
page_facilities="$(python3 -c 'import json,sys
print("\n".join(sorted(f["code"] for f in json.load(sys.stdin).get("facilities", []))))' <<<"$body")"
[[ -n "$broker_facilities" ]] || fail "the broker reports at least one facility address"
[[ "$broker_facilities" == "$page_facilities" ]] \
  || fail "the page lists exactly the facilities the broker knows" "broker: $(paste -sd, - <<<"$broker_facilities")" \
          "page:   $(paste -sd, - <<<"$page_facilities")"
pass "the page lists every facility the broker knows ($(wc -l <<<"$page_facilities" | tr -d ' '))"

# Conflicts and retries come from the receiver's own tables, so compare against those.
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p"; }
DB="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]db[-_]' || true)"
mgmt_sql() {
  { env_of "$RECEIVER" MGMT_DB_PASSWORD; printf '%s\n' "$1"; } | docker exec -i "$DB" sh -c \
    'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mariadb --batch --skip-column-names -u "$1" "$2"' \
    sh "$(env_of "$RECEIVER" MGMT_DB_USER)" "$(env_of "$RECEIVER" MGMT_DB_NAME)"
}
for pair in "recordsRetrying:receiver_retry_queue" "conflicts:receiver_conflict_queue"; do
  key="${pair%%:*}"; table="${pair#*:}"
  page="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["central"][sys.argv[1]])' "$key" <<<"$body")"
  actual="$(mgmt_sql "SELECT COUNT(*) FROM $table")"
  [[ "$page" == "$actual" ]] || fail "the page's $key matches $table" "page: $page, database: $actual"
done
pass "the page's retrying and conflict counts match the receiver's own tables"

echo "== a user without the privilege =="
# The QA sync account holds Sync Receiver, which does not carry View Sync Status.
SYNC_USER="$(env_of "$RECEIVER" OPENMRS_REST_USER)"
SYNC_PASSWORD="$(env_of "$RECEIVER" OPENMRS_REST_PASSWORD)"
if [[ -n "$SYNC_USER" ]]; then
  code="$(curl -sk -m "$TIMEOUT" -u "$SYNC_USER:$SYNC_PASSWORD" -o /dev/null -w '%{http_code}' "$CENTRAL_URL$STATUS_PATH")"
  [[ "$code" == "403" ]] || fail "a user without View Sync Status is refused" "got HTTP $code for $SYNC_USER"
  pass "a user without View Sync Status is refused (403)"
else
  echo "   skipped: the receiver has no REST account configured"
fi

echo "== the same image at a facility =="
if curl -sk -o /dev/null -m 5 "$FACILITY_URL/openmrs/ws/rest/v1/session"; then
  facility_body="$(curl -sk -m "$TIMEOUT" -u "$USER:$PASSWORD" "$FACILITY_URL$STATUS_PATH")"
  [[ "$(field enabled <<<"$facility_body")" == "False" ]] \
    || fail "a facility reports the page off" "$(head -c 200 <<<"$facility_body")"
  pass "a facility reports the page off, so its menu entry stays hidden"
else
  echo "   skipped: no facility stack is running"
fi

echo "PASS: all $PASSES sync status checks held"
