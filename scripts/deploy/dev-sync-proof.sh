#!/usr/bin/env bash
# Proves sync end to end on the dev pair, for .github/workflows/enable-dev-sync.yml: a patient
# registered at the facility reaches central, then is voided again so demo data stays clean.
#
#   FACILITY_ADMIN_PASSWORD=... CENTRAL_ADMIN_PASSWORD=... \
#     dev-sync-proof.sh <facility-url> <central-url> [timeout-seconds]
set -euo pipefail

FACILITY="$1/openmrs/ws/rest/v1"
CENTRAL="$2/openmrs/ws/rest/v1"
TIMEOUT="${3:-2700}"
ADMIN="${OPENMRS_ADMIN_USER:-admin}"
: "${FACILITY_ADMIN_PASSWORD:?}" "${CENTRAL_ADMIN_PASSWORD:?}"

fac() { curl -sk -u "$ADMIN:$FACILITY_ADMIN_PASSWORD" -H 'Content-Type: application/json' "$@"; }
cen() { curl -sk -u "$ADMIN:$CENTRAL_ADMIN_PASSWORD" -H 'Content-Type: application/json' "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d, 'arg': sys.argv[2:]}))" "$@"; }

location="$(fac "$FACILITY/location?tag=Login%20Location&v=custom:(uuid)" | json 'd["results"][0]["uuid"]')"
types="$(fac "$FACILITY/patientidentifiertype?v=custom:(uuid,name)")"
type_of() { json "next(t['uuid'] for t in d['results'] if t['name'] == arg[0])" "$1" <<<"$types"; }
generate() {
  local source
  source="$(fac "$FACILITY/idgen/identifiersource?v=custom:(uuid,name)" | json "next(s['uuid'] for s in d['results'] if arg[0] in s['name'])" "$1")"
  fac "$FACILITY/idgen/identifiersource/$source/identifier" -X POST -d '{}' | json 'd["identifier"]'
}
ids="[{\"identifier\":\"$(generate "OpenMRS ID")\",\"identifierType\":\"$(type_of "OpenMRS ID")\",\"location\":\"$location\",\"preferred\":true},"
ids="$ids{\"identifier\":\"$(generate "MOH ID Gen")\",\"identifierType\":\"$(type_of "MOH Health Record Number")\",\"location\":\"$location\"}]"
patient="$(fac "$FACILITY/patient" -X POST -d "{\"identifiers\":$ids,\"person\":{\"names\":[{\"givenName\":\"Synccheck\",\"familyName\":\"Dev\"}],\"gender\":\"F\",\"birthdate\":\"1990-01-01\"}}" \
  | json 'd.get("uuid") or d.get("error", {}).get("message")')"
[[ "$patient" =~ ^[0-9a-f-]{36}$ ]] || { echo "could not register a test patient: $patient" >&2; exit 1; }
echo "registered test patient $patient at the facility; waiting for it at central (the first load comes first)"

deadline=$((SECONDS + TIMEOUT))
until [ "$(cen "$CENTRAL/patient/$patient?v=custom:(uuid)" | json 'd.get("uuid", "")')" = "$patient" ]; do
  (( SECONDS < deadline )) || { echo "the test patient did not reach central within $TIMEOUT s" >&2; exit 1; }
  sleep 30
done
echo "the test patient is at central"
cpi="$(cen "$CENTRAL/liberiaemr/identity/patient/$patient" | json 'd.get("code", "")' 2>/dev/null || true)"
[ -z "$cpi" ] || echo "central gave it CPI $cpi"

fac "$FACILITY/patient/$patient?reason=sync%20check" -X DELETE -o /dev/null
echo "voided the test patient at the facility; the void syncs too"
