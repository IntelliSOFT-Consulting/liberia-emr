-- mamba_dim_emr_ops_encounter_type: every encounter type, with whether EMR-OPS-008 treats it as
-- a SYSTEM type (emr-ops.csv: "all clinical encounter types; exclude system ones").
--
--   is_system_type  1 for Check In, Check Out, Attachment Upload, Order, Lab Results, Bed
--                   Assignment, Cancel ADT and Transfer Request, by their variables; else 0
--
-- core's mamba_dim_encounter carries the encounter type and both timestamps EMR-OPS-008 compares
-- (date_created, encounter_datetime), but the reports read no UUID literal (ADR 0010 decision 7),
-- so the exclusion list lives here as a flag.
--
-- Rebuilt in full on every run: encounter types are metadata and few.
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_dim_emr_ops_encounter_type
(
    encounter_type_id INT          NOT NULL PRIMARY KEY,
    uuid              CHAR(38)     NOT NULL,
    name              VARCHAR(255) NOT NULL,
    retired           TINYINT(1)   NOT NULL,
    is_system_type    TINYINT(1)   NOT NULL,

    INDEX mamba_idx_is_system_type (is_system_type)
);

TRUNCATE TABLE mamba_dim_emr_ops_encounter_type;

INSERT INTO mamba_dim_emr_ops_encounter_type (encounter_type_id, uuid, name, retired, is_system_type)
SELECT et.encounter_type_id,
       et.uuid,
       et.name,
       et.retired,
       IF(et.uuid IN ('${var.encountertypes.check-in.uuid}',
                      '${var.encountertypes.check-out.uuid}',
                      '${var.encountertypes.attachment-upload.uuid}',
                      '${var.encountertypes.order.uuid}',
                      '${var.encountertypes.lab-results.uuid}',
                      '${var.encountertypes.bed-assignment.uuid}',
                      '${var.encountertypes.cancel-adt.uuid}',
                      '${var.encountertypes.transfer-request.uuid}'), 1, 0)
FROM mamba_source_db.encounter_type et;

-- $END
