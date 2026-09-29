-- mamba_fact_rmncah_anc_visit: one row per live ANC contact, from BOTH ANC form families
-- (rmncah-nutrition-gaps.md gap 13 and §2 "ANC visit table"). It is the shared ANC/IPTp table:
-- RPT 6 owns it, and the malaria facts consume it (MAL-002, MAL-003, MAL-011). Its columns are
-- a published contract (modules/mambaetl/README.md); add columns, never rename or drop one.
--
-- Contacts:
--   * MCH family: every encounter of type ANC Initial Visit or ANC Follow-up Visit, whatever
--     the form version (ANC Initial v1.1 and v1.2 both count).
--   * National family: `1. ANC Form` v1.1 on the shared Consultation type, matched on
--     ${var.form.anc-national.uuid}, the runtime uuid Initializer derives from the form's name
--     and version (so a new form version needs its own token here).
--
-- Columns (NULL = not recorded on that contact):
--   anc_form_family         'mch' or 'national'
--   is_first_anc_contact    1 when the contact is an ANC Initial Visit, or the national form's
--                           ANC visit number is 1st (MAL-002 denominator)
--   anc_visit_number        1-4, from the national `ANC visit number` answer
--   gestational_age_weeks   CIEL 1438 (ANC Initial, national form) or the local follow-up concept
--   trimester               1-3, from Pregnancy trimester (CIEL 5272)
--   is_third_trimester      1 when trimester = 3 or gestational_age_weeks >= 28 (MAL-003)
--   iptp_dose_number        the highest IPTp dose given at the contact: 1-4 from the MCH question,
--                           1-3 from the national one, whose 3rd answer means "3rd or later"
--   woman_receiving_ipt     1 yes, 0 no
--   iptp_deferral_reason_uuid, iptp_deferred   the MCH deferral reason, and 1 when one is given
--   llin_received           1 yes, 0 no (MAL-011)
-- A voided obs never counts. Where a question has several live answers on one contact, the
-- latest obs wins, except the IPTp dose, which takes the highest.
--
-- Rebuilt in full on every run (one indexed pass over obs for nine concepts), so edits,
-- voids and late entries need no incremental bookkeeping.
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_rmncah_anc_visit
(
    encounter_id              INT          NOT NULL PRIMARY KEY,
    visit_id                  INT          NULL,
    client_id                 INT          NOT NULL,
    person_key                VARCHAR(46)  NOT NULL,
    encounter_datetime        DATETIME     NOT NULL,
    location_id               INT          NOT NULL,
    facility_location_id      INT          NULL,
    encounter_type_uuid       CHAR(38)     NOT NULL,
    form_uuid                 CHAR(38)     NULL,
    anc_form_family           VARCHAR(10)  NOT NULL,
    is_first_anc_contact      TINYINT(1)   NOT NULL,
    anc_visit_number          TINYINT      NULL,
    gestational_age_weeks     DECIMAL(6, 1) NULL,
    trimester                 TINYINT      NULL,
    is_third_trimester        TINYINT(1)   NOT NULL,
    iptp_dose_number          TINYINT      NULL,
    woman_receiving_ipt       TINYINT(1)   NULL,
    iptp_deferral_reason_uuid CHAR(38)     NULL,
    iptp_deferred             TINYINT(1)   NOT NULL,
    llin_received             TINYINT(1)   NULL,

    INDEX mamba_idx_client_id (client_id),
    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_encounter_datetime (encounter_datetime),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id)
);

TRUNCATE TABLE mamba_fact_rmncah_anc_visit;

INSERT INTO mamba_fact_rmncah_anc_visit (encounter_id, visit_id, client_id, person_key,
                                         encounter_datetime, location_id, facility_location_id,
                                         encounter_type_uuid, form_uuid, anc_form_family,
                                         is_first_anc_contact, anc_visit_number,
                                         gestational_age_weeks, trimester, is_third_trimester,
                                         iptp_dose_number, woman_receiving_ipt,
                                         iptp_deferral_reason_uuid, iptp_deferred, llin_received)
SELECT c.encounter_id,
       c.visit_id,
       c.client_id,
       c.person_key,
       c.encounter_datetime,
       c.location_id,
       c.facility_location_id,
       c.encounter_type_uuid,
       c.form_uuid,
       c.anc_form_family,
       CASE
           WHEN c.encounter_type_uuid = '${var.encountertype.anc-initial.uuid}' THEN 1
           WHEN ob.anc_visit_number = 1 THEN 1
           ELSE 0 END,
       ob.anc_visit_number,
       CAST(ob.gestational_age_weeks AS DECIMAL(6, 1)),
       ob.trimester,
       CASE
           WHEN ob.trimester = 3 THEN 1
           WHEN CAST(ob.gestational_age_weeks AS DECIMAL(6, 1)) >= 28 THEN 1
           ELSE 0 END,
       ob.iptp_dose_number,
       ob.woman_receiving_ipt,
       ob.iptp_deferral_reason_uuid,
       IF(ob.iptp_deferral_reason_uuid IS NULL, 0, 1),
       ob.llin_received
FROM (SELECT e.encounter_id,
             e.visit_id,
             e.patient_id                          AS client_id,
             pc.person_key,
             e.encounter_datetime,
             el.location_id,
             lh.facility_location_id,
             et.uuid                               AS encounter_type_uuid,
             f.uuid                                AS form_uuid,
             IF(et.uuid IN ('${var.encountertype.anc-initial.uuid}',
                            '${var.encountertype.anc-followup.uuid}'), 'mch', 'national') AS anc_form_family
      FROM mamba_source_db.encounter e
               INNER JOIN mamba_source_db.encounter_type et ON et.encounter_type_id = e.encounter_type
               INNER JOIN mamba_dim_encounter_location el ON el.encounter_id = e.encounter_id
               INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = e.patient_id
               LEFT JOIN mamba_dim_location_hierarchy lh ON lh.location_id = el.location_id
               LEFT JOIN mamba_dim_encounter_form ef ON ef.encounter_id = e.encounter_id
               LEFT JOIN mamba_source_db.form f ON f.form_id = ef.form_id
      WHERE e.voided = 0
        AND (et.uuid IN ('${var.encountertype.anc-initial.uuid}',
                         '${var.encountertype.anc-followup.uuid}')
          OR (et.uuid = '${var.encountertype.consultation.uuid}'
              AND f.uuid = '${var.form.anc-national.uuid}'))) c
         LEFT JOIN
     (SELECT o.encounter_id,
             SUBSTRING_INDEX(GROUP_CONCAT(
                                     CASE
                                         WHEN q.uuid IN ('${var.concept.ciel.gestational-age.uuid}',
                                                         '${var.concept.national.gestational-age-weeks.uuid}')
                                             THEN o.value_numeric END
                                     ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                             '|', 1) AS gestational_age_weeks,
             CAST(SUBSTRING_INDEX(GROUP_CONCAT(
                                          CASE
                                              WHEN q.uuid = '${var.concept.ciel.pregnancy-status.uuid}'
                                                  THEN CASE a.uuid
                                                           WHEN '${var.concept.national.1st-trimester.uuid}' THEN 1
                                                           WHEN '${var.concept.national.2nd-trimester.uuid}' THEN 2
                                                           WHEN '${var.concept.national.3rd-trimester.uuid}' THEN 3
                                                  END END
                                          ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                  '|', 1) AS UNSIGNED) AS trimester,
             CAST(SUBSTRING_INDEX(GROUP_CONCAT(
                                          CASE
                                              WHEN q.uuid = '${var.concept.national.anc-visit-number.uuid}'
                                                  THEN CASE a.uuid
                                                           WHEN '${var.concept.national.1st.uuid}' THEN 1
                                                           WHEN '${var.concept.national.2nd.uuid}' THEN 2
                                                           WHEN '${var.concept.national.3rd.uuid}' THEN 3
                                                           WHEN '${var.concept.national.4th.uuid}' THEN 4
                                                  END END
                                          ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                  '|', 1) AS UNSIGNED) AS anc_visit_number,
             MAX(CASE
                     WHEN q.uuid = '${var.concept.mch.ipt-dose-administered.uuid}'
                         THEN CASE a.uuid
                                  WHEN '${var.concept.mch.1st-ipt-dose.uuid}' THEN 1
                                  WHEN '${var.concept.mch.2nd-ipt-dose.uuid}' THEN 2
                                  WHEN '${var.concept.mch.3rd-ipt-dose.uuid}' THEN 3
                                  WHEN '${var.concept.mch.4th-ipt-dose.uuid}' THEN 4
                         END
                     WHEN q.uuid = '${var.concept.national.ipt-dose-administered.uuid}'
                         THEN CASE a.uuid
                                  WHEN '${var.concept.national.1st-ipt-dose.uuid}' THEN 1
                                  WHEN '${var.concept.national.2nd-ipt-dose.uuid}' THEN 2
                                  WHEN '${var.concept.national.3rd-ipt-dose.uuid}' THEN 3
                         END
                 END)                   AS iptp_dose_number,
             CAST(SUBSTRING_INDEX(GROUP_CONCAT(
                                          CASE
                                              WHEN q.uuid = '${var.concept.national.woman-receiving-ipt.uuid}'
                                                  THEN CASE a.uuid
                                                           WHEN '${var.concept.ciel.yes.uuid}' THEN 1
                                                           WHEN '${var.concept.ciel.no.uuid}' THEN 0
                                                  END END
                                          ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                  '|', 1) AS UNSIGNED) AS woman_receiving_ipt,
             SUBSTRING_INDEX(GROUP_CONCAT(
                                     CASE
                                         WHEN q.uuid = '${var.concept.mch.iptp-deferral-reason.uuid}'
                                             THEN a.uuid END
                                     ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                             '|', 1) AS iptp_deferral_reason_uuid,
             CAST(SUBSTRING_INDEX(GROUP_CONCAT(
                                          CASE
                                              WHEN q.uuid = '${var.concept.national.llin-received-at-anc.uuid}'
                                                  THEN CASE a.uuid
                                                           WHEN '${var.concept.ciel.yes.uuid}' THEN 1
                                                           WHEN '${var.concept.ciel.no.uuid}' THEN 0
                                                  END END
                                          ORDER BY o.obs_datetime DESC, o.obs_id DESC SEPARATOR '|'),
                                  '|', 1) AS UNSIGNED) AS llin_received
      FROM mamba_source_db.obs o
               INNER JOIN mamba_source_db.concept q ON q.concept_id = o.concept_id
               LEFT JOIN mamba_source_db.concept a ON a.concept_id = o.value_coded
      WHERE o.voided = 0
        AND o.encounter_id IS NOT NULL
        AND q.uuid IN ('${var.concept.ciel.gestational-age.uuid}',
                       '${var.concept.national.gestational-age-weeks.uuid}',
                       '${var.concept.ciel.pregnancy-status.uuid}',
                       '${var.concept.national.anc-visit-number.uuid}',
                       '${var.concept.mch.ipt-dose-administered.uuid}',
                       '${var.concept.national.ipt-dose-administered.uuid}',
                       '${var.concept.national.woman-receiving-ipt.uuid}',
                       '${var.concept.mch.iptp-deferral-reason.uuid}',
                       '${var.concept.national.llin-received-at-anc.uuid}')
      GROUP BY o.encounter_id) ob ON ob.encounter_id = c.encounter_id;

-- $END
