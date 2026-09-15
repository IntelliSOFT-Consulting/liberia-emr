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
#   SYNC_PAYLOAD_ENCRYPTION  true; must match every facility's setting
#   COMPLEX_OBS_DIR          /opt/eip/complex-obs
#   LOG_LEVEL                INFO
#   JAVA_OPTS                JVM flags, e.g. -Xmx2g
set -eu
SYNC_ROLE="sync receiver"
. /app/sync-security.sh

: "${SYNC_PAYLOAD_ENCRYPTION:=true}"
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
export SYNC_PAYLOAD_ENCRYPTION COMPLEX_OBS_DIR LOG_LEVEL

mkdir -p "$COMPLEX_OBS_DIR"

# Substitute ONLY the declared variables: an unlisted variable stays literal instead of
# being silently blanked, and credential values are copied verbatim, never evaluated.
vars='${OPENMRS_DB_HOST} ${OPENMRS_DB_PORT} ${OPENMRS_DB_NAME} ${OPENMRS_DB_USER}
${OPENMRS_DB_PASSWORD} ${MGMT_DB_NAME} ${MGMT_DB_USER} ${MGMT_DB_PASSWORD}
${ARTEMIS_URL} ${OPENMRS_BASE_URL} ${OPENMRS_REST_USER} ${OPENMRS_REST_PASSWORD}
${SYNC_PAYLOAD_ENCRYPTION} ${PGP_PASSWORD} ${COMPLEX_OBS_DIR} ${LOG_LEVEL}'
umask 077
PGP_PASSWORD="$PGP_PASSWORD" envsubst "$vars" \
  < /app/receiver-application.properties.template > /app/config/application.properties
unset PGP_PASSWORD

# shellcheck disable=SC2086 # JAVA_OPTS and TLS_ARGS are deliberately word-split
exec java ${JAVA_OPTS:--Xmx2g} $TLS_ARGS -jar /app/receiver.jar \
  --spring.config.location=file:/app/config/application.properties
