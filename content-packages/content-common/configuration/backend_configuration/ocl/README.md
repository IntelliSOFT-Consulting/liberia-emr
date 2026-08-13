# CIEL concept dictionary (OCL)

Initializer loads a CIEL subscription **ZIP** dropped in this directory. Reusing CIEL is
the first step of the metadata build order (IMPLEMENTATION.md §5) and the reason our own
`concepts/` CSVs stay small: a local duplicate of a CIEL concept fragments reporting and
breaks the FHIR and DHIS2 mappings downstream.

## The ZIPs are not committed

CIEL dictionary exports are large and licensed; they are fetched at build time, not stored
in git. `.gitignore` excludes `*.zip` under this directory.

Two different things land here and they are not interchangeable:

| File | Source | Fetched by | Credentials |
| --- | --- | --- | --- |
| `*-common.zip` | The pinned upstream reference-application demo tag | `scripts/build/lift-common-content.sh` | none |
| `lib-<collection>-ciel-*.zip` | The MOH's own OCL org | `scripts/build/fetch-ciel.sh` | `OCL_API_TOKEN` |

`scripts/build/build-distribution.sh` runs both, each guarded by its own file name. Without
`OCL_API_TOKEN` it warns and carries on with only the first — the images build, but every
concept mapping to a CIEL source fails to load, so treat that build as unreleasable.

Which collections are fetched, and the version they are pinned to, live in
`distribution/distro.properties` (`ocl.org`, `ocl.collections`, `ocl.collection.version`)
under the same rule as the WAR and the OMODs. `ocl.collection.version` is empty until the
MOH publishes a released version; empty exports HEAD, which is reproducible only by
accident, and the build says so. Pin it before cutting a release and record it in the
release notes — a floating CIEL version makes two builds of the same tag produce different
metadata.

## Upstream defects are repaired at build time

`scripts/build/sanitize-ocl-export.sh` rewrites every ZIP in this directory before the
content packages are assembled, repairing two defects we do not control upstream:

- **Duplicate concept names** in the same locale on one concept. OpenMRS 2.8 rejects the
  concept outright with `DuplicateConceptNameException`, even when one of the pair is
  retired.
- **Orphan mappings** — `from_concept_url` empty, so the mapping names no source concept.

The second matters more than its size suggests. openconceptlab marks the **entire** import
failed on any single item error, with the message `Errors found`; Initializer rethrows it,
and the release gate fails the build. CIEL v2026-07-20 carries 10 such mappings out of
300,246 — enough to fail every clean install, and unfixable from our own content. Both
repairs are idempotent, so re-running on an already-clean export is a no-op.

If a future export fails the gate with `Errors found`, the failing items are printed by
`qa/upgrade/run-clean-install.sh` from `openconceptlab_item`; extend the sanitizer rather
than editing an export by hand.

## Choosing the subset

Do not load all of CIEL. Subscribe to the collection covering the deployed programmes:

- MCH — ANC, L&D, PNC, Family Planning (first go-live) — `ocl.collections=mch`
- Laboratory — the HIS-Lite test catalogue
- Pharmacy — the formulary drug concepts

Add each to `ocl.collections` as it is published. A narrower dictionary means a faster
Initializer startup, which matters on facility-grade hardware running offline: a full CIEL
export is roughly 59,000 concepts and 300,000 mappings, and a clean install spends hours
importing it before the backend answers.

`fetch-ciel.sh`'s post-download smoke test only knows MCH concepts, so any other collection
needs `--no-smoke-test` until it grows per-collection expectations.

## Adding a concept CIEL does not have

Add it to the owning package's `concepts/` CSV with a `Same as mappings` value if any
standard terminology covers it, and raise it with the CIEL maintainers. A concept that
lives only in Liberia's database cannot be aggregated nationally.
