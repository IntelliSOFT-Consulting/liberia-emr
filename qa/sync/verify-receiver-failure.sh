#!/usr/bin/env bash
# QA check against a running central stack that a message the receiver cannot apply is never
# lost (LE-35 acceptance criterion 2; sync-eip.md 5.4 and F6): it is redelivered, moved to
# DLQ after 10 attempts and alerted, while the messages behind it still apply. It sends a
# correctly signed but malformed message and valid ones straight after it, the sequence that
# made upstream's acknowledgement mode drop the failed message. The valid ones ask for a reply
# on DLQ, where the receiver may not send, so they only apply if replies stay disabled.
#
#   qa/sync/verify-receiver-failure.sh [--pki ~/.liberiaemr/sync-security] [--facility careysburg] \
#     [--prom-url http://127.0.0.1:9190] [--jdk-image maven:3.9-eclipse-temurin-17] [--timeout 900]
#
# The receiver exits on each attempt and its restart policy brings it back, so central stops
# applying messages for several minutes; run it on a staging stack. Clears DLQ at the end.
set -euo pipefail

PKI="$HOME/.liberiaemr/sync-security"
FACILITY="careysburg"
PROM_URL="http://127.0.0.1:9190"
JDK_IMAGE="maven:3.9-eclipse-temurin-17"
TIMEOUT=900

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pki)       PKI="$2"; shift 2 ;;
    --facility)  FACILITY="$2"; shift 2 ;;
    --prom-url)  PROM_URL="$2"; shift 2 ;;
    --jdk-image) JDK_IMAGE="$2"; shift 2 ;;
    --timeout)   TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKI="$(cd "$PKI" && pwd)"
# shellcheck source=qa/sync/central-probe.sh
. "$ROOT/qa/sync/central-probe.sh"

SUBSCRIPTION="DB-SYNC-REC.DB-SYNC-RECEIVER"
[[ "$(queue_count DLQ)" == "0" && "$(queue_count "$SUBSCRIPTION")" == "0" ]] \
  || fail "DLQ and the receiver's subscription are empty before the check" "let the receiver drain and investigate DLQ first"

since="$(now)"
[[ "$(send_as send-signed-malformed "$FACILITY" "$FACILITY" "$FACILITY")" == "RESULT SENT" ]] \
  || fail "a malformed message is sent" "$(tail -5 "$WORK/probe.log")"
wait_for_log "$since" "Shutting down the application" || fail "the receiver fails on the malformed message"
for _ in 1 2 3; do
  send_as send-signed "$FACILITY" "$FACILITY" "$FACILITY" JMSReplyTo=queue://DLA::DLQ >/dev/null
done

echo "== waiting for 10 delivery attempts (the receiver restarts for each; timeout ${TIMEOUT}s) =="
dlq=""
for _ in $(seq 1 $((TIMEOUT / 5))); do
  dlq="$(queue_count DLQ)"
  [[ "$dlq" == "1" ]] && break
  sleep 5
done
# Logged once per attempt; the exception itself is logged more than once.
attempts="$(receiver_log "$since" | grep -c "An error occurred, cause: .*dbSyncVersion" || true)"
[[ "$dlq" == "1" ]] \
  || fail "the failed message reaches DLQ instead of being lost" "DLQ '$dlq', subscription '$(queue_count "$SUBSCRIPTION")', attempts $attempts"
pass "the failed message reaches DLQ instead of being lost"
[[ "$attempts" -ge 10 ]] || fail "it was attempted 10 times first" "attempts $attempts"
pass "it was attempted 10 times first"

applied="$(receiver_log "$since" | grep -c "Skipping sync of entity: org.openmrs.eip.dbsync.model.UserModel" || true)"
[[ "$applied" -ge 3 ]] || fail "the valid messages sent after it were applied" "applied $applied"
pass "the valid messages sent after it were applied, their reply requests ignored"

wait_for_log "$since" "Started Application" || true
[[ "$(docker inspect -f '{{.State.Running}}' "$RECEIVER")" == "true" && "$(queue_count "$SUBSCRIPTION")" == "0" ]] \
  || fail "the receiver is running again with nothing left behind"
pass "the receiver is running again with nothing left behind"

state=""
for _ in $(seq 1 120); do
  state="$(alert_state SyncDeadLetters "$PROM_URL")"
  [[ -n "$state" ]] && break
  sleep 1
done
[[ "$state" == *pending* || "$state" == *firing* ]] || fail "SyncDeadLetters is raised" "state '$state' at $PROM_URL"
pass "SyncDeadLetters is raised (it fires after its 5 minute hold)"

[[ "$(queue_count DLQ)" == "1" ]] || fail "only the malformed message was dead-lettered" "DLQ '$(queue_count DLQ)'"
pass "only the malformed message was dead-lettered"

admin queue purge --name DLQ >/dev/null
[[ "$(queue_count DLQ)" == "0" ]] || fail "an operator can clear DLQ after investigating"
pass "an operator can clear DLQ after investigating"

echo
echo "PASS: all $PASSES receiver failure checks held."
