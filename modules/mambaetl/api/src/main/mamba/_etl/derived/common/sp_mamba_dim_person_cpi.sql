-- mamba_dim_person_cpi: one row per patient, with the key that counts a PERSON once
-- (docs/reporting/README.md §2.3).
--
--   person_key  the patient's PRIMARY Central Person Identifier where one exists, else
--               'patient:<patient uuid>'. Count people with COUNT(DISTINCT person_key).
--
-- The CPI lives at central only, in the openmrs_identity schema (sync-eip.md 2.5, ADR 0005):
-- patient_link maps a patient uuid to a cpi row, and a cpi aliased into another carries
-- primary_cpi_id, possibly through a chain, which is followed to its end here the way
-- IdentityService.primary() does. Central's initdb (30-etl-db-user.sh) grants the ETL user
-- SELECT on that schema. A facility has no such schema, and information_schema shows the ETL
-- user no table it cannot read, so there every patient is its own person and the same SQL
-- runs unchanged. The schema name is the one IdentityService hard-codes.
--
-- Rebuilt in full on every run: aliasing can move any number of patients at once.
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_dim_person_cpi
(
    person_id      INT         NOT NULL PRIMARY KEY,
    patient_uuid   CHAR(38)    NOT NULL,
    cpi_id         INT         NULL,
    primary_cpi_id INT         NULL,
    primary_cpi    CHAR(36)    NULL,
    person_key     VARCHAR(46) NOT NULL,

    INDEX mamba_idx_primary_cpi_id (primary_cpi_id),
    INDEX mamba_idx_person_key (person_key)
);

TRUNCATE TABLE mamba_dim_person_cpi;

INSERT INTO mamba_dim_person_cpi (person_id, patient_uuid, person_key)
SELECT p.patient_id, per.uuid, CONCAT('patient:', per.uuid)
FROM mamba_source_db.patient p
         INNER JOIN mamba_source_db.person per ON per.person_id = p.patient_id
WHERE p.voided = 0;

IF (SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = 'openmrs_identity'
      AND table_name IN ('cpi', 'patient_link')) = 2 THEN

    UPDATE mamba_dim_person_cpi d
        INNER JOIN openmrs_identity.patient_link l ON l.patient_uuid = d.patient_uuid
        INNER JOIN openmrs_identity.cpi c ON c.cpi_id = l.cpi_id
    SET d.cpi_id         = c.cpi_id,
        d.primary_cpi_id = COALESCE(c.primary_cpi_id, c.cpi_id);

    -- Follow alias chains one hop per pass; the cap bounds a cycle whatever the data says.
    SET @mamba_cpi_hops = 0;

    REPEAT
        UPDATE mamba_dim_person_cpi d
            INNER JOIN openmrs_identity.cpi c ON c.cpi_id = d.primary_cpi_id
        SET d.primary_cpi_id = c.primary_cpi_id
        WHERE c.primary_cpi_id IS NOT NULL;

        SET @mamba_cpi_rows = ROW_COUNT();
        SET @mamba_cpi_hops = @mamba_cpi_hops + 1;
    UNTIL @mamba_cpi_rows = 0 OR @mamba_cpi_hops >= 20 END REPEAT;

    UPDATE mamba_dim_person_cpi d
        INNER JOIN openmrs_identity.cpi c ON c.cpi_id = d.primary_cpi_id
    SET d.primary_cpi = c.cpi,
        d.person_key  = CONCAT('cpi:', c.cpi);

END IF;

-- $END
