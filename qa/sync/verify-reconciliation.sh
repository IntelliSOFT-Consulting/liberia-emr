#!/usr/bin/env bash
# QA check for reconciliation (sync-eip.md 5.5): a record the facility holds but central lost is
# found, confirmed, alerted and shown on the Sync status page, and the gap closes once the record
# arrives again.
#
#   qa/sync/verify-reconciliation.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--prom-url http://127.0.0.1:9190] \
#     [--user admin] [--password ...] [--timeout 900]
#
# Needs both stacks with sync running (verify-e2e-push.sh). It registers a patient, waits for it
# at central, then deletes one of its identifiers from central's replica, the kind of loss a
# restore from an older backup leaves. The facility's digest and central's check are run on
# demand instead of waiting for the night, with the grace and confirm windows at zero. Editing
# the identifier at the facility sends it back and must close the gap.
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
PROM_URL="http://127.0.0.1:9190"
USER="admin"
PASSWORD="Admin123"
TIMEOUT=900

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url) FACILITY_URL="$2"; shift 2 ;;
    --central-url)  CENTRAL_URL="$2"; shift 2 ;;
    --prom-url)     PROM_URL="$2"; shift 2 ;;
    --user)         USER="$2"; shift 2 ;;
    --password)     PASSWORD="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
for u in "$FACILITY_URL" "$CENTRAL_URL"; do
  [[ "$u" != *moh.gov.lr* ]] || { echo "REFUSING: this check deletes a record at central; never production." >&2; exit 1; }
done

container() { docker ps --format '{{.Names}}' | grep -v facility2 | grep -m1 -E "$1" || true; }
SYNC="$(container 'facility[-_]sync[-_][0-9]+$')"
RECEIVER="$(container 'central.*[-_]sync-receiver[-_]')"
CENTRAL_DB="$(container 'central.*[-_]db[-_]')"
[[ -n "$SYNC" && -n "$RECEIVER" && -n "$CENTRAL_DB" ]] || { echo "FAIL: needs the facility sync, central sync-receiver and central db containers" >&2; exit 1; }
CODE="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$SYNC" | sed -n 's/^DBSYNC_SENDER_ID=//p')"

pass() { echo "PASS [$1]"; }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }
wait_for() { # seconds description command...
  local deadline=$((SECONDS + $1)) what="$2"; shift 2
  until "$@"; do (( SECONDS < deadline )) || fail "$what"; sleep 10; done
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
api() { local base="$1" path="$2"; shift 2; curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@" "$base/openmrs/ws/rest/v1$path"; }
central_sql() { docker exec "$CENTRAL_DB" sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B "$1" -e "$2"' sh "$1" "$2"; }
# The digest and the check, now, over the broker with each container's own certificate.
recon_once() { # container mode env...
  local c="$1" mode="$2" url; shift 2
  url="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" | sed -n 's/^ARTEMIS_URL=//p')"
  docker exec "$@" -e "ARTEMIS_URL=${url}?socket.verifyHostName=true&jms.watchTopicAdvisories=false" "$c" \
    sh -c 'exec java @/app/config/jvm-tls.args -jar /app/recon.jar "$1" --once' sh "$mode"
}
register() {
  local base location types gen ids
  base="$FACILITY_URL"
  location="$(api "$base" "/location?tag=Login%20Location&v=custom:(uuid)" | json 'd["results"][0]["uuid"]')"
  types="$(api "$base" "/patientidentifiertype?v=custom:(uuid,name)")"
  gen() {
    local source
    source="$(api "$base" "/idgen/identifiersource?v=custom:(uuid,name)" | json "next(s['uuid'] for s in d['results'] if '$1' in s['name'])")"
    api "$base" "/idgen/identifiersource/$source/identifier" -X POST -d '{}' | json 'd["identifier"]'
  }
  ids="[{\"identifier\":\"$(gen "OpenMRS ID")\",\"identifierType\":\"$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="OpenMRS ID")' <<<"$types")\",\"location\":\"$location\",\"preferred\":true},"
  ids="$ids{\"identifier\":\"$(gen "MOH ID Gen")\",\"identifierType\":\"$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="MOH Health Record Number")' <<<"$types")\",\"location\":\"$location\"}]"
  api "$base" "/patient" -X POST -d "{\"identifiers\":$ids,\"person\":{\"names\":[{\"givenName\":\"Qa$(date +%s)\",\"familyName\":\"Recon\"}],\"gender\":\"M\",\"birthdate\":\"1980-06-01\"}}" \
    | json 'd.get("uuid") or d.get("error",{}).get("message")'
}
at_central() { [[ "$(api "$CENTRAL_URL" "/patient/$1?v=custom:(uuid)" | json 'd.get("uuid","")')" == "$1" ]]; }
prom() { curl -s "$PROM_URL/api/v1/query" --data-urlencode "query=$1" | json 'd["data"]["result"][0]["value"][1] if d["data"]["result"] else ""'; }
gap() { central_sql openmrs_mgmt "SELECT confirmed FROM liberiaemr_recon_missing WHERE uuid = '$1'"; }

echo "== a patient registered at $CODE reaches central =="
patient="$(register)"
[[ "$patient" =~ ^[0-9a-f-]{36}$ ]] || fail "the facility registers a patient" "$patient"
wait_for "$TIMEOUT" "the patient reached central" at_central "$patient"
identifier="$(api "$FACILITY_URL" "/patient/$patient/identifier?v=custom:(uuid,preferred)" | json 'next(i["uuid"] for i in d["results"] if not i["preferred"])')"
# A later record moves the sender past the first, so the digest's cutoff includes it.
later="$(register)"
wait_for "$TIMEOUT" "the second patient reached central" at_central "$later"
pass "patient $patient is at central"

echo "== central loses one of its identifiers =="
central_sql openmrs "DELETE FROM patient_identifier WHERE uuid = '$identifier'"
[[ -z "$(central_sql openmrs "SELECT uuid FROM patient_identifier WHERE uuid = '$identifier'")" ]] || fail "the identifier is gone from central"
pass "identifier $identifier deleted from central's replica"

echo "== the facility's digest and central's check find it =="
recon_once "$SYNC" facility -e SYNC_RECON_GRACE_MINUTES=0 | tail -1
recon_once "$RECEIVER" central -e SYNC_RECON_CONFIRM_HOURS=0 | tail -2
[[ "$(gap "$identifier")" == "1" ]] || fail "the lost identifier is a confirmed gap" "state: '$(gap "$identifier")'"
[[ -z "$(gap "$patient")" ]] || fail "records central still holds are not gaps"
pass "the lost identifier is confirmed missing, and nothing else of the patient's"

missing_reported() { [[ "$(prom "sync_recon_missing_records{facility=\"$CODE\"}")" =~ ^[1-9] ]]; }
wait_for "$TIMEOUT" "Prometheus shows the gap" missing_reported
firing() { curl -s "$PROM_URL/api/v1/alerts" | json 'any(a["labels"].get("alertname")=="SyncRecordsMissing" and a["state"]=="firing" for a in d["data"]["alerts"])' | grep -q True; }
wait_for "$TIMEOUT" "SyncRecordsMissing fires" firing
page="$(api "$CENTRAL_URL" "/liberiaemr/syncstatus")"
[[ "$(json "next(f.get('recordsMissing') for f in d['facilities'] if f['code']=='$CODE')" <<<"$page")" =~ ^[1-9] ]] \
  || fail "the Sync status page shows the gap" "${page:0:400}"
pass "SyncRecordsMissing fires and the Sync status page shows the facility's gap"

echo "== saving the identifier again at the facility closes the gap =="
# A save that changes nothing writes nothing, so nothing is sent: make two real changes, which
# leave the record as it was and send it whole.
for preferred in true false; do
  api "$FACILITY_URL" "/patient/$patient/identifier/$identifier" -X POST -d "{\"preferred\":$preferred}" >/dev/null
done
back() { [[ -n "$(central_sql openmrs "SELECT uuid FROM patient_identifier WHERE uuid = '$identifier'")" ]]; }
wait_for "$TIMEOUT" "the identifier is back at central" back
recon_once "$RECEIVER" central -e SYNC_RECON_CONFIRM_HOURS=0 | tail -1
[[ -z "$(gap "$identifier")" ]] || fail "the gap closes once the record arrives"
pass "the identifier arrived again and its gap closed"

echo
echo "PASS: reconciliation found a record central lost, alerted on it, and cleared once it arrived."
