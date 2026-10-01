-- mamba_fact_emr_ops_patient: one row per live patient record, with the identity-quality flags
-- EMR-OPS-007 (duplicate records) and EMR-OPS-015 (consistent identifier) read. Both have a
-- facility and a central definition (emr-ops.csv); the report picks the columns for its role.
--
--   person_key, primary_cpi_id  from mamba_dim_person_cpi
--   date_registered             patient.date_created (the stock denominators count records
--                               registered by the period end)
--   location_id                 where the RECORD belongs: the location of its preferred live
--                               identifier (the one IdentityService reads), else of its first
--                               live visit. A patient has no encounter location of its own.
--   facility_location_id        from mamba_dim_location_hierarchy
--
-- Why not openmrs_identity.patient_link.facility_location_uuid at central? It now holds the same
-- thing, the nearest Health Facility above that identifier's location (IdentityService,
-- FacilityOfOrigin), but reading it would buy nothing and cost three things: a facility has no
-- patient_link, so the facility role needs this derivation anyway and the two roles would count
-- one record by two rules; the link is fixed when the CPI is minted, while this is rebuilt from
-- live identifiers every run, so a corrected identifier location or a re-parented ward shows here
-- at once; and a record whose identifiers carry no location still gets its first visit's
-- location here, where the link has NULL. (For a voided record whose identifiers are all voided
-- the link keeps the location it had; such records are not in this table.)
--
-- Facility definitions:
--   is_probable_duplicate  1 when another live record at the same facility shares the
--                          normalised given + family name, birthdate and gender, or a live
--                          identifier of the same type and value (EMR-OPS-007 numerator: the
--                          records, so 2 per pair). person_merge_log is not read: merges leave
--                          one live record, and none are done today.
--   hrn_live_count, hrn_voided_count  MOH Health Record Number rows, live and voided
--   hrn_consistent         exactly one live HRN and no voided one (EMR-OPS-015 numerator)
--
-- Central definitions (openmrs_identity, as sp_mamba_dim_person_cpi reads it; 0 or NULL at a
-- facility, which has no such schema):
--   link_basis             openmrs_identity.patient_link.basis (NEW, NATIONAL_ID, ...)
--   same_facility_link     1 when the CPI service linked this record to another live record of
--                          the same facility (EMR-OPS-007 central numerator counts such groups).
--                          Records of one person at different facilities are linked by design
--                          (ADR 0005) and are not duplicates.
--   national_id_key        SHA-256 of the record's live National ID when it has exactly one
--                          distinct value, else NULL. A hash, so the value never leaves openmrs.
--   person_national_id_consistent  1 on every record of a person (person_key) whose records all
--                          carry the same live National ID, or whose group was linked on
--                          basis NATIONAL_ID (EMR-OPS-015 central numerator)
--
-- Rebuilt in full on every run: linking and identifier edits can move any record.
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime. Depends on
-- mamba_dim_person_cpi, mamba_dim_location_hierarchy and mamba_fact_emr_ops_visit.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_fact_emr_ops_patient
(
    client_id                     INT         NOT NULL PRIMARY KEY,
    person_key                    VARCHAR(46) NOT NULL,
    primary_cpi_id                INT         NULL,
    date_registered               DATETIME    NOT NULL,
    location_id                   INT         NULL,
    facility_location_id          INT         NULL,
    name_match_key                CHAR(64)    NULL,
    hrn_live_count                INT         NOT NULL DEFAULT 0,
    hrn_voided_count              INT         NOT NULL DEFAULT 0,
    hrn_consistent                TINYINT(1)  NOT NULL DEFAULT 0,
    national_id_key               CHAR(64)    NULL,
    link_basis                    VARCHAR(30) NULL,
    is_probable_duplicate         TINYINT(1)  NOT NULL DEFAULT 0,
    same_facility_link            TINYINT(1)  NOT NULL DEFAULT 0,
    person_national_id_consistent TINYINT(1)  NOT NULL DEFAULT 0,

    INDEX mamba_idx_person_key (person_key),
    INDEX mamba_idx_date_registered (date_registered),
    INDEX mamba_idx_location_id (location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_name_match_key (name_match_key)
);

TRUNCATE TABLE mamba_fact_emr_ops_patient;

SET @eo_hrn = (SELECT patient_identifier_type_id FROM mamba_source_db.patient_identifier_type
               WHERE uuid = '${var.identifiertype.moh-health-record.uuid}');
SET @eo_nid = (SELECT patient_identifier_type_id FROM mamba_source_db.patient_identifier_type
               WHERE uuid = '${var.identifiertype.national-id.uuid}');

INSERT INTO mamba_fact_emr_ops_patient (client_id, person_key, primary_cpi_id, date_registered, location_id)
SELECT p.patient_id,
       pc.person_key,
       pc.primary_cpi_id,
       p.date_created,
       COALESCE((SELECT pi.location_id
                 FROM mamba_source_db.patient_identifier pi
                 WHERE pi.patient_id = p.patient_id
                   AND pi.voided = 0
                   AND pi.location_id IS NOT NULL
                 ORDER BY pi.preferred DESC, pi.patient_identifier_id
                 LIMIT 1),
                (SELECT v.location_id
                 FROM mamba_fact_emr_ops_visit v
                 WHERE v.client_id = p.patient_id
                   AND v.location_id IS NOT NULL
                 ORDER BY v.date_started, v.visit_id
                 LIMIT 1))
FROM mamba_source_db.patient p
         INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = p.patient_id
WHERE p.voided = 0;

UPDATE mamba_fact_emr_ops_patient f
    LEFT JOIN mamba_dim_location_hierarchy h ON h.location_id = f.location_id
SET f.facility_location_id = h.facility_location_id;

-- ---- identifiers ----
UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN (SELECT pi.patient_id,
                       SUM(pi.identifier_type = @eo_hrn AND pi.voided = 0)            AS hrn_live,
                       SUM(pi.identifier_type = @eo_hrn AND pi.voided = 1)            AS hrn_voided,
                       COUNT(DISTINCT IF(pi.identifier_type = @eo_nid AND pi.voided = 0,
                                         UPPER(TRIM(pi.identifier)), NULL))           AS nid_values,
                       MAX(IF(pi.identifier_type = @eo_nid AND pi.voided = 0,
                              UPPER(TRIM(pi.identifier)), NULL))                      AS nid_value
                FROM mamba_source_db.patient_identifier pi
                WHERE pi.identifier_type IN (@eo_hrn, @eo_nid)
                GROUP BY pi.patient_id) x ON x.patient_id = f.client_id
SET f.hrn_live_count   = x.hrn_live,
    f.hrn_voided_count = x.hrn_voided,
    f.national_id_key  = IF(x.nid_values = 1 AND x.nid_value <> '', SHA2(x.nid_value, 256), NULL);

UPDATE mamba_fact_emr_ops_patient
SET hrn_consistent = IF(hrn_live_count = 1 AND hrn_voided_count = 0, 1, 0);

-- ---- facility heuristic: same name, birthdate and sex, or a shared identifier ----
UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN mamba_source_db.person per ON per.person_id = f.client_id
    INNER JOIN mamba_source_db.person_name n
               ON n.person_name_id = (SELECT n2.person_name_id
                                      FROM mamba_source_db.person_name n2
                                      WHERE n2.person_id = f.client_id
                                        AND n2.voided = 0
                                      ORDER BY n2.preferred DESC, n2.person_name_id
                                      LIMIT 1)
SET f.name_match_key = SHA2(CONCAT_WS('|', LOWER(TRIM(n.given_name)), LOWER(TRIM(n.family_name)),
                                      per.birthdate, UPPER(per.gender)), 256)
WHERE per.birthdate IS NOT NULL
  AND per.gender IS NOT NULL
  AND TRIM(COALESCE(n.given_name, '')) <> ''
  AND TRIM(COALESCE(n.family_name, '')) <> '';

UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN (SELECT name_match_key, facility_location_id
                FROM mamba_fact_emr_ops_patient
                WHERE name_match_key IS NOT NULL
                GROUP BY name_match_key, facility_location_id
                HAVING COUNT(*) > 1) g
               ON g.name_match_key = f.name_match_key
                   AND g.facility_location_id <=> f.facility_location_id
SET f.is_probable_duplicate = 1;

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_eo_identifier;
CREATE TEMPORARY TABLE mamba_tmp_eo_identifier
(
    patient_id           INT          NOT NULL,
    identifier_type      INT          NOT NULL,
    identifier           VARCHAR(255) NOT NULL,
    facility_location_id INT          NULL,

    INDEX mamba_idx_identifier (identifier_type, identifier)
);

INSERT INTO mamba_tmp_eo_identifier (patient_id, identifier_type, identifier, facility_location_id)
SELECT DISTINCT pi.patient_id, pi.identifier_type, UPPER(TRIM(pi.identifier)), f.facility_location_id
FROM mamba_source_db.patient_identifier pi
         INNER JOIN mamba_fact_emr_ops_patient f ON f.client_id = pi.patient_id
WHERE pi.voided = 0
  AND TRIM(pi.identifier) <> '';

-- A temporary table cannot be opened twice in one statement, so the shared values go to a
-- second one first.
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_eo_shared;
CREATE TEMPORARY TABLE mamba_tmp_eo_shared
(
    identifier_type      INT          NOT NULL,
    identifier           VARCHAR(255) NOT NULL,
    facility_location_id INT          NULL,

    INDEX mamba_idx_identifier (identifier_type, identifier)
);

INSERT INTO mamba_tmp_eo_shared (identifier_type, identifier, facility_location_id)
SELECT identifier_type, identifier, facility_location_id
FROM mamba_tmp_eo_identifier
GROUP BY identifier_type, identifier, facility_location_id
HAVING COUNT(DISTINCT patient_id) > 1;

UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN (SELECT DISTINCT t.patient_id
                FROM mamba_tmp_eo_identifier t
                         INNER JOIN mamba_tmp_eo_shared s
                                    ON s.identifier_type = t.identifier_type
                                        AND s.identifier = t.identifier
                                        AND s.facility_location_id <=> t.facility_location_id) d
               ON d.patient_id = f.client_id
SET f.is_probable_duplicate = 1;

DROP TEMPORARY TABLE IF EXISTS mamba_tmp_eo_shared;
DROP TEMPORARY TABLE IF EXISTS mamba_tmp_eo_identifier;

-- ---- central: the CPI service's links ----
IF (SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = 'openmrs_identity'
      AND table_name = 'patient_link') = 1 THEN

    UPDATE mamba_fact_emr_ops_patient f
        INNER JOIN mamba_dim_person_cpi pc ON pc.person_id = f.client_id
        INNER JOIN openmrs_identity.patient_link l ON l.patient_uuid = pc.patient_uuid
    SET f.link_basis = l.basis;

END IF;

UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN (SELECT person_key, facility_location_id
                FROM mamba_fact_emr_ops_patient
                WHERE primary_cpi_id IS NOT NULL
                GROUP BY person_key, facility_location_id
                HAVING COUNT(*) > 1) g
               ON g.person_key = f.person_key
                   AND g.facility_location_id <=> f.facility_location_id
SET f.same_facility_link = 1;

UPDATE mamba_fact_emr_ops_patient f
    INNER JOIN (SELECT person_key,
                       IF((MIN(national_id_key IS NOT NULL) = 1 AND COUNT(DISTINCT national_id_key) = 1)
                              OR MAX(link_basis <=> 'NATIONAL_ID') = 1, 1, 0) AS consistent
                FROM mamba_fact_emr_ops_patient
                GROUP BY person_key) g ON g.person_key = f.person_key
SET f.person_national_id_consistent = g.consistent;

-- $END
