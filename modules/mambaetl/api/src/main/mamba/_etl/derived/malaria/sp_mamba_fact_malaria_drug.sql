-- mamba_fact_malaria_drug: one row per live drug order, with its dispensing (LE-333;
-- malaria-ncd-gaps.md §2 "Drug order and dispense fact"). Shared by Malaria (MAL-001),
-- NCD (NCD-009, NCD-017) and RMNCAH (RMNCAH-018, RMNCAH-021).
--
--   prescribed_at   orders.date_activated
--   dispensed_at    the earliest medication_dispense.date_handed_over of the order (live rows)
--   treated_at      dispensed_at, else prescribed_at. medication_dispense is NOT synced
--                   (eip.watchedTables), so at central dispensed_at is always NULL and every
--                   time window falls back to prescribed_at (LE-358).
--   is_*            drug class, from the reporting concept sets in content-liberia-national
--                   (reporting_convsets-national.csv): the order's concept, or its drug's
--                   concept, is a member. No drug uuid appears here. Several members are not
--                   yet in the formulary (LE-347), so a flag can be 0 for want of a drug.
--
-- DISCONTINUE orders are not rows. REVISE orders are, with previous_order_id, so a count of
-- people is COUNT(DISTINCT client_id), not a count of rows.
--
-- Attribution: the order's encounter (mamba_dim_encounter_location). Incremental in both modes:
-- rows whose order or encounter was voided or deleted, or whose attribution changed, are
-- removed and re-added; every live drug order not held is added; dispense columns, class flags
-- (mamba_fact_malaria_drug_class, rebuilt each run) and facility are refreshed.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_malaria_drug
(
    order_id                   INT         NOT NULL PRIMARY KEY,
    encounter_id               INT         NOT NULL,
    visit_id                   INT         NULL,
    client_id                  INT         NOT NULL,
    location_id                INT         NOT NULL,
    facility_location_id       INT         NULL,
    order_concept_id           INT         NOT NULL,
    drug_id                    INT         NULL,
    order_number               VARCHAR(50) NULL,
    order_action               VARCHAR(50) NOT NULL,
    previous_order_id          INT         NULL,
    prescribed_at              DATETIME    NULL,
    date_stopped               DATETIME    NULL,
    auto_expire_date           DATETIME    NULL,
    quantity                   DOUBLE      NULL,
    dispensed_at               DATETIME    NULL,
    dispense_count             INT         NOT NULL DEFAULT 0,
    treated_at                 DATETIME    NULL,
    is_first_line_antimalarial TINYINT(1)  NOT NULL DEFAULT 0,
    is_pneumonia_antibiotic    TINYINT(1)  NOT NULL DEFAULT 0,
    is_glucose_lowering        TINYINT(1)  NOT NULL DEFAULT 0,
    is_strong_opioid           TINYINT(1)  NOT NULL DEFAULT 0,
    is_oral_rehydration        TINYINT(1)  NOT NULL DEFAULT 0,

    INDEX mamba_idx_encounter_id (encounter_id),
    INDEX mamba_idx_visit_id (visit_id),
    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_prescribed_at (prescribed_at),
    INDEX mamba_idx_treated_at (treated_at)
);

-- ---- drug class membership, rebuilt in full: concept_id -> class flags ----
CREATE TABLE IF NOT EXISTS mamba_fact_malaria_drug_class
(
    concept_id                 INT        NOT NULL PRIMARY KEY,
    is_first_line_antimalarial TINYINT(1) NOT NULL DEFAULT 0,
    is_pneumonia_antibiotic    TINYINT(1) NOT NULL DEFAULT 0,
    is_glucose_lowering        TINYINT(1) NOT NULL DEFAULT 0,
    is_strong_opioid           TINYINT(1) NOT NULL DEFAULT 0,
    is_oral_rehydration        TINYINT(1) NOT NULL DEFAULT 0
);

TRUNCATE TABLE mamba_fact_malaria_drug_class;

INSERT INTO mamba_fact_malaria_drug_class (concept_id, is_first_line_antimalarial, is_pneumonia_antibiotic,
                                           is_glucose_lowering, is_strong_opioid, is_oral_rehydration)
SELECT cs.concept_id,
       MAX(s.uuid = '${var.concept.national.reporting-first-line-antimalarials.uuid}'),
       MAX(s.uuid = '${var.concept.national.reporting-pneumonia-antibiotics.uuid}'),
       MAX(s.uuid = '${var.concept.national.reporting-glucose-lowering-drugs.uuid}'),
       MAX(s.uuid = '${var.concept.national.reporting-strong-opioids.uuid}'),
       MAX(s.uuid = '${var.concept.national.reporting-oral-rehydration.uuid}')
FROM mamba_source_db.concept_set cs
         INNER JOIN mamba_source_db.concept s ON s.concept_id = cs.concept_set
WHERE s.uuid IN ('${var.concept.national.reporting-first-line-antimalarials.uuid}',
                 '${var.concept.national.reporting-pneumonia-antibiotics.uuid}',
                 '${var.concept.national.reporting-glucose-lowering-drugs.uuid}',
                 '${var.concept.national.reporting-strong-opioids.uuid}',
                 '${var.concept.national.reporting-oral-rehydration.uuid}')
GROUP BY cs.concept_id;

-- ---- remove rows whose order, encounter or attribution changed ----
DELETE f
FROM mamba_fact_malaria_drug f
         LEFT JOIN mamba_source_db.orders o ON o.order_id = f.order_id
         LEFT JOIN mamba_source_db.drug_order d ON d.order_id = f.order_id
         LEFT JOIN mamba_dim_encounter_location el ON el.encounter_id = o.encounter_id
WHERE o.order_id IS NULL
   OR o.voided = 1
   OR el.encounter_id IS NULL
   OR NOT (el.location_id <=> f.location_id)
   OR NOT (el.visit_id <=> f.visit_id)
   OR NOT (o.date_activated <=> f.prescribed_at)
   OR NOT (o.date_stopped <=> f.date_stopped)
   OR NOT (o.auto_expire_date <=> f.auto_expire_date)
   OR NOT (d.drug_inventory_id <=> f.drug_id)
   OR NOT (d.quantity <=> f.quantity);

-- ---- add every live drug order not held ----
INSERT INTO mamba_fact_malaria_drug (order_id, encounter_id, visit_id, client_id, location_id,
                                     facility_location_id, order_concept_id, drug_id, order_number,
                                     order_action, previous_order_id, prescribed_at, date_stopped,
                                     auto_expire_date, quantity)
SELECT o.order_id,
       o.encounter_id,
       el.visit_id,
       o.patient_id,
       el.location_id,
       h.facility_location_id,
       o.concept_id,
       d.drug_inventory_id,
       o.order_number,
       o.order_action,
       o.previous_order_id,
       o.date_activated,
       o.date_stopped,
       o.auto_expire_date,
       d.quantity
FROM mamba_source_db.drug_order d
         INNER JOIN mamba_source_db.orders o ON o.order_id = d.order_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = o.encounter_id
         LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = el.location_id
         LEFT JOIN mamba_fact_malaria_drug f ON f.order_id = d.order_id
WHERE o.voided = 0
  AND o.order_action <> 'DISCONTINUE'
  AND f.order_id IS NULL;

-- ---- dispensing, where it differs (facility only; central has no medication_dispense rows) ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_drug_dispense;
CREATE TEMPORARY TABLE mamba_tmp_drug_dispense
(
    order_id     INT      NOT NULL PRIMARY KEY,
    dispensed_at DATETIME NULL,
    n            INT      NOT NULL
);

INSERT INTO mamba_tmp_drug_dispense (order_id, dispensed_at, n)
SELECT md.drug_order_id, MIN(md.date_handed_over), COUNT(*)
FROM mamba_source_db.medication_dispense md
WHERE md.voided = 0
  AND md.drug_order_id IS NOT NULL
GROUP BY md.drug_order_id;

UPDATE mamba_fact_malaria_drug f
    LEFT JOIN mamba_tmp_drug_dispense x ON x.order_id = f.order_id
SET f.dispensed_at   = x.dispensed_at,
    f.dispense_count = COALESCE(x.n, 0)
WHERE NOT (f.dispensed_at <=> x.dispensed_at)
   OR f.dispense_count <> COALESCE(x.n, 0);

UPDATE mamba_fact_malaria_drug f
SET f.treated_at = COALESCE(f.dispensed_at, f.prescribed_at)
WHERE NOT (f.treated_at <=> COALESCE(f.dispensed_at, f.prescribed_at));

-- ---- class flags and facility, where they differ ----
UPDATE mamba_fact_malaria_drug f
    LEFT JOIN mamba_source_db.drug dr ON dr.drug_id = f.drug_id
    LEFT JOIN mamba_fact_malaria_drug_class c1 ON c1.concept_id = f.order_concept_id
    LEFT JOIN mamba_fact_malaria_drug_class c2 ON c2.concept_id = dr.concept_id
SET f.is_first_line_antimalarial = GREATEST(COALESCE(c1.is_first_line_antimalarial, 0),
                                            COALESCE(c2.is_first_line_antimalarial, 0)),
    f.is_pneumonia_antibiotic    = GREATEST(COALESCE(c1.is_pneumonia_antibiotic, 0),
                                            COALESCE(c2.is_pneumonia_antibiotic, 0)),
    f.is_glucose_lowering        = GREATEST(COALESCE(c1.is_glucose_lowering, 0),
                                            COALESCE(c2.is_glucose_lowering, 0)),
    f.is_strong_opioid           = GREATEST(COALESCE(c1.is_strong_opioid, 0), COALESCE(c2.is_strong_opioid, 0)),
    f.is_oral_rehydration        = GREATEST(COALESCE(c1.is_oral_rehydration, 0),
                                            COALESCE(c2.is_oral_rehydration, 0));

UPDATE mamba_fact_malaria_drug f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_drug_dispense;

-- $END
