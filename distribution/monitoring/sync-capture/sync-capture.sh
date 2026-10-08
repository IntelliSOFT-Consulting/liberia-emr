#!/bin/sh
# Exposes whether the facility's sync sender is still capturing changes, for Prometheus.
#
# The sender can stay up, reach its database and report an empty error queue while Debezium
# retries one binlog event forever (a torn event after a power cut, error 1236). Nothing is
# captured and no sender metric moves. This compares two things the sender cannot hide: the
# binlog position it last saved, and the newest rows in tables it watches. Rows arriving while
# the saved position stands still mean capture has stopped.
#
# It also asks the sender whether it can reach the broker at central, so a facility can see a
# broken link to central while it has nothing to send (SyncCentralUnreachable).
#
#   sync-capture.sh          serve :9102/metrics, refreshed every REFRESH_SECONDS
#   sync-capture.sh --once   print the metrics once and exit
set -eu

OFFSETS="${OFFSETS_FILE:-/eip/.debezium/offsets.txt}"
OUT_DIR=/tmp/www
STATE="${STATE_FILE:-/tmp/state}"
REFRESH_SECONDS="${REFRESH_SECONDS:-60}"
SENDER_HEALTH_URL="${SENDER_HEALTH_URL:-http://sync:8080/actuator/health}"
# Long enough for the sender's own attempt to reach central to give up. A firewall that drops
# the broker port makes that attempt hang rather than fail.
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-40}"

# The newest primary key in each watched table that clinical work writes to. A new row in any
# of them is a change the sender must capture; primary keys are indexed, so this stays cheap
# on a large database.
# Only new rows are seen: a stuck sender at a clinic that only edits or voids records goes
# unnoticed until the next new record.
IDS_SQL="SELECT CONCAT_WS(',',
  (SELECT COALESCE(MAX(person_id), 0) FROM person), (SELECT COALESCE(MAX(patient_identifier_id), 0) FROM patient_identifier),
  (SELECT COALESCE(MAX(visit_id), 0) FROM visit), (SELECT COALESCE(MAX(encounter_id), 0) FROM encounter),
  (SELECT COALESCE(MAX(obs_id), 0) FROM obs), (SELECT COALESCE(MAX(order_id), 0) FROM orders),
  (SELECT COALESCE(MAX(patient_program_id), 0) FROM patient_program), (SELECT COALESCE(MAX(condition_id), 0) FROM conditions),
  (SELECT COALESCE(MAX(allergy_id), 0) FROM allergy))"

newest_ids() {
  MYSQL_PWD="${DB_PASSWORD:-}" mariadb --skip-ssl -h "${DB_HOST:-db}" -P "${DB_PORT:-3306}" \
    -u "${DB_USER:-}" -N -B -e "$IDS_SQL" "${DB_NAME:-openmrs}" 2>/dev/null
}

# The offset file is a serialised Java map whose value is Debezium's JSON offset; the JSON is
# read as text, never deserialised. Control bytes become line breaks first, because busybox grep
# stops at the NULs of the Java wrapper.
saved_offset() {
  [ -r "$OFFSETS" ] || return 0
  LC_ALL=C tr '\000-\037\177-\377' '\n' < "$OFFSETS" | grep -o '{"[^{}]*"pos":[0-9]*[^{}]*}' | tail -1 || true
}

# The sender's health answer lists its parts (show-components in sync/application.properties.
# template). "jms" is Spring's own check of the broker connection, so it is down whenever the
# sender cannot reach central. The answer is 503 while any part is down, and is read anyway.
broker_status() {
  curl -s -m "$HEALTH_TIMEOUT_SECONDS" "$SENDER_HEALTH_URL" 2>/dev/null \
    | grep -o '"jms":{"status":"[A-Z_]*"' | sed 's/.*"status":"\([A-Z_]*\)"/\1/' || true
}

state_get() { [ ! -f "$STATE" ] || sed -n "s/^$1=//p" "$STATE"; }

render() {
  now="$(date -u +%s)"
  offset="$(saved_offset)"
  offset_readable=1
  [ -n "$offset" ] || { offset=none; offset_readable=0; }
  event_seconds="$(printf '%s' "$offset" | sed -n 's/.*"ts_sec":\([0-9]*\).*/\1/p')"

  db_readable=1
  ids="$(newest_ids)" || true
  [ -n "$ids" ] || db_readable=0

  broker="$(broker_status)"

  last_offset="$(state_get offset)"
  offset_since="$(state_get offset_since)"
  ids_at_offset="$(state_get ids_at_offset)"
  waiting_since="$(state_get waiting_since)"

  if [ "$offset" != "$last_offset" ] || [ -z "$offset_since" ]; then
    offset_since="$now"
    ids_at_offset="$ids"
    waiting_since=""
  elif [ -z "$ids_at_offset" ]; then
    ids_at_offset="$ids"
  fi

  # Rows newer than the saved position: waiting since the first run that saw them, not since the
  # position last moved, so a quiet clinic's first new patient does not look days late.
  waiting=0
  if [ "$db_readable" = 1 ] && [ -n "$ids_at_offset" ] && [ "$ids" != "$ids_at_offset" ]; then
    [ -n "$waiting_since" ] || waiting_since="$now"
    waiting=$((now - waiting_since))
  else
    waiting_since=""
  fi

  # A first load keeps one position for hours while it reads every table, and a sender with no
  # saved position (a first start, or a resend) has none to watch: neither is a stall. Rows
  # waiting with no position to judge them by are reported as unverified instead.
  snapshot=0
  case "$offset" in *'"snapshot":true'* | *'"snapshot":"true"'*) snapshot=1 ;; esac
  stalled=0
  unverified=0
  if [ "$snapshot" = 1 ]; then
    waiting_since=""
  elif [ "$offset_readable" = 1 ]; then
    stalled="$waiting"
  else
    unverified="$waiting"
  fi

  printf 'offset=%s\noffset_since=%s\nids_at_offset=%s\nwaiting_since=%s\n' \
    "$offset" "$offset_since" "$ids_at_offset" "$waiting_since" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"

  echo "# TYPE sync_capture_stalled_seconds gauge"
  echo "sync_capture_stalled_seconds $stalled"
  echo "# TYPE sync_capture_unverified_seconds gauge"
  echo "sync_capture_unverified_seconds $unverified"
  echo "# TYPE sync_capture_snapshot gauge"
  echo "sync_capture_snapshot $snapshot"
  echo "# TYPE sync_capture_offset_unchanged_seconds gauge"
  echo "sync_capture_offset_unchanged_seconds $((now - offset_since))"
  if [ -n "$event_seconds" ]; then
    echo "# TYPE sync_capture_last_event_seconds gauge"
    echo "sync_capture_last_event_seconds $event_seconds"
  fi
  echo "# TYPE sync_capture_offset_readable gauge"
  echo "sync_capture_offset_readable $offset_readable"
  echo "# TYPE sync_capture_db_readable gauge"
  echo "sync_capture_db_readable $db_readable"
  # Absent, rather than 0, when the sender did not answer: a stopped sender is SyncSenderDown,
  # not a broken link to central.
  case "$broker" in
    UP) echo "# TYPE sync_sender_broker_connected gauge"; echo "sync_sender_broker_connected 1" ;;
    DOWN | OUT_OF_SERVICE) echo "# TYPE sync_sender_broker_connected gauge"; echo "sync_sender_broker_connected 0" ;;
  esac
  echo "# TYPE sync_capture_last_run_seconds gauge"
  echo "sync_capture_last_run_seconds $now"
}

if [ "${1:-}" = "--once" ]; then
  render
  exit 0
fi

mkdir -p "$OUT_DIR"
render > "$OUT_DIR/metrics.tmp" && mv "$OUT_DIR/metrics.tmp" "$OUT_DIR/metrics"
httpd -f -p 9102 -h "$OUT_DIR" &
httpd_pid=$!
trap 'kill "$httpd_pid" 2>/dev/null; exit 0' TERM INT
while sleep "$REFRESH_SECONDS" & wait $!; do
  render > "$OUT_DIR/metrics.tmp" && mv "$OUT_DIR/metrics.tmp" "$OUT_DIR/metrics"
done
