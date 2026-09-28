-- LE-363 override of core 3.0.0's procedure of the same name, which refreshes modified rows of
-- mamba_dim_patient_identifier. Core joins the modified keys, which are patient_identifier_id
-- values, to mamba_dim_patient_identifier.patient_id, and the source row on patient_id alone.
-- It so updates the identifiers of the wrong patient, copying one of that patient's
-- identifiers over all of them, and never refreshes the identifier that changed. With the
-- value comparison in sp_mamba_etl_incremental_columns_index_modified_insert, that row would
-- also stay selected, and be mis-applied, on every run. This version joins on the key.
--
-- Compiled after core's copy, so this definition is the one deployed.

-- $BEGIN

UPDATE mamba_dim_patient_identifier mpi
    INNER JOIN mamba_etl_incremental_columns_index_modified im
    ON mpi.patient_identifier_id = im.incremental_table_pkey
    INNER JOIN mamba_source_db.patient_identifier pi
    ON mpi.patient_identifier_id = pi.patient_identifier_id
SET mpi.patient_id         = pi.patient_id,
    mpi.identifier         = pi.identifier,
    mpi.identifier_type    = pi.identifier_type,
    mpi.preferred          = pi.preferred,
    mpi.location_id        = pi.location_id,
    mpi.patient_program_id = pi.patient_program_id,
    mpi.uuid               = pi.uuid,
    mpi.voided             = pi.voided,
    mpi.date_created       = pi.date_created,
    mpi.date_changed       = pi.date_changed,
    mpi.date_voided        = pi.date_voided,
    mpi.changed_by         = pi.changed_by,
    mpi.voided_by          = pi.voided_by,
    mpi.void_reason        = pi.void_reason,
    mpi.incremental_record = 1;

-- $END
