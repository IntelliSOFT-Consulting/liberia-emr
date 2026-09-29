#!/bin/sh
# Lets the reporting ETL user read the sync sender's queue METADATA (LE-354, EMR-OPS-005).
# Runs ONCE, on the first boot of an empty data volume, as root, after 10-sync-db-users.sh
# (the management schema) and 20-etl-db-user.sh (the ETL user).
#
# What is granted: column-level SELECT on the two sender queues in the management schema,
# the columns that sp_mamba_fact_emr_ops_sync_queue copies and nothing else. Not
# identifier or primary_key_id, which point at patient records, and not the retry
# queue's message, which can quote record values. The column list is openmrs-eip 4.2.0's
# (liquibase-watcher.xml, sync.eip in distro.properties): recheck it on every sync.eip bump.
#
# Why the ETL user and not the OpenMRS user: reports read only the ETL schema (ADR 0010
# decision 6), and the OpenMRS user is the web application's credential, with ALL on the
# clinical schema. The ETL user already reads that schema, and what it writes stays in
# liberiaemr_etl, which is out of the binlog and never synced.
#
# Why an event: the queue tables do not exist yet. The sender creates them through its own
# liquibase on its first start, which is after this script runs, and MariaDB refuses a
# table or column grant on a missing table (ERROR 1146). Creating dbsync's tables here
# instead would make this script a second owner of their DDL. So this script leaves a
# root-owned event that checks once a minute, grants as soon as every column exists, and
# then drops itself. If a sync.eip bump renames a column, the event keeps waiting and the
# ETL's mamba_fact_emr_ops_sync_status shows the queue as not readable.
#
# Nothing here reaches the binlog (sql_log_bin = 0 in this session and inside the event),
# so the account statements are not shipped anywhere, as in 20-etl-db-user.sh.
#
# Gated on both SYNC_MGMT_DB_PASSWORD and ETL_DB_PASSWORD. For a database that already
# exists (initdb will not run again), run this script by hand once, with the same
# environment values:
#   docker compose exec db sh /docker-entrypoint-initdb.d/30-etl-sync-queue-grant.sh
# If the sender has already created its tables, the grant lands within a minute.
set -eu

esc() {
  printf %s "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if [ -z "${SYNC_MGMT_DB_PASSWORD:-}" ] || [ -z "${ETL_DB_PASSWORD:-}" ]; then
  echo "initdb: SYNC_MGMT_DB_PASSWORD or ETL_DB_PASSWORD unset; skipping the ETL sync-queue grant"
  exit 0
fi

MGMT_DB="${SYNC_MGMT_DB_NAME:-openmrs_mgmt}"
case "$MGMT_DB" in
  *[!A-Za-z0-9_]*) echo "initdb: SYNC_MGMT_DB_NAME must be alphanumeric/underscore" >&2; exit 1 ;;
esac
ETL_USER="$(esc "${ETL_DB_USER:-mambaetl}")"

mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
SET SESSION sql_log_bin = 0;
DROP EVENT IF EXISTS \`${MGMT_DB}\`.\`liberiaemr_etl_sync_queue_grant\`;
DELIMITER //
CREATE DEFINER = CURRENT_USER EVENT \`${MGMT_DB}\`.\`liberiaemr_etl_sync_queue_grant\`
  ON SCHEDULE EVERY 1 MINUTE
  COMMENT 'LE-354: grants the ETL user the sender queue metadata columns once they exist, then drops itself'
  DO
  BEGIN
    IF (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '${MGMT_DB}'
          AND ((TABLE_NAME = 'debezium_event_queue'
                AND COLUMN_NAME IN ('id', 'table_name', 'operation', 'snapshot', 'date_created'))
            OR (TABLE_NAME = 'sender_retry_queue'
                AND COLUMN_NAME IN ('id', 'table_name', 'operation', 'snapshot', 'date_created',
                                    'date_changed', 'attempt_count', 'exception_type')))) = 13 THEN
      SET SESSION sql_log_bin = 0;
      GRANT SELECT (id, table_name, operation, snapshot, date_created)
        ON \`${MGMT_DB}\`.\`debezium_event_queue\` TO '${ETL_USER}'@'%';
      GRANT SELECT (id, table_name, operation, snapshot, date_created, date_changed, attempt_count,
                    exception_type)
        ON \`${MGMT_DB}\`.\`sender_retry_queue\` TO '${ETL_USER}'@'%';
      DROP EVENT IF EXISTS \`${MGMT_DB}\`.\`liberiaemr_etl_sync_queue_grant\`;
    END IF;
  END //
DELIMITER ;
SQL
echo "initdb: '${ETL_DB_USER:-mambaetl}' gets the sender queue metadata in '${MGMT_DB}' once the sender has created it"
