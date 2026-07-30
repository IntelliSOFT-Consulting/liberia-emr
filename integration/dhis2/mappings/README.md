# DHIS2 data-element mappings

**Status: BLOCKED on the MOH.**

Aggregate indicator export to the national DHIS2 instance requires a mapping from each
LiberiaEMR indicator to a DHIS2 data element and category option combination. That mapping
is an **MOH dependency** — we cannot invent it, and guessing a data element UUID produces
national statistics that are confidently wrong.

## What we need from the MOH

For each indicator in the MCH reporting set:

| Field | Example |
| --- | --- |
| DHIS2 data element UID | `fbfJHSPpUQD` |
| Data element name | ANC 1st visit |
| Category option combo UID | `HllvX50cXC0` |
| Disaggregation | age band, sex, facility |
| Period type | Monthly |
| Dataset UID | the dataset the element belongs to |
| Org unit mapping | Careysburg / Barnersville → DHIS2 org unit UID |

## What we can do while blocked

- Define the indicators themselves in `content-packages/*/configuration/` reporting
  metadata — the cohort logic is ours and does not depend on DHIS2 UIDs.
- Build and test the export mechanism against a DHIS2 sandbox using placeholder UIDs.
- Keep `mappings.csv` absent rather than filled with placeholders. An empty directory is an
  obvious blocker; a file full of invented UIDs looks finished and is not.

## Where this runs

Central only, never from a facility. See the `dhis2-export` service in
`distribution/compose/central/docker-compose.yml` (behind the `dhis2` profile, so it stays
off until the mappings land).
