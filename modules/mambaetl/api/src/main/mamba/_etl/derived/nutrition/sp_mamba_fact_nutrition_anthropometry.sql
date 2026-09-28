-- mamba_fact_nutrition_anthropometry: one row per live encounter that records weight, height or
-- MUAC on the Triage form, the O3 vitals app or the OPD Consultation Form (NUT-008, NUT-009;
-- also the NCD-008 BMI proxy, if that is approved).
--
-- Sources (source column):
--   'triage'  encounters of type Triage (only the Triage Form writes it)
--   'vitals'  encounters of type Vitals (the O3 vitals app; no form)
--   'opd'     `OPD Consultation Form` v2.0 on the shared Consultation type. INTERIM: matched on
--             form NAME and VERSION, because var.form.opd-consultation.uuid holds the JSON uuid
--             that Initializer ignores (gaps note, gap 11). Replace with the variable once it
--             holds the runtime uuid.
--
-- Values are CIEL 5089 weight (kg), 5090 height/length (cm) and 1343 MUAC (cm). A voided obs
-- never counts; if a concept has several live obs on one encounter, the latest wins. The
-- stored "W/Z score" concept is weight-for-AGE and is deliberately NOT read.
--
-- WHZ: computed here, only from weight and height on the SAME encounter, with the WHO Child
-- Growth Standards (2006) LMS tables in mamba_dim_nutrition_who_wflh, following WHO's `anthro`
-- package (z-score-weight-for-lenhei.R):
--   * whz_measure is 'L' (weight-for-length) when age_days < 731, else 'H' (weight-for-height).
--     The EMR does not record whether the child lay or stood, so no 0.7 cm adjustment is made.
--   * L, M and S are interpolated linearly between the 0.1 cm grid points around height_cm.
--   * z = ((weight/M)^L - 1) / (S*L); beyond +/-3 it is WHO's restricted extension, using the
--     distance between the 2 and 3 SD weights. Rounded to 2 decimals.
--   * NULL unless: sex is M or F, weight > 0, age_months < 60 and age_days <= 1856, and
--     height_cm is within 45-110 ('L') or 65-120 ('H').
--
-- Other columns: age_days and age_months (completed, TIMESTAMPDIFF) at encounter_datetime;
-- bmi = weight / (height/100)^2, rounded to 1 decimal, when both are recorded (height >= 10 cm).
--
-- NUT-008: children 6-59 months; the LATEST muac_cm row per child in the period; < 11.5.
-- NUT-009: children 6-59 months with whz >= -3 AND whz < -2.
--
-- Rebuilt in full on every run. Runs in the ETL schema's context; mamba_source_db is replaced
-- at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_nutrition_anthropometry
(
    encounter_id         INT          NOT NULL PRIMARY KEY,
    visit_id             INT          NULL,
    client_id            INT          NOT NULL,
    person_key           VARCHAR(46)  NOT NULL,
    birthdate            DATE         NULL,
    gender               VARCHAR(50)  NULL,
    encounter_datetime   DATETIME     NOT NULL,
    location_id          INT          NOT NULL,
    facility_location_id INT          NULL,
    source               VARCHAR(10)  NOT NULL,
    form_uuid            CHAR(38)     NULL,
    age_days             INT          NULL,
    age_months           INT          NULL,
    weight_kg            DECIMAL(8, 2) NULL,
    height_cm            DECIMAL(6, 1) NULL,
    muac_cm              DECIMAL(5, 1) NULL,
    bmi                  DECIMAL(10, 1) NULL,
    whz_measure          CHAR(1)      NULL,
    whz                  DECIMAL(5, 2) NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_age_months (age_months)
);

TRUNCATE TABLE mamba_fact_nutrition_anthropometry;

INSERT INTO mamba_fact_nutrition_anthropometry (encounter_id, visit_id, client_id, person_key,
                                                birthdate, gender, encounter_datetime,
                                                location_id, facility_location_id, source,
                                                form_uuid, age_days, age_months, weight_kg,
                                                height_cm, muac_cm, bmi, whz_measure, whz)
SELECT z.encounter_id,
       z.visit_id,
       z.client_id,
       z.person_key,
       z.birthdate,
       z.gender,
       z.encounter_datetime,
       z.location_id,
       z.facility_location_id,
       z.source,
       z.form_uuid,
       z.age_days,
       z.age_months,
       z.weight_kg,
       z.height_cm,
       z.muac_cm,
       z.bmi,
       IF(z.z_raw IS NULL, NULL, z.whz_measure),
       ROUND(CASE
                 WHEN z.z_raw > 3 THEN
                     3 + (z.weight_kg - z.lms_m * POW(1 + z.lms_l * z.lms_s * 3, 1 / z.lms_l))
                         / (z.lms_m * POW(1 + z.lms_l * z.lms_s * 3, 1 / z.lms_l)
                         - z.lms_m * POW(1 + z.lms_l * z.lms_s * 2, 1 / z.lms_l))
                 WHEN z.z_raw < -3 THEN
                     -3 + (z.weight_kg - z.lms_m * POW(1 + z.lms_l * z.lms_s * -3, 1 / z.lms_l))
                         / (z.lms_m * POW(1 + z.lms_l * z.lms_s * -2, 1 / z.lms_l)
                         - z.lms_m * POW(1 + z.lms_l * z.lms_s * -3, 1 / z.lms_l))
                 ELSE z.z_raw
                 END, 2)
FROM (SELECT y.*,
             (POW(y.weight_kg / y.lms_m, y.lms_l) - 1) / (y.lms_s * y.lms_l) AS z_raw
      FROM (SELECT x.*,
                   lo.l + x.lenhei_diff * (COALESCE(hi.l, lo.l) - lo.l) AS lms_l,
                   lo.m + x.lenhei_diff * (COALESCE(hi.m, lo.m) - lo.m) AS lms_m,
                   lo.s + x.lenhei_diff * (COALESCE(hi.s, lo.s) - lo.s) AS lms_s
            FROM (SELECT w.*,
                         -- the grid point at or below height_cm, and the fraction of 0.1 cm above it
                         FLOOR(ROUND(w.height_cm * 10, 6)) / 10                        AS lenhei_low,
                         (w.height_cm - FLOOR(ROUND(w.height_cm * 10, 6)) / 10) / 0.1 AS lenhei_diff,
                         CASE
                             WHEN w.gender NOT IN ('M', 'F') OR w.weight_kg IS NULL OR w.weight_kg <= 0
                                 OR w.height_cm IS NULL OR w.age_days IS NULL OR w.age_days < 0
                                 OR w.age_days > 1856 OR w.age_months >= 60 THEN NULL
                             WHEN w.age_days < 731 AND w.height_cm BETWEEN 45 AND 110 THEN 'L'
                             WHEN w.age_days >= 731 AND w.height_cm BETWEEN 65 AND 120 THEN 'H'
                             END                                                        AS whz_measure
                  FROM (SELECT e.encounter_id,
                               e.visit_id,
                               e.patient_id                                                   AS client_id,
                               pc.person_key,
                               p.birthdate,
                               p.gender,
                               e.encounter_datetime,
                               el.location_id,
                               lh.facility_location_id,
                               CASE
                                   WHEN et.uuid = '${var.encountertype.triage.uuid}' THEN 'triage'
                                   WHEN et.uuid = '${var.encountertype.vitals.uuid}' THEN 'vitals'
                                   ELSE 'opd' END                                             AS source,
                               f.uuid                                                         AS form_uuid,
                               DATEDIFF(DATE(e.encounter_datetime), p.birthdate)              AS age_days,
                               TIMESTAMPDIFF(MONTH, p.birthdate, e.encounter_datetime)        AS age_months,
                               CAST(ob.weight_kg AS DECIMAL(8, 2))                            AS weight_kg,
                               CAST(ob.height_cm AS DECIMAL(6, 1))                            AS height_cm,
                               CAST(ob.muac_cm AS DECIMAL(5, 1))                              AS muac_cm,
                               IF(CAST(ob.height_cm AS DECIMAL(6, 1)) >= 10,
                                  ROUND(CAST(ob.weight_kg AS DECIMAL(8, 2))
                                            / POW(CAST(ob.height_cm AS DECIMAL(6, 1)) / 100, 2), 1),
                                  NULL)                                                       AS bmi
                        FROM (SELECT o.encounter_id,
                                     SUBSTRING_INDEX(GROUP_CONCAT(
                                                             CASE WHEN q.uuid = '${var.concept.ciel.weight.uuid}'
                                                                      THEN o.value_numeric END
                                                             ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                                     '|', 1) AS weight_kg,
                                     SUBSTRING_INDEX(GROUP_CONCAT(
                                                             CASE WHEN q.uuid = '${var.concept.ciel.height.uuid}'
                                                                      THEN o.value_numeric END
                                                             ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                                     '|', 1) AS height_cm,
                                     SUBSTRING_INDEX(GROUP_CONCAT(
                                                             CASE WHEN q.uuid = '${var.concept.ciel.muac.uuid}'
                                                                      THEN o.value_numeric END
                                                             ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                                     '|', 1) AS muac_cm
                              FROM mamba_source_db.obs o
                                       INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
                              WHERE o.voided = 0
                                AND o.encounter_id IS NOT NULL
                                AND o.value_numeric IS NOT NULL
                                AND q.uuid IN ('${var.concept.ciel.weight.uuid}',
                                               '${var.concept.ciel.height.uuid}',
                                               '${var.concept.ciel.muac.uuid}')
                              GROUP BY o.encounter_id) ob
                                 INNER JOIN mamba_source_db.encounter e ON e.encounter_id = ob.encounter_id
                                 INNER JOIN mamba_source_db.encounter_type et
                                            ON et.encounter_type_id = e.encounter_type
                                 INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
                                 INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = e.patient_id
                                 INNER JOIN mamba_source_db.person p ON p.person_id = e.patient_id
                                 LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
                                 LEFT JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
                                 LEFT JOIN mamba_source_db.form f ON f.form_id = ef.form_id
                        WHERE e.voided = 0
                          AND (et.uuid IN ('${var.encountertype.triage.uuid}',
                                           '${var.encountertype.vitals.uuid}')
                            -- INTERIM name/version match: the OPD form variable is not the runtime uuid.
                            OR (et.uuid = '${var.encountertype.consultation.uuid}'
                                AND f.name = 'OPD Consultation Form' AND f.version = '2.0'))) w) x
                     LEFT JOIN mamba_dim_nutrition_who_wflh lo
                               ON lo.measure = x.whz_measure
                                   AND lo.sex = x.gender
                                   AND lo.lenhei_cm = x.lenhei_low
                     LEFT JOIN mamba_dim_nutrition_who_wflh hi
                               ON hi.measure = x.whz_measure
                                   AND hi.sex = x.gender
                                   AND hi.lenhei_cm = x.lenhei_low + 0.1) y) z;

-- $END
