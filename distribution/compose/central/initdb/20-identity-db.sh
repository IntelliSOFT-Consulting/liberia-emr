#!/bin/sh
# Creates the identity schema (sync-eip.md 2.5.3), ONCE, on the first boot of an empty data
# volume. It holds the Central Person Identifier and the link table, apart from the OpenMRS
# replica the sync receiver maintains, so identity never changes a replicated row. The EMR's
# own account is its only writer; the liberiaemr module creates the tables with liquibase.
# On an existing database run these statements by hand once.
set -eu

esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -n "${MARIADB_USER:-}" ]; then
  mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`openmrs_identity\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`openmrs_identity\`.* TO '$(esc "${MARIADB_USER}")'@'%';
SQL
  echo "initdb: created the identity schema 'openmrs_identity'"
else
  echo "initdb: MARIADB_USER unset; skipping the identity schema"
fi
