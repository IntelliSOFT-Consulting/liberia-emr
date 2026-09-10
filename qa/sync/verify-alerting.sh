#!/usr/bin/env bash
# QA check for LE-35 acceptance criterion 3: failure alerting fires on push errors and
# is visible to admins, then resolves when the failure clears.
#
#   qa/sync/verify-alerting.sh [--facility-url https://localhost] [--prom-url http://127.0.0.1:9090] \
#     [--user admin] [--password ...] [--timeout 600] [--resolve-timeout 2400] \
#     [--outage-cmd '...'] [--restore-cmd '...']
#
# Requires the facility stack with --profile sync (which includes prometheus and
# alertmanager) and a reachable central broker to break. It provokes a real push error:
# cut the broker, register a patient so the sender has something to fail on, and watch
# the SyncPushErrors alert fire in Prometheus; then restore and watch it resolve. The
# alert rule's 5m hold means firing takes ten minutes or so; RESOLUTION waits on the
# sender's retry poller, which runs every 30 minutes (db-event.retry.interval), so the
# resolve phase has its own, longer timeout.
set -euo pipefail

FACILITY_URL="https://localhost"
PROM_URL="http://127.0.0.1:9090"
USER="admin"
PASSWORD="Admin123"
TIMEOUT=600
RESOLVE_TIMEOUT=2400
OUTAGE_CMD=""
RESTORE_CMD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --facility-url) FACILITY_URL="$2"; shift 2 ;;
    --prom-url)     PROM_URL="$2"; shift 2 ;;
    --user)         USER="$2"; shift 2 ;;
    --password)     PASSWORD="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    --resolve-timeout) RESOLVE_TIMEOUT="$2"; shift 2 ;;
    --outage-cmd)   OUTAGE_CMD="$2"; shift 2 ;;
    --restore-cmd)  RESTORE_CMD="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$FACILITY_URL" == *moh.gov.lr* ]]; then
  echo "REFUSING: this check fabricates a patient and breaks the broker link; never production." >&2
  exit 1
fi

if [[ -z "$OUTAGE_CMD" ]]; then
  ARTEMIS="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]artemis[-_]' || true)"
  [[ -n "$ARTEMIS" ]] || { echo "FAIL: no central artemis container and no --outage-cmd given" >&2; exit 1; }
  OUTAGE_CMD="docker stop $ARTEMIS"
  RESTORE_CMD="docker start $ARTEMIS"
fi
[[ -n "$RESTORE_CMD" ]] || { echo "FAIL: --outage-cmd requires --restore-cmd" >&2; exit 1; }

alert_state() { # prints the state of SyncPushErrors: firing|pending|none
  curl -s "$PROM_URL/api/v1/alerts" | python3 -c '
import json,sys
alerts = json.load(sys.stdin)["data"]["alerts"]
states = [a["state"] for a in alerts if a["labels"].get("alertname") == "SyncPushErrors"]
print(states[0] if states else "none")'
}

echo "== baseline: no SyncPushErrors alert =="
[[ "$(alert_state)" == "none" ]] || { echo "FAIL: SyncPushErrors already active before the drill" >&2; exit 1; }

echo "== cutting the link and provoking a push error =="
eval "$OUTAGE_CMD"
# The sender only fails when it has something to send.
"$(dirname "$0")/verify-sender-capture.sh" --base-url "$FACILITY_URL" \
  --user "$USER" --password "$PASSWORD" --timeout "$TIMEOUT" >/dev/null
echo "   patient captured; the send will now fail and queue"

echo "== waiting for SyncPushErrors to fire (rule holds 5m; timeout ${TIMEOUT}s) =="
deadline=$((SECONDS + TIMEOUT))
until [[ "$(alert_state)" == "firing" ]]; do
  if (( SECONDS >= deadline )); then
    echo "FAIL: SyncPushErrors did not fire within ${TIMEOUT}s (state: $(alert_state))" >&2
    eval "$RESTORE_CMD" || true
    exit 1
  fi
  sleep 15
done
echo "   FIRING, and visible at $PROM_URL/alerts"

echo "== restoring the link: $RESTORE_CMD =="
eval "$RESTORE_CMD"

echo "== waiting for the alert to resolve (the sender retries every 30m; timeout ${RESOLVE_TIMEOUT}s) =="
deadline=$((SECONDS + RESOLVE_TIMEOUT))
until [[ "$(alert_state)" == "none" ]]; do
  if (( SECONDS >= deadline )); then
    echo "FAIL: SyncPushErrors still $(alert_state) ${RESOLVE_TIMEOUT}s after restore" >&2
    exit 1
  fi
  sleep 15
done

echo
echo "PASS: SyncPushErrors fired on a real push failure, was admin-visible, and resolved on recovery."
