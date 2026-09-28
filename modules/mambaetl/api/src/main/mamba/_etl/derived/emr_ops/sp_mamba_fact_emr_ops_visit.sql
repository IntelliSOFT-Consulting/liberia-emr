-- mamba_fact_emr_ops_visit: one row per live visit (LE-333; EMR-OPS-015, "patients with two or
-- more visits in the period").
--
-- Core 3.0.0 has no visit dimension, and liberiaemrreports reads only the ETL schema (ADR 0010
-- decision 6), so the visit count needs this table. A visit counts even when its only encounter
-- is voided (fixtures: C-ANC4), so it is built from visit, not from encounters.
--
--   location_id           visit.location_id, falling back to the attribution location of the
--                         visit's first live encounter when the visit has none
--   facility_location_id  from mamba_dim_location_hierarchy
--
-- EMR-OPS-008 needs no table of its own: core's mamba_dim_encounter carries date_created and
-- encounter_datetime, and mamba_dim_encounter_location the attribution.
--
-- Incremental in both modes: rows whose visit was voided, deleted or edited are removed and
-- re-added, missing live visits are added, and facility is refreshed where it differs.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_emr_ops_visit
(
    visit_id             INT      NOT NULL PRIMARY KEY,
    client_id            INT      NOT NULL,
    visit_type_id        INT      NOT NULL,
    date_started         DATETIME NOT NULL,
    date_stopped         DATETIME NULL,
    visit_location_id    INT      NULL,
    location_id          INT      NULL,
    facility_location_id INT      NULL,
    date_created         DATETIME NOT NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_date_started (date_started),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

DELETE f
FROM mamba_fact_emr_ops_visit f
         LEFT JOIN mamba_source_db.visit v ON v.visit_id = f.visit_id
WHERE v.visit_id IS NULL
   OR v.voided = 1
   OR v.patient_id <> f.client_id
   OR v.visit_type_id <> f.visit_type_id
   OR v.date_started <> f.date_started
   OR NOT (v.date_stopped <=> f.date_stopped)
   OR NOT (v.location_id <=> f.visit_location_id)
   OR (v.location_id IS NULL AND f.location_id IS NULL);

INSERT INTO mamba_fact_emr_ops_visit (visit_id, client_id, visit_type_id, date_started, date_stopped,
                                      visit_location_id, location_id, date_created)
SELECT v.visit_id,
       v.patient_id,
       v.visit_type_id,
       v.date_started,
       v.date_stopped,
       v.location_id,
       COALESCE(v.location_id,
                (SELECT el.location_id
                 FROM mamba_dim_encounter_location el
                          INNER JOIN mamba_source_db.encounter e ON e.encounter_id = el.encounter_id
                 WHERE el.visit_id = v.visit_id
                 ORDER BY e.encounter_datetime, e.encounter_id
                 LIMIT 1)),
       v.date_created
FROM mamba_source_db.visit v
         LEFT JOIN mamba_fact_emr_ops_visit f ON f.visit_id = v.visit_id
WHERE v.voided = 0
  AND f.visit_id IS NULL;

UPDATE mamba_fact_emr_ops_visit f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

-- $END
