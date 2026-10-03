# Modify + PR

**Build class: Modify + PR** (IMPLEMENTATION.md §3).

A change to a community component that **will be upstreamed**. Sustainability for this
project means staying on the OpenMRS community mainline with full IP handover to the MOH —
so a fork we maintain forever is a failure mode, not a solution.

## The rule

Every patch in `.patches/` must have an open or merged upstream PR. A patch with no PR link
is a fork, and a fork is what this directory exists to prevent.

## Layout

`.patches/` holds the **sidecar** — the tracking record. The patch body lives where the
build that applies it can reach it, because each is a Docker build input:

| Patches | Body lives in | Applied by |
| --- | --- | --- |
| Frontend ESMs (compiled bundle) | `distribution/frontend/patch-*.cjs` | a `COPY` + `RUN node …` pair in `distribution/frontend/Dockerfile`, after `openmrs assemble` |
| dbsync (source) | `distribution/sync/patches/*.patch` | `distribution/sync/Dockerfile`, which applies everything in `patches/` |
| auditlog module (source) | `distribution/backend/patches/auditlog/*.patch` | the `auditlog` stage of `distribution/backend/Dockerfile` |
| bedmanagement module (source) | `distribution/backend/patches/bedmanagement/*.patch` | the `bedmanagement` stage of `distribution/backend/Dockerfile` |

```
.patches/
└── 0001-<component>-<summary>.md     # sidecar, one per patch
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

## Current patches

| Component (pinned version) | Patch | Sidecar | Upstream PR |
| --- | --- | --- | --- |
| `openmrs-dbsync` (`sync.dbsync=4.0.0`) | `distribution/sync/patches/0001-allow-openmrs-2.8.patch` | [`0001-openmrs-dbsync-allow-openmrs-2.8.md`](.patches/0001-openmrs-dbsync-allow-openmrs-2.8.md) | [mekomsolutions/openmrs-dbsync#12](https://github.com/mekomsolutions/openmrs-dbsync/pull/12) |
| `openmrs-module-auditlog` (`source.auditlog.commit=ba96ba5`) | `distribution/backend/patches/auditlog/0001-serialize-hibernate-proxies.patch` | [`0002-openmrs-module-auditlog-serialize-hibernate-proxies.md`](.patches/0002-openmrs-module-auditlog-serialize-hibernate-proxies.md) | [openmrs/openmrs-module-auditlog#30](https://github.com/openmrs/openmrs-module-auditlog/pull/30) |
| `openmrs-module-auditlog` (`source.auditlog.commit=ba96ba5`) | `distribution/backend/patches/auditlog/0002-keep-session-open-for-detached-previous-state.patch` | [`0003-openmrs-module-auditlog-detached-previous-state.md`](.patches/0003-openmrs-module-auditlog-detached-previous-state.md) | [openmrs/openmrs-module-auditlog#31](https://github.com/openmrs/openmrs-module-auditlog/pull/31) |
| `openmrs-module-auditlog` (`source.auditlog.commit=ba96ba5`) | `distribution/backend/patches/auditlog/0003-unmapped-class-metadata.patch` | [`0004-openmrs-module-auditlog-unmapped-class-metadata.md`](.patches/0004-openmrs-module-auditlog-unmapped-class-metadata.md) | [openmrs/openmrs-module-auditlog#32](https://github.com/openmrs/openmrs-module-auditlog/pull/32) |
| `openmrs-module-bedmanagement` (`source.bedmanagement.commit=c346b7b`, tag 7.2.0) | `distribution/backend/patches/bedmanagement/0001-end-visit-without-bed-write-privileges.patch` | [`0005-openmrs-module-bedmanagement-end-visit-without-bed-write.md`](.patches/0005-openmrs-module-bedmanagement-end-visit-without-bed-write.md) | [openmrs/openmrs-module-bedmanagement#119](https://github.com/openmrs/openmrs-module-bedmanagement/pull/119) |
| `esm-service-queues-app` (`11.1.0`) | `distribution/frontend/patch-service-queues-location.cjs` | [`0001-esm-service-queues-app-default-queue-location.md`](.patches/0001-esm-service-queues-app-default-queue-location.md) | **none yet** (sidecar says TODO) |
| `esm-patient-registration-app` (`11.1.0`) | `distribution/frontend/patch-patient-registration.cjs` | **none** | **none recorded** |
| `esm-patient-orders-app` (`12.3.4`) | `distribution/frontend/patch-patient-orders.cjs` | **none** | **none recorded** |

The last three break [the rule](#the-rule) as things stand: no upstream PR link, and two have no
sidecar at all.

## Before adding a patch

Ask, in order:

1. Can this be **configuration** instead? Most of what looks like a code change is a
   runtime config key. That is the `Configure` class and belongs in `content-packages/`.
2. Can this be a **new extension** in a Custom Build ESM plugged into an existing slot?
   That is the `Custom Build` class and needs no patch at all.
3. Only if neither works: patch, and open the PR **in the same week**.

## When the PR merges

Bump the pinned version in `distribution/distro.properties`, delete the patch body, the
Dockerfile lines that apply it and the sidecar, and note it in the release. A patch that
outlives its upstream release is dead weight that silently reapplies against code that has
moved.

## Review

Patches are reviewed by the senior engineer, not the developer who wrote them
(IMPLEMENTATION.md §11).
