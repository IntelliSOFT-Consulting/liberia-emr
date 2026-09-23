# LiberiaEMR

Facility-scale **OpenMRS 3.x (O3)** EMR for the **Ministry of Health,
Republic of Liberia**.

Base platform: **O3 RefApp 3.7.1 + HIS-Lite** (dispensing, laboratory, billing, stock).

- **Topology** — offline-first and decentralised. Each facility runs a complete EMR that
  synchronises to a central instance (facility→central push first; cross-facility query
  later).
- **First go-live scope** — maternal health: ANC, Labour & Delivery, PNC, Family Planning.
- **Sustainability** — stay on the OpenMRS community mainline; full IP handover to the MOH.
  Everything must be reproducible from configuration and transferable.

## The one principle

> **Use the content package to describe the implementation. Use the distribution to
> assemble and deploy it.**

Two artefact kinds, deliberately separate ([ADR 0001](docs/adr/0001-two-artefact-model.md)):

| | Purpose | Version discipline |
| --- | --- | --- |
| [`distribution/`](distribution/) | Pins platform, module and content versions → Docker images | **exact pins** |
| [`content-packages/`](content-packages/) | Versioned configuration + clinical content | **ranges (`>=`)** |

Never the reverse. Content packages are processed **when the distribution is built** — they
are not dropped into the app-data directory like an `.omod`.

## Layout

```
├── distribution/          ASSEMBLE + DEPLOY — pinned versions, Dockerfiles, compose stacks
├── content-packages/      DESCRIBE — layered Initializer + O3 runtime configuration
│   ├── content-common/            shared concepts, encounter/visit types, roles
│   ├── content-liberia-national/  MOH identifiers, RBAC baseline, reporting
│   ├── content-liberia-mch/       ANC / L&D / PNC / FP  ← first go-live
│   ├── content-liberia-{lab,pharmacy,opd-ipd}/
│   ├── content-site-{careysburg,barnersville}/
│   └── content-demo/              lifted from the RefApp demo package; NEVER in production
├── modules/               CUSTOM BUILD (backend) — the liberiaemr OpenMRS module (.omod)
├── packages/              CUSTOM BUILD (frontend) — Liberia ESMs; MODIFY+PR patches
│   ├── esm-liberia-epartograph-app/          WHO-aligned electronic partograph
│   ├── esm-liberia-login-app/                login, loading and location-picker pages
│   ├── esm-liberia-patient-chart-extension/  configurable obs-by-encounter widget
│   ├── esm-liberia-sync-status-app/          national sync status page (central)
│   └── modify-pr/                            patches to community code, each with an upstream PR
├── integration/           EXTERNAL — EIP sync, DHIS2, cross-facility, mSupply, FHIR
├── docs/                  architecture, ADRs, DAK, security, runbooks, metadata specs
├── qa/                    api, e2e, manual, uat, sync verification, upgrade harness
└── scripts/               validate, build, deploy, security (certs), sync admin
```

Inside `distribution/`: `backend/` (the OpenMRS image, which builds `modules/liberiaemr` from
source), `frontend/`, `gateway/` (TLS termination), `sync/` (dbsync sender and receiver),
`broker/` (Artemis), `monitoring/` (Prometheus and alert rules), `compose/{facility,central}`
and `env/` (example env files). See [distribution/README.md](distribution/README.md).

Content layers load **common → national → programme → site**, each overriding the last
([ADR 0003](docs/adr/0003-layered-content-packages.md)).

## Quick start

```bash
# Validate every content package — seconds, run it before anything slower
./scripts/validate/validate-content.sh

# Build the images and bring up a local demo stack (15–25 min cold build)
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg --demo
cp distribution/env/demo.env.example distribution/env/demo.env   # then edit it
./scripts/deploy/deploy-facility.sh --env distribution/env/demo.env --demo --local
```

Drop `--demo` from both commands for a production-shaped stack with no demo content.
[docs/runbooks/local-development.md](docs/runbooks/local-development.md) covers the content
edit loop and frontend work; [demo-stack.md](docs/runbooks/demo-stack.md)
covers a training room.

Regenerate the directory tree at any time — it is idempotent and never overwrites an
existing file:

```bash
./scaffold.sh
```

## Two rules worth knowing before you touch anything

**Never hard-code a UUID.** Declare it once in a package's
`configuration/variables.properties` and reference `${var.*}` everywhere else.
`scripts/validate/validate-content.sh` fails the build otherwise. This is what lets a site
package map onto metadata that already exists in a facility database instead of creating
duplicates.

**Production content is append-only.** Once metadata is in production, do not change a UUID,
change a concept's datatype, remove coded answers, or delete program states that patient
data references. Retire the wrong thing, add a corrected one, migrate the data.

## Custom code

Custom code falls into three of the four build classes in IMPLEMENTATION.md §3 (the fourth,
External, is integration work under [`integration/`](integration/)), and each lives in exactly
one place:

| Where | What | How it ships |
| --- | --- | --- |
| [`modules/liberiaemr/`](modules/liberiaemr/) | Backend module: rules-based form visibility (`/ws/rest/v1/liberiaemr/forms`), password-reset flow | Built from source **inside** the backend image; not pinned in `distro.properties`. Snapshots and opt-in releases go to Repsy |
| [`packages/esm-liberia-*`](packages/) | O3 frontend modules | Published to npm; an app reaches the image only when pinned in `distro.properties` |
| [`packages/modify-pr/`](packages/modify-pr/) | Patches to community code | Only with an open or merged upstream PR — otherwise it is a fork |

See [modules/liberiaemr/README.md](modules/liberiaemr/README.md) for the module's
endpoints, SMTP configuration and the release opt-in rule.

## Continuous integration

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | PRs to `main`/`develop`, pushes to `main`, manual runs | Validation, content build, clean-DB Initializer, backend module, images, sync hardening and Cypress E2E. Its **CI gate** job is the required check on `main`; on a push to `main` it also publishes `:latest` images and updates the dev environment |
| `modules.yml` | changes under `modules/**`, releases, manual runs | Builds the module; publishes SNAPSHOTs from `main` and releases whose tag matches the pom |
| `packages.yml` | changes under `packages/**`, releases, manual runs | Lints, type-checks, builds and publishes the frontend modules to npm (`next` from `main`, `latest` on a release). Unit tests run in `ci.yml`, not here, and only for the login and sync-status apps |
| `release.yml` | `x.y.z` tags, manual runs | Upgrade test from the previous release and production approval. Full-stack API/Cypress, image push and staging deploy are still `echo "TODO"` stubs |

## Current status

**Not production-ready.** Metadata and forms exist for MCH and OPD/IPD, the e-partograph ships
as a pre-release, and facility→central sync runs on openmrs-dbsync
([ADR 0008](docs/adr/0008-adopt-openmrs-dbsync.md), still *Proposed*). Among the open items:
review of the five MCH forms, confirming the e-partograph's alert/action geometry against
the DAK, the password expiry mechanism, the cross-facility identity policy
([ADR 0005](docs/adr/0005-cross-facility-identity-reconciliation.md), awaiting MOH ICT), and
CIEL mappings for the partograph concepts.

Start at [docs/runbooks/go-live.md](docs/runbooks/go-live.md) for the full gate list.

## Documentation

| | |
| --- | --- |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Conventions and constraints — **read before contributing** |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch strategy, upstream-PR workflow, review |
| [HANDOVER.md](HANDOVER.md) | IP handover to the MOH |
| [distribution/README.md](distribution/README.md) | Images, pins, compose stacks |
| [docs/architecture/](docs/architecture/) | Solution architecture, including [sync](docs/architecture/sync-eip.md) |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/security/](docs/security/) | MOH ICT SOP and NCS control mapping |
| [docs/runbooks/](docs/runbooks/) | Local development, demo stack, DAK → Initializer, deploy, sync operations, backup/restore, DR, go-live |
| [docs/metadata-specs/](docs/metadata-specs/) | Per-programme metadata specifications |

## Licence

Mozilla Public License 2.0 with Healthcare Disclaimer (OpenMRS). See
[HANDOVER.md](HANDOVER.md) for the MOH IP position.
