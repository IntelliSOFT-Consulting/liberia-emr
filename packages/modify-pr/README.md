# Modify + PR

**Build class: Modify + PR** (IMPLEMENTATION.md §3).

A change to a community component that **will be upstreamed**. Sustainability for this
project means staying on the OpenMRS community mainline with full IP handover to the MOH —
so a fork we maintain forever is a failure mode, not a solution.

## The rule

Every patch in `.patches/` must have an open or merged upstream PR. A patch with no PR link
is a fork, and a fork is what this directory exists to prevent.

## Layout

```
.patches/
├── 0001-<component>-<summary>.patch
└── 0001-<component>-<summary>.md     # required sidecar
```

The sidecar records:

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-esm-patient-chart` |
| Upstream PR | link — **required** |
| Component version patched | the exact version pinned in `distro.properties` |
| Why not configuration | why this could not be done in a content package |
| Removal condition | the upstream release that makes the patch unnecessary |
| Owner | who is chasing the PR |

## Before adding a patch

Ask, in order:

1. Can this be **configuration** instead? Most of what looks like a code change is a
   runtime config key. That is the `Configure` class and belongs in `content-packages/`.
2. Can this be a **new extension** in a Custom Build ESM plugged into an existing slot?
   That is the `Custom Build` class and needs no patch at all.
3. Only if neither works: patch, and open the PR **in the same week**.

## When the PR merges

Bump the pinned version in `distribution/distro.properties`, delete the patch and its
sidecar, and note it in the release. A patch that outlives its upstream release is dead
weight that silently reapplies against code that has moved.

## Review

Patches are reviewed by the senior engineer, not the developer who wrote them
(IMPLEMENTATION.md §11).
