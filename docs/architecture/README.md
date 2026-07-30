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
  │ backend (OpenMRS+Init) │          │ backend (OpenMRS+Init) │
  │ db (MariaDB)           │          │ db (MariaDB)           │
  │ sync (EIP, queued)     │          │ sync (EIP, queued)     │
  └───────────┬────────────┘          └───────────┬────────────┘
              │  facility → central push only     │
              │  (queues locally when offline)    │
              └──────────────┬────────────────────┘
                             ▼
                   ┌──────────────────────┐
                   │  Central instance    │
                   │  sync-receiver       │
                   │  backend + db        │
                   │  DHIS2 export ⚠      │
                   └──────────────────────┘
```

Sync is **unidirectional** in this release. Central does not write back into a facility
database. Cross-facility query (Sprint 4) is a read path, not a second write direction.

## Artefacts

Per [ADR 0001](../adr/0001-two-artefact-model.md), two kinds:

| | Assembles | Version discipline |
| --- | --- | --- |
| `distribution/` | platform + modules + content → Docker images | **exact pins** |
| `content-packages/*` | configuration + clinical content | **ranges (`>=`)** |

Three images per release, immutable and versioned: `liberia-emr-backend:x.y.z`,
`-frontend:x.y.z`, `-gateway:x.y.z`. A mutable git checkout is never mounted into a
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
