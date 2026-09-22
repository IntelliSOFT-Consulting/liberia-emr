#!/usr/bin/env bash
# Shared by the QA checks that fabricate a patient's clinical day at a facility and look for it
# at central. Sourced, not executed. Expects FACILITY_URL, CENTRAL_URL, USER, PASSWORD,
# CENTRAL_USER and CENTRAL_PASSWORD to be set.

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
# The UUID of the first result of a facility query, or a plain failure when there is none.
first_uuid() { # what query
  facility "$FACILITY_URL/openmrs/ws/rest/v1/$2" | python3 -c 'import json,sys
r = json.load(sys.stdin).get("results", [])
r or sys.exit("no " + sys.argv[1] + " found at the facility")
print(r[0]["uuid"])' "$1"
}
at_central() { [[ "$(central -o /dev/null -w '%{http_code}' "$CENTRAL_URL/openmrs/ws/rest/v1/$1")" == "200" ]]; }

identifier_type() { # exact name
  facility "$FACILITY_URL/openmrs/ws/rest/v1/patientidentifiertype?v=custom:(uuid,name)" | python3 -c 'import json,sys
r = [t["uuid"] for t in json.load(sys.stdin)["results"] if t["name"] == sys.argv[1]]
r or sys.exit("no identifier type named " + repr(sys.argv[1]) + " at the facility")
print(r[0])' "$1"
}
new_identifier() { # identifier source, by part of its name
  local source
  source="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/idgen/identifiersource?v=custom:(uuid,name)" \
    | python3 -c 'import json,sys
r = [s["uuid"] for s in json.load(sys.stdin)["results"] if sys.argv[1] in s["name"]]
r or sys.exit("no identifier source named like " + repr(sys.argv[1]) + " at the facility")
print(r[0])' "$1")"
  facility -X POST "$FACILITY_URL/openmrs/ws/rest/v1/idgen/identifiersource/$source/identifier" -d '{}' \
    | field identifier
}

# Registers a patient with both identifiers the site requires, whether or not the sender is
# running, and prints the patient's UUID.
register_patient() { # family name
  local openmrs_type moh_type location
  openmrs_type="$(identifier_type "OpenMRS ID")"
  moh_type="$(identifier_type "MOH Health Record Number")"
  location="$(first_uuid "login location" "location?tag=Login%20Location&v=custom:(uuid)")"
  facility "$FACILITY_URL/openmrs/ws/rest/v1/patient" -d '{
    "person": {"names": [{"givenName": "Qa'"$(date +%s)"'", "familyName": "'"$1"'"}],
               "gender": "F", "birthdate": "1990-01-01"},
    "identifiers": [
      {"identifier": "'"$(new_identifier "OpenMRS ID")"'", "identifierType": "'"$openmrs_type"'",
       "location": "'"$location"'", "preferred": true},
      {"identifier": "'"$(new_identifier "MOH ID Gen")"'", "identifierType": "'"$moh_type"'",
       "location": "'"$location"'"}]}' | uuid_or_error patient
}

# Records a visit, an ANC encounter with a weight, a programme enrolment, a test order and a
# drug order for the patient. Sets VISIT, ENCOUNTER, OBS, ENROLMENT, TEST_ORDER, DRUG_ORDER and
# the metadata they use.
record_clinical_day() { # patient
  local patient="$1" location provider role care_setting weight tablet haemoglobin drug_concept now
  location="$(first_uuid "login location" "location?tag=Login%20Location&v=custom:(uuid)")"
  provider="$(first_uuid "provider record for $USER" \
    "provider?user=$(facility "$FACILITY_URL/openmrs/ws/rest/v1/session" | field user.uuid)&v=custom:(uuid)")"
  VISIT_TYPE="$(named visittype "Antenatal Care")"
  ENCOUNTER_TYPE="$(named encountertype "ANC Encounter")"
  role="$(named encounterrole "Clinician")"
  PROGRAM="$(named program "Family Planning")"
  care_setting="$(named caresetting "Outpatient")"
  weight="$(named concept "Weight (kg)")"
  tablet="$(named concept "Tablet")"
  haemoglobin="$(named concept "Haemoglobin")"
  DRUG="$(first_uuid "drug" "drug?v=custom:(uuid)&limit=1")"
  drug_concept="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/drug/$DRUG?v=custom:(concept:(uuid))" | field concept.uuid)"
  now="$(date -u +%Y-%m-%dT%H:%M:%S.000+0000)"
  WEIGHT_KG=62 # any plausible value; compared end to end, never printed

  VISIT="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/visit" -d '{"patient":"'"$patient"'","visitType":"'"$VISIT_TYPE"'",
    "startDatetime":"'"$now"'","location":"'"$location"'"}' | uuid_or_error visit)"
  ENCOUNTER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/encounter" -d '{"patient":"'"$patient"'","visit":"'"$VISIT"'",
    "encounterType":"'"$ENCOUNTER_TYPE"'","encounterDatetime":"'"$now"'","location":"'"$location"'",
    "encounterProviders":[{"provider":"'"$provider"'","encounterRole":"'"$role"'"}],
    "obs":[{"concept":"'"$weight"'","value":'"$WEIGHT_KG"',"obsDatetime":"'"$now"'"}]}' | uuid_or_error encounter)"
  OBS="$(first_uuid "weight obs" "obs?patient=$patient&concept=$weight&v=custom:(uuid)")"
  ENROLMENT="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/programenrollment" -d '{"patient":"'"$patient"'",
    "program":"'"$PROGRAM"'","dateEnrolled":"'"$now"'","location":"'"$location"'"}' | uuid_or_error "programme enrolment")"
  TEST_ORDER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/order" -d '{"type":"testorder","patient":"'"$patient"'",
    "encounter":"'"$ENCOUNTER"'","orderer":"'"$provider"'","careSetting":"'"$care_setting"'",
    "concept":"'"$haemoglobin"'"}' | uuid_or_error "test order")"
  DRUG_ORDER="$(facility "$FACILITY_URL/openmrs/ws/rest/v1/order" -d '{"type":"drugorder","patient":"'"$patient"'",
    "encounter":"'"$ENCOUNTER"'","orderer":"'"$provider"'","careSetting":"'"$care_setting"'",
    "drug":"'"$DRUG"'","concept":"'"$drug_concept"'","dosingType":"org.openmrs.FreeTextDosingInstructions",
    "dosingInstructions":"one tablet daily","quantity":10,"quantityUnits":"'"$tablet"'","numRefills":0}' \
    | uuid_or_error "drug order")"
  echo "   visit $VISIT, encounter $ENCOUNTER, obs $OBS, enrolment $ENROLMENT, orders $TEST_ORDER $DRUG_ORDER"
}

clinical_day_at_central() {
  local r
  for r in "visit/$VISIT" "encounter/$ENCOUNTER" "obs/$OBS" "programenrollment/$ENROLMENT" \
           "order/$TEST_ORDER" "order/$DRUG_ORDER"; do
    at_central "$r" || return 1
  done
}
