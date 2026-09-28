-- mamba_dim_encounter_form (docs/reporting/README.md §2.3): the form each encounter was
-- entered on.
--
-- Core flattens per ENCOUNTER TYPE, and several forms share one (the five national forms on
-- Consultation, for example). A fact that must count one form joins this table and filters
-- form_uuid on that form's var.form.* tokens, EVERY version of the form included: a new
-- form version is a new form uuid.
--
-- Maintained incrementally in both modes: rows whose encounter was voided, deleted or moved
-- to another form are removed, and every live encounter with a form that is not yet here is
-- added. A full (drop-and-flatten) run starts from an empty table, because core drops every
-- mamba_* table first.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_dim_encounter_form
(
    encounter_id INT      NOT NULL PRIMARY KEY,
    form_id      INT      NOT NULL,
    form_uuid    CHAR(38) NOT NULL,

    INDEX mamba_idx_form_id (form_id),
    INDEX mamba_idx_form_uuid (form_uuid)
);

DELETE ef
FROM mamba_dim_encounter_form ef
         LEFT JOIN mamba_source_db.encounter e ON e.encounter_id = ef.encounter_id
WHERE e.encounter_id IS NULL
   OR e.voided = 1
   OR e.form_id IS NULL
   OR e.form_id <> ef.form_id;

INSERT INTO mamba_dim_encounter_form (encounter_id, form_id, form_uuid)
SELECT e.encounter_id, e.form_id, f.uuid
FROM mamba_source_db.encounter e
         INNER JOIN mamba_source_db.form f ON f.form_id = e.form_id
         LEFT JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
WHERE e.voided = 0
  AND ef.encounter_id IS NULL;

-- $END
