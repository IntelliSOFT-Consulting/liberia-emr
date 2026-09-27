#!/bin/sh
# Creates the reporting ETL schema and its database principal (ADR 0010 decision 3). Runs
# ONCE, on the first boot of an empty data volume; MariaDB executes it as root with this
# container's environment. The same script ships as the facility's 20-etl-db-user.sh.
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
CREATE DATABASE IF NOT EXISTS \`liberiaemr_etl\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${ETL_USER}'@'%' IDENTIFIED BY '${ETL_PW}';
GRANT ALL PRIVILEGES ON \`liberiaemr_etl\`.* TO '${ETL_USER}'@'%';
GRANT SELECT ON \`${SRC_DB}\`.* TO '${ETL_USER}'@'%';
GRANT SELECT ON \`performance_schema\`.\`events_statements_current\` TO '${ETL_USER}'@'%';
SQL
echo "initdb: created the reporting ETL user '${ETL_DB_USER:-mambaetl}' and schema 'liberiaemr_etl'"

if [ -n "${MARIADB_USER:-}" ]; then
  mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
GRANT SELECT ON \`liberiaemr_etl\`.* TO '$(esc "${MARIADB_USER}")'@'%';
SQL
  echo "initdb: granted '${MARIADB_USER}' read access to 'liberiaemr_etl'"
fi
