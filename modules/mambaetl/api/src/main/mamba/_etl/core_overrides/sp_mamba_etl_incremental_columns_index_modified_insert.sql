-- LE-363 override of core 3.0.0's procedure of the same name. Core's incremental mode calls
-- it for every mamba_dim_* table and for mamba_z_encounter_obs to list the rows its
-- incremental update procedures must refresh from the source.
--
-- Core selects a row when date_changed, or date_voided or date_retired on a voided or retired
-- row, is >= the start of the last completed run. A void or edit made at a facility before
-- that moment but synced after it is never selected. This version keeps core's test and adds
-- a comparison by VALUE: a row already in the ETL table is also selected when any of
-- date_changed, voided, date_voided, retired or date_retired differs from the source. Only
-- the columns the ETL table has are compared, so the same code serves every table. Core's
-- update procedures copy all five back, so a selected row stops differing once refreshed.
--
-- A file without a body marker: the compiler copies it as written, after core's copy, so this
-- definition is the one deployed.

DROP PROCEDURE IF EXISTS sp_mamba_etl_incremental_columns_index_modified_insert;

DELIMITER //

CREATE PROCEDURE sp_mamba_etl_incremental_columns_index_modified_insert(
    IN mamba_table_name VARCHAR(255)
)
BEGIN
    DECLARE incremental_start_time DATETIME;
    DECLARE pkey_column VARCHAR(255);
    DECLARE drift_test TEXT;

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

    -- Core's test, unchanged.
    SET @mamba_modified_insert_sql = CONCAT(
            'INSERT IGNORE INTO mamba_etl_incremental_columns_index_modified (incremental_table_pkey) ',
            'SELECT DISTINCT incremental_table_pkey ',
            'FROM mamba_etl_incremental_columns_index_all ',
            'WHERE date_changed >= ?',
            ' OR (voided = 1 AND date_voided >= ?)',
            ' OR (retired = 1 AND date_retired >= ?)');

    PREPARE stmt FROM @mamba_modified_insert_sql;
    SET @mamba_modified_start_time = incremental_start_time;
    EXECUTE stmt USING @mamba_modified_start_time, @mamba_modified_start_time, @mamba_modified_start_time;
    DEALLOCATE PREPARE stmt;

    -- The value comparison, over the change markers this ETL table stores.
    SET drift_test = (SELECT GROUP_CONCAT(CONCAT('NOT (a.', COLUMN_NAME, ' <=> t.', COLUMN_NAME, ')')
                                          ORDER BY COLUMN_NAME SEPARATOR ' OR ')
                      FROM INFORMATION_SCHEMA.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = mamba_table_name
                        AND COLUMN_NAME IN ('date_changed', 'voided', 'date_voided', 'retired', 'date_retired'));

    IF drift_test IS NOT NULL AND pkey_column IS NOT NULL THEN
        SET @mamba_modified_drift_sql = CONCAT(
                'INSERT IGNORE INTO mamba_etl_incremental_columns_index_modified (incremental_table_pkey) ',
                'SELECT a.incremental_table_pkey ',
                'FROM mamba_etl_incremental_columns_index_all a ',
                'INNER JOIN ', mamba_table_name, ' t ON t.', pkey_column, ' = a.incremental_table_pkey ',
                'WHERE ', drift_test);

        PREPARE stmt FROM @mamba_modified_drift_sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

DELIMITER ;
