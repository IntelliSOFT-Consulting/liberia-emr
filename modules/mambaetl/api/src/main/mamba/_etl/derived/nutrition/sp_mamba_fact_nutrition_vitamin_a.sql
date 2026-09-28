-- mamba_fact_nutrition_vitamin_a: one row per Vitamin A supplementation event, from either
-- source the matrix lists for NUT-005 (and, once a Red answer exists, NUT-006):
--
--   source 'immunization_form'  a live `Supplementary immunization activities` = Vit.-A.Blue
--                               100,000iu obs on the Immunization form. The form saves under the
--                               shared Consultation type, so it is keyed on the form variable.
--   source 'drug_order'         a live, non-DISCONTINUE drug order for a Vitamin A capsule drug
--                               (100 000 IU or 200 000 IU, by drug variable). Its event time is
--                               date_activated, and its location is the order's encounter's.
--
-- Columns:
--   event_id        obs_id for the form, order_id for the order (unique within source)
--   event_datetime  encounter_datetime (form) or date_activated (order)
--   dose_iu         100000 (Blue) or 200000 (Red)
--   age_months      completed months at event_datetime (TIMESTAMPDIFF), NULL without a birthdate
--
-- NUT-005: COUNT(DISTINCT person_key) with dose_iu = 100000, age_months BETWEEN 6 AND 11 and
-- event_datetime in the period. Each child counts once, whichever source recorded the dose.
--
-- Rebuilt in full on every run. Runs in the ETL schema's context; mamba_source_db is replaced
-- at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_nutrition_vitamin_a
(
    source               VARCHAR(20) NOT NULL,
    event_id             INT         NOT NULL,
    encounter_id         INT         NOT NULL,
    visit_id             INT         NULL,
    client_id            INT         NOT NULL,
    person_key           VARCHAR(46) NOT NULL,
    birthdate            DATE        NULL,
    gender               VARCHAR(50) NULL,
    event_datetime       DATETIME    NOT NULL,
    location_id          INT         NOT NULL,
    facility_location_id INT         NULL,
    dose_iu              INT         NOT NULL,
    age_months           INT         NULL,

    PRIMARY KEY (source, event_id),
    INDEX mamba_idx_encounter_id (encounter_id),
    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_event_datetime (event_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

TRUNCATE TABLE mamba_fact_nutrition_vitamin_a;

INSERT INTO mamba_fact_nutrition_vitamin_a (source, event_id, encounter_id, visit_id, client_id,
                                            person_key, birthdate, gender, event_datetime,
                                            location_id, facility_location_id, dose_iu, age_months)
SELECT 'immunization_form',
       o.obs_id,
       e.encounter_id,
       e.visit_id,
       e.patient_id,
       pc.person_key,
       p.birthdate,
       p.gender,
       e.encounter_datetime,
       el.location_id,
       lh.facility_location_id,
       100000,
       TIMESTAMPDIFF(MONTH, p.birthdate, e.encounter_datetime)
FROM mamba_source_db.obs o
         INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
         INNER JOIN mamba_source_db.concept a ON a.concept_id = o.value_coded
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = o.encounter_id
         INNER JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
         INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = e.patient_id
         INNER JOIN mamba_source_db.person p ON p.person_id = e.patient_id
         LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
WHERE o.voided = 0
  AND e.voided = 0
  AND q.uuid = '${var.concept.national.supplementary-immunization-activities.uuid}'
  AND a.uuid = '${var.concept.national.vit-a-blue-100-000iu.uuid}'
  AND ef.form_uuid = '${var.form.immunization.uuid}';

INSERT INTO mamba_fact_nutrition_vitamin_a (source, event_id, encounter_id, visit_id, client_id,
                                            person_key, birthdate, gender, event_datetime,
                                            location_id, facility_location_id, dose_iu, age_months)
SELECT 'drug_order',
       ord.order_id,
       e.encounter_id,
       e.visit_id,
       ord.patient_id,
       pc.person_key,
       p.birthdate,
       p.gender,
       ord.date_activated,
       el.location_id,
       lh.facility_location_id,
       IF(dr.uuid = '${var.drug.pharmacy.ciel-86339-capsule-100000iu.uuid}', 100000, 200000),
       TIMESTAMPDIFF(MONTH, p.birthdate, ord.date_activated)
FROM mamba_source_db.orders ord
         INNER JOIN mamba_source_db.drug_order dor ON dor.order_id = ord.order_id
         INNER JOIN mamba_source_db.drug dr ON dr.drug_id = dor.drug_inventory_id
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = ord.encounter_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
         INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = ord.patient_id
         INNER JOIN mamba_source_db.person p ON p.person_id = ord.patient_id
         LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
WHERE ord.voided = 0
  AND e.voided = 0
  AND ord.order_action <> 'DISCONTINUE'
  AND dr.uuid IN ('${var.drug.pharmacy.ciel-86339-capsule-100000iu.uuid}',
                  '${var.drug.pharmacy.ciel-86339-capsule-200000iu.uuid}');

-- $END
