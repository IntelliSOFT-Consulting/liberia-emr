# 0003 — Layer content packages: common → programme → national → site

**Status:** Accepted

## Context

Two facilities, several clinical programmes, and a national configuration that applies to
both. A single content package would mean copying shared metadata per facility and then
watching the copies drift — which is how two "identical" facilities end up with different
concept UUIDs and non-comparable reports.

## Decision

Layer the packages, later layers overriding earlier ones:

```
RefApp baseline  →  common  →  national  →  programme  →  site
```

- **common** — shared CIEL concepts, core encounter/visit types, generic forms
- **national** — MOH identifiers, RBAC baseline, reporting mappings, admin hierarchy
- **programme** — MCH, lab, pharmacy, OPD/IPD
- **site** — facility locations, wards, local roles, branding, formulary overrides
- **demo** — training data, never in a production distribution

Load order is enforced by the module order in `content-packages/pom.xml` and by the unpack
order in `distribution/backend/Dockerfile`. Frontend configs follow the same order in
`SPA_CONFIG_URLS`.

Every UUID is declared once in `variables.properties` and referenced as `${var.*}`. A site
package overrides a variable rather than duplicating the metadata it names.

## Consequences

- Shared metadata is defined once; facility differences stay in the site layer where they
  are visible.
- Adding a third facility is a new site package, not a fork.
- A site can map onto pre-existing production metadata by overriding a variable — which is
  what makes adopting an existing database possible.
- Cost: **order matters**. A layer cannot forward-reference something a later layer
  declares. This has already shaped the tree — the ICT Auditor role lives in `national`
  rather than `common` because it needs a national privilege.
- `location.facility-root.uuid` is deliberately unset in `common`, so a distribution built
  with no site layer fails loudly at Initializer time instead of installing an EMR with no
  facility.
