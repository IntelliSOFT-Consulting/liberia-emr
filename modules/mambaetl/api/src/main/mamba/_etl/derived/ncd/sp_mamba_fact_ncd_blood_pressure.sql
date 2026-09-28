-- mamba_fact_ncd_blood_pressure: one row per live encounter holding a live blood-pressure
-- reading (LE-333; NCD-007).
--
-- BP is recorded on several encounter types: Triage and the OPD Consultation Form, the O3
-- vitals app (Vitals), and all three ANC forms. The ANC forms use local concepts that duplicate
-- CIEL 5085/5086 (LE-346), so this fact UNIONS both pairs:
--
--   systolic   CIEL 5085 or local "Blood Pressure (Systolic)"  (national.blood-pressure-systolic)
--   diastolic  CIEL 5086 or local "Blood Pressure (Diastolic)" (national.blood-pressure-diastolic)
--
-- It reads obs directly rather than per-encounter-type flat tables, so one table covers every
-- type (the Triage and OPD form variables do not hold the runtime form uuids, LE-344).
--
-- Within an encounter, each measure is the latest live obs (obs_datetime, then obs_id), so a
-- corrected reading replaces the voided one. SBP and DBP are paired by encounter.
--
--   reading_at     the later obs_datetime of the pair
--   bp_source      ciel, anc_local, or mixed
--   is_raised      SBP >= 140 or DBP >= 90 (either may be NULL)
--   encounter_type_id  kept so a report can exclude ANC encounters (pregnancy) if the MOH asks
--
-- Attribution: mamba_dim_encounter_location. Incremental in both modes: encounters with BP obs
-- above an obs_id watermark (mamba_fact_ncd_etl_state), encounters whose stored obs was voided or
-- deleted, and encounters that were voided or whose attribution changed are rebuilt.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_ncd_blood_pressure
(
    encounter_id         INT         NOT NULL PRIMARY KEY,
    visit_id             INT         NULL,
    client_id            INT         NOT NULL,
    encounter_type_id    INT         NOT NULL,
    encounter_datetime   DATETIME    NOT NULL,
    reading_at           DATETIME    NOT NULL,
    location_id          INT         NOT NULL,
    facility_location_id INT         NULL,
    systolic             DOUBLE      NULL,
    diastolic            DOUBLE      NULL,
    systolic_obs_id      INT         NULL,
    diastolic_obs_id     INT         NULL,
    bp_source            VARCHAR(10) NOT NULL,
    is_raised            TINYINT(1)  NOT NULL DEFAULT 0,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_reading_at (reading_at),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

CREATE TABLE IF NOT EXISTS mamba_fact_ncd_etl_state
(
    state_key   VARCHAR(64) NOT NULL PRIMARY KEY,
    state_value BIGINT      NOT NULL
);

SET @bp_sbp = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.5085.uuid}');
SET @bp_dbp = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.5086.uuid}');
SET @bp_sbp_anc = (SELECT concept_id FROM mamba_source_db.concept
                   WHERE uuid = '${var.concept.national.blood-pressure-systolic.uuid}');
SET @bp_dbp_anc = (SELECT concept_id FROM mamba_source_db.concept
                   WHERE uuid = '${var.concept.national.blood-pressure-diastolic.uuid}');

-- Watermark on obs_id, read back with a margin (see mamba_fact_malaria_lab_result).
SET @bp_max_obs = GREATEST(COALESCE((SELECT state_value FROM mamba_fact_ncd_etl_state
                                     WHERE state_key = 'blood_pressure.obs.obs_id'), 0) - 1000, 0);
SET @bp_new_max_obs = COALESCE((SELECT MAX(obs_id) FROM mamba_source_db.obs), 0);

-- ---- the encounters to rebuild ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_bp_enc;
CREATE TEMPORARY TABLE mamba_tmp_bp_enc
(
    encounter_id INT NOT NULL PRIMARY KEY
);

INSERT IGNORE INTO mamba_tmp_bp_enc (encounter_id)
SELECT DISTINCT o.encounter_id
FROM mamba_source_db.obs o
WHERE o.obs_id > @bp_max_obs
  AND o.obs_id <= @bp_new_max_obs
  AND o.concept_id IN (@bp_sbp, @bp_dbp, @bp_sbp_anc, @bp_dbp_anc)
  AND o.encounter_id IS NOT NULL;

INSERT IGNORE INTO mamba_tmp_bp_enc (encounter_id)
SELECT f.encounter_id
FROM mamba_fact_ncd_blood_pressure f
         LEFT JOIN mamba_source_db.obs s ON s.obs_id = f.systolic_obs_id
         LEFT JOIN mamba_source_db.obs d ON d.obs_id = f.diastolic_obs_id
         LEFT JOIN mamba_dim_encounter_location el ON el.encounter_id = f.encounter_id
         LEFT JOIN mamba_source_db.encounter e ON e.encounter_id = f.encounter_id
WHERE (f.systolic_obs_id IS NOT NULL AND (s.obs_id IS NULL OR s.voided = 1))
   OR (f.diastolic_obs_id IS NOT NULL AND (d.obs_id IS NULL OR d.voided = 1))
   OR el.encounter_id IS NULL
   OR NOT (el.location_id <=> f.location_id)
   OR NOT (el.visit_id <=> f.visit_id)
   OR NOT (e.encounter_datetime <=> f.encounter_datetime);

DELETE f
FROM mamba_fact_ncd_blood_pressure f
         INNER JOIN mamba_tmp_bp_enc a ON a.encounter_id = f.encounter_id;

-- ---- rebuild: latest live obs per measure per encounter, paired ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_bp_pair;
CREATE TEMPORARY TABLE mamba_tmp_bp_pair
(
    encounter_id     INT        NOT NULL PRIMARY KEY,
    systolic         DOUBLE     NULL,
    diastolic        DOUBLE     NULL,
    systolic_obs_id  INT        NULL,
    diastolic_obs_id INT        NULL,
    reading_at       DATETIME   NOT NULL,
    n_anc_local      INT        NOT NULL,
    n_measures       INT        NOT NULL
);

INSERT INTO mamba_tmp_bp_pair (encounter_id, systolic, diastolic, systolic_obs_id, diastolic_obs_id, reading_at,
                               n_anc_local, n_measures)
SELECT x.encounter_id,
       MAX(IF(x.measure = 'sbp', x.value_numeric, NULL)),
       MAX(IF(x.measure = 'dbp', x.value_numeric, NULL)),
       MAX(IF(x.measure = 'sbp', x.obs_id, NULL)),
       MAX(IF(x.measure = 'dbp', x.obs_id, NULL)),
       MAX(x.obs_datetime),
       SUM(x.is_anc_local),
       COUNT(*)
FROM (SELECT o.encounter_id,
             IF(o.concept_id IN (@bp_sbp, @bp_sbp_anc), 'sbp', 'dbp') AS measure,
             o.obs_id,
             o.obs_datetime,
             o.value_numeric,
             IF(o.concept_id IN (@bp_sbp_anc, @bp_dbp_anc), 1, 0)     AS is_anc_local,
             ROW_NUMBER() OVER (PARTITION BY o.encounter_id, IF(o.concept_id IN (@bp_sbp, @bp_sbp_anc), 'sbp', 'dbp')
                 ORDER BY o.obs_datetime DESC, o.obs_id DESC)         AS rn
      FROM mamba_tmp_bp_enc a
               INNER JOIN mamba_source_db.obs o ON o.encounter_id = a.encounter_id
      WHERE o.voided = 0
        AND o.value_numeric IS NOT NULL
        AND o.concept_id IN (@bp_sbp, @bp_dbp, @bp_sbp_anc, @bp_dbp_anc)) x
WHERE x.rn = 1
GROUP BY x.encounter_id;

INSERT INTO mamba_fact_ncd_blood_pressure (encounter_id, visit_id, client_id, encounter_type_id,
                                           encounter_datetime, reading_at, location_id, facility_location_id,
                                           systolic, diastolic, systolic_obs_id, diastolic_obs_id, bp_source,
                                           is_raised)
SELECT e.encounter_id,
       el.visit_id,
       e.patient_id,
       e.encounter_type,
       e.encounter_datetime,
       p.reading_at,
       el.location_id,
       h.facility_location_id,
       p.systolic,
       p.diastolic,
       p.systolic_obs_id,
       p.diastolic_obs_id,
       CASE
           WHEN p.n_anc_local = 0 THEN 'ciel'
           WHEN p.n_anc_local = p.n_measures THEN 'anc_local'
           ELSE 'mixed'
           END,
       IF(COALESCE(p.systolic >= 140, 0) OR COALESCE(p.diastolic >= 90, 0), 1, 0)
FROM mamba_tmp_bp_pair p
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = p.encounter_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
         LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = el.location_id;

INSERT INTO mamba_fact_ncd_etl_state (state_key, state_value)
VALUES ('blood_pressure.obs.obs_id', @bp_new_max_obs)
ON DUPLICATE KEY UPDATE state_value = VALUES(state_value);

UPDATE mamba_fact_ncd_blood_pressure f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_bp_pair;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_bp_enc;

-- $END
