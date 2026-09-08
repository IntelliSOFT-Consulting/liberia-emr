#!/bin/sh
# Creates the sync layer's database principals. Runs ONCE, on the first boot of an empty
# data volume (see ../initdb/README.md); MariaDB executes it as root with this container's
# environment. This is exactly the initdb use case the README names: grants the
# application user cannot create for itself.
#
# Two principals, deliberately separate (sync-eip.md section 7):
#   - the Debezium account reads the binary log and nothing else writable; REPLICATION
#     privileges are global by nature, so it gets the minimum global set
#   - the management account owns only the sender's own schema (queues, offsets metadata)
#
# Both are gated on their password being set, so a stack that does not run the sync
# profile boots unchanged. For a database that already exists (initdb will not run
# again), execute these statements by hand once, with the same environment values.
set -eu

# SQL string-literal escaping for values interpolated below: double the single quotes and
# the backslashes. Without this, a quote in a generated password is injection into a root
# session, and the benign case aborts first-boot init half way, leaving a data volume
# that initdb will never touch again.
esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -n "${DEBEZIUM_DB_PASSWORD:-}" ]; then
  DBZ_USER="$(esc "${DEBEZIUM_DB_USER:-debezium}")"
  DBZ_PW="$(esc "${DEBEZIUM_DB_PASSWORD}")"
  mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${DBZ_USER}'@'%' IDENTIFIED BY '${DBZ_PW}';
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
  ON *.* TO '${DBZ_USER}'@'%';
SQL
  echo "initdb: created Debezium replication user '${DEBEZIUM_DB_USER:-debezium}'"
else
  echo "initdb: DEBEZIUM_DB_PASSWORD unset; skipping the Debezium user"
fi

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
  echo "initdb: created sync management schema '${MGMT_DB}'"
else
  echo "initdb: SYNC_MGMT_DB_PASSWORD unset; skipping the management schema"
fi
