-- mamba_fact_rmncah_mother_pnc: one row per live `Mother PNC` encounter, grouped into delivery
-- episodes (RMNCAH-028, deliveries at home).
--
-- Rows: encounters of type Postnatal Visit on the Mother PNC form, by their variables.
--
-- Episodes: rows of one patient record within 42 days of the previous row report one delivery
-- (matrix note; qa/reporting README, ambiguity 6). An episode belongs to the period of its
-- FIRST row; count rows with is_episode_start = 1.
--
-- Columns:
--   place_of_delivery_uuid   answer to Place of Delivery on this encounter
--   place_of_delivery        'home' / 'health_facility'
--   is_episode_start, episode_start_encounter_id, episode_start_datetime
--   episode_place_of_delivery  'home' if any row of the episode records Home, else
--                              'health_facility' if any records it, else NULL
--
-- RMNCAH-028: rows with is_episode_start = 1, episode_start_datetime in the period and
-- episode_place_of_delivery = 'home'. It undercounts: only home deliveries that reach PNC appear.
--
-- Rebuilt in full on every run. Runs in the ETL schema's context; mamba_source_db is replaced
-- at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_rmncah_mother_pnc
(
    encounter_id               INT         NOT NULL PRIMARY KEY,
    visit_id                   INT         NULL,
    client_id                  INT         NOT NULL,
    person_key                 VARCHAR(46) NOT NULL,
    encounter_datetime         DATETIME    NOT NULL,
    location_id                INT         NOT NULL,
    facility_location_id       INT         NULL,
    form_uuid                  CHAR(38)    NOT NULL,
    place_of_delivery_uuid     CHAR(38)    NULL,
    place_of_delivery          VARCHAR(20) NULL,
    is_episode_start           TINYINT(1)  NOT NULL,
    episode_start_encounter_id INT         NOT NULL,
    episode_start_datetime     DATETIME    NOT NULL,
    episode_place_of_delivery  VARCHAR(20) NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_episode_start_datetime (episode_start_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

TRUNCATE TABLE mamba_fact_rmncah_mother_pnc;

INSERT INTO mamba_fact_rmncah_mother_pnc (encounter_id, visit_id, client_id, person_key,
                                          encounter_datetime, location_id, facility_location_id,
                                          form_uuid, place_of_delivery_uuid, place_of_delivery,
                                          is_episode_start, episode_start_encounter_id,
                                          episode_start_datetime, episode_place_of_delivery)
SELECT s.encounter_id,
       s.visit_id,
       s.client_id,
       s.person_key,
       s.encounter_datetime,
       s.location_id,
       s.facility_location_id,
       s.form_uuid,
       s.place_of_delivery_uuid,
       s.place_of_delivery,
       s.is_episode_start,
       FIRST_VALUE(s.encounter_id) OVER (PARTITION BY s.client_id, s.episode_seq
           ORDER BY s.encounter_datetime, s.encounter_id),
       FIRST_VALUE(s.encounter_datetime) OVER (PARTITION BY s.client_id, s.episode_seq
           ORDER BY s.encounter_datetime, s.encounter_id),
       CASE
           WHEN MAX(s.place_of_delivery = 'home') OVER (PARTITION BY s.client_id, s.episode_seq) = 1
               THEN 'home'
           WHEN MAX(s.place_of_delivery = 'health_facility') OVER (PARTITION BY s.client_id, s.episode_seq) = 1
               THEN 'health_facility'
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
                         ob.place_of_delivery_uuid,
                         CASE ob.place_of_delivery_uuid
                             WHEN '${var.concept.national.place-of-delivery-home.uuid}' THEN 'home'
                             WHEN '${var.concept.ciel.health-facility.uuid}' THEN 'health_facility'
                             END      AS place_of_delivery
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
                                                            SEPARATOR '|'), '|', 1) AS place_of_delivery_uuid
                        FROM mamba_source_db.obs o
                                 INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
                                 INNER JOIN mamba_source_db.concept a ON a.concept_id = o.value_coded
                        WHERE o.voided = 0
                          AND o.encounter_id IS NOT NULL
                          AND q.uuid = '${var.concept.national.place-of-delivery.uuid}'
                        GROUP BY o.encounter_id) ob ON ob.encounter_id = e.encounter_id
                  WHERE e.voided = 0
                    AND et.uuid = '${var.encountertype.mch-pnc.uuid}'
                    AND f.uuid = '${var.form.pnc-visit.uuid}') d) r) s;

-- $END
