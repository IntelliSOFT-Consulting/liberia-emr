#!/bin/sh
# Renders the dbsync sender configuration from the environment and starts the app.
#
# Required variables (no defaults, fail loudly):
#   DBSYNC_SENDER_ID       facility code central expects (FACILITY_CODE in the env file)
#   OPENMRS_DB_HOST/PORT/NAME, OPENMRS_DB_USER, OPENMRS_DB_PASSWORD
#   MGMT_DB_NAME, MGMT_DB_USER, MGMT_DB_PASSWORD
#   DEBEZIUM_SERVER_ID, DEBEZIUM_DB_USER, DEBEZIUM_DB_PASSWORD
#   OPENMRS_BASE_URL, OPENMRS_REST_USER, OPENMRS_REST_PASSWORD
#   ARTEMIS_URL, ARTEMIS_USER, ARTEMIS_PASSWORD (required unless SYNC_OUTPUT_ENDPOINT
#   is a file: endpoint, the QA-only mode)
#
# Optional (defaulted here):
#   SYNC_OUTPUT_ENDPOINT   activemq:topic:openmrs.sync.topic; file: endpoints are for QA only
#   COMPLEX_OBS_DIR        /opt/eip/complex-obs
#   LOG_LEVEL              INFO
#   JAVA_OPTS              JVM flags, e.g. -Xmx1g
set -eu

: "${SYNC_OUTPUT_ENDPOINT:=activemq:topic:openmrs.sync.topic}"
: "${COMPLEX_OBS_DIR:=/opt/eip/complex-obs}"
: "${LOG_LEVEL:=INFO}"
export SYNC_OUTPUT_ENDPOINT COMPLEX_OBS_DIR LOG_LEVEL

required="DBSYNC_SENDER_ID
OPENMRS_DB_HOST OPENMRS_DB_PORT OPENMRS_DB_NAME OPENMRS_DB_USER OPENMRS_DB_PASSWORD
MGMT_DB_NAME MGMT_DB_USER MGMT_DB_PASSWORD
DEBEZIUM_SERVER_ID DEBEZIUM_DB_USER DEBEZIUM_DB_PASSWORD
OPENMRS_BASE_URL OPENMRS_REST_USER OPENMRS_REST_PASSWORD"

# Broker credentials are required exactly when the broker is the output. In the QA-only
# file: mode there is no broker to authenticate to, and demanding one would make the
# documented capture check impossible to run before central exists.
case "$SYNC_OUTPUT_ENDPOINT" in
  activemq:*) required="$required ARTEMIS_URL ARTEMIS_USER ARTEMIS_PASSWORD" ;;
  file:*)     : "${ARTEMIS_URL:=}" "${ARTEMIS_USER:=}" "${ARTEMIS_PASSWORD:=}"
              export ARTEMIS_URL ARTEMIS_USER ARTEMIS_PASSWORD ;;
  *)          echo "sync sender refusing to start; SYNC_OUTPUT_ENDPOINT must be an activemq: or file: endpoint, got '$SYNC_OUTPUT_ENDPOINT'" >&2
              exit 2 ;;
esac

missing=""
for v in $required; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "sync sender refusing to start; unset variables:$missing" >&2
  exit 2
fi

mkdir -p /opt/eip/.debezium "$COMPLEX_OBS_DIR"

# Substitute ONLY the declared variables, the same discipline as the gateway's
# NGINX_ENVSUBST_FILTER: an unlisted variable stays literal instead of being silently
# blanked, and credential values are copied verbatim, never evaluated.
vars='${DBSYNC_SENDER_ID} ${OPENMRS_DB_HOST} ${OPENMRS_DB_PORT} ${OPENMRS_DB_NAME}
${OPENMRS_DB_USER} ${OPENMRS_DB_PASSWORD} ${MGMT_DB_NAME} ${MGMT_DB_USER}
${MGMT_DB_PASSWORD} ${DEBEZIUM_SERVER_ID} ${DEBEZIUM_DB_USER} ${DEBEZIUM_DB_PASSWORD}
${ARTEMIS_URL} ${ARTEMIS_USER} ${ARTEMIS_PASSWORD} ${OPENMRS_BASE_URL}
${OPENMRS_REST_USER} ${OPENMRS_REST_PASSWORD} ${SYNC_OUTPUT_ENDPOINT}
${COMPLEX_OBS_DIR} ${LOG_LEVEL}'
umask 077
envsubst "$vars" < /app/application.properties.template > /app/config/application.properties

exec java ${JAVA_OPTS:--Xmx1g} -jar /app/sender.jar \
  --spring.config.location=file:/app/config/application.properties
