-- LE-363 override of core 3.0.0's procedure of the same name, which fills mamba_dim_encounter
-- in a full (drop-and-flatten) run. Core's copy keeps only encounters whose type has a flat
-- table (mamba_concept_metadata), while its incremental insert keeps every type. With no
-- flat-table configs, a full run therefore left mamba_dim_encounter empty, and incremental
-- runs then added only the encounters new since. This version keeps every encounter whose
-- type is known, exactly as the incremental insert does, so both modes build the same table.
-- Flat tables are unaffected: they select their own encounter types.
--
-- Compiled after core's copy, so this definition is the one deployed.

-- $BEGIN

INSERT INTO mamba_dim_encounter (encounter_id,
                                 uuid,
                                 encounter_type,
                                 encounter_type_uuid,
                                 patient_id,
                                 visit_id,
                                 encounter_datetime,
                                 date_created,
                                 date_changed,
                                 changed_by,
                                 date_voided,
                                 voided,
                                 voided_by,
                                 void_reason)
SELECT e.encounter_id,
       e.uuid,
       e.encounter_type,
       et.uuid,
       e.patient_id,
       e.visit_id,
       e.encounter_datetime,
       e.date_created,
       e.date_changed,
       e.changed_by,
       e.date_voided,
       e.voided,
       e.voided_by,
       e.void_reason
FROM mamba_source_db.encounter e
         INNER JOIN mamba_dim_encounter_type et
                    ON e.encounter_type = et.encounter_type_id;

-- $END
