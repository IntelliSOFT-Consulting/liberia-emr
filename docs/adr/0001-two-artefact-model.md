# 0001 — Separate distribution and content packages

**Status:** Accepted

## Context

An OpenMRS implementation has to answer two different questions, and conflating them is the
classic way these projects become unmaintainable:

1. *Which versions of the platform and modules are we running?* — changes on the OpenMRS
   community's release cadence.
2. *What clinical content and configuration does this implementation have?* — changes on
   the MOH's and the clinical team's cadence.

The tempting shortcut is one repository where a distribution build and the configuration
evolve together. It works until the first OpenMRS upgrade, at which point the two are
inseparable and the upgrade becomes a rewrite.

This project additionally requires staying on the community mainline and handing full IP to
the MOH. Both rule out a large maintained fork.

## Decision

Two artefact kinds, kept separate:

- **`distribution/`** pins exact platform, module and content-package versions and produces
  immutable Docker images. It answers "this release uses exactly version Y".
- **`content-packages/*`** hold versioned configuration and clinical content consumed by
  Initializer and the O3 runtime. They declare "I require version X or later".

Content packages are processed **when the distribution is built**. They are not dropped
into the app-data directory like an `.omod`.

The version discipline follows: **ranges** (`>=`) in `content.properties`, **exact pins**
in `distro.properties`. Never the reverse.

## Consequences

- OpenMRS core and O3 modules can be upgraded without touching clinical content.
- Clinical content is versioned and released on its own cadence, with its own history.
- Any release is reproducible from configuration alone — which is what makes handover to
  the MOH real rather than nominal.
- Cost: two version streams to reconcile at release time, and a build step that resolves
  content into the backend image. The upgrade test in CI exists to keep that honest.
