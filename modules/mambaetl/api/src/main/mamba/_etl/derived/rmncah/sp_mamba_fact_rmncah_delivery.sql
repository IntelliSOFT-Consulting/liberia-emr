-- mamba_fact_rmncah_delivery: one row per live labour-and-delivery encounter, grouped into
-- delivery episodes (RMNCAH-026; later RMNCAH-014, 016, 027 and live-birth denominators).
--
-- Rows: encounters of the national `Labor & Delivery` type (where every labour form saves;
-- gaps note, gap 12) entered on `1. First and Second Stage of Labor and Delivery` or
-- `3. Third Stage of Labor and Delivery`, by their form variables. A new version of either form
-- is a new form uuid, so the variable (or this list) must cover it.
--
-- Episodes: rows of one patient record whose encounter_datetime is within 42 days of the
-- previous row are one delivery (matrix note; qa/reporting README, ambiguity 6). An episode
-- belongs to the period of its FIRST row; count rows with is_episode_start = 1.
--
-- Columns:
--   delivery_method_uuid     answer to Delivery method on this encounter
--   delivery_method          'svd' / 'caesarean'
--   is_caesarean             1 when this encounter records Caesarean section (CIEL 1171)
--   birth_outcome_uuid       RESERVED, always NULL today: no form asks for a birth outcome
--                            (gaps note, gap 1). A later form version fills it; reports may
--                            select it already.
--   is_episode_start, episode_start_encounter_id, episode_start_datetime
--   episode_delivery_method  'caesarean' if any row of the episode records it, else 'svd' if any
--                            does, else NULL (no method recorded in the episode)
--
-- RMNCAH-026: over rows with is_episode_start = 1 and episode_start_datetime in the period,
-- denominator = episode_delivery_method IS NOT NULL, numerator = 'caesarean'.
--
-- Rebuilt in full on every run (episodes can merge or split when a row is voided).
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_rmncah_delivery
(
    encounter_id               INT         NOT NULL PRIMARY KEY,
    visit_id                   INT         NULL,
    client_id                  INT         NOT NULL,
    person_key                 VARCHAR(46) NOT NULL,
    encounter_datetime         DATETIME    NOT NULL,
    location_id                INT         NOT NULL,
    facility_location_id       INT         NULL,
    form_uuid                  CHAR(38)    NOT NULL,
    delivery_method_uuid       CHAR(38)    NULL,
    delivery_method            VARCHAR(10) NULL,
    is_caesarean               TINYINT(1)  NOT NULL,
    birth_outcome_uuid         CHAR(38)    NULL,
    is_episode_start           TINYINT(1)  NOT NULL,
    episode_start_encounter_id INT         NOT NULL,
    episode_start_datetime     DATETIME    NOT NULL,
    episode_delivery_method    VARCHAR(10) NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_episode_start_datetime (episode_start_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

TRUNCATE TABLE mamba_fact_rmncah_delivery;

INSERT INTO mamba_fact_rmncah_delivery (encounter_id, visit_id, client_id, person_key,
                                        encounter_datetime, location_id, facility_location_id,
                                        form_uuid, delivery_method_uuid, delivery_method,
                                        is_caesarean, birth_outcome_uuid, is_episode_start,
                                        episode_start_encounter_id, episode_start_datetime,
                                        episode_delivery_method)
SELECT s.encounter_id,
       s.visit_id,
       s.client_id,
       s.person_key,
       s.encounter_datetime,
       s.location_id,
       s.facility_location_id,
       s.form_uuid,
       s.delivery_method_uuid,
       s.delivery_method,
       s.is_caesarean,
       NULL,
       s.is_episode_start,
       FIRST_VALUE(s.encounter_id) OVER (PARTITION BY s.client_id, s.episode_seq ORDER BY s.encounter_datetime, s.encounter_id),
       FIRST_VALUE(s.encounter_datetime) OVER (PARTITION BY s.client_id, s.episode_seq ORDER BY s.encounter_datetime, s.encounter_id),
       CASE
           WHEN MAX(s.is_caesarean) OVER (PARTITION BY s.client_id, s.episode_seq) = 1 THEN 'caesarean'
           WHEN MAX(s.delivery_method = 'svd') OVER (PARTITION BY s.client_id, s.episode_seq) = 1 THEN 'svd'
           END
FROM (SELECT r.*,
             SUM(r.is_episode_start) OVER (PARTITION BY r.client_id
                 ORDER BY r.encounter_datetime, r.encounter_id
                 ROWS UNBOUNDED PRECEDING) AS episode_seq
      FROM (SELECT d.*,
                   CASE
                       WHEN LAG(d.encounter_datetime) OVER (PARTITION BY d.client_id
                           ORDER BY d.encounter_datetime, d.encounter_id) IS NULL THEN 1
                       WHEN d.encounter_datetime > LAG(d.encounter_datetime) OVER (PARTITION BY d.client_id
                           ORDER BY d.encounter_datetime, d.encounter_id) + INTERVAL 42 DAY THEN 1
                       ELSE 0 END AS is_episode_start
            FROM (SELECT e.encounter_id,
                         e.visit_id,
                         e.patient_id AS client_id,
                         pc.person_key,
                         e.encounter_datetime,
                         el.location_id,
                         lh.facility_location_id,
                         f.uuid       AS form_uuid,
                         ob.delivery_method_uuid,
                         CASE ob.delivery_method_uuid
                             WHEN '${var.concept.national.spontaneous-vaginal-delivery-svd.uuid}' THEN 'svd'
                             WHEN '${var.concept.ciel.cesarean-section.uuid}' THEN 'caesarean'
                             END      AS delivery_method,
                         IF(ob.delivery_method_uuid = '${var.concept.ciel.cesarean-section.uuid}', 1, 0) AS is_caesarean
                  FROM mamba_source_db.encounter e
                           INNER JOIN mamba_source_db.encounter_type et ON et.encounter_type_id = e.encounter_type
                           INNER JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
                           INNER JOIN mamba_source_db.form f ON f.form_id = ef.form_id
                           INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
                           INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = e.patient_id
                           LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
                           LEFT JOIN
                       (SELECT o.encounter_id,
                               SUBSTRING_INDEX(GROUP_CONCAT(a.uuid ORDER BY o.obs_datetime DESC, o.obs_id DESC
                                                            SEPARATOR '|'), '|', 1) AS delivery_method_uuid
                        FROM mamba_source_db.obs o
                                 INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
                                 INNER JOIN mamba_source_db.concept a ON a.concept_id = o.value_coded
                        WHERE o.voided = 0
                          AND o.encounter_id IS NOT NULL
                          AND q.uuid = '${var.concept.national.delivery-method.uuid}'
                        GROUP BY o.encounter_id) ob ON ob.encounter_id = e.encounter_id
                  WHERE e.voided = 0
                    AND et.uuid = '${var.encountertype.labor-delivery.uuid}'
                    AND f.uuid IN ('${var.form.first-and-second-stage-of-labor-and-delivery.uuid}',
                                   '${var.form.third-stage-of-labor-and-delivery.uuid}')) d) r) s;

-- $END
