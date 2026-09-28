-- mamba_dim_encounter_location: the ATTRIBUTION location of every live encounter (ADR 0010
-- decision 5, docs/reporting/README.md §2.3).
--
--   location_id = encounter.location_id, or visit.location_id when that is null.
--
-- Never the patient's address, identifier prefix or home facility, and never where the data
-- was entered. Every fact table takes its location_id from here, and its facility_location_id
-- from mamba_dim_location_hierarchy via this location_id, so the rule lives in one place.
-- encounter_location_id and visit_location_id are kept for auditing the fallback.
--
-- Maintained incrementally in both modes: rows whose encounter was voided or deleted, or whose
-- attribution changed (an edited encounter or visit location), are removed and re-added. A
-- full (drop-and-flatten) run starts from an empty table, because core drops every mamba_*
-- table first. Encounters with neither location stay out: they cannot be attributed.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_dim_encounter_location
(
    encounter_id          INT NOT NULL PRIMARY KEY,
    visit_id              INT NULL,
    encounter_location_id INT NULL,
    visit_location_id     INT NULL,
    location_id           INT NOT NULL,

    INDEX mamba_idx_visit_id (visit_id),
    INDEX mamba_idx_location_id (location_id)
);

DELETE el
FROM mamba_dim_encounter_location el
         LEFT JOIN mamba_source_db.encounter e ON e.encounter_id = el.encounter_id
         LEFT JOIN mamba_source_db.visit v ON v.visit_id = e.visit_id
WHERE e.encounter_id IS NULL
   OR e.voided = 1
   OR NOT (e.visit_id <=> el.visit_id)
   OR NOT (e.location_id <=> el.encounter_location_id)
   OR NOT (v.location_id <=> el.visit_location_id);

INSERT INTO mamba_dim_encounter_location (encounter_id, visit_id, encounter_location_id,
                                          visit_location_id, location_id)
SELECT e.encounter_id,
       e.visit_id,
       e.location_id,
       v.location_id,
       COALESCE(e.location_id, v.location_id)
FROM mamba_source_db.encounter e
         LEFT JOIN mamba_source_db.visit v ON v.visit_id = e.visit_id
         LEFT JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
WHERE e.voided = 0
  AND COALESCE(e.location_id, v.location_id) IS NOT NULL
  AND el.encounter_id IS NULL;

-- $END
