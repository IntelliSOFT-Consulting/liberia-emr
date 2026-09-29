-- mamba_fact_rmncah_family_planning: one row per live encounter on ANY version of
-- `3. Family Planning` (RMNCAH-017, contraceptive prevalence).
--
-- Forms:
--   * v2.2 (MCH) by its form variable. It was keyed on the FORM because the family-planning
--     encounter-type variable had two values (gaps note, gap 10). The MCH type now has its own
--     key, var.encountertype.mch-family-planning.uuid, but the FORM is still the right key:
--     every column below reads this form's questions, and v1.0 has no FP encounter type.
--   * v1.0 (national, on the shared Consultation type). INTERIM: matched on form NAME and
--     VERSION, because no variable holds its runtime uuid. Replace with a ${var.form.*} token
--     once one exists.
--
-- Columns:
--   client_type            'new' / 'continuing' (v2.2 only)
--   chosen_method_uuid     answer to Chosen Family Planning Method (v2.2 only)
--   dispensed_method_uuid  answer to Family Planning Method Dispensed
--   method                 the method class of the dispensed answer, else of the chosen one:
--                          injectable, pill, implant, iud, condom, lam, cycle_beads
--   is_modern_method       1 for every class above
--   protection_months      how long one contact protects (qa/reporting README, ambiguity 5, and
--                          the matrix note): injectable 3, pill 1, condom 1 (the lower bound,
--                          as for pills), implant 36, iud 120. NULL for lam and cycle_beads:
--                          the matrix defines no window for them, so they are never a current
--                          user until one is agreed.
--   protected_until        DATE(encounter_datetime) + protection_months
--   method_removed_date    Date when the family planning method was removed
--
-- RMNCAH-017 (current user at period end E): take each woman's LATEST row with
-- encounter_datetime <= E; she counts when method_removed_date IS NULL, protected_until >= E,
-- and she is 15-49 at E (birthdate is carried for that).
--
-- Rebuilt in full on every run. Runs in the ETL schema's context; mamba_source_db is replaced
-- at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_rmncah_family_planning
(
    encounter_id          INT          NOT NULL PRIMARY KEY,
    visit_id              INT          NULL,
    client_id             INT          NOT NULL,
    person_key            VARCHAR(46)  NOT NULL,
    birthdate             DATE         NULL,
    gender                VARCHAR(50)  NULL,
    encounter_datetime    DATETIME     NOT NULL,
    location_id           INT          NOT NULL,
    facility_location_id  INT          NULL,
    form_uuid             CHAR(38)     NOT NULL,
    form_version          VARCHAR(50)  NOT NULL,
    client_type           VARCHAR(10)  NULL,
    chosen_method_uuid    CHAR(38)     NULL,
    dispensed_method_uuid CHAR(38)     NULL,
    method                VARCHAR(20)  NULL,
    is_modern_method      TINYINT(1)   NOT NULL,
    protection_months     SMALLINT     NULL,
    protected_until       DATE         NULL,
    method_removed_date   DATE         NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

TRUNCATE TABLE mamba_fact_rmncah_family_planning;

INSERT INTO mamba_fact_rmncah_family_planning (encounter_id, visit_id, client_id, person_key,
                                               birthdate, gender, encounter_datetime,
                                               location_id, facility_location_id, form_uuid,
                                               form_version, client_type, chosen_method_uuid,
                                               dispensed_method_uuid, method, is_modern_method,
                                               protection_months, protected_until,
                                               method_removed_date)
SELECT m.encounter_id,
       m.visit_id,
       m.client_id,
       m.person_key,
       m.birthdate,
       m.gender,
       m.encounter_datetime,
       m.location_id,
       m.facility_location_id,
       m.form_uuid,
       m.form_version,
       m.client_type,
       m.chosen_method_uuid,
       m.dispensed_method_uuid,
       m.method,
       IF(m.method IS NULL, 0, 1),
       m.protection_months,
       IF(m.protection_months IS NULL, NULL,
          DATE_ADD(DATE(m.encounter_datetime), INTERVAL m.protection_months MONTH)),
       m.method_removed_date
FROM (SELECT c.*,
             CASE COALESCE(c.dispensed_method, c.chosen_method)
                 WHEN 'injectable' THEN 3
                 WHEN 'pill' THEN 1
                 WHEN 'condom' THEN 1
                 WHEN 'implant' THEN 36
                 WHEN 'iud' THEN 120
                 END                                          AS protection_months,
             COALESCE(c.dispensed_method, c.chosen_method) AS method
      FROM (SELECT b.*,
                   CASE
                       WHEN b.dispensed_method_uuid IN ('${var.concept.ciel.injectable-contraceptives.uuid}',
                                                        '${var.concept.ciel.drug.medroxyprogesterone-acetate.uuid}',
                                                        '${var.concept.mch.fp-sayana-press.uuid}') THEN 'injectable'
                       WHEN b.dispensed_method_uuid IN ('${var.concept.mch.fp-microgynon.uuid}',
                                                        '${var.concept.mch.fp-microlut.uuid}') THEN 'pill'
                       WHEN b.dispensed_method_uuid IN ('${var.concept.ciel.male-condoms.uuid}',
                                                        '${var.concept.ciel.female-condoms.uuid}') THEN 'condom'
                       WHEN b.dispensed_method_uuid = '${var.concept.mch.fp-implants.uuid}' THEN 'implant'
                       WHEN b.dispensed_method_uuid IN ('${var.concept.ciel.iud.uuid}',
                                                        '${var.concept.national.iuds.uuid}') THEN 'iud'
                       WHEN b.dispensed_method_uuid = '${var.concept.mch.fp-lam.uuid}' THEN 'lam'
                       WHEN b.dispensed_method_uuid = '${var.concept.mch.fp-cycle-beads.uuid}' THEN 'cycle_beads'
                       END AS dispensed_method,
                   CASE
                       WHEN b.chosen_method_uuid IN ('${var.concept.ciel.injectable-contraceptives.uuid}',
                                                     '${var.concept.ciel.drug.medroxyprogesterone-acetate.uuid}',
                                                     '${var.concept.mch.fp-sayana-press.uuid}') THEN 'injectable'
                       WHEN b.chosen_method_uuid IN ('${var.concept.mch.fp-microgynon.uuid}',
                                                     '${var.concept.mch.fp-microlut.uuid}') THEN 'pill'
                       WHEN b.chosen_method_uuid IN ('${var.concept.ciel.male-condoms.uuid}',
                                                     '${var.concept.ciel.female-condoms.uuid}') THEN 'condom'
                       WHEN b.chosen_method_uuid = '${var.concept.mch.fp-implants.uuid}' THEN 'implant'
                       WHEN b.chosen_method_uuid IN ('${var.concept.ciel.iud.uuid}',
                                                     '${var.concept.national.iuds.uuid}') THEN 'iud'
                       WHEN b.chosen_method_uuid = '${var.concept.mch.fp-lam.uuid}' THEN 'lam'
                       WHEN b.chosen_method_uuid = '${var.concept.mch.fp-cycle-beads.uuid}' THEN 'cycle_beads'
                       END AS chosen_method
            FROM (SELECT e.encounter_id,
                         e.visit_id,
                         e.patient_id AS client_id,
                         pc.person_key,
                         p.birthdate,
                         p.gender,
                         e.encounter_datetime,
                         el.location_id,
                         lh.facility_location_id,
                         f.uuid       AS form_uuid,
                         f.version    AS form_version,
                         ob.client_type,
                         ob.chosen_method_uuid,
                         ob.dispensed_method_uuid,
                         ob.method_removed_date
                  FROM mamba_source_db.encounter e
                           INNER JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
                           INNER JOIN mamba_source_db.form f ON f.form_id = ef.form_id
                           INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
                           INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = e.patient_id
                           INNER JOIN mamba_source_db.person p ON p.person_id = e.patient_id
                           LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
                           LEFT JOIN
                       (SELECT o.encounter_id,
                               SUBSTRING_INDEX(GROUP_CONCAT(
                                                       CASE
                                                           WHEN q.uuid = '${var.concept.mch.fp-client-type.uuid}'
                                                               THEN CASE a.uuid
                                                                        WHEN '${var.concept.mch.fp-client-new.uuid}' THEN 'new'
                                                                        WHEN '${var.concept.mch.fp-client-continuing.uuid}'
                                                                            THEN 'continuing'
                                                                   END END
                                                       ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                               '|', 1) AS client_type,
                               SUBSTRING_INDEX(GROUP_CONCAT(
                                                       CASE
                                                           WHEN q.uuid = '${var.concept.mch.fp-chosen-method.uuid}'
                                                               THEN a.uuid END
                                                       ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                               '|', 1) AS chosen_method_uuid,
                               SUBSTRING_INDEX(GROUP_CONCAT(
                                                       CASE
                                                           WHEN q.uuid =
                                                                '${var.concept.national.family-planning-method-dispensed.uuid}'
                                                               THEN a.uuid END
                                                       ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                               '|', 1) AS dispensed_method_uuid,
                               CAST(SUBSTRING_INDEX(GROUP_CONCAT(
                                                            CASE
                                                                WHEN q.uuid =
                                                                     '${var.concept.national.date-when-the-family-planning-method-was-removed.uuid}'
                                                                    THEN DATE(o.value_datetime) END
                                                            ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                                    '|', 1) AS DATE) AS method_removed_date
                        FROM mamba_source_db.obs o
                                 INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
                                 LEFT JOIN mamba_source_db.concept a ON a.concept_id = o.value_coded
                        WHERE o.voided = 0
                          AND o.encounter_id IS NOT NULL
                          AND q.uuid IN ('${var.concept.mch.fp-client-type.uuid}',
                                         '${var.concept.mch.fp-chosen-method.uuid}',
                                         '${var.concept.national.family-planning-method-dispensed.uuid}',
                                         '${var.concept.national.date-when-the-family-planning-method-was-removed.uuid}')
                        GROUP BY o.encounter_id) ob ON ob.encounter_id = e.encounter_id
                  WHERE e.voided = 0
                    AND (f.uuid = '${var.form.family-planning.uuid}'
                      -- INTERIM name/version match: v1.0 has no runtime form variable.
                      OR (f.name = '3. Family Planning' AND f.version = '1.0'))) b) c) m;

-- $END
