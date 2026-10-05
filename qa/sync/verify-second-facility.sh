#!/usr/bin/env bash
# QA check for LE-339 (docs/adr/0012-central-site-locations.md): records a facility creates
# against each of its OWN locations, the root and every child (OPD, maternity, ward, laboratory,
# pharmacy), reach central attached to that same location, and central holds every location the
# facility has, with the same name and parent.
#
#   qa/sync/verify-second-facility.sh [--facility-url https://localhost] \
#     [--central-url https://localhost:8443] [--user admin] [--password ...] \
#     [--central-user admin] [--central-password ...] [--timeout 300] [--negative-control] \
#     [--prom-url http://127.0.0.1:9190] [--alert-timeout 1200]
#
# Run it against a facility other than the one central's database was first built from;
# Careysburg proves nothing on a central that once ran the Careysburg image.
#
# Why it does not count retry queues: the dbsync receiver never parks a record whose location
# central lacks. It inserts a placeholder location with that UUID (name "[Default]", retired,
# retire reason "[placeholder]", no parent, no tags) and applies the record. So the failure is
# silent misattribution, and the checks here look for placeholders and for name or parent
# drift instead.
#
# --negative-control also creates a location at the facility that no site package holds and
# records a visit there, and passes only if central shows it as a placeholder: proof the check
# can fail. It then retires the location at the facility, but central keeps the placeholder for
# good, so use it on a throwaway pair only. Later runs list it as already present and still pass.
# With --prom-url (central's Prometheus) it also waits for SyncPlaceholderMetadata to fire for
# locations (LE-373), after the exported count rises above what it was before the run. That needs a reconciliation pass after the placeholder appears, every
# SYNC_RECON_CHECK_SECONDS (10 minutes by default), hence --alert-timeout.
set -euo pipefail

FACILITY_URL="https://localhost"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
TIMEOUT=300
NEGATIVE=false
PROM_URL=""
ALERT_TIMEOUT=1200

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url)     FACILITY_URL="$2"; shift 2 ;;
    --central-url)      CENTRAL_URL="$2"; shift 2 ;;
    --user)             USER="$2"; shift 2 ;;
    --password)         PASSWORD="$2"; shift 2 ;;
    --central-user)     CENTRAL_USER="$2"; shift 2 ;;
    --central-password) CENTRAL_PASSWORD="$2"; shift 2 ;;
    --timeout)          TIMEOUT="$2"; shift 2 ;;
    --negative-control) NEGATIVE=true; shift ;;
    --prom-url)         PROM_URL="$2"; shift 2 ;;
    --alert-timeout)    ALERT_TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$CENTRAL_USER" ]] || CENTRAL_USER="$USER"
[[ -n "$CENTRAL_PASSWORD" ]] || CENTRAL_PASSWORD="$PASSWORD"

if [[ "$CENTRAL_URL" == *moh.gov.lr* || "$FACILITY_URL" == *moh.gov.lr* ]]; then
  echo "REFUSING: this drill fabricates patients and must never touch a production facility" >&2
  echo "          or the real central." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=qa/sync/facility-records.sh
. "$HERE/facility-records.sh"
REST="openmrs/ws/rest/v1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Every location, retired ones too, one page of 100 at a time (the REST module's ceiling).
locations() { # facility|central file
  local start=0 page
  : > "$WORK/$2.pages"
  while :; do
    page="$("$1" "$( [[ $1 == facility ]] && echo "$FACILITY_URL" || echo "$CENTRAL_URL")/$REST/location?includeAll=true&limit=100&startIndex=$start&v=custom:(uuid,name,retired,retireReason,parentLocation:(uuid),tags:(display))")"
    echo "$page" >> "$WORK/$2.pages"
    python3 -c 'import json,sys; sys.exit(0 if len(json.load(sys.stdin).get("results", [])) == 100 else 1)' <<<"$page" || break
    start=$((start + 100))
  done
  python3 -c 'import json,sys
out = []
for line in open(sys.argv[1]):
    d = json.loads(line)
    if "results" not in d: sys.exit("location listing failed: " + json.dumps(d.get("error", d))[:300])
    out += d["results"]
json.dump(out, open(sys.argv[2], "w"))' "$WORK/$2.pages" "$WORK/$2.json"
}
placeholders() { # file -> one "uuid" per line
  python3 -c 'import json,sys
for l in json.load(open(sys.argv[1])):
    if l.get("retireReason") == "[placeholder]": print(l["uuid"])' "$1"
}

echo "== central's placeholder locations before =="
locations central central-before
placeholders "$WORK/central-before.json" | sort > "$WORK/placeholders-before"
if [[ -s "$WORK/placeholders-before" ]]; then
  echo "   already present (each is a location a facility record referenced and central lacked):"
  sed 's/^/     /' "$WORK/placeholders-before"
else
  echo "   none"
fi

echo "== every facility location exists at central with the same name and parent =="
locations facility facility
python3 - "$WORK/facility.json" "$WORK/central-before.json" <<'PY' || fail "central holds every facility location, unchanged"
import json, sys
fac = [l for l in json.load(open(sys.argv[1])) if not l["retired"]]
cen = {l["uuid"]: l for l in json.load(open(sys.argv[2]))}
parent = lambda l: (l.get("parentLocation") or {}).get("uuid")
bad = []
for l in fac:
    c = cen.get(l["uuid"])
    if c is None:
        bad.append(f"missing at central: {l['name']} ({l['uuid']})")
    elif c.get("retireReason") == "[placeholder]":
        bad.append(f"only a placeholder at central: {l['name']} ({l['uuid']})")
    elif c["name"] != l["name"] or parent(c) != parent(l) or c["retired"]:
        bad.append(f"differs at central: {l['name']} -> {c['name']}, parent {parent(l)} -> {parent(c)}, retired {c['retired']}")
for b in bad:
    print("    " + b, file=sys.stderr)
print(f"   {len(fac)} facility locations checked against {len(cen)} at central")
sys.exit(1 if bad else 0)
PY
pass "central holds every facility location with the same name and parent"

# The facility's own locations: its Facility Location root and the root's children.
python3 - "$WORK/facility.json" > "$WORK/site-locations" <<'PY'
import json, sys
fac = [l for l in json.load(open(sys.argv[1])) if not l["retired"]]
for r in fac:
    if any(t["display"] == "Facility Location" for t in r.get("tags", [])):
        print(r["uuid"] + "|" + r["name"])
        for l in fac:
            if (l.get("parentLocation") or {}).get("uuid") == r["uuid"]:
                print(l["uuid"] + "|" + l["name"])
PY
[[ -s "$WORK/site-locations" ]] || fail "the facility has a Facility Location root" \
  "no unretired location carries the Facility Location tag"

echo "== a patient, visit, encounter with an observation and an enrolment at each of them =="
openmrs_type="$(identifier_type "OpenMRS ID")"
moh_type="$(identifier_type "MOH Health Record Number")"
provider="$(first_uuid "provider record for $USER" \
  "provider?user=$(facility "$FACILITY_URL/$REST/session" | field user.uuid)&v=custom:(uuid)")"
VISIT_TYPE="$(first_uuid "visit type" "visittype?v=custom:(uuid)")"
ENCOUNTER_TYPE="$(first_uuid "encounter type" "encountertype?v=custom:(uuid)")"
ROLE="$(first_uuid "encounter role" "encounterrole?v=custom:(uuid)")"
PROGRAM="$(first_uuid "programme" "program?v=custom:(uuid)")"
NUMERIC="$(facility "$FACILITY_URL/$REST/concept?q=weight&v=custom:(uuid,datatype:(display))" | python3 -c 'import json,sys
r = [c["uuid"] for c in json.load(sys.stdin)["results"] if c["datatype"]["display"] == "Numeric"]
r or sys.exit("no numeric concept matching weight at the facility")
print(r[0])')"

RECORDS="$WORK/records"
: > "$RECORDS"
record_at() { # location-uuid location-name
  local loc="$1" name="$2" now patient visit enc enr
  now="$(date -u +%Y-%m-%dT%H:%M:%S.000+0000)"
  patient="$(facility "$FACILITY_URL/$REST/patient" -d '{
    "person": {"names": [{"givenName": "Qa'"$(date +%s)"'", "familyName": "SecondFacility"}],
               "gender": "F", "birthdate": "1990-01-01"},
    "identifiers": [
      {"identifier": "'"$(new_identifier "OpenMRS ID")"'", "identifierType": "'"$openmrs_type"'",
       "location": "'"$loc"'", "preferred": true},
      {"identifier": "'"$(new_identifier "MOH ID Gen")"'", "identifierType": "'"$moh_type"'",
       "location": "'"$loc"'"}]}' | uuid_or_error patient)"
  visit="$(facility "$FACILITY_URL/$REST/visit" -d '{"patient":"'"$patient"'","visitType":"'"$VISIT_TYPE"'",
    "startDatetime":"'"$now"'","location":"'"$loc"'"}' | uuid_or_error visit)"
  enc="$(facility "$FACILITY_URL/$REST/encounter" -d '{"patient":"'"$patient"'","visit":"'"$visit"'",
    "encounterType":"'"$ENCOUNTER_TYPE"'","encounterDatetime":"'"$now"'","location":"'"$loc"'",
    "encounterProviders":[{"provider":"'"$provider"'","encounterRole":"'"$ROLE"'"}],
    "obs":[{"concept":"'"$NUMERIC"'","value":62,"obsDatetime":"'"$now"'","location":"'"$loc"'"}]}' \
    | uuid_or_error encounter)"
  enr="$(facility "$FACILITY_URL/$REST/programenrollment" -d '{"patient":"'"$patient"'",
    "program":"'"$PROGRAM"'","dateEnrolled":"'"$now"'","location":"'"$loc"'"}' | uuid_or_error "programme enrolment")"
  echo "$name|$loc|$patient|$visit|$enc|$enr" >> "$RECORDS"
  echo "   $name: patient $patient, visit $visit, encounter $enc, enrolment $enr"
}
while IFS='|' read -r loc name; do record_at "$loc" "$name"; done < "$WORK/site-locations"

all_at_central() { # records-file
  local loc patient visit enc enr
  while IFS='|' read -r _ loc patient visit enc enr; do
    at_central "patient/$patient" && at_central "visit/$visit" && at_central "encounter/$enc" \
      && at_central "programenrollment/$enr" || return 1
  done < "$1"
}
# What central attached each record to: identifiers, visit, encounter, obs and enrolment.
locations_at_central() { # patient visit encounter enrolment
  {
    central "$CENTRAL_URL/$REST/patient/$1?v=custom:(identifiers:(location:(uuid)))"; echo
    central "$CENTRAL_URL/$REST/visit/$2?v=custom:(location:(uuid))"; echo
    central "$CENTRAL_URL/$REST/encounter/$3?v=custom:(location:(uuid),obs:(location:(uuid)))"; echo
    central "$CENTRAL_URL/$REST/programenrollment/$4?v=custom:(location:(uuid))"; echo
  } | python3 -c 'import json,sys
found = set()
def walk(d):
    if isinstance(d, dict):
        if isinstance(d.get("location"), dict): found.add(d["location"]["uuid"])
        for v in d.values(): walk(v)
    elif isinstance(d, list):
        for v in d: walk(v)
for line in sys.stdin:
    if line.strip(): walk(json.loads(line))
print(" ".join(sorted(found)))'
}

echo "== waiting for them at central (timeout ${TIMEOUT}s) =="
until_true "$TIMEOUT" all_at_central "$RECORDS" \
  || fail "every record reaches central within ${TIMEOUT}s" \
          "check the receiver logs and the retry and conflict queues in the central management schema"
while IFS='|' read -r name loc patient visit enc enr; do
  got="$(locations_at_central "$patient" "$visit" "$enc" "$enr")"
  [[ "$got" == "$loc" ]] || fail "$name: every record at central is attached to $loc" "found: ${got:-none}"
  pass "$name: identifiers, visit, encounter, obs and enrolment at central are attached to it"
done < "$RECORDS"

echo "== central's placeholder locations after =="
locations central central-after
placeholders "$WORK/central-after.json" | sort > "$WORK/placeholders-after"
new="$(comm -13 "$WORK/placeholders-before" "$WORK/placeholders-after")"
[[ -z "$new" ]] || fail "no record from this run created a placeholder location at central" "$new"
pass "no placeholder location appeared at central"

placeholder_metric() { # the location count central's reconciliation last exported, or empty
  curl -s "$PROM_URL/api/v1/query" --data-urlencode 'query=sync_placeholder_metadata{table="location"}' \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(int(float(r[0]["value"][1])) if r else "")'
}

if $NEGATIVE; then
  if [[ -n "$PROM_URL" ]]; then
    METRIC_BEFORE="$(placeholder_metric)"
    [[ -n "$METRIC_BEFORE" ]] || fail "central's Prometheus at $PROM_URL has sync_placeholder_metadata" \
      "the sync-recon target is down, or its receiver image predates LE-373"
  fi
  echo "== negative control: a location no site package holds =="
  stray_name="QA Unenrolled Ward $(date +%s)"
  stray="$(facility "$FACILITY_URL/$REST/location" -d '{"name":"'"$stray_name"'"}' | uuid_or_error location)"
  : > "$RECORDS"
  record_at "$stray" "$stray_name"
  until_true "$TIMEOUT" all_at_central "$RECORDS" \
    || fail "the negative control's records reach central within ${TIMEOUT}s"
  reason="$(central "$CENTRAL_URL/$REST/location/$stray?v=custom:(retireReason)" | field retireReason 2>/dev/null || true)"
  [[ "$reason" == "[placeholder]" ]] \
    || fail "central shows the unenrolled location as a placeholder" "retire reason: ${reason:-none}"
  pass "the negative control is caught: central applied its records against a placeholder location"
  if [[ -n "$PROM_URL" ]]; then
    echo "== waiting for SyncPlaceholderMetadata to fire for locations (timeout ${ALERT_TIMEOUT}s) =="
    alert_firing() {
      local now
      now="$(placeholder_metric)"
      [[ -n "$now" && "$now" -gt "$METRIC_BEFORE" ]] || return 1
      curl -s "$PROM_URL/api/v1/alerts" | python3 -c 'import json,sys
sys.exit(0 if any(a["labels"].get("alertname") == "SyncPlaceholderMetadata" and a["labels"].get("table") == "location"
                  and a["state"] == "firing" for a in json.load(sys.stdin)["data"]["alerts"]) else 1)'
    }
    until_true "$ALERT_TIMEOUT" alert_firing \
      || fail "SyncPlaceholderMetadata fires for locations within ${ALERT_TIMEOUT}s" \
              "check sync_placeholder_metadata on the sync-recon target and that Prometheus loaded rules-central.yml"
    pass "the placeholder count rose from $METRIC_BEFORE and SyncPlaceholderMetadata fires for locations"
  fi
  # Retired at the facility, so the next run's location check skips it; central keeps the
  # placeholder, which the next run lists as already present.
  facility -o /dev/null -X DELETE "$FACILITY_URL/$REST/location/$stray?reason=LE-339%20negative%20control"
fi

echo "PASS: all $PASSES second-facility checks held."
