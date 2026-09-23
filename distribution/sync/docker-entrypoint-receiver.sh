#!/bin/sh
# Renders the dbsync receiver configuration from the environment and starts the app.
#
# Required variables (no defaults, fail loudly):
#   OPENMRS_DB_HOST/PORT/NAME, OPENMRS_DB_USER, OPENMRS_DB_PASSWORD
#   MGMT_DB_NAME, MGMT_DB_USER, MGMT_DB_PASSWORD
#   ARTEMIS_URL            ssl://artemis:61617
#   OPENMRS_BASE_URL, OPENMRS_REST_USER, OPENMRS_REST_PASSWORD
#
# Mounted at /app/sync-certs: client.p12, truststore.p12, their .pass files, and pgp/
# holding the receiver's private key and every enrolled facility's public key.
#
# Optional (defaulted here):
#   SYNC_HASHES_UPDATE         false; true runs dbsync's hash updater instead of syncing, then
#   SYNC_HASHES_UPDATE_TABLES    exits (docs/runbooks/sync-operations.md); tables comma-separated
#   SYNC_CONFLICT_WINDOW       01:00-05:00 UTC, when conflict decisions recorded in the EMR are
#                                applied; empty turns that off
#   SYNC_CONFLICT_CHECK_SECONDS  600, how often decisions are looked for inside the window
#   COMPLEX_OBS_DIR          /opt/eip/complex-obs
#   LOG_LEVEL                INFO
#   JAVA_OPTS                JVM flags, e.g. -Xmx2g
set -eu
SYNC_ROLE="sync receiver"
. /app/sync-security.sh

# Payload encryption and signing are not optional at central (sync-eip.md 7.1 and 7.7).
[ "${SYNC_PAYLOAD_ENCRYPTION:=true}" = true ] \
  || sync_refuse "SYNC_PAYLOAD_ENCRYPTION cannot be turned off at central"
: "${SYNC_HASHES_UPDATE:=false}"
# Unset takes the default; set but empty turns automatic application off.
: "${SYNC_CONFLICT_WINDOW=01:00-05:00}"
: "${SYNC_CONFLICT_CHECK_SECONDS:=600}"
: "${SYNC_HASHES_UPDATE_TABLES:=}"
case "$SYNC_HASHES_UPDATE" in
  true|false) ;;
  *) sync_refuse "SYNC_HASHES_UPDATE must be true or false, got '$SYNC_HASHES_UPDATE'" ;;
esac
# A case pattern, not grep, so a value carrying a newline cannot slip a second property in.
case "$SYNC_HASHES_UPDATE_TABLES" in
  *[!a-z_,]*) sync_refuse "SYNC_HASHES_UPDATE_TABLES must be comma-separated table names, got '$SYNC_HASHES_UPDATE_TABLES'" ;;
esac
if [ -n "$SYNC_CONFLICT_WINDOW" ]; then
  printf '%s' "$SYNC_CONFLICT_WINDOW" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' \
    || sync_refuse "SYNC_CONFLICT_WINDOW must be HH:MM-HH:MM in UTC, or empty to turn it off, got '$SYNC_CONFLICT_WINDOW'"
fi
case "$SYNC_CONFLICT_CHECK_SECONDS" in
  ''|*[!0-9]*) sync_refuse "SYNC_CONFLICT_CHECK_SECONDS must be a number of seconds, got '$SYNC_CONFLICT_CHECK_SECONDS'" ;;
esac
: "${COMPLEX_OBS_DIR:=/opt/eip/complex-obs}"
: "${LOG_LEVEL:=INFO}"

missing=""
for v in OPENMRS_DB_HOST OPENMRS_DB_PORT OPENMRS_DB_NAME OPENMRS_DB_USER OPENMRS_DB_PASSWORD \
         MGMT_DB_NAME MGMT_DB_USER MGMT_DB_PASSWORD ARTEMIS_URL \
         OPENMRS_BASE_URL OPENMRS_REST_USER OPENMRS_REST_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
[ -z "$missing" ] || sync_refuse "unset variables:$missing"

sync_broker_url
sync_tls_argfile
TLS_ARGS="$SYNC_TLS_ARGS"
sync_pgp
export COMPLEX_OBS_DIR LOG_LEVEL SYNC_HASHES_UPDATE SYNC_HASHES_UPDATE_TABLES

mkdir -p "$COMPLEX_OBS_DIR"

# Substitute ONLY the declared variables: an unlisted variable stays literal instead of
# being silently blanked, and credential values are copied verbatim, never evaluated.
vars='${OPENMRS_DB_HOST} ${OPENMRS_DB_PORT} ${OPENMRS_DB_NAME} ${OPENMRS_DB_USER}
${OPENMRS_DB_PASSWORD} ${MGMT_DB_NAME} ${MGMT_DB_USER} ${MGMT_DB_PASSWORD}
${ARTEMIS_URL} ${OPENMRS_BASE_URL} ${OPENMRS_REST_USER} ${OPENMRS_REST_PASSWORD}
${PGP_PASSWORD} ${COMPLEX_OBS_DIR} ${LOG_LEVEL} ${SYNC_HASHES_UPDATE} ${SYNC_HASHES_UPDATE_TABLES}'
umask 077
PGP_PASSWORD="$PGP_PASSWORD" envsubst "$vars" \
  < /app/receiver-application.properties.template > /app/config/application.properties
unset PGP_PASSWORD

# Only ever started with &: exec makes the background job the JVM itself, so its pid is the one
# a TERM has to reach.
receiver_jvm() {
  # shellcheck disable=SC2086 # JAVA_OPTS and TLS_ARGS are deliberately word-split
  exec java ${JAVA_OPTS:--Xmx2g} $TLS_ARGS -jar /app/receiver.jar \
    --spring.config.location=file:/app/config/application.properties "$@"
}

# Conflict decisions recorded in the EMR are applied in SYNC_CONFLICT_WINDOW (conflict-decisions.sh).
# That needs the receiver stopped for a moment, so this shell stays as the parent of the JVM
# instead of replacing itself with it. Empty turns it off: conflicts are then resolved with
# scripts/sync/conflicts.sh.
if [ "$SYNC_HASHES_UPDATE" = false ] && [ -n "$SYNC_CONFLICT_WINDOW" ]; then
  . /app/conflict-decisions.sh
  cd_setup
  CD_CHILD=""
  CD_IDS=""
  tick=0
  # After a failed apply, leave decisions alone until the next night's window, so a failure that
  # repeats does not stop and start the receiver at every check.
  held_until=0
  stop_child() {
    if [ -n "$CD_CHILD" ]; then
      kill -TERM "$CD_CHILD" 2>/dev/null || true
      cd_wait "$CD_CHILD"
      CD_CHILD=""
    fi
  }
  shutdown() {
    kill "$ticker" 2>/dev/null || true
    stop_child
    [ -z "$CD_IDS" ] || cd_reopen "$CD_IDS" || true
    exit 143
  }
  trap shutdown TERM INT
  trap 'tick=1' USR1

  cd_reopen >/dev/null 2>&1 || true
  ( while sleep "$SYNC_CONFLICT_CHECK_SECONDS"; do kill -USR1 $$ 2>/dev/null || exit 0; done ) &
  ticker=$!
  receiver_jvm & CD_CHILD=$!
  while :; do
    rc=0
    wait "$CD_CHILD" || rc=$?
    if [ "$tick" = 1 ]; then
      tick=0
      # A tick interrupts the wait with the receiver still running; outside the window, or with
      # nothing decided, it carries on untouched.
      if [ "$(date +%s)" -ge "$held_until" ] && cd_in_window && [ -n "$(cd_ready 2>/dev/null)" ]; then
        cd_log "stopping the receiver to apply decided conflicts"
        stop_child
        if ! cd_apply receiver_jvm; then
          held_until=$(( $(date +%s) + 12 * 3600 ))
          cd_log "not trying again for 12 hours"
        fi
        receiver_jvm & CD_CHILD=$!
      fi
      continue
    fi
    # The receiver ended by itself: end with it, so the restart policy brings it back.
    kill "$ticker" 2>/dev/null || true
    exit "$rc"
  done
fi

# shellcheck disable=SC2086 # JAVA_OPTS and TLS_ARGS are deliberately word-split
exec java ${JAVA_OPTS:--Xmx2g} $TLS_ARGS -jar /app/receiver.jar \
  --spring.config.location=file:/app/config/application.properties
