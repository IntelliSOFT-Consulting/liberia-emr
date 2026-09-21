#!/usr/bin/env bash
# QA check for the full sync path (LE-35, acceptance criterion 1): registers a patient at the
# FACILITY, then gives them a visit, an ANC encounter with an observation, a programme
# enrolment, a test order and a drug order, and asserts each one appears at CENTRAL intact
# with the same UUID. That covers every route group in sync-entity-coverage.md through the
# whole chain: facility REST write -> binlog -> Debezium -> sender -> Artemis -> receiver ->
# central database. It also checks the sender watches exactly the tables the template declares.
#
#   qa/sync/verify-e2e-push.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user admin] [--central-password ...] [--timeout 300]
#
# Both stacks must be up, the facility with --profile sync. Uses the same fabrication
# guard as verify-sender-capture.sh: it refuses if the sender targets the real central
# broker, because staging is the place for this drill, never production.
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
TIMEOUT=300

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
  echo "REFUSING: this drill fabricates a patient and must never touch a production" >&2
  echo "          facility or the real central; a production facility's own sender" >&2
  echo "          would sync the fabricated record onward." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/../../distribution/sync/application.properties.template"
PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

facility() { curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@"; }
central() { curl -sk -u "$CENTRAL_USER:$CENTRAL_PASSWORD" -H 'Content-Type: application/json' "$@"; }
field() { # dotted path, e.g. results.0.uuid
  python3 -c 'import json,sys; d=json.load(sys.stdin)
for k in sys.argv[1].split("."): d = d[int(k)] if k.isdigit() else d[k]
print(d)' "$1"; }
uuid_or_error() { python3 -c 'import json,sys
d = json.load(sys.stdin)
if "uuid" not in d: sys.exit(sys.argv[1] + " rejected: " + json.dumps(d.get("error", d))[:300])
print(d["uuid"])' "$1"; }
until_true() { # seconds command...
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    (( SECONDS < deadline )) || return 1
    sleep 10
  done
}
# The UUID of the facility's metadata item with exactly this display name.
named() { # resource name
  facility "$FACILITY_URL/openmrs/ws/rest/v1/$1?q=${2// /%20}&v=custom:(uuid,display)" \
    | python3 -c 'import json,sys
r = [x["uuid"] for x in json.load(sys.stdin)["results"] if x["display"] == sys.argv[1]]
r or sys.exit(sys.argv[2] + " named " + repr(sys.argv[1]) + " not found at the facility")
print(r[0])' "$2" "$1"
}
at_central() { [[ "$(central -o /dev/null -w '%{http_code}' "$CENTRAL_URL/openmrs/ws/rest/v1/$1")" == "200" ]]; }
# The UUID of the first result of a facility query, or a plain failure when there is none.
first_uuid() { # what query
  facility "$FACILITY_URL/openmrs/ws/rest/v1/$2" | python3 -c 'import json,sys
r = json.load(sys.stdin).get("results", [])
r or sys.exit("no " + sys.argv[1] + " found at the facility")
print(r[0]["uuid"])' "$1"
}

echo "== registering a patient at the facility (via verify-sender-capture.sh) =="
CAPTURE_OUT="$("$HERE/verify-sender-capture.sh" --base-url "$FACILITY_URL" \
  --user "$USER" --password "$PASSWORD" --timeout "$TIMEOUT")"
echo "$CAPTURE_OUT" | tail -2
PATIENT="$(echo "$CAPTURE_OUT" | sed -n 's/.*patient \([0-9a-f-]\{36\}\).*/\1/p' | head -1)"
[[ -n "$PATIENT" ]] || fail "the capture step reports the patient UUID"

echo "== waiting for the patient at central (timeout ${TIMEOUT}s) =="
until_true "$TIMEOUT" at_central "patient/$PATIENT" \
  || fail "patient $PATIENT reaches central within ${TIMEOUT}s" \
          "check the receiver logs and the retry and conflict queues in the central management schema"
# Same person? Compare a stable, non-generated field end to end. The values are deliberately
# not printed: no PHI in output, fabricated or not.
facility_birthdate="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/patient/$PATIENT?v=custom:(person:(birthdate))" | field person.birthdate)"
central_birthdate="$(central "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$PATIENT?v=custom:(person:(birthdate))" | field person.birthdate)"
[[ -n "$facility_birthdate" && "$facility_birthdate" == "$central_birthdate" ]] \
  || fail "the patient at central is the same person" "birthdate differs for $PATIENT"
pass "patient $PATIENT pushed facility -> central intact"

echo "== recording a clinical day for them at the facility =="
LOCATION="$(first_uuid "login location" "location?tag=Login%20Location&v=custom:(uuid)")"
PROVIDER="$(first_uuid "provider record for $USER" \
  "provider?user=$(facility "$FACILITY_URL/openmrs/ws/rest/v1/session" | field user.uuid)&v=custom:(uuid)")"
VISIT_TYPE="$(named visittype "Antenatal Care")"
ENCOUNTER_TYPE="$(named encountertype "ANC Encounter")"
ROLE="$(named encounterrole "Clinician")"
PROGRAM="$(named program "Family Planning")"
CARE_SETTING="$(named caresetting "Outpatient")"
WEIGHT="$(named concept "Weight (kg)")"
TABLET="$(named concept "Tablet")"
HAEMOGLOBIN="$(named concept "Haemoglobin")"
DRUG="$(first_uuid "drug" "drug?v=custom:(uuid)&limit=1")"
DRUG_CONCEPT="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/drug/$DRUG?v=custom:(concept:(uuid))" | field concept.uuid)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000+0000)"
WEIGHT_KG=62 # any plausible value; compared end to end, never printed

VISIT="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/visit" -d '{"patient":"'"$PATIENT"'","visitType":"'"$VISIT_TYPE"'",
  "startDatetime":"'"$NOW"'","location":"'"$LOCATION"'"}' | uuid_or_error visit)"
ENCOUNTER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/encounter" -d '{"patient":"'"$PATIENT"'","visit":"'"$VISIT"'",
  "encounterType":"'"$ENCOUNTER_TYPE"'","encounterDatetime":"'"$NOW"'","location":"'"$LOCATION"'",
  "encounterProviders":[{"provider":"'"$PROVIDER"'","encounterRole":"'"$ROLE"'"}],
  "obs":[{"concept":"'"$WEIGHT"'","value":'"$WEIGHT_KG"',"obsDatetime":"'"$NOW"'"}]}' | uuid_or_error encounter)"
OBS="$(first_uuid "weight obs" "obs?patient=$PATIENT&concept=$WEIGHT&v=custom:(uuid)")"
ENROLMENT="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/programenrollment" -d '{"patient":"'"$PATIENT"'",
  "program":"'"$PROGRAM"'","dateEnrolled":"'"$NOW"'","location":"'"$LOCATION"'"}' | uuid_or_error "programme enrolment")"
TEST_ORDER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/order" -d '{"type":"testorder","patient":"'"$PATIENT"'",
  "encounter":"'"$ENCOUNTER"'","orderer":"'"$PROVIDER"'","careSetting":"'"$CARE_SETTING"'",
  "concept":"'"$HAEMOGLOBIN"'"}' | uuid_or_error "test order")"
DRUG_ORDER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/order" -d '{"type":"drugorder","patient":"'"$PATIENT"'",
  "encounter":"'"$ENCOUNTER"'","orderer":"'"$PROVIDER"'","careSetting":"'"$CARE_SETTING"'",
  "drug":"'"$DRUG"'","concept":"'"$DRUG_CONCEPT"'","dosingType":"org.openmrs.FreeTextDosingInstructions",
  "dosingInstructions":"one tablet daily","quantity":10,"quantityUnits":"'"$TABLET"'","numRefills":0}' \
  | uuid_or_error "drug order")"
echo "   visit $VISIT, encounter $ENCOUNTER, obs $OBS, enrolment $ENROLMENT, orders $TEST_ORDER $DRUG_ORDER"

echo "== waiting for the clinical records at central (timeout ${TIMEOUT}s) =="
all_at_central() {
  local r
  for r in "visit/$VISIT" "encounter/$ENCOUNTER" "obs/$OBS" "programenrollment/$ENROLMENT" \
           "order/$TEST_ORDER" "order/$DRUG_ORDER"; do
    at_central "$r" || return 1
  done
}
until_true "$TIMEOUT" all_at_central \
  || fail "the visit, encounter, obs, enrolment and orders all reach central within ${TIMEOUT}s" \
          "check the receiver logs and the retry and conflict queues in the central management schema"
pass "the visit, encounter, obs, programme enrolment and both orders reach central"

[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/visit/$VISIT?v=custom:(visitType:(uuid),patient:(uuid))" | field visitType.uuid)" == "$VISIT_TYPE" ]] \
  || fail "the visit at central keeps its type"
[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/encounter/$ENCOUNTER?v=custom:(encounterType:(uuid),visit:(uuid))" | field encounterType.uuid)" == "$ENCOUNTER_TYPE" ]] \
  || fail "the encounter at central keeps its type"
[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/encounter/$ENCOUNTER?v=custom:(visit:(uuid))" | field visit.uuid)" == "$VISIT" ]] \
  || fail "the encounter at central belongs to the same visit"
pass "the visit and encounter arrive with their types and linkage"

[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/obs/$OBS?v=custom:(encounter:(uuid))" | field encounter.uuid)" == "$ENCOUNTER" ]] \
  || fail "the obs at central belongs to the same encounter"
facility_value="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/obs/$OBS?v=custom:(value)" | field value)"
central_value="$(central "$CENTRAL_URL/openmrs/ws/rest/v1/obs/$OBS?v=custom:(value)" | field value)"
[[ -n "$facility_value" && "$facility_value" == "$central_value" ]] \
  || fail "the obs value is the same at both ends"
pass "the observation arrives with its value and encounter"

[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/programenrollment/$ENROLMENT?v=custom:(program:(uuid))" | field program.uuid)" == "$PROGRAM" ]] \
  || fail "the programme enrolment at central is for the same programme"
pass "the programme enrolment arrives"

# dbsync's README lists Order subclass sync as a known failure (EIP-142); this holds 4.0.0 to it.
[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/order/$TEST_ORDER" | field type)" == "testorder" ]] \
  || fail "the test order at central is a test order"
[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/order/$DRUG_ORDER" | field type)" == "drugorder" ]] \
  || fail "the drug order at central is a drug order"
[[ "$(central "$CENTRAL_URL/openmrs/ws/rest/v1/order/$DRUG_ORDER?v=custom:(drug:(uuid))" | field drug.uuid)" == "$DRUG" ]] \
  || fail "the drug order at central names the same drug"
pass "test and drug orders arrive as their subclasses"

echo "== checking the sender watches the declared tables =="
SYNC_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'facility.*[-_]sync[-_]' || true)"
[[ -n "$SYNC_CONTAINER" ]] || fail "the facility sync container is running" "none found; start the stack with --profile sync"
declared="$(sed -n 's/^eip\.watchedTables=//p' "$TEMPLATE" | tr ',' '\n' | sort)"
# Debezium logs the list once, at start; the `|| true` lets a missing line reach the fail below.
watched="$(docker logs "$SYNC_CONTAINER" 2>&1 | grep -a 'table.include.list = ' | tail -1 \
  | sed 's/.*table.include.list = //' | tr ',' '\n' | sed 's/^[^.]*\.//' | sort || true)"
[[ -n "$watched" ]] || fail "the sender logged its table list" "no table.include.list line in $SYNC_CONTAINER's log"
[[ -n "$declared" && "$declared" == "$watched" ]] \
  || fail "the sender watches exactly the tables the template declares" \
          "template: $(paste -sd, - <<<"$declared")" "sender:   $(paste -sd, - <<<"$watched")"
pass "the sender watches exactly the ${TEMPLATE##*/} table set"

echo "PASS: all $PASSES sync checks held; patient $PATIENT and their clinical day pushed facility -> central intact"
