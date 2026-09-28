-- LE-363 override of core 3.0.0's procedure of the same name. Core's incremental mode calls
-- it for every mamba_dim_* table and for mamba_z_encounter_obs, through
-- sp_mamba_etl_incremental_columns_index(openmrs_table, mamba_table), to list the source rows
-- the incremental insert procedures must add.
--
-- Core selects a row when date_created >= the start of the last completed run and its key is
-- not yet in the ETL table. dbsync keeps a facility's original date_created, so at central a
-- record that syncs after a run started is never selected; neither is back-dated data. This
-- version selects by ARRIVAL instead: a row is new when its key is not in the ETL table and
--
--   * its key is above the highest key this table saw on its previous run, less a margin
--     (dbsync and every OpenMRS insert take a fresh AUTO_INCREMENT key, whatever
--     date_created says); or
--   * core's own test holds (date_created >= the last run's start); or
--   * this is a sweep run: no state yet (the first incremental run after a full one, whose
--     drop removes the state table) or the last sweep is over a day old. A sweep drops the
--     key bound, so anything the margin missed is caught within a day.
--
-- The margin covers a key allocated before the last run read the table but committed after
-- it. Re-selecting a row that the insert procedure filters out (obs of an unconfigured
-- concept, a non-preferred concept name) costs one join and inserts nothing.
--
-- State: mamba_etl_liberia_incremental_state, one row per ETL table. Its mamba_ prefix makes
-- a full run drop it with everything else.
--
-- A file without a body marker: the compiler copies it as written, after core's copy, so this
-- definition is the one deployed.

DROP PROCEDURE IF EXISTS sp_mamba_etl_incremental_columns_index_new_insert;

DELIMITER //

CREATE PROCEDURE sp_mamba_etl_incremental_columns_index_new_insert(
    IN mamba_table_name VARCHAR(255)
)
BEGIN
    DECLARE incremental_start_time DATETIME;
    DECLARE pkey_column VARCHAR(255);
    DECLARE prev_max_pkey BIGINT;
    DECLARE prev_sweep_time DATETIME;
    DECLARE key_floor BIGINT;
    DECLARE is_sweep TINYINT(1) DEFAULT 0;
    DECLARE new_rows BIGINT DEFAULT 0;

    -- Keys at or above (last run's highest key - margin) are always re-examined.
    DECLARE key_margin BIGINT DEFAULT 10000;

    SELECT COLUMN_NAME
    INTO pkey_column
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = mamba_table_name
      AND COLUMN_KEY = 'PRI'
    LIMIT 1;

    SET incremental_start_time = (SELECT start_time
                                  FROM _mamba_etl_schedule sch
                                  WHERE end_time IS NOT NULL
                                    AND transaction_status = 'COMPLETED'
                                  ORDER BY id DESC
                                  LIMIT 1);

    CREATE TABLE IF NOT EXISTS mamba_etl_liberia_incremental_state
    (
        etl_table        VARCHAR(64) NOT NULL PRIMARY KEY,
        max_pkey_seen    BIGINT      NOT NULL,
        last_sweep_time  DATETIME    NULL,
        last_run_time    DATETIME    NOT NULL,
        last_run_sweep   TINYINT(1)  NOT NULL,
        last_run_new     BIGINT      NOT NULL
    );

    SET prev_max_pkey = (SELECT max_pkey_seen
                         FROM mamba_etl_liberia_incremental_state
                         WHERE etl_table = mamba_table_name
                         LIMIT 1);
    SET prev_sweep_time = (SELECT last_sweep_time
                           FROM mamba_etl_liberia_incremental_state
                           WHERE etl_table = mamba_table_name
                           LIMIT 1);

    IF prev_max_pkey IS NULL OR prev_sweep_time IS NULL OR prev_sweep_time < NOW() - INTERVAL 1 DAY THEN
        SET is_sweep = 1;
        SET key_floor = -1;
    ELSE
        SET key_floor = prev_max_pkey - key_margin;
    END IF;

    SET @mamba_new_insert_sql = CONCAT(
            'INSERT INTO mamba_etl_incremental_columns_index_new (incremental_table_pkey) ',
            'SELECT a.incremental_table_pkey ',
            'FROM mamba_etl_incremental_columns_index_all a ',
            'LEFT JOIN ', mamba_table_name, ' t ON t.', pkey_column, ' = a.incremental_table_pkey ',
            'WHERE t.', pkey_column, ' IS NULL ',
            'AND (a.incremental_table_pkey > ? OR a.date_created >= ?)');

    PREPARE stmt FROM @mamba_new_insert_sql;
    SET @mamba_new_key_floor = key_floor;
    SET @mamba_new_start_time = incremental_start_time;
    EXECUTE stmt USING @mamba_new_key_floor, @mamba_new_start_time;
    SET new_rows = ROW_COUNT();
    DEALLOCATE PREPARE stmt;

    INSERT INTO mamba_etl_liberia_incremental_state (etl_table, max_pkey_seen, last_sweep_time,
                                              last_run_time, last_run_sweep, last_run_new)
    SELECT mamba_table_name,
           COALESCE(MAX(a.incremental_table_pkey), 0),
           IF(is_sweep = 1, NOW(), prev_sweep_time),
           NOW(),
           is_sweep,
           new_rows
    FROM mamba_etl_incremental_columns_index_all a
    ON DUPLICATE KEY UPDATE max_pkey_seen   = VALUES(max_pkey_seen),
                            last_sweep_time = VALUES(last_sweep_time),
                            last_run_time   = VALUES(last_run_time),
                            last_run_sweep  = VALUES(last_run_sweep),
                            last_run_new    = VALUES(last_run_new);
END //

DELIMITER ;
