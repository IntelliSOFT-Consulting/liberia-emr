-- mamba_fact_malaria_diagnosis: one row per live encounter_diagnosis (LE-333; matrix gaps note
-- malaria-ncd-gaps.md §2 "Diagnosis fact"). Shared by Malaria (MAL-004 secondary, MAL-018
-- proxy), NCD (NCD-005, NCD-015, the death proxy cause) and RMNCAH (RMNCAH-018 to 021), so it
-- lives in the malaria section, which runs before ncd.
--
-- Only the O3 Visit Note writes encounter_diagnosis today (LE-349).
--
--   icd10_*                 the diagnosis concept's ICD-10-WHO map, SAME-AS preferred over
--                           NARROWER-THAN, then the lowest code (mamba_fact_malaria_concept_icd10)
--   icd10_group             malaria B50-B54, cvd I00-I99, cancer C00-C97, diabetes E10-E14,
--                           crd J30-J98, renal N00-N19, pneumonia J12-J18, diarrhoea A00-A09
--   days_since_prev_group   days since this PATIENT RECORD's previous live diagnosis in the same
--                           icd10_group (NULL: the first). An episode rule is "new when NULL or
--                           > N days" (14 for diarrhoea/pneumonia). Record-level, so it is the
--                           facility view; a person-level roll-up at central applies its own
--                           window over mamba_dim_person_cpi.person_key.
--   days_since_prev_category the same within the ICD-10 3-character category (cancer site)
--
-- Attribution: location_id from mamba_dim_encounter_location, facility_location_id from
-- mamba_dim_location_hierarchy. A diagnosis on a voided encounter is dropped.
--
-- Incremental in both modes: rows whose source was voided, deleted or edited, or whose
-- attribution changed, are removed and re-added; missing live rows are added; ICD-10 and
-- facility columns are refreshed where they differ; the day gaps are recomputed only for the
-- patients touched. A full run starts empty (core drops every mamba_* table first).
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_malaria_concept_icd10
(
    concept_id     INT         NOT NULL PRIMARY KEY,
    icd10_code     VARCHAR(50) NOT NULL,
    icd10_category CHAR(3)     NOT NULL,
    icd10_map_type VARCHAR(20) NOT NULL,
    icd10_group    VARCHAR(20) NULL,

    INDEX mamba_idx_icd10_category (icd10_category),
    INDEX mamba_idx_icd10_group (icd10_group)
);

CREATE TABLE IF NOT EXISTS mamba_fact_malaria_diagnosis
(
    diagnosis_id              INT          NOT NULL PRIMARY KEY,
    encounter_id              INT          NOT NULL,
    visit_id                  INT          NULL,
    client_id                 INT          NOT NULL,
    encounter_type_id         INT          NOT NULL,
    encounter_datetime        DATETIME     NOT NULL,
    location_id               INT          NOT NULL,
    facility_location_id      INT          NULL,
    diagnosis_concept_id      INT          NULL,
    diagnosis_non_coded       VARCHAR(255) NULL,
    certainty                 VARCHAR(255) NOT NULL,
    dx_rank                   INT          NOT NULL,
    condition_id              INT          NULL,
    icd10_code                VARCHAR(50)  NULL,
    icd10_category            CHAR(3)      NULL,
    icd10_map_type            VARCHAR(20)  NULL,
    icd10_group               VARCHAR(20)  NULL,
    days_since_prev_group     INT          NULL,
    days_since_prev_category  INT          NULL,
    date_created              DATETIME     NOT NULL,

    INDEX mamba_idx_encounter_id (encounter_id),
    INDEX mamba_idx_visit_id (visit_id),
    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_diagnosis_concept_id (diagnosis_concept_id),
    INDEX mamba_idx_icd10_group (icd10_group),
    INDEX mamba_idx_icd10_category (icd10_category)
);

-- ---- ICD-10 grouping, rebuilt in full: one row per mapped concept ----
TRUNCATE TABLE mamba_fact_malaria_concept_icd10;

INSERT INTO mamba_fact_malaria_concept_icd10 (concept_id, icd10_code, icd10_category, icd10_map_type,
                                              icd10_group)
SELECT x.concept_id,
       x.code,
       LEFT(x.code, 3),
       x.map_type,
       CASE
           WHEN LEFT(x.code, 3) BETWEEN 'B50' AND 'B54' THEN 'malaria'
           WHEN LEFT(x.code, 3) BETWEEN 'I00' AND 'I99' THEN 'cvd'
           WHEN LEFT(x.code, 3) BETWEEN 'C00' AND 'C97' THEN 'cancer'
           WHEN LEFT(x.code, 3) BETWEEN 'E10' AND 'E14' THEN 'diabetes'
           WHEN LEFT(x.code, 3) BETWEEN 'J12' AND 'J18' THEN 'pneumonia'
           WHEN LEFT(x.code, 3) BETWEEN 'J30' AND 'J98' THEN 'crd'
           WHEN LEFT(x.code, 3) BETWEEN 'N00' AND 'N19' THEN 'renal'
           WHEN LEFT(x.code, 3) BETWEEN 'A00' AND 'A09' THEN 'diarrhoea'
           END
FROM (SELECT m.concept_id,
             UPPER(TRIM(t.code))                                    AS code,
             IF(mt.uuid = '${var.conceptmaptype.same-as.uuid}', 'SAME-AS', 'NARROWER-THAN') AS map_type,
             ROW_NUMBER() OVER (PARTITION BY m.concept_id
                 ORDER BY mt.uuid = '${var.conceptmaptype.same-as.uuid}' DESC, UPPER(TRIM(t.code))) AS rn
      FROM mamba_source_db.concept_reference_map m
               INNER JOIN mamba_source_db.concept_reference_term t
                          ON t.concept_reference_term_id = m.concept_reference_term_id
               INNER JOIN mamba_source_db.concept_reference_source s
                          ON s.concept_source_id = t.concept_source_id
               INNER JOIN mamba_source_db.concept_map_type mt
                          ON mt.concept_map_type_id = m.concept_map_type_id
      WHERE s.name = 'ICD-10-WHO'
        AND s.retired = 0
        AND t.retired = 0
        AND t.code REGEXP '^[A-Za-z][0-9]{2}'
        AND mt.uuid IN ('${var.conceptmaptype.same-as.uuid}', '${var.conceptmaptype.narrower-than.uuid}')) x
WHERE x.rn = 1;

-- Patients whose day gaps must be recomputed this run.
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dx_client;
CREATE TEMPORARY TABLE mamba_tmp_dx_client
(
    client_id INT NOT NULL PRIMARY KEY
);

-- ---- remove rows whose source or attribution changed ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dx_stale;
CREATE TEMPORARY TABLE mamba_tmp_dx_stale
(
    diagnosis_id INT NOT NULL PRIMARY KEY,
    client_id    INT NOT NULL
);

INSERT INTO mamba_tmp_dx_stale (diagnosis_id, client_id)
SELECT f.diagnosis_id, f.client_id
FROM mamba_fact_malaria_diagnosis f
         LEFT JOIN mamba_source_db.encounter_diagnosis d ON d.diagnosis_id = f.diagnosis_id
         LEFT JOIN mamba_dim_encounter_location el ON el.encounter_id = d.encounter_id
WHERE d.diagnosis_id IS NULL
   OR d.voided = 1
   OR el.encounter_id IS NULL
   OR d.encounter_id <> f.encounter_id
   OR d.patient_id <> f.client_id
   OR NOT (d.diagnosis_coded <=> f.diagnosis_concept_id)
   OR NOT (d.diagnosis_non_coded <=> f.diagnosis_non_coded)
   OR NOT (d.certainty <=> f.certainty)
   OR NOT (d.dx_rank <=> f.dx_rank)
   OR NOT (d.condition_id <=> f.condition_id)
   OR NOT (el.location_id <=> f.location_id)
   OR NOT (el.visit_id <=> f.visit_id);

INSERT IGNORE INTO mamba_tmp_dx_client (client_id)
SELECT client_id
FROM mamba_tmp_dx_stale;

DELETE f
FROM mamba_fact_malaria_diagnosis f
         INNER JOIN mamba_tmp_dx_stale s ON s.diagnosis_id = f.diagnosis_id;

-- The encounter datetime or type can change without touching the diagnosis row.
INSERT IGNORE INTO mamba_tmp_dx_client (client_id)
SELECT f.client_id
FROM mamba_fact_malaria_diagnosis f
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = f.encounter_id
WHERE f.encounter_datetime <> e.encounter_datetime;

UPDATE mamba_fact_malaria_diagnosis f
    INNER JOIN mamba_source_db.encounter e ON e.encounter_id = f.encounter_id
SET f.encounter_datetime = e.encounter_datetime,
    f.encounter_type_id  = e.encounter_type
WHERE f.encounter_datetime <> e.encounter_datetime
   OR f.encounter_type_id <> e.encounter_type;

-- ---- add missing live rows ----
INSERT IGNORE INTO mamba_tmp_dx_client (client_id)
SELECT DISTINCT d.patient_id
FROM mamba_source_db.encounter_diagnosis d
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = d.encounter_id
         LEFT JOIN mamba_fact_malaria_diagnosis f ON f.diagnosis_id = d.diagnosis_id
WHERE d.voided = 0
  AND f.diagnosis_id IS NULL;

INSERT INTO mamba_fact_malaria_diagnosis (diagnosis_id, encounter_id, visit_id, client_id, encounter_type_id,
                                          encounter_datetime, location_id, facility_location_id,
                                          diagnosis_concept_id, diagnosis_non_coded, certainty, dx_rank,
                                          condition_id, date_created)
SELECT d.diagnosis_id,
       d.encounter_id,
       el.visit_id,
       d.patient_id,
       e.encounter_type,
       e.encounter_datetime,
       el.location_id,
       h.facility_location_id,
       d.diagnosis_coded,
       d.diagnosis_non_coded,
       d.certainty,
       d.dx_rank,
       d.condition_id,
       d.date_created
FROM mamba_source_db.encounter_diagnosis d
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = d.encounter_id
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = d.encounter_id
         LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = el.location_id
         LEFT JOIN mamba_fact_malaria_diagnosis f ON f.diagnosis_id = d.diagnosis_id
WHERE d.voided = 0
  AND f.diagnosis_id IS NULL;

-- ---- refresh ICD-10 and facility columns where they differ ----
INSERT IGNORE INTO mamba_tmp_dx_client (client_id)
SELECT f.client_id
FROM mamba_fact_malaria_diagnosis f
         LEFT JOIN mamba_fact_malaria_concept_icd10 i ON i.concept_id = f.diagnosis_concept_id
WHERE NOT (f.icd10_code <=> i.icd10_code)
   OR NOT (f.icd10_group <=> i.icd10_group)
   OR NOT (f.icd10_map_type <=> i.icd10_map_type);

UPDATE mamba_fact_malaria_diagnosis f
    LEFT JOIN mamba_fact_malaria_concept_icd10 i ON i.concept_id = f.diagnosis_concept_id
SET f.icd10_code     = i.icd10_code,
    f.icd10_category = i.icd10_category,
    f.icd10_map_type = i.icd10_map_type,
    f.icd10_group    = i.icd10_group
WHERE NOT (f.icd10_code <=> i.icd10_code)
   OR NOT (f.icd10_group <=> i.icd10_group)
   OR NOT (f.icd10_map_type <=> i.icd10_map_type);

UPDATE mamba_fact_malaria_diagnosis f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

-- ---- day gaps for the touched patients ----
UPDATE mamba_fact_malaria_diagnosis f
    INNER JOIN (SELECT d.diagnosis_id,
                       DATEDIFF(d.encounter_datetime,
                                LAG(d.encounter_datetime) OVER (
                                    PARTITION BY d.client_id, d.icd10_group
                                    ORDER BY d.encounter_datetime, d.diagnosis_id)) AS gap_group,
                       DATEDIFF(d.encounter_datetime,
                                LAG(d.encounter_datetime) OVER (
                                    PARTITION BY d.client_id, d.icd10_category
                                    ORDER BY d.encounter_datetime, d.diagnosis_id)) AS gap_category
                FROM mamba_fact_malaria_diagnosis d
                         INNER JOIN mamba_tmp_dx_client c ON c.client_id = d.client_id) g
               ON g.diagnosis_id = f.diagnosis_id
SET f.days_since_prev_group    = IF(f.icd10_group IS NULL, NULL, g.gap_group),
    f.days_since_prev_category = IF(f.icd10_category IS NULL, NULL, g.gap_category);

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dx_stale;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_dx_client;

-- $END
