#!/usr/bin/env bash
# QA check for the full sync path (LE-35, acceptance criterion 1): registers a patient
# at the FACILITY and asserts the same record, same UUID, appears at CENTRAL within the
# push interval. Exercises the whole chain: facility REST write -> binlog -> Debezium ->
# sender -> Artemis -> receiver -> central database.
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

echo "== registering a patient at the facility (via verify-sender-capture.sh) =="
CAPTURE_OUT="$("$(dirname "$0")/verify-sender-capture.sh" --base-url "$FACILITY_URL" \
  --user "$USER" --password "$PASSWORD" --timeout "$TIMEOUT")"
echo "$CAPTURE_OUT" | tail -2
PATIENT_UUID="$(echo "$CAPTURE_OUT" | sed -n 's/.*patient \([0-9a-f-]\{36\}\).*/\1/p' | head -1)"
[[ -n "$PATIENT_UUID" ]] || { echo "FAIL: could not extract the patient UUID from the capture step" >&2; exit 1; }

echo "== waiting for the record at central (timeout ${TIMEOUT}s) =="
deadline=$((SECONDS + TIMEOUT))
while true; do
  code="$(curl -sk -o /dev/null -w '%{http_code}' -u "$CENTRAL_USER:$CENTRAL_PASSWORD" \
    "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$PATIENT_UUID" || true)"
  [[ "$code" == "200" ]] && break
  if (( SECONDS >= deadline )); then
    echo "FAIL: patient $PATIENT_UUID not at central within ${TIMEOUT}s (last HTTP $code)" >&2
    echo "      Check the receiver logs and the receiver_retry_queue / conflict queue" >&2
    echo "      in the central management schema." >&2
    exit 1
  fi
  sleep 10
done

# Same person? Compare a stable, non-generated field end to end.
FACILITY_BIRTHDATE="$(curl -sk -u "$USER:$PASSWORD" \
  "$FACILITY_URL/openmrs/ws/rest/v1/patient/$PATIENT_UUID?v=custom:(person:(birthdate))" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["person"]["birthdate"])')"
CENTRAL_BIRTHDATE="$(curl -sk -u "$CENTRAL_USER:$CENTRAL_PASSWORD" \
  "$CENTRAL_URL/openmrs/ws/rest/v1/patient/$PATIENT_UUID?v=custom:(person:(birthdate))" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["person"]["birthdate"])')"
if [[ "$FACILITY_BIRTHDATE" != "$CENTRAL_BIRTHDATE" ]]; then
  # The values are deliberately not printed: no PHI in output, fabricated or not.
  echo "FAIL: patient $PATIENT_UUID exists at both ends but the birthdate differs" >&2
  exit 1
fi

echo "PASS: patient $PATIENT_UUID pushed facility -> central intact"
