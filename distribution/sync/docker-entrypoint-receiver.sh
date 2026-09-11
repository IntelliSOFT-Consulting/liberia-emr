#!/bin/sh
# Renders the dbsync receiver configuration from the environment and starts the app.
#
# Required variables (no defaults, fail loudly):
#   OPENMRS_DB_HOST/PORT/NAME, OPENMRS_DB_USER, OPENMRS_DB_PASSWORD
#   MGMT_DB_NAME, MGMT_DB_USER, MGMT_DB_PASSWORD
#   ARTEMIS_URL, ARTEMIS_USER, ARTEMIS_PASSWORD
#   OPENMRS_BASE_URL, OPENMRS_REST_USER, OPENMRS_REST_PASSWORD
#
# Optional (defaulted here):
#   COMPLEX_OBS_DIR        /opt/eip/complex-obs
#   LOG_LEVEL              INFO
#   JAVA_OPTS              JVM flags, e.g. -Xmx2g
set -eu

: "${COMPLEX_OBS_DIR:=/opt/eip/complex-obs}"
: "${LOG_LEVEL:=INFO}"
export COMPLEX_OBS_DIR LOG_LEVEL

missing=""
for v in OPENMRS_DB_HOST OPENMRS_DB_PORT OPENMRS_DB_NAME OPENMRS_DB_USER OPENMRS_DB_PASSWORD \
         MGMT_DB_NAME MGMT_DB_USER MGMT_DB_PASSWORD \
         ARTEMIS_URL ARTEMIS_USER ARTEMIS_PASSWORD \
         OPENMRS_BASE_URL OPENMRS_REST_USER OPENMRS_REST_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "sync receiver refusing to start; unset variables:$missing" >&2
  exit 2
fi

mkdir -p "$COMPLEX_OBS_DIR"

# Substitute ONLY the declared variables: an unlisted variable stays literal instead of
# being silently blanked, and credential values are copied verbatim, never evaluated.
vars='${OPENMRS_DB_HOST} ${OPENMRS_DB_PORT} ${OPENMRS_DB_NAME} ${OPENMRS_DB_USER}
${OPENMRS_DB_PASSWORD} ${MGMT_DB_NAME} ${MGMT_DB_USER} ${MGMT_DB_PASSWORD}
${ARTEMIS_URL} ${ARTEMIS_USER} ${ARTEMIS_PASSWORD} ${OPENMRS_BASE_URL}
${OPENMRS_REST_USER} ${OPENMRS_REST_PASSWORD} ${COMPLEX_OBS_DIR} ${LOG_LEVEL}'
umask 077
envsubst "$vars" < /app/receiver-application.properties.template > /app/config/application.properties

exec java ${JAVA_OPTS:--Xmx2g} -jar /app/receiver.jar \
  --spring.config.location=file:/app/config/application.properties
