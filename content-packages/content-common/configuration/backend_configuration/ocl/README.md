# CIEL concept dictionary (OCL)

Initializer loads a CIEL subscription **ZIP** dropped in this directory. Reusing CIEL is
the first step of the metadata build order (IMPLEMENTATION.md §5) and the reason our own
`concepts/` CSVs stay small: a local duplicate of a CIEL concept fragments reporting and
breaks the FHIR and DHIS2 mappings downstream.

## The ZIP is not committed

CIEL dictionary exports are large and licensed; they are fetched at build time, not stored
in git. `.gitignore` excludes `*.zip` under this directory.

`scripts/build/fetch-ciel.sh` downloads the pinned export into this directory before
`mvn package`. The version it fetches is pinned there and recorded in the release notes —
a floating CIEL version would make two builds of the same tag produce different metadata.

## Choosing the subset

Do not load all of CIEL. Subscribe to the collection covering the deployed programmes:

- MCH — ANC, L&D, PNC, Family Planning (first go-live)
- Laboratory — the HIS-Lite test catalogue
- Pharmacy — the formulary drug concepts

A narrower dictionary means a faster Initializer startup, which matters on facility-grade
hardware running offline.

## Adding a concept CIEL does not have

Add it to the owning package's `concepts/` CSV with a `Same as mappings` value if any
standard terminology covers it, and raise it with the CIEL maintainers. A concept that
lives only in Liberia's database cannot be aggregated nationally.
