#!/bin/sh
# Creates the reporting ETL schema and its database principal (ADR 0010 decision 3). Runs
# ONCE, on the first boot of an empty data volume; MariaDB executes it as root with this
# container's environment. The facility's 20-etl-db-user.sh is the same minus the identity grant.
#
# The ETL user (mamba-etl-liberiaemr, mambaetl.analysis.db.username) gets:
#   - ALL on liberiaemr_etl, which it builds and rebuilds: tables, routines, events;
#   - SELECT on the OpenMRS schema, which it flattens and never writes;
#   - SELECT on performance_schema.events_statements_current, which core's stuck-run check
#     (sp_mamba_etl_un_stuck_scheduler) reads on every scheduled run.
# No SUPER. Its two uses are replaced by server flags in docker-compose.yml:
# --event-scheduler=ON (central has no binlog, so it needs no --log-bin-trust-function-creators).
#
# The OpenMRS user gets SELECT on liberiaemr_etl: the reports module queries the ETL schema
# over the OpenMRS connection.
#
# Gated on ETL_DB_PASSWORD, so a stack without it boots unchanged and the module only logs
# that it could not deploy. There is deliberately no fallback to the OpenMRS user, which holds
# ALL on the clinical schema. For a database that already exists (initdb will not run again),
# execute these statements by hand once, with the same environment values.
set -eu

esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -z "${ETL_DB_PASSWORD:-}" ]; then
  echo "initdb: ETL_DB_PASSWORD unset; skipping the reporting ETL user and schema"
  exit 0
fi

SRC_DB="${MARIADB_DATABASE:-openmrs}"
case "$SRC_DB" in
  *[!A-Za-z0-9_]*) echo "initdb: MARIADB_DATABASE must be alphanumeric/underscore" >&2; exit 1 ;;
esac
ETL_USER="$(esc "${ETL_DB_USER:-mambaetl}")"
ETL_PW="$(esc "${ETL_DB_PASSWORD}")"

mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
-- Keep the ETL password out of the binlog, where CREATE USER would log it in clear text
-- for the whole retention period. Nothing downstream replays account statements.
SET SESSION sql_log_bin = 0;
CREATE DATABASE IF NOT EXISTS \`liberiaemr_etl\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${ETL_USER}'@'%' IDENTIFIED BY '${ETL_PW}';
GRANT ALL PRIVILEGES ON \`liberiaemr_etl\`.* TO '${ETL_USER}'@'%';
GRANT SELECT ON \`${SRC_DB}\`.* TO '${ETL_USER}'@'%';
GRANT SELECT ON \`performance_schema\`.\`events_statements_current\` TO '${ETL_USER}'@'%';
-- Central only: mamba_dim_person_cpi counts each person once by primary CPI, which lives in
-- the identity schema 20-identity-db.sh creates. Schema-level, because the liberiaemr module
-- creates its tables later and a table-level grant needs the table to exist.
GRANT SELECT ON \`openmrs_identity\`.* TO '${ETL_USER}'@'%';
SQL
echo "initdb: created the reporting ETL user '${ETL_DB_USER:-mambaetl}' and schema 'liberiaemr_etl'"

if [ -n "${OPENMRS_DB_USER:-}" ]; then
  mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
SET SESSION sql_log_bin = 0;
GRANT SELECT ON \`liberiaemr_etl\`.* TO '$(esc "${OPENMRS_DB_USER}")'@'%';
SQL
  echo "initdb: granted '${OPENMRS_DB_USER}' read access to 'liberiaemr_etl'"
fi
