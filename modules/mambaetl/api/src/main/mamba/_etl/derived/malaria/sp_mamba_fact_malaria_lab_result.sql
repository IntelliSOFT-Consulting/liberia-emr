-- mamba_fact_malaria_lab_result: test orders and their results (LE-333; malaria-ncd-gaps.md §2
-- "Lab-result fact"). Shared by Malaria (MAL-001, MAL-004) and NCD (NCD-009, 011, 015).
--
-- Grain: one row per live test order and live LEAF result obs (a value-bearing obs; a panel's
-- group obs is not a row, its members are). A test order with no result yet has one row with
-- result_obs_id = 0 and NULL result columns. DISCONTINUE orders are not rows: esm-laboratory-app
-- writes one each time it completes an order.
--
-- How a result finds its order (verified in @openmrs/esm-patient-orders-app 12.3.4,
-- lab-results.resource.ts, which esm-laboratory-app 1.5.1 opens to enter results):
--   * the app POSTs the result obs into the ORDER'S encounter, and every obs, the group and each
--     member, carries order = the test order. So result_linked_by = 'order_id'.
--   * obs written some other way with no order_id (a form, a REST client) are matched by
--     encounter and concept: an obs in the order's encounter whose concept is the order's
--     concept or a member of it. result_linked_by = 'encounter_concept'. It is used only when
--     the order has no order_id-linked result.
--   * the app sets no obsDatetime, so core gives the obs the ENCOUNTER's datetime, which is the
--     order time. resulted_at is therefore obs_datetime only when it is later than the order's
--     encounter datetime (set explicitly), else the obs date_created (entry time).
--
--   ordered_at     orders.date_activated
--   test_code      malaria_rdt, malaria_smear, cholesterol_total, creatinine_umol,
--                  creatinine_mgdl, urea, egfr, glucose_fasting, glucose_serum, glucose_mmol
--                  (result concept first, then order concept); NULL for other tests
--   test_group     malaria, lipid, renal, glucose
--   is_malaria_positive  1 when a malaria result is Positive (703), P. falciparum, P. vivax,
--                  mixed (161246-8), P. malariae or P. ovale (168986-7)
--
-- Attribution: the order's encounter (mamba_dim_encounter_location). Incremental in both modes:
-- orders touched since the last run (new orders, orders with new result obs, orders whose
-- order, encounter or stored result obs was voided or deleted, or whose attribution changed) are
-- deleted and rebuilt. New result obs are found above an obs_id watermark kept in
-- mamba_fact_malaria_etl_state.
--
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_malaria_lab_result
(
    order_id             INT          NOT NULL,
    result_obs_id        INT          NOT NULL DEFAULT 0,
    encounter_id         INT          NOT NULL,
    visit_id             INT          NULL,
    client_id            INT          NOT NULL,
    location_id          INT          NOT NULL,
    facility_location_id INT          NULL,
    order_concept_id     INT          NOT NULL,
    order_number         VARCHAR(50)  NULL,
    fulfiller_status     VARCHAR(50)  NULL,
    ordered_at           DATETIME     NULL,
    result_concept_id    INT          NULL,
    value_coded          INT          NULL,
    value_numeric        DOUBLE       NULL,
    value_text           TEXT         NULL,
    result_obs_datetime  DATETIME     NULL,
    result_entered_at    DATETIME     NULL,
    resulted_at          DATETIME     NULL,
    result_linked_by     VARCHAR(20)  NULL,
    test_code            VARCHAR(30)  NULL,
    test_group           VARCHAR(20)  NULL,
    is_malaria_positive  TINYINT(1)   NOT NULL DEFAULT 0,

    PRIMARY KEY (order_id, result_obs_id),
    INDEX mamba_idx_result_obs_id (result_obs_id),
    INDEX mamba_idx_encounter_id (encounter_id),
    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_test_code (test_code),
    INDEX mamba_idx_test_group (test_group),
    INDEX mamba_idx_ordered_at (ordered_at),
    INDEX mamba_idx_resulted_at (resulted_at)
);

-- Concept ids for the tests and answers compared below.
SET @lr_rdt = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.1643.uuid}');
SET @lr_smear = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.32.uuid}');
SET @lr_smear_set = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.161426.uuid}');
SET @lr_species = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.168988.uuid}');
SET @lr_chol = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.1006.uuid}');
SET @lr_creat = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.790.uuid}');
SET @lr_creat_mg = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.164364.uuid}');
SET @lr_urea = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.857.uuid}');
SET @lr_egfr = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.161132.uuid}');
SET @lr_fbg = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.160912.uuid}');
SET @lr_glu = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.887.uuid}');
SET @lr_glu_mmol = (SELECT concept_id FROM mamba_source_db.concept WHERE uuid = '${var.concept.ciel.1458.uuid}');

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_positive;
CREATE TEMPORARY TABLE mamba_tmp_lr_positive
(
    concept_id INT NOT NULL PRIMARY KEY
);
INSERT IGNORE INTO mamba_tmp_lr_positive (concept_id)
SELECT concept_id
FROM mamba_source_db.concept
WHERE uuid IN ('${var.concept.ciel.703.uuid}', '${var.concept.ciel.161246.uuid}',
               '${var.concept.ciel.161247.uuid}', '${var.concept.ciel.161248.uuid}',
               '${var.concept.ciel.168986.uuid}', '${var.concept.ciel.168987.uuid}');

-- Watermark: the highest obs.obs_id already scanned for results. It is read back with a margin,
-- so an obs whose id was allocated before the last run but committed after it is still seen;
-- rebuilding an order twice is harmless. A full run starts from 0.
CREATE TABLE IF NOT EXISTS mamba_fact_malaria_etl_state
(
    state_key   VARCHAR(64) NOT NULL PRIMARY KEY,
    state_value BIGINT      NOT NULL
);

SET @lr_max_obs = GREATEST(COALESCE((SELECT state_value FROM mamba_fact_malaria_etl_state
                                     WHERE state_key = 'lab_result.obs.obs_id'), 0) - 1000, 0);
SET @lr_new_max_obs = COALESCE((SELECT MAX(obs_id) FROM mamba_source_db.obs), 0);

-- ---- the orders to rebuild ----
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_order;
CREATE TEMPORARY TABLE mamba_tmp_lr_order
(
    order_id INT NOT NULL PRIMARY KEY
);

-- held rows whose order, encounter or attribution changed
INSERT IGNORE INTO mamba_tmp_lr_order (order_id)
SELECT f.order_id
FROM mamba_fact_malaria_lab_result f
         LEFT JOIN mamba_source_db.orders o ON o.order_id = f.order_id
         LEFT JOIN mamba_dim_encounter_location el ON el.encounter_id = o.encounter_id
WHERE o.order_id IS NULL
   OR o.voided = 1
   OR el.encounter_id IS NULL
   OR NOT (el.location_id <=> f.location_id)
   OR NOT (el.visit_id <=> f.visit_id)
   OR NOT (o.fulfiller_status <=> f.fulfiller_status)
   OR NOT (o.date_activated <=> f.ordered_at);

-- held results that were voided or deleted
INSERT IGNORE INTO mamba_tmp_lr_order (order_id)
SELECT f.order_id
FROM mamba_fact_malaria_lab_result f
         LEFT JOIN mamba_source_db.obs r ON r.obs_id = f.result_obs_id
WHERE f.result_obs_id <> 0
  AND (r.obs_id IS NULL OR r.voided = 1);

-- live test orders not held (new ones, and any whose order or encounter came back to life)
INSERT IGNORE INTO mamba_tmp_lr_order (order_id)
SELECT o.order_id
FROM mamba_source_db.test_order t
         INNER JOIN mamba_source_db.orders o ON o.order_id = t.order_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = o.encounter_id
         LEFT JOIN mamba_fact_malaria_lab_result f ON f.order_id = t.order_id
WHERE o.voided = 0
  AND o.order_action <> 'DISCONTINUE'
  AND f.order_id IS NULL;

-- test orders with new result obs linked by order_id (directly, or through the group obs)
INSERT IGNORE INTO mamba_tmp_lr_order (order_id)
SELECT DISTINCT COALESCE(r.order_id, g.order_id)
FROM mamba_source_db.obs r
         LEFT JOIN mamba_source_db.obs g ON g.obs_id = r.obs_group_id
         INNER JOIN mamba_source_db.test_order t ON t.order_id = COALESCE(r.order_id, g.order_id)
WHERE r.obs_id > @lr_max_obs
  AND r.obs_id <= @lr_new_max_obs;

-- test orders with new obs in their encounter carrying no order_id (the fallback link)
INSERT IGNORE INTO mamba_tmp_lr_order (order_id)
SELECT DISTINCT o.order_id
FROM mamba_source_db.obs r
         INNER JOIN mamba_source_db.orders o ON o.encounter_id = r.encounter_id
         INNER JOIN mamba_source_db.test_order t ON t.order_id = o.order_id
WHERE r.obs_id > @lr_max_obs
  AND r.obs_id <= @lr_new_max_obs
  AND r.order_id IS NULL;

DELETE f
FROM mamba_fact_malaria_lab_result f
         INNER JOIN mamba_tmp_lr_order a ON a.order_id = f.order_id;

-- ---- rebuild them ----
-- The live test orders among them, with their attribution.
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_live;
CREATE TEMPORARY TABLE mamba_tmp_lr_live
(
    order_id             INT         NOT NULL PRIMARY KEY,
    encounter_id         INT         NOT NULL,
    encounter_datetime   DATETIME    NOT NULL,
    visit_id             INT         NULL,
    client_id            INT         NOT NULL,
    location_id          INT         NOT NULL,
    facility_location_id INT         NULL,
    order_concept_id     INT         NOT NULL,
    order_number         VARCHAR(50) NULL,
    fulfiller_status     VARCHAR(50) NULL,
    ordered_at           DATETIME    NULL
);

INSERT INTO mamba_tmp_lr_live
SELECT o.order_id,
       o.encounter_id,
       e.encounter_datetime,
       el.visit_id,
       o.patient_id,
       el.location_id,
       h.facility_location_id,
       o.concept_id,
       o.order_number,
       o.fulfiller_status,
       o.date_activated
FROM mamba_tmp_lr_order a
         INNER JOIN mamba_source_db.orders o ON o.order_id = a.order_id
         INNER JOIN mamba_source_db.test_order t ON t.order_id = o.order_id
         INNER JOIN mamba_source_db.encounter e ON e.encounter_id = o.encounter_id
         INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = o.encounter_id
         LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = el.location_id
WHERE o.voided = 0
  AND o.order_action <> 'DISCONTINUE';

-- Results linked by order_id: the obs itself, or its group obs, names the order.
INSERT INTO mamba_fact_malaria_lab_result (order_id, result_obs_id, encounter_id, visit_id, client_id,
                                           location_id, facility_location_id, order_concept_id,
                                           order_number, fulfiller_status, ordered_at, result_concept_id,
                                           value_coded, value_numeric, value_text, result_obs_datetime,
                                           result_entered_at, resulted_at, result_linked_by)
SELECT l.order_id,
       r.obs_id,
       l.encounter_id,
       l.visit_id,
       l.client_id,
       l.location_id,
       l.facility_location_id,
       l.order_concept_id,
       l.order_number,
       l.fulfiller_status,
       l.ordered_at,
       r.concept_id,
       r.value_coded,
       r.value_numeric,
       r.value_text,
       r.obs_datetime,
       r.date_created,
       IF(r.obs_datetime > l.encounter_datetime, r.obs_datetime, r.date_created),
       'order_id'
FROM mamba_tmp_lr_live l
         INNER JOIN mamba_source_db.obs r ON r.order_id = l.order_id
WHERE r.voided = 0
  AND (r.value_coded IS NOT NULL OR r.value_numeric IS NOT NULL OR r.value_text IS NOT NULL
    OR r.value_datetime IS NOT NULL);

INSERT IGNORE INTO mamba_fact_malaria_lab_result (order_id, result_obs_id, encounter_id, visit_id, client_id,
                                                  location_id, facility_location_id, order_concept_id,
                                                  order_number, fulfiller_status, ordered_at,
                                                  result_concept_id, value_coded, value_numeric, value_text,
                                                  result_obs_datetime, result_entered_at, resulted_at,
                                                  result_linked_by)
SELECT l.order_id,
       r.obs_id,
       l.encounter_id,
       l.visit_id,
       l.client_id,
       l.location_id,
       l.facility_location_id,
       l.order_concept_id,
       l.order_number,
       l.fulfiller_status,
       l.ordered_at,
       r.concept_id,
       r.value_coded,
       r.value_numeric,
       r.value_text,
       r.obs_datetime,
       r.date_created,
       IF(r.obs_datetime > l.encounter_datetime, r.obs_datetime, r.date_created),
       'order_id'
FROM mamba_tmp_lr_live l
         INNER JOIN mamba_source_db.obs g ON g.order_id = l.order_id
         INNER JOIN mamba_source_db.obs r ON r.obs_group_id = g.obs_id
WHERE g.voided = 0
  AND r.voided = 0
  AND r.order_id IS NULL
  AND (r.value_coded IS NOT NULL OR r.value_numeric IS NOT NULL OR r.value_text IS NOT NULL
    OR r.value_datetime IS NOT NULL);

-- Fallback for orders that still have no result: obs with no order_id in the order's encounter,
-- whose concept is the order's concept or one of its set members.
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_pending;
CREATE TEMPORARY TABLE mamba_tmp_lr_pending
(
    order_id INT NOT NULL PRIMARY KEY
);
INSERT INTO mamba_tmp_lr_pending (order_id)
SELECT l.order_id
FROM mamba_tmp_lr_live l
         LEFT JOIN mamba_fact_malaria_lab_result f ON f.order_id = l.order_id
WHERE f.order_id IS NULL;

INSERT IGNORE INTO mamba_fact_malaria_lab_result (order_id, result_obs_id, encounter_id, visit_id, client_id,
                                                  location_id, facility_location_id, order_concept_id,
                                                  order_number, fulfiller_status, ordered_at,
                                                  result_concept_id, value_coded, value_numeric, value_text,
                                                  result_obs_datetime, result_entered_at, resulted_at,
                                                  result_linked_by)
SELECT l.order_id,
       r.obs_id,
       l.encounter_id,
       l.visit_id,
       l.client_id,
       l.location_id,
       l.facility_location_id,
       l.order_concept_id,
       l.order_number,
       l.fulfiller_status,
       l.ordered_at,
       r.concept_id,
       r.value_coded,
       r.value_numeric,
       r.value_text,
       r.obs_datetime,
       r.date_created,
       IF(r.obs_datetime > l.encounter_datetime, r.obs_datetime, r.date_created),
       'encounter_concept'
FROM mamba_tmp_lr_pending p
         INNER JOIN mamba_tmp_lr_live l ON l.order_id = p.order_id
         INNER JOIN mamba_source_db.obs r ON r.encounter_id = l.encounter_id
WHERE r.voided = 0
  AND r.order_id IS NULL
  AND (r.concept_id = l.order_concept_id
    OR r.concept_id IN (SELECT cs.concept_id
                        FROM mamba_source_db.concept_set cs
                        WHERE cs.concept_set = l.order_concept_id))
  AND (r.value_coded IS NOT NULL OR r.value_numeric IS NOT NULL OR r.value_text IS NOT NULL
    OR r.value_datetime IS NOT NULL);

-- Orders with no result at all: one row, result_obs_id = 0.
INSERT IGNORE INTO mamba_fact_malaria_lab_result (order_id, result_obs_id, encounter_id, visit_id, client_id,
                                                  location_id, facility_location_id, order_concept_id,
                                                  order_number, fulfiller_status, ordered_at)
SELECT l.order_id,
       0,
       l.encounter_id,
       l.visit_id,
       l.client_id,
       l.location_id,
       l.facility_location_id,
       l.order_concept_id,
       l.order_number,
       l.fulfiller_status,
       l.ordered_at
FROM mamba_tmp_lr_live l
         LEFT JOIN mamba_fact_malaria_lab_result f ON f.order_id = l.order_id
WHERE f.order_id IS NULL;

-- ---- classify the rebuilt rows ----
UPDATE mamba_fact_malaria_lab_result f
    INNER JOIN mamba_tmp_lr_live l ON l.order_id = f.order_id
SET f.test_code = CASE
                      WHEN f.result_concept_id IN (@lr_rdt) THEN 'malaria_rdt'
                      WHEN f.result_concept_id IN (@lr_smear, @lr_species) THEN 'malaria_smear'
                      WHEN f.result_concept_id = @lr_chol THEN 'cholesterol_total'
                      WHEN f.result_concept_id = @lr_creat THEN 'creatinine_umol'
                      WHEN f.result_concept_id = @lr_creat_mg THEN 'creatinine_mgdl'
                      WHEN f.result_concept_id = @lr_urea THEN 'urea'
                      WHEN f.result_concept_id = @lr_egfr THEN 'egfr'
                      WHEN f.result_concept_id = @lr_fbg THEN 'glucose_fasting'
                      WHEN f.result_concept_id = @lr_glu THEN 'glucose_serum'
                      WHEN f.result_concept_id = @lr_glu_mmol THEN 'glucose_mmol'
                      WHEN f.result_concept_id IS NOT NULL THEN NULL
                      WHEN f.order_concept_id = @lr_rdt THEN 'malaria_rdt'
                      WHEN f.order_concept_id IN (@lr_smear, @lr_smear_set, @lr_species) THEN 'malaria_smear'
                      WHEN f.order_concept_id = @lr_chol THEN 'cholesterol_total'
                      WHEN f.order_concept_id = @lr_creat THEN 'creatinine_umol'
                      WHEN f.order_concept_id = @lr_creat_mg THEN 'creatinine_mgdl'
                      WHEN f.order_concept_id = @lr_urea THEN 'urea'
                      WHEN f.order_concept_id = @lr_egfr THEN 'egfr'
                      WHEN f.order_concept_id = @lr_fbg THEN 'glucose_fasting'
                      WHEN f.order_concept_id = @lr_glu THEN 'glucose_serum'
                      WHEN f.order_concept_id = @lr_glu_mmol THEN 'glucose_mmol'
    END;

UPDATE mamba_fact_malaria_lab_result f
    INNER JOIN mamba_tmp_lr_live l ON l.order_id = f.order_id
SET f.test_group          = CASE
                                WHEN f.test_code LIKE 'malaria%' THEN 'malaria'
                                WHEN f.test_code = 'cholesterol_total' THEN 'lipid'
                                WHEN f.test_code IN ('creatinine_umol', 'creatinine_mgdl', 'urea', 'egfr')
                                    THEN 'renal'
                                WHEN f.test_code LIKE 'glucose%' THEN 'glucose'
        END,
    f.is_malaria_positive = IF(f.test_code LIKE 'malaria%'
                                   AND f.value_coded IN (SELECT concept_id FROM mamba_tmp_lr_positive), 1, 0);

-- ---- facility column, where the hierarchy moved ----
UPDATE mamba_fact_malaria_lab_result f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id
WHERE NOT (f.facility_location_id <=> h.facility_location_id);

INSERT INTO mamba_fact_malaria_etl_state (state_key, state_value)
VALUES ('lab_result.obs.obs_id', @lr_new_max_obs)
ON DUPLICATE KEY UPDATE state_value = VALUES(state_value);

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_pending;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_live;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_order;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_lr_positive;

-- $END
