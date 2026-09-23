# Solution architecture

## Topology

Offline-first and decentralised. Each facility runs a **complete** EMR — database, backend,
frontend, gateway — and synchronises to a central instance. A facility that loses its link
keeps working; sync catches up when the link returns.

```
  Careysburg Health Center            Barnersville Health Center
  ┌────────────────────────┐          ┌────────────────────────┐
  │ gateway (TLS)          │          │ gateway (TLS)          │
  │ frontend (O3 shell)    │          │ frontend (O3 shell)    │
  │ backend (OpenMRS+Init  │          │ backend (OpenMRS+Init  │
  │   + liberiaemr omod)   │          │   + liberiaemr omod)   │
  │ db (MariaDB, binlog)   │          │ db (MariaDB, binlog)   │
  │ sync (dbsync sender)   │          │ sync (dbsync sender)   │
  │ prometheus+alertmanager│          │ prometheus+alertmanager│
  └───────────┬────────────┘          └───────────┬────────────┘
              │  facility → central push only     │
              │  mTLS JMS; PGP-signed + encrypted │
              └──────────────┬────────────────────┘
                             ▼
                   ┌──────────────────────────┐
                   │  Central instance        │
                   │  artemis (broker, 61617) │
                   │  sync-receiver (dbsync)  │
                   │  gateway, frontend       │
                   │  backend + db            │
                   │  prometheus+alertmanager │
                   │  cert-expiry exporter    │
                   │  DHIS2 export ⚠          │
                   └──────────────────────────┘
```

Compose stacks: `distribution/compose/facility/` and `distribution/compose/central/`. At a
facility the sender, Prometheus and Alertmanager sit behind `--profile sync`; the demo stack
has sync off. `dhis2-export` is declared at central behind the `dhis2` profile, but no build in
this repository produces its image yet.

Sync is **unidirectional** in this release. Central does not write back into a facility
database. Cross-facility query (Sprint 4) is a read path, not a second write direction.

The sync layer's own design is documented in three parts:

| Document | Covers |
| --- | --- |
| [**Sync & EIP architecture**](sync-eip.md) | The strategy: topology, change capture, transport, identity and the CPI, pulled-record scope, offline/retry, security, cross-facility query |
| [**Module evaluation**](sync-module-evaluation.md) | Why openmrs-dbsync: the nine options considered, versions to pin, compatibility gaps, plan, expected outcomes and risks |
| [**Entity coverage and sync order**](sync-entity-coverage.md) | The 34 entities that sync, the dependency chain, and what needs custom work |

Decisions: [ADR 0005](../adr/0005-cross-facility-identity-reconciliation.md) (identity),
[ADR 0007](../adr/0007-pulled-record-scope.md) (pulled-record scope),
[ADR 0008](../adr/0008-adopt-openmrs-dbsync.md) (module selection).

## Components

| Component | Where | What it is |
| --- | --- | --- |
| Gateway | `distribution/gateway/` | nginx; terminates TLS in front of frontend and backend. Certificates are mounted at run time, never baked in |
| Frontend | `distribution/frontend/` | O3 app shell plus the ESMs pinned in `distro.properties` |
| Backend | `distribution/backend/` | OpenMRS platform, pinned OMODs, Initializer content, and the `liberiaemr` module built from source |
| `liberiaemr` module | [`modules/liberiaemr/`](../../modules/liberiaemr/README.md) | Rules-based form visibility (`/ws/rest/v1/liberiaemr/forms`, the backend of `customFormsUrl`); anonymous password-reset flow over an SMTP relay configured from the environment; the national sync status endpoint (`/ws/rest/v1/liberiaemr/syncstatus`, `View Sync Status` privilege) |
| Liberia ESMs | `packages/esm-liberia-*` | `epartograph-app`, `login-app`, `patient-chart-extension`, and `sync-status-app`, the national sync status page at central ([sync runbook](../runbooks/sync-operations.md) §13). The first three are pinned in `distro.properties`; `sync-status-app` is not yet, so the frontend image does not carry it |
| Sync sender / receiver | [`distribution/sync/`](../../distribution/sync/README.md) | openmrs-dbsync, built from the `sync.dbsync` tag in `distro.properties` with a one-line platform 2.8 patch |
| Broker | [`distribution/broker/`](../../distribution/broker/README.md) | ActiveMQ Artemis at central: mutual TLS only, one address per facility, dead letters kept and alerted |
| Monitoring | `distribution/monitoring/` | Prometheus and Alertmanager on both sides. The facility watches its sender; central watches the receiver, the broker and certificate expiry (`cert-expiry`). Alerts go by email or webhook |

The sync status page reads central's Prometheus (`LIBERIAEMR_SYNC_MONITORING_URL`). A
facility has no national monitoring to read and reports the feature off.

## Artefacts

Per [ADR 0001](../adr/0001-two-artefact-model.md), two kinds:

| | Assembles | Version discipline |
| --- | --- | --- |
| `distribution/` | platform + modules + content → Docker images | **exact pins** |
| `content-packages/*` | configuration + clinical content | **ranges (`>=`)** |

Seven images per release, immutable and versioned: `liberia-emr-backend:x.y.z`,
`-frontend`, `-gateway`, `-sync`, `-sync-receiver`, `-broker` and `-cert-expiry`
(`scripts/build/build-distribution.sh`; the last four are skipped for a demo build or with
`--no-sync`). A mutable git checkout is never mounted into a
production container.

## Content layering

See [ADR 0003](../adr/0003-layered-content-packages.md).

```
RefApp baseline → common → national → programme → site
```

Backend: unpack order in `distribution/backend/Dockerfile`.
Frontend: file order in `SPA_CONFIG_URLS`. Both must stay in step — a frontend config
listed out of order overrides the wrong layer, and nothing errors.

## Why facility-scale hardware shapes the design

Facility instances run on modest hardware with intermittent power and connectivity. That is
why the CIEL subset is narrowed rather than loaded whole (Initializer startup time), why the
sync queue is a durable volume rather than in-memory, and why the e-partograph declares
offline support and has to mean it.

## To produce

⚠ A rendered architecture diagram (SVG) belongs in this directory alongside this file. The
ASCII sketch above is the working reference until then.
