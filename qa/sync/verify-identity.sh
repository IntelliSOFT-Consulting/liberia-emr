#!/usr/bin/env bash
# QA check for the Central Person Identifier (sync-eip.md 2.5, ADR 0005). Registers patients at
# two facilities and asserts, through central's endpoint only, that every record gets a CPI,
# that the same National ID with agreeing sex and date of birth links two records to one
# person, that a National ID whose sex disagrees is held for review instead, that a record
# without a National ID stays its own person, and that a user without View Identity Links is
# refused.
#
#   qa/sync/verify-identity.sh [--facility-url https://localhost] \
#     [--second-facility-url https://localhost:9443] [--central-url https://localhost:8443] \
#     [--user admin] [--password ...] [--central-user ...] [--central-password ...] [--timeout 900]
#
# Both facility stacks and central must be up with sync running (verify-e2e-push.sh). The
# second facility exists because OpenMRS refuses a duplicate National ID within one facility;
# only two facilities can register the same person twice.
set -euo pipefail

FACILITY_URL="https://localhost"
SECOND_URL="https://localhost:9443"
CENTRAL_URL="https://localhost:8443"
USER="admin"
PASSWORD="Admin123"
CENTRAL_USER=""
CENTRAL_PASSWORD=""
TIMEOUT=900

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url)        FACILITY_URL="$2"; shift 2 ;;
    --second-facility-url) SECOND_URL="$2"; shift 2 ;;
    --central-url)         CENTRAL_URL="$2"; shift 2 ;;
    --user)                USER="$2"; shift 2 ;;
    --password)            PASSWORD="$2"; shift 2 ;;
    --central-user)        CENTRAL_USER="$2"; shift 2 ;;
    --central-password)    CENTRAL_PASSWORD="$2"; shift 2 ;;
    --timeout)             TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$CENTRAL_USER" ]] || CENTRAL_USER="$USER"
[[ -n "$CENTRAL_PASSWORD" ]] || CENTRAL_PASSWORD="$PASSWORD"

for u in "$FACILITY_URL" "$SECOND_URL" "$CENTRAL_URL"; do
  [[ "$u" != *moh.gov.lr* ]] || { echo "REFUSING: this check fabricates patients; never production." >&2; exit 1; }
done

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
until_true() { # seconds command...
  local deadline=$((SECONDS + $1)); shift
  until "$@"; do (( SECONDS < deadline )) || return 1; sleep 10; done
}
api() { # base-url path [curl args...]
  local base="$1" path="$2"; shift 2
  curl -sk -u "$USER:$PASSWORD" -H 'Content-Type: application/json' "$@" "$base/openmrs/ws/rest/v1$path"
}
central() { curl -sk -u "$CENTRAL_USER:$CENTRAL_PASSWORD" "$@"; }

NATIONAL_ID_TYPE="$(central "$CENTRAL_URL/openmrs/ws/rest/v1/systemsetting/liberiaemr.identity.nationalIdTypeUuid?v=custom:(value)" | json 'd["value"]')"
[[ "$NATIONAL_ID_TYPE" =~ ^[0-9a-f-]{36}$ ]] || fail "central names the National ID identifier type" "$NATIONAL_ID_TYPE"
RUN="$(date +%s)"

# Registers a patient with the two required identifiers from idgen and, optionally, a National
# ID; prints its uuid.
register() { # base-url given family gender birthdate national-id
  local base="$1" given="$2" family="$3" gender="$4" birthdate="$5" nid="$6"
  local location types openmrs_type moh_type
  location="$(api "$base" "/location?tag=Login%20Location&v=custom:(uuid)" | json 'd["results"][0]["uuid"]')"
  types="$(api "$base" "/patientidentifiertype?v=custom:(uuid,name)")"
  openmrs_type="$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="OpenMRS ID")' <<<"$types")"
  moh_type="$(json 'next(t["uuid"] for t in d["results"] if t["name"]=="MOH Health Record Number")' <<<"$types")"
  gen() { # source-name
    local source
    source="$(api "$base" "/idgen/identifiersource?v=custom:(uuid,name)" | json "next(s['uuid'] for s in d['results'] if '$1' in s['name'])")"
    api "$base" "/idgen/identifiersource/$source/identifier" -X POST -d '{}' | json 'd["identifier"]'
  }
  local ids="[{\"identifier\":\"$(gen "OpenMRS ID")\",\"identifierType\":\"$openmrs_type\",\"location\":\"$location\",\"preferred\":true},"
  ids="$ids{\"identifier\":\"$(gen "MOH ID Gen")\",\"identifierType\":\"$moh_type\",\"location\":\"$location\"}"
  [[ -z "$nid" ]] || ids="$ids,{\"identifier\":\"$nid\",\"identifierType\":\"$NATIONAL_ID_TYPE\",\"location\":\"$location\"}"
  ids="$ids]"
  api "$base" "/patient" -X POST -d "{\"identifiers\":$ids,\"person\":{\"names\":[{\"givenName\":\"$given\",\"familyName\":\"$family\"}],\"gender\":\"$gender\",\"birthdate\":\"$birthdate\",\"birthdateEstimated\":false}}" \
    | json 'd.get("uuid") or d.get("error",{}).get("message")'
}
identity() { central "$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/identity/patient/$1"; }
has_cpi() { [[ "$(central -o /dev/null -w '%{http_code}' "$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/identity/patient/$1")" == "200" ]]; }
person_count() { identity "$1" | json 'len(d["records"])'; }

echo "== identity is on at central =="
status="$(central "$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/identity/status")"
[[ "$(json 'd["enabled"]' <<<"$status")" == "True" ]] || fail "central has an identity schema" "$(head -c 200 <<<"$status")"
pass "central reports identity on ($(json 'd["people"]' <<<"$status") people so far)"

echo "== one person registered at two facilities with the same National ID =="
NID_SAME="1$RUN"   # the type requires 11 digits; RUN is 10
A="$(register "$FACILITY_URL" "Qa$RUN" "Same" F 1990-04-01 "$NID_SAME")"
[[ "$A" =~ ^[0-9a-f-]{36}$ ]] || fail "the first facility registers the person" "$A"
B="$(register "$SECOND_URL" "Qa$RUN" "Same" F 1990-04-01 "$NID_SAME")"
[[ "$B" =~ ^[0-9a-f-]{36}$ ]] || fail "the second facility registers the same person" "$B"
until_true "$TIMEOUT" has_cpi "$A" || fail "the first record gets a CPI at central"
until_true "$TIMEOUT" has_cpi "$B" || fail "the second record gets a CPI at central"
code_a="$(identity "$A" | json 'd["code"]')"
[[ "$code_a" =~ ^LR-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z*~$=U]$ ]] || fail "the CPI has the readable LR form" "$code_a"
pass "both records get a CPI; the readable form is $code_a"
linked() { [[ "$(identity "$A" | json 'd["code"]')" == "$(identity "$B" | json 'd["code"]')" ]]; }
until_true 300 linked || fail "the two records resolve to one person" "$(identity "$A" | head -c 300)" "$(identity "$B" | head -c 300)"
[[ "$(person_count "$A")" == "2" ]] || fail "the person shows both records" "$(identity "$A" | head -c 400)"
# Whichever record reached central first stays primary; the other's CPI becomes its alias.
aliases="$(identity "$A" | json 'sum(r["recordCode"] != d["code"] for r in d["records"])')"
[[ "$aliases" == "1" ]] || fail "exactly one of the two CPIs is an alias of the other" "$(identity "$A" | head -c 400)"
pass "same National ID, sex and date of birth: linked to one person, later CPI aliased, nothing merged"

echo "== the same National ID on a record whose sex disagrees =="
NID_CLASH="2$RUN"
C="$(register "$FACILITY_URL" "Qa$RUN" "Clash" F 1985-07-15 "$NID_CLASH")"
D="$(register "$SECOND_URL" "Qa$RUN" "Clash" M 1985-07-15 "$NID_CLASH")"
[[ "$C" =~ ^[0-9a-f-]{36}$ && "$D" =~ ^[0-9a-f-]{36}$ ]] || fail "both clashing records register" "$C" "$D"
until_true "$TIMEOUT" has_cpi "$D" || fail "the clashing record gets a CPI"
until_true "$TIMEOUT" has_cpi "$C" || fail "its counterpart gets a CPI"
reviewed() { [[ "$(identity "$D" | json 'len(d["openReviews"])')" -ge 1 ]]; }
until_true 300 reviewed || fail "the disagreement is held for review" "$(identity "$D" | head -c 400)"
[[ "$(identity "$C" | json 'd["code"]')" != "$(identity "$D" | json 'd["code"]')" ]] || fail "records whose sex disagrees are not linked"
[[ "$(identity "$D" | json 'd["openReviews"][0]["reason"]')" == *"sex differs"* ]] || fail "the review says why"
pass "same National ID but sex differs: two people, one open review saying sex differs"

echo "== a record with no National ID =="
E="$(register "$FACILITY_URL" "Qa$RUN" "Alone" F 1990-04-01 "")"
[[ "$E" =~ ^[0-9a-f-]{36}$ ]] || fail "a patient without a National ID registers" "$E"
until_true "$TIMEOUT" has_cpi "$E" || fail "it gets a CPI"
[[ "$(person_count "$E")" == "1" && "$(identity "$E" | json 'd["code"]')" != "$code_a" ]] \
  || fail "name and date of birth alone never link" "$(identity "$E" | head -c 300)"
pass "no National ID: its own person, even with the same name and date of birth as another"

echo "== a National ID recorded after the record got its CPI =="
NID_LATER="3$RUN"
F="$(register "$FACILITY_URL" "Qa$RUN" "Later" M 1978-02-09 "")"
G="$(register "$SECOND_URL" "Qa$RUN" "Later" M 1978-02-09 "$NID_LATER")"
[[ "$F" =~ ^[0-9a-f-]{36}$ && "$G" =~ ^[0-9a-f-]{36}$ ]] || fail "both records register" "$F" "$G"
until_true "$TIMEOUT" has_cpi "$F" || fail "the record without a National ID gets a CPI"
until_true "$TIMEOUT" has_cpi "$G" || fail "the record with one gets a CPI"
[[ "$(identity "$F" | json 'd["code"]')" != "$(identity "$G" | json 'd["code"]')" ]] || fail "they are two people before the National ID is known"
location="$(api "$FACILITY_URL" "/location?tag=Login%20Location&v=custom:(uuid)" | json 'd["results"][0]["uuid"]')"
added="$(api "$FACILITY_URL" "/patient/$F/identifier" -X POST \
  -d "{\"identifier\":\"$NID_LATER\",\"identifierType\":\"$NATIONAL_ID_TYPE\",\"location\":\"$location\"}" | json 'd.get("uuid") or d')"
[[ "$added" =~ ^[0-9a-f-]{36}$ ]] || fail "the facility records the National ID on a return visit" "$added"
linked_later() { [[ "$(identity "$F" | json 'd["code"]')" == "$(identity "$G" | json 'd["code"]')" ]]; }
until_true "$TIMEOUT" linked_later || fail "the records link once the National ID reaches central" "$(identity "$F" | head -c 300)"
pass "a National ID added on a later visit links the records once it syncs"

echo "== a National ID corrected on a record already linked to another =="
nid_uuid="$(api "$FACILITY_URL" "/patient/$A/identifier?v=custom:(uuid,identifierType:(uuid))" \
  | json "next(i['uuid'] for i in d['results'] if i['identifierType']['uuid']=='$NATIONAL_ID_TYPE')")"
changed="$(api "$FACILITY_URL" "/patient/$A/identifier/$nid_uuid" -X POST -d "{\"identifier\":\"4$RUN\"}" | json 'd.get("uuid") or d')"
[[ "$changed" == "$nid_uuid" ]] || fail "the facility corrects the National ID" "$changed"
flagged() { [[ "$(identity "$A" | json 'sum("changed after" in r["reason"] for r in d["openReviews"])')" -ge 1 ]]; }
until_true "$TIMEOUT" flagged || fail "the corrected National ID is held for review" "$(identity "$A" | head -c 400)"
linked || fail "the correction does not move the linked record on its own" "$(identity "$A" | head -c 300)"
pass "a corrected National ID on a linked record goes to review; the link is not moved"

echo "== privilege =="
RECEIVER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]sync-receiver[-_]' || true)"
if [[ -n "$RECEIVER" ]]; then
  env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p"; }
  code="$(curl -sk -u "$(env_of "$RECEIVER" OPENMRS_REST_USER):$(env_of "$RECEIVER" OPENMRS_REST_PASSWORD)" -o /dev/null -w '%{http_code}' \
    "$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/identity/patient/$A")"
  [[ "$code" == "403" ]] || fail "a user without View Identity Links is refused" "got HTTP $code"
  pass "a user without View Identity Links is refused (403)"
fi

echo "== counts =="
after="$(central "$CENTRAL_URL/openmrs/ws/rest/v1/liberiaemr/identity/status")"
[[ "$(json 'd["openReviews"]' <<<"$after")" -ge 1 && "$(json 'd["linked"]' <<<"$after")" -ge 1 ]] \
  || fail "the status counts reflect the link and the review" "$after"
pass "status counts: $(json 'd["people"]' <<<"$after") people, $(json 'd["linked"]' <<<"$after") linked, $(json 'd["openReviews"]' <<<"$after") for review"

echo
echo "PASS: all $PASSES identity checks held."
