#!/bin/sh
# Renders the dbsync sender configuration from the environment and starts the app.
#
# Required variables (no defaults, fail loudly):
#   DBSYNC_SENDER_ID       facility code enrolled on the broker (FACILITY_CODE in the env file)
#   OPENMRS_DB_HOST/PORT/NAME, OPENMRS_DB_USER, OPENMRS_DB_PASSWORD
#   MGMT_DB_NAME, MGMT_DB_USER, MGMT_DB_PASSWORD
#   DEBEZIUM_SERVER_ID, DEBEZIUM_DB_USER, DEBEZIUM_DB_PASSWORD
#   OPENMRS_BASE_URL, OPENMRS_REST_USER, OPENMRS_REST_PASSWORD
#   ARTEMIS_URL            ssl://<central>:61617 (unless the output is a file: endpoint)
#
# Mounted at /app/sync-certs when the output is the broker: client.p12, truststore.p12,
# their .pass files, and pgp/ with pgp.pass (sync-security.sh checks all of it).
#
# Optional (defaulted here):
#   SYNC_OUTPUT_ENDPOINT     activemq:topic:sync.facility.<DBSYNC_SENDER_ID>; file: is QA only
#   SYNC_PAYLOAD_ENCRYPTION  true for the broker, false for file: (QA reads the payload)
#   PGP_USER_ID              DBSYNC_SENDER_ID@sync.liberiaemr
#   PGP_RECEIVER_USER_ID     sync-receiver@sync.liberiaemr
#   COMPLEX_OBS_DIR          /opt/eip/complex-obs
#   LOG_LEVEL                INFO
#   JAVA_OPTS                JVM flags, e.g. -Xmx1g
set -eu
SYNC_ROLE="sync sender"
. /app/sync-security.sh

required="DBSYNC_SENDER_ID
OPENMRS_DB_HOST OPENMRS_DB_PORT OPENMRS_DB_NAME OPENMRS_DB_USER OPENMRS_DB_PASSWORD
MGMT_DB_NAME MGMT_DB_USER MGMT_DB_PASSWORD
DEBEZIUM_SERVER_ID DEBEZIUM_DB_USER DEBEZIUM_DB_PASSWORD
OPENMRS_BASE_URL OPENMRS_REST_USER OPENMRS_REST_PASSWORD"

missing=""
for v in $required; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
[ -z "$missing" ] || sync_refuse "unset variables:$missing"

# The facility code names the broker address this facility may publish to.
echo "$DBSYNC_SENDER_ID" | grep -Eq '^[a-z0-9][a-z0-9-]{1,31}$' \
  || sync_refuse "DBSYNC_SENDER_ID must be lowercase letters, digits and hyphens, got '$DBSYNC_SENDER_ID'"

OWN_ENDPOINT="activemq:topic:sync.facility.$DBSYNC_SENDER_ID"
: "${SYNC_OUTPUT_ENDPOINT:=$OWN_ENDPOINT}"
# Bare addresses: dbsync's PGP library wraps the id in <...> before matching the key's
# user id, which is what keeps one facility's id from matching inside another's.
: "${PGP_USER_ID:=$DBSYNC_SENDER_ID@sync.liberiaemr}"
: "${PGP_RECEIVER_USER_ID:=sync-receiver@sync.liberiaemr}"
: "${COMPLEX_OBS_DIR:=/opt/eip/complex-obs}"
: "${LOG_LEVEL:=INFO}"

TLS_ARGS=""
case "$SYNC_OUTPUT_ENDPOINT" in
  "$OWN_ENDPOINT")
    [ -n "${ARTEMIS_URL:-}" ] || sync_refuse "unset variables: ARTEMIS_URL"
    : "${SYNC_PAYLOAD_ENCRYPTION:=true}"
    sync_broker_url
    sync_tls_argfile
    TLS_ARGS="$SYNC_TLS_ARGS"
    ;;
  activemq:*)
    sync_refuse "SYNC_OUTPUT_ENDPOINT must be this facility's own address $OWN_ENDPOINT (the broker refuses any other), got '$SYNC_OUTPUT_ENDPOINT'"
    ;;
  file:*)
    : "${ARTEMIS_URL:=}"
    : "${SYNC_PAYLOAD_ENCRYPTION:=false}"
    ;;
  *)
    sync_refuse "SYNC_OUTPUT_ENDPOINT must be an activemq: or file: endpoint, got '$SYNC_OUTPUT_ENDPOINT'"
    ;;
esac
sync_pgp
export SYNC_OUTPUT_ENDPOINT SYNC_PAYLOAD_ENCRYPTION PGP_USER_ID PGP_RECEIVER_USER_ID \
       COMPLEX_OBS_DIR LOG_LEVEL ARTEMIS_URL

mkdir -p /opt/eip/.debezium "$COMPLEX_OBS_DIR"

# Substitute ONLY the declared variables, the same discipline as the gateway's
# NGINX_ENVSUBST_FILTER: an unlisted variable stays literal instead of being silently
# blanked, and credential values are copied verbatim, never evaluated.
vars='${DBSYNC_SENDER_ID} ${OPENMRS_DB_HOST} ${OPENMRS_DB_PORT} ${OPENMRS_DB_NAME}
${OPENMRS_DB_USER} ${OPENMRS_DB_PASSWORD} ${MGMT_DB_NAME} ${MGMT_DB_USER}
${MGMT_DB_PASSWORD} ${DEBEZIUM_SERVER_ID} ${DEBEZIUM_DB_USER} ${DEBEZIUM_DB_PASSWORD}
${ARTEMIS_URL} ${OPENMRS_BASE_URL} ${OPENMRS_REST_USER} ${OPENMRS_REST_PASSWORD}
${SYNC_OUTPUT_ENDPOINT} ${SYNC_PAYLOAD_ENCRYPTION} ${PGP_USER_ID} ${PGP_RECEIVER_USER_ID}
${PGP_PASSWORD} ${COMPLEX_OBS_DIR} ${LOG_LEVEL}'
umask 077
PGP_PASSWORD="$PGP_PASSWORD" envsubst "$vars" \
  < /app/application.properties.template > /app/config/application.properties
unset PGP_PASSWORD

# shellcheck disable=SC2086 # JAVA_OPTS and TLS_ARGS are deliberately word-split
exec java ${JAVA_OPTS:--Xmx1g} $TLS_ARGS -jar /app/sender.jar \
  --spring.config.location=file:/app/config/application.properties
