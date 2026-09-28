-- mamba_fact_ncd_death: one row per dead patient (LE-333; malaria-ncd-gaps.md §2 "Death fact").
-- Serves NCD-002 and NCD-017's denominator, MAL-018 and the RMNCAH under-5 deaths.
--
-- A death is recorded only through "Mark patient deceased" (person.dead, death_date,
-- cause_of_death). It has no encounter and no location, so:
--
--   location_id           the location of the patient's LAST live visit started on or before
--                         the death day (the latest visit if none is), falling back to that visit's
--                         last encounter's attribution location when the visit has none.
--                         NULL when the patient has no visit at all: such a death cannot be
--                         attributed.
--   cause_group           the coded cause of death. concept.causeOfDeath has only six answers
--                         (LE-348): cancer (Neoplasm/cancer), infectious, trauma, unnatural,
--                         other, unknown. NULL when the cause is not coded.
--   proxy_icd10_group     the ICD-10 group of the patient's last live coded diagnosis on or
--   proxy_icd10_code      before the death day (mamba_fact_malaria_diagnosis). A PROXY, not the
--                         underlying cause.
--   age_*_at_death        completed years, months and days (TIMESTAMPDIFF) at death_date.
--
-- Incremental in both modes: the current state of every dead patient is computed (deaths are
-- few), rows that differ from it or are gone are removed, and the rest are added. Late-synced
-- visits at central therefore move a death's attribution on the next run.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime. Depends on
-- mamba_fact_malaria_diagnosis (malaria section, which runs first).

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_ncd_death
(
    client_id                  INT          NOT NULL PRIMARY KEY,
    death_date                 DATETIME     NULL,
    birthdate                  DATE         NULL,
    gender                     VARCHAR(50)  NULL,
    age_years_at_death         INT          NULL,
    age_months_at_death        INT          NULL,
    age_days_at_death          INT          NULL,
    cause_of_death_concept_id  INT          NULL,
    cause_of_death_non_coded   VARCHAR(255) NULL,
    cause_group                VARCHAR(20)  NULL,
    last_visit_id              INT          NULL,
    last_visit_started         DATETIME     NULL,
    location_id                INT          NULL,
    facility_location_id       INT          NULL,
    proxy_diagnosis_id         INT          NULL,
    proxy_icd10_code           VARCHAR(50)  NULL,
    proxy_icd10_group          VARCHAR(20)  NULL,

    INDEX mamba_idx_death_date (death_date),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_cause_group (cause_group)
);

SET @dth_cancer = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.116030.uuid}');
SET @dth_infectious = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.151673.uuid}');
SET @dth_trauma = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.124193.uuid}');
SET @dth_unnatural = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.166078.uuid}');
SET @dth_other = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.5622.uuid}');
SET @dth_unknown = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.1067.uuid}');

-- ---- the current state of every dead patient ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dth;
CREATE TEMPORARY TABLE mamba_tmp_dth
(
    client_id                 INT          NOT NULL PRIMARY KEY,
    death_date                DATETIME     NULL,
    birthdate                 DATE         NULL,
    gender                    VARCHAR(50)  NULL,
    cause_of_death_concept_id INT          NULL,
    cause_of_death_non_coded  VARCHAR(255) NULL,
    last_visit_id             INT          NULL,
    last_visit_started        DATETIME     NULL,
    location_id               INT          NULL,
    proxy_diagnosis_id        INT          NULL
);

INSERT INTO mamba_tmp_dth (client_id, death_date, birthdate, gender, cause_of_death_concept_id,
                           cause_of_death_non_coded)
SELECT p.person_id, p.death_date, p.birthdate, p.gender, p.cause_of_death, p.cause_of_death_non_coded
FROM mamba_source_db.person p
         INNER JOIN mamba_source_db.patient pt ON pt.patient_id = p.person_id
WHERE p.dead = 1
  AND p.voided = 0
  AND pt.voided = 0;

-- The last live visit started on or before the death date; the latest visit when none is.
UPDATE mamba_tmp_dth d
SET d.last_visit_id = COALESCE(
        (SELECT v.visit_id
         FROM mamba_source_db.visit v
         WHERE v.patient_id = d.client_id
           AND v.voided = 0
           AND (d.death_date IS NULL OR DATE(v.date_started) <= DATE(d.death_date))
         ORDER BY v.date_started DESC, v.visit_id DESC
         LIMIT 1),
        (SELECT v.visit_id
         FROM mamba_source_db.visit v
         WHERE v.patient_id = d.client_id
           AND v.voided = 0
         ORDER BY v.date_started DESC, v.visit_id DESC
         LIMIT 1));

UPDATE mamba_tmp_dth d
    INNER JOIN mamba_source_db.visit v ON v.visit_id = d.last_visit_id
SET d.last_visit_started = v.date_started,
    d.location_id        = COALESCE(v.location_id,
                                    (SELECT el.location_id
                                     FROM mamba_dim_encounter_location el
                                              INNER JOIN mamba_source_db.encounter e
                                                         ON e.encounter_id = el.encounter_id
                                     WHERE el.visit_id = v.visit_id
                                     ORDER BY e.encounter_datetime DESC, e.encounter_id DESC
                                     LIMIT 1));

-- The last coded, grouped diagnosis on or before the death date: the proxy cause.
UPDATE mamba_tmp_dth d
SET d.proxy_diagnosis_id = (SELECT x.diagnosis_id
                            FROM mamba_fact_malaria_diagnosis x
                            WHERE x.client_id = d.client_id
                              AND x.icd10_group IS NOT NULL
                              AND (d.death_date IS NULL OR DATE(x.encounter_datetime) <= DATE(d.death_date))
                            ORDER BY x.encounter_datetime DESC, x.dx_rank, x.diagnosis_id DESC
                            LIMIT 1);

-- ---- remove rows that are gone or differ ----
DELETE f
FROM mamba_fact_ncd_death f
         LEFT JOIN mamba_tmp_dth d ON d.client_id = f.client_id
         LEFT JOIN mamba_fact_malaria_diagnosis x ON x.diagnosis_id = d.proxy_diagnosis_id
WHERE d.client_id IS NULL
   OR NOT (d.death_date <=> f.death_date)
   OR NOT (d.birthdate <=> f.birthdate)
   OR NOT (d.gender <=> f.gender)
   OR NOT (d.cause_of_death_concept_id <=> f.cause_of_death_concept_id)
   OR NOT (d.cause_of_death_non_coded <=> f.cause_of_death_non_coded)
   OR NOT (d.last_visit_id <=> f.last_visit_id)
   OR NOT (d.location_id <=> f.location_id)
   OR NOT (d.proxy_diagnosis_id <=> f.proxy_diagnosis_id)
   OR NOT (x.icd10_code <=> f.proxy_icd10_code);

-- ---- add the missing ones ----
INSERT INTO mamba_fact_ncd_death (client_id, death_date, birthdate, gender, age_years_at_death,
                                  age_months_at_death, age_days_at_death, cause_of_death_concept_id,
                                  cause_of_death_non_coded, cause_group, last_visit_id, last_visit_started,
                                  location_id, facility_location_id, proxy_diagnosis_id, proxy_icd10_code,
                                  proxy_icd10_group)
SELECT d.client_id,
       d.death_date,
       d.birthdate,
       d.gender,
       TIMESTAMPDIFF(YEAR, d.birthdate, d.death_date),
       TIMESTAMPDIFF(MONTH, d.birthdate, d.death_date),
       TIMESTAMPDIFF(DAY, d.birthdate, d.death_date),
       d.cause_of_death_concept_id,
       d.cause_of_death_non_coded,
       CASE d.cause_of_death_concept_id
           WHEN @dth_cancer THEN 'cancer'
           WHEN @dth_infectious THEN 'infectious'
           WHEN @dth_trauma THEN 'trauma'
           WHEN @dth_unnatural THEN 'unnatural'
           WHEN @dth_other THEN 'other'
           WHEN @dth_unknown THEN 'unknown'
           END,
       d.last_visit_id,
       d.last_visit_started,
       d.location_id,
       h.facility_location_id,
       d.proxy_diagnosis_id,
       x.icd10_code,
       x.icd10_group
FROM mamba_tmp_dth d
         LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = d.location_id
         LEFT JOIN mamba_fact_malaria_diagnosis x ON x.diagnosis_id = d.proxy_diagnosis_id
         LEFT JOIN mamba_fact_ncd_death f ON f.client_id = d.client_id
WHERE f.client_id IS NULL;

UPDATE mamba_fact_ncd_death f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dth;

-- $END
