# LiberiaEMR

Facility-scale **OpenMRS 3.x (O3)** EMR for **UNFPA Liberia** and the **Ministry of Health,
Republic of Liberia**, deployed at **Careysburg** and **Barnersville** Health Centers.

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
├── packages/              CUSTOM BUILD — esm-liberia-epartograph-app; MODIFY+PR patches
├── integration/           EXTERNAL — EIP sync, DHIS2, cross-facility, mSupply, FHIR
├── docs/                  architecture, ADRs, DAK, security, runbooks, metadata specs
├── qa/                    api, e2e, manual, uat, upgrade harness
└── scripts/               validate, build, deploy
```

Content layers load **common → national → programme → site**, each overriding the last
([ADR 0003](docs/adr/0003-layered-content-packages.md)).

## Quick start

```bash
# Validate and build every content package
./scripts/build/build-content.sh

# Bring up a facility stack locally
cd distribution/compose/facility
cp ../../env/facility.env.example facility.env    # then fill it in
docker compose --env-file facility.env up -d
```

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

## Current status

Base scaffold with first-cut MCH metadata. **Not deployable yet.** The substantial open
items are the password expiry mechanism, the cross-facility identity policy, CIEL mappings
for the partograph concepts, the five MCH forms, and the e-partograph itself.

Start at [docs/runbooks/go-live.md](docs/runbooks/go-live.md) for the full gate list.

## Documentation

| | |
| --- | --- |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Conventions and constraints — **read before contributing** |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch strategy, upstream-PR workflow, review |
| [HANDOVER.md](HANDOVER.md) | IP handover to the MOH |
| [docs/architecture/](docs/architecture/) | Solution architecture |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/security/](docs/security/) | MOH ICT SOP and NCS control mapping |
| [docs/runbooks/](docs/runbooks/) | Deploy, backup/restore, DR, go-live |
| [docs/metadata-specs/](docs/metadata-specs/) | Per-programme metadata specifications |

## Licence

Mozilla Public License 2.0 with Healthcare Disclaimer (OpenMRS). See
[HANDOVER.md](HANDOVER.md) for the MOH IP position.
