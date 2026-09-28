-- mamba_dim_location_hierarchy and mamba_dim_location_ancestor (docs/reporting/README.md §2.3).
--
-- Core's mamba_dim_location has neither uuid nor parent, so attribution and roll-up read these
-- instead. Both are rebuilt in full on every run: locations are metadata and few.
--
--   mamba_dim_location_ancestor    one row per (location, ancestor-or-self), with the depth
--                                  between them. A report for any MFL node N counts the facts
--                                  whose location_id has N as an ancestor:
--                                    JOIN mamba_dim_location_ancestor a
--                                      ON a.location_id = f.location_id
--                                     AND a.ancestor_location_id = <N>
--   mamba_dim_location_hierarchy   one row per location: its uuid and parent, the NEAREST
--                                  ancestor-or-self tagged Health Facility, District and County,
--                                  and its tags (names for reading, uuids for comparing).
--
-- Tags are compared by uuid, from variables.properties, never by name.
-- Runs in the ETL schema's context; mamba_source_db is replaced at runtime.

-- $BEGIN

CREATE TABLE IF NOT EXISTS mamba_dim_location_ancestor
(
    location_id          INT NOT NULL,
    ancestor_location_id INT NOT NULL,
    depth                INT NOT NULL,

    PRIMARY KEY (location_id, ancestor_location_id),
    INDEX mamba_idx_ancestor_location_id (ancestor_location_id)
);

CREATE TABLE IF NOT EXISTS mamba_dim_location_hierarchy
(
    location_id          INT          NOT NULL PRIMARY KEY,
    uuid                 CHAR(38)     NOT NULL,
    name                 VARCHAR(255) NOT NULL,
    parent_location_id   INT          NULL,
    facility_location_id INT          NULL,
    district_location_id INT          NULL,
    county_location_id   INT          NULL,
    tags                 TEXT         NULL,
    tag_uuids            TEXT         NULL,
    retired              TINYINT(1)   NOT NULL,

    UNIQUE INDEX mamba_idx_uuid (uuid),
    INDEX mamba_idx_parent_location_id (parent_location_id),
    INDEX mamba_idx_facility_location_id (facility_location_id),
    INDEX mamba_idx_district_location_id (district_location_id),
    INDEX mamba_idx_county_location_id (county_location_id)
);

TRUNCATE TABLE mamba_dim_location_ancestor;

INSERT INTO mamba_dim_location_ancestor (location_id, ancestor_location_id, depth)
SELECT location_id, location_id, 0
FROM mamba_source_db.location;

-- Walk up one level per pass. The primary key absorbs a cycle in parent_location, and the
-- depth cap bounds the loop whatever the data says.
SET @mamba_lh_depth = 0;

REPEAT
    INSERT INTO mamba_dim_location_ancestor (location_id, ancestor_location_id, depth)
    SELECT a.location_id, l.parent_location, a.depth + 1
    FROM mamba_dim_location_ancestor a
             INNER JOIN mamba_source_db.location l
                        ON l.location_id = a.ancestor_location_id
    WHERE a.depth = @mamba_lh_depth
      AND l.parent_location IS NOT NULL
    ON DUPLICATE KEY UPDATE depth = LEAST(mamba_dim_location_ancestor.depth, VALUES(depth));

    SET @mamba_lh_rows = ROW_COUNT();
    SET @mamba_lh_depth = @mamba_lh_depth + 1;
UNTIL @mamba_lh_rows = 0 OR @mamba_lh_depth >= 32 END REPEAT;

TRUNCATE TABLE mamba_dim_location_hierarchy;

INSERT INTO mamba_dim_location_hierarchy (location_id, uuid, name, parent_location_id,
                                          facility_location_id, district_location_id,
                                          county_location_id, tags, tag_uuids, retired)
SELECT l.location_id,
       l.uuid,
       l.name,
       l.parent_location,
       (SELECT a.ancestor_location_id
        FROM mamba_dim_location_ancestor a
                 INNER JOIN mamba_source_db.location_tag_map m ON m.location_id = a.ancestor_location_id
                 INNER JOIN mamba_source_db.location_tag t ON t.location_tag_id = m.location_tag_id
        WHERE a.location_id = l.location_id
          AND t.uuid = '${var.locationtag.health-facility.uuid}'
        ORDER BY a.depth
        LIMIT 1),
       (SELECT a.ancestor_location_id
        FROM mamba_dim_location_ancestor a
                 INNER JOIN mamba_source_db.location_tag_map m ON m.location_id = a.ancestor_location_id
                 INNER JOIN mamba_source_db.location_tag t ON t.location_tag_id = m.location_tag_id
        WHERE a.location_id = l.location_id
          AND t.uuid = '${var.locationtag.district.uuid}'
        ORDER BY a.depth
        LIMIT 1),
       (SELECT a.ancestor_location_id
        FROM mamba_dim_location_ancestor a
                 INNER JOIN mamba_source_db.location_tag_map m ON m.location_id = a.ancestor_location_id
                 INNER JOIN mamba_source_db.location_tag t ON t.location_tag_id = m.location_tag_id
        WHERE a.location_id = l.location_id
          AND t.uuid = '${var.locationtag.county.uuid}'
        ORDER BY a.depth
        LIMIT 1),
       (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ',')
        FROM mamba_source_db.location_tag_map m
                 INNER JOIN mamba_source_db.location_tag t ON t.location_tag_id = m.location_tag_id
        WHERE m.location_id = l.location_id
          AND t.retired = 0),
       (SELECT GROUP_CONCAT(t.uuid ORDER BY t.uuid SEPARATOR ',')
        FROM mamba_source_db.location_tag_map m
                 INNER JOIN mamba_source_db.location_tag t ON t.location_tag_id = m.location_tag_id
        WHERE m.location_id = l.location_id
          AND t.retired = 0),
       l.retired
FROM mamba_source_db.location l;

-- $END
