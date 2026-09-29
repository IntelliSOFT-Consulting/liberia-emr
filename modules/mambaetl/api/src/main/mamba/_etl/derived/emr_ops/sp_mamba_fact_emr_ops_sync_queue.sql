-- mamba_fact_emr_ops_sync_queue: what the facility's sync sender still has to deliver, as of
-- this ETL run (LE-354; EMR-OPS-005, "records not yet delivered after 48h"). One row per
-- pending row in the sender's two queues in openmrs_mgmt (openmrs-eip 4.2.0,
-- liquibase-watcher.xml):
--
--   queue_name = 'event'  debezium_event_queue: captured from the binlog, not yet published.
--                         date_created is the capture time.
--   queue_name = 'retry'  sender_retry_queue: publishing failed, waiting for a retry.
--                         date_created is when it FIRST FAILED (later than the capture), and
--                         date_changed the latest attempt.
--
-- The sender deletes a row as soon as it is delivered and keeps no history (sync-eip.md §5.8),
-- so this table is a stock, rebuilt in full on every run. A report computes ages against
-- mamba_fact_emr_ops_sync_status.sampled_at, not NOW(). Filter is_snapshot = 0 to leave out
-- the initial load.
--
-- METADATA ONLY. The ETL user is granted SELECT on these columns and no others
-- (distribution/compose/facility/initdb/30-etl-sync-queue-grant.sh): not identifier or
-- primary_key_id, which point at patient records, and not the retry queue's message, which
-- can quote record values. Any change to the column list here must change that grant too.
--
-- mamba_fact_emr_ops_sync_status says whether the queues could be read, so a report can tell
-- "nothing pending" from "not readable" (central, a stack without sync, a facility whose
-- sender has not created its tables yet, or a missing grant). The management schema is found
-- through the grant itself: the one schema in which this user can see the queue's columns.
-- It also carries sync_go_live_date, the facility's liberiaemr.sync.goLiveDate global
-- property (site package variable site.sync-go-live-date), or NULL when it is empty or not a
-- valid YYYY-MM-DD date. NULL means sync is not live here, and the backlog is not applicable.
--
-- Reads use READ COMMITTED, so the copy takes no shared locks on the sender's rows.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_emr_ops_sync_queue
(
    queue_name     VARCHAR(5)   NOT NULL,
    queue_row_id   BIGINT       NOT NULL,
    table_name     VARCHAR(100) NOT NULL,
    operation      CHAR(1)      NOT NULL,
    is_snapshot    TINYINT      NOT NULL,
    date_created   DATETIME(3)  NOT NULL,
    date_changed   DATETIME     NULL,
    attempt_count  INT          NULL,
    exception_type VARCHAR(255) NULL,

    PRIMARY KEY (queue_name, queue_row_id),
    INDEX mamba_idx_date_created (date_created)
);

CREATE TABLE IF NOT EXISTS mamba_fact_emr_ops_sync_status
(
    id                   TINYINT     NOT NULL PRIMARY KEY,
    sampled_at           DATETIME(3) NOT NULL,
    mgmt_schema          VARCHAR(64) NULL,
    event_queue_readable TINYINT     NOT NULL,
    retry_queue_readable TINYINT     NOT NULL,
    sync_go_live_date    DATE        NULL
);

SET @mamba_sync_sampled_at = NOW(3);

-- Parsed in a SET, not in the REPLACE below, so a malformed value becomes NULL with a warning
-- instead of failing the run. Date arithmetic is what rejects an impossible date: on MariaDB
-- 10.11 STR_TO_DATE, and CAST inside a subquery, both let 2026-02-31 through, and the strict
-- REPLACE then fails the run on it. It also turns 0000-00-00 into NULL.
SET @mamba_sync_go_live_date = (SELECT DATE(gp.property_value + INTERVAL 0 DAY)
                                FROM mamba_source_db.global_property gp
                                WHERE gp.property = 'liberiaemr.sync.goLiveDate'
                                  AND gp.property_value REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

SET @mamba_sync_mgmt_db = (SELECT MIN(TABLE_SCHEMA)
                           FROM information_schema.COLUMNS
                           WHERE TABLE_NAME = 'debezium_event_queue'
                             AND COLUMN_NAME = 'date_created');

SET @mamba_sync_event_readable = ((SELECT COUNT(*)
                                   FROM information_schema.COLUMNS
                                   WHERE TABLE_SCHEMA = @mamba_sync_mgmt_db
                                     AND TABLE_NAME = 'debezium_event_queue'
                                     AND COLUMN_NAME IN ('id', 'table_name', 'operation', 'snapshot',
                                                         'date_created')) = 5);

SET @mamba_sync_retry_readable = ((SELECT COUNT(*)
                                   FROM information_schema.COLUMNS
                                   WHERE TABLE_SCHEMA = @mamba_sync_mgmt_db
                                     AND TABLE_NAME = 'sender_retry_queue'
                                     AND COLUMN_NAME IN ('id', 'table_name', 'operation', 'snapshot',
                                                         'date_created', 'date_changed', 'attempt_count',
                                                         'exception_type')) = 8);

DELETE FROM mamba_fact_emr_ops_sync_queue;

IF @mamba_sync_event_readable THEN
    SET @mamba_sync_sql = CONCAT(
            'INSERT INTO mamba_fact_emr_ops_sync_queue ',
            '(queue_name, queue_row_id, table_name, operation, is_snapshot, date_created) ',
            'SELECT ''event'', q.id, q.table_name, q.operation, q.snapshot, q.date_created ',
            'FROM `', @mamba_sync_mgmt_db, '`.debezium_event_queue q');
    PREPARE mamba_sync_stmt FROM @mamba_sync_sql;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    EXECUTE mamba_sync_stmt;
    DEALLOCATE PREPARE mamba_sync_stmt;
END IF;

IF @mamba_sync_retry_readable THEN
    SET @mamba_sync_sql = CONCAT(
            'INSERT INTO mamba_fact_emr_ops_sync_queue ',
            '(queue_name, queue_row_id, table_name, operation, is_snapshot, date_created, date_changed, ',
            'attempt_count, exception_type) ',
            'SELECT ''retry'', q.id, q.table_name, q.operation, q.snapshot, q.date_created, q.date_changed, ',
            'q.attempt_count, q.exception_type ',
            'FROM `', @mamba_sync_mgmt_db, '`.sender_retry_queue q');
    PREPARE mamba_sync_stmt FROM @mamba_sync_sql;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    EXECUTE mamba_sync_stmt;
    DEALLOCATE PREPARE mamba_sync_stmt;
END IF;

REPLACE INTO mamba_fact_emr_ops_sync_status (id, sampled_at, mgmt_schema, event_queue_readable,
                                             retry_queue_readable, sync_go_live_date)
VALUES (1, @mamba_sync_sampled_at, @mamba_sync_mgmt_db, @mamba_sync_event_readable,
        @mamba_sync_retry_readable, @mamba_sync_go_live_date);

-- $END
