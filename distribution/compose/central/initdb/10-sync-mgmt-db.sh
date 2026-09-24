#!/bin/sh
# Creates the sync receiver's management schema and its principal, ONCE, on the first
# boot of an empty data volume (see README.md). Gated on the password being set; on an
# existing database run these statements by hand once. Tables are dbsync's own
# liquibase, never this script's.
set -eu

# SQL string-literal escaping for interpolated values: double the single quotes and the
# backslashes, so a generated password cannot break or inject into this root session.
esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -n "${SYNC_MGMT_DB_PASSWORD:-}" ]; then
  MGMT_DB="${SYNC_MGMT_DB_NAME:-openmrs_mgmt}"
  case "$MGMT_DB" in
    *[!A-Za-z0-9_]*) echo "initdb: SYNC_MGMT_DB_NAME must be alphanumeric/underscore" >&2; exit 1 ;;
  esac
  MGMT_USER="$(esc "${SYNC_MGMT_DB_USER:-dbsync_mgmt}")"
  MGMT_PW="$(esc "${SYNC_MGMT_DB_PASSWORD}")"
  mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MGMT_DB}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MGMT_USER}'@'%' IDENTIFIED BY '${MGMT_PW}';
GRANT ALL PRIVILEGES ON \`${MGMT_DB}\`.* TO '${MGMT_USER}'@'%';
SQL
  # The EMR reads the conflict queue for its Sync conflicts page, and never writes to it.
  if [ -n "${MARIADB_USER:-}" ]; then
    mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
GRANT SELECT ON \`${MGMT_DB}\`.* TO '$(esc "${MARIADB_USER}")'@'%';
SQL
  fi
  echo "initdb: created sync management schema '${MGMT_DB}'"
else
  echo "initdb: SYNC_MGMT_DB_PASSWORD unset; skipping the management schema"
fi
