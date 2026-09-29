#!/bin/sh
# Creates the OpenMRS application user and grants it ALL on the OpenMRS schema. Runs ONCE, on
# the first boot of an empty data volume; MariaDB executes it as root with this container's
# environment. It runs before the other scripts here, which grant this user more.
#
# This replaces the image's own MARIADB_USER/MARIADB_PASSWORD handling (LE-361). The image
# creates that user after it re-enables the binlog, with the facility's --log-bin, so its
# CREATE USER ... IDENTIFIED BY '<password>' reached the binlog in clear text, and stayed there
# for the whole retention period. The image still creates the database from MARIADB_DATABASE;
# that statement carries no secret. The compose file passes the operator's MYSQL_USER and
# MYSQL_PASSWORD in as OPENMRS_DB_USER and OPENMRS_DB_PASSWORD.
#
# Central has no binlog and uses an identical script, so both stacks create the user the same way.
set -eu

esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -z "${OPENMRS_DB_USER:-}" ] || [ -z "${OPENMRS_DB_PASSWORD:-}" ]; then
  echo "initdb: OPENMRS_DB_USER or OPENMRS_DB_PASSWORD unset; skipping the OpenMRS application user" >&2
  exit 0
fi

DB="${MARIADB_DATABASE:-openmrs}"
case "$DB" in
  *[!A-Za-z0-9_]*) echo "initdb: MARIADB_DATABASE must be alphanumeric/underscore" >&2; exit 1 ;;
esac
# As the image does: `_` is a wildcard in a grant's schema name, so escape it.
DB_GRANT="$(printf %s "$DB" | sed 's/_/\\_/g')"
APP_USER="$(esc "${OPENMRS_DB_USER}")"
APP_PW="$(esc "${OPENMRS_DB_PASSWORD}")"

mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
-- Keep the password out of the binlog. Nothing downstream replays account statements: the
-- binlog's one reader is the sync sender's Debezium engine, which reads OpenMRS table rows.
SET SESSION sql_log_bin = 0;
CREATE USER IF NOT EXISTS '${APP_USER}'@'%' IDENTIFIED BY '${APP_PW}';
GRANT ALL ON \`${DB_GRANT}\`.* TO '${APP_USER}'@'%';
SQL
echo "initdb: created the OpenMRS application user '${OPENMRS_DB_USER}' on '${DB}'"
