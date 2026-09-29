# 0012: Central loads the locations of every site package

**Status:** Accepted (29 September 2026)
**Ticket:** LE-339 (builds on [ADR 0011](0011-central-composition.md), Option A; related: LE-317, ADR 0009)

## Context

Every record a facility sends to central references that facility's own locations: its root,
and the OPD, ward, maternity, laboratory or pharmacy the encounter or visit happened in.
Location rows are metadata, and metadata is not synced
([sync-entity-coverage.md](../architecture/sync-entity-coverage.md) §3): central must already
hold every UUID a synced record references, or the receiver fails on it.

Until now central ran the facility release's backend image, which is built with one site
package (Careysburg by default). So it held one facility's locations and no other facility's:
a record from Barnersville would reference locations central did not have.

It also breaks ADR 0009's prerequisite for the Master Facility List sync. Central must hold
each live facility's site root, carrying its `MFL UID`, before its first MFL sync. Otherwise
the sync creates a second row for that facility.

The options were:
- **A.** Build central with every site package's locations.
- **B.** A national "departments" package keyed by MFL UID.
- **C.** Sync `LOCATION` rows, reversing §3.

ADR 0011 set the direction for A and left it for this ticket to confirm.

## Decision

**Option A.** Central has its own backend image, `liberia-emr-backend-central`, built by
`scripts/build/build-distribution.sh --site central`:

- `content-central` takes the site layer's place, exactly as for the frontend (ADR 0011).
- The backend Dockerfile then adds the `locations/` of **every** `liberiaemr-site-*` package in
  the build context, and **nothing else** from them. The build excludes their identifier
  sequences, cash points, queues and facility global properties, which describe one facility
  and would make central behave as that facility.
- Sites are discovered, not listed, so a new site package reaches central without editing the
  build. A location file name that two site packages share fails the build instead of one
  silently shadowing the other.
- `scripts/validate/central-backend-content.sh` checks the built image against
  `content-packages/content-site-*`: every site's `locations/` present, no other site file
  present. It runs on every central build, including on every PR, in *Build Docker Images*.
- Central compose runs `liberia-emr-backend-central`. `publish-central-latest` pushes it, and
  the central dev deploy and rollback use it (LE-368).

## Why several sites' location files coexist safely

Checked against the current site packages on 29 September 2026:

- **Names:** all distinct: *Careysburg OPD*, *Barnersville OPD* and so on. OpenMRS rejects a
  second active location with the same name, whatever its parent (ADR 0009 §3), so a clash
  would fail Initializer; the build does not guard against a future one, but content review
  and Initializer both would.
- **UUIDs:** each site package resolves the same variable names (`var.location.opd.uuid`, …)
  against its own `variables.properties` when it is built. The 12 resolved location UUIDs of the
  two sites are all distinct.
- **Tags:** the site rows carry `Login Location`, `Visit Location`, `Queue Location` and so on.
  At central these are harmless: central's login picker filters on `Health Facility`
  (`config-central.json`, ADR 0009 §6), so it lists facilities, not every ward.
- **Adopted roots:** each site root keeps the name and parent its CSV gives it and carries its
  `MFL UID` (ADR 0009 §1). So the MFL sync at central adopts every site root instead of
  duplicating it.
- **MOH Health Record Number auto-generation:** the national option
  (`autogenerationoptions-national.csv`) points at the ID source every site package defines,
  with that site's HRN prefix. Central loads no site ID source, so Initializer would reject
  the option. The central build drops it instead. Central is not a point-of-care system
  (`sync-eip.md`) and must not issue a facility-scoped identifier. The central backend it
  replaces, Careysburg's, would have issued Careysburg-prefixed HRNs.
- **`liberiaemr.facility.locationUuid`:** this global property comes from a site's
  `gp-facility-*.xml`, which central no longer loads. It is documented as ignored on a central
  instance.

## Consequences

- A release builds central's backend image as well as its frontend: one more backend build per
  release, and one per PR in *Build Docker Images*.
- Adding a site package is enough for central to receive its locations on the next build. That
  includes its new wards and departments.
- The central dev server switches from the facility backend image to
  `liberia-emr-backend-central` on the first central deploy after this merges. Initializer then
  loads the other sites' locations into the existing database. Initializer never deletes rows,
  so central dev keeps the Careysburg ID source and HRN auto-generation option it already
  holds from the facility image. A fresh central does not get them. Retire them there by hand
  if they matter.
- **Not yet proven end to end:** a record created at a second facility against one of its
  wards, pushed through the broker, and landing at central without parking. This is the ticket's
  "done when" check. The image-content check proves the precondition on every build: central
  holds those UUIDs. The two-facility `qa/sync` scenario needs a second facility stack in CI and
  is left as follow-up work.
