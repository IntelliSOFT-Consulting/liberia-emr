# LiberiaEMR — Implementation Instructions

Instructions for Claude Code (or any AI coding assistant) to scaffold and implement the
base structure of **LiberiaEMR**. Read this file in full before generating any code. The
conventions encode both OpenMRS best practice and this project's contractual and
sustainability constraints — follow them exactly.

---

## 0. The one principle everything follows

> **Use the content package to describe the implementation. Use the distribution to
> assemble and deploy it.**

This project has **two kinds of artefact**, kept in separate repositories/trees:

1. **Distribution** (`distribution/`) — selects and **pins** the OpenMRS Platform, backend
   modules, frontend modules, and content-package versions, then produces deployable Docker
   images. It resolves "this release uses exactly version Y."
2. **Content packages** (`content-packages/*`) — versioned **configuration + clinical
   content** (concepts, forms, programs, metadata, O3 runtime JSON), consumed by the
   **Initializer** module (backend) and the **O3 runtime** (frontend). They declare "I
   require version X or later."

Content packages are **processed when the distribution is built** — they are *not* dropped
into the OpenMRS app-data directory like an `.omod`. This separation lets us upgrade
OpenMRS core and O3 modules without maintaining a large fork, while versioning clinical
content and deployment history independently.

---

## 1. What this project is

Facility-scale **OpenMRS 3.x (O3)** EMR for **UNFPA Liberia** and the **MOH, Republic of
Liberia**, at **Careysburg** and **Barnersville** Health Centers. Base platform is **O3
RefApp 3.7.1 + HIS-Lite** (dispensing, lab, billing, stock).

- **Topology:** offline-first, decentralized; each facility runs a full EMR instance that
  synchronizes to a central instance (facility→central push first; cross-facility query
  later).
- **Priority scope (first go-live):** maternal health — ANC, Labor & Delivery, PNC, Family
  Planning (per the DAK).
- **Sustainability:** stay on the OpenMRS **community mainline**; full **IP handover to
  MOH**. Everything must be reproducible from config and transferable.

---

## 2. Layered content-package strategy

Do **not** put everything in one package. Layer it so shared metadata is reused and local
differences stay isolated. Later layers depend on and can override earlier ones.

| Layer | Package | Contains |
| --- | --- | --- |
| Baseline | *(RefApp content, pinned in distro)* | Minimum O3 metadata. **Not** a production config — excludes facility locations, formularies, etc. |
| Common | `content-common` | Shared CIEL concepts, core encounter/visit types, generic forms, shared frontend config, common reports. Reusable across any Liberia install. |
| Programme | `content-liberia-mch` | ANC / L&D / PNC / FP metadata, forms, programs+workflows. **First go-live priority.** |
| Programme | `content-liberia-lab` | Laboratory (HIS-Lite) — order types, results concepts, lab config. |
| Programme | `content-liberia-pharmacy` | Pharmacy/dispensing + stock (HIS-Lite), formulary. |
| Programme | `content-liberia-opd-ipd` | OPD / IPD encounter + admission workflows. |
| National | `content-liberia-national` | National identifier types, MOH forms, national reporting mappings, admin hierarchy, terminology, required translations. |
| Site | `content-site-careysburg` | Facility locations, departments/wards, local roles, branding, local lab catalogue, formulary overrides. |
| Site | `content-site-barnersville` | Same, for Barnersville. |
| Demo | `content-demo` | Training metadata, lifted verbatim from `openmrs-content-referenceapplication-demo` 1.9.2 (`scripts/build/lift-demo-content.sh`). **NEVER shipped to production.** |

**Rule:** never include demo patients, test users, or sample observations in any production
package. The demo layer exists only for training/test environments.

---

## 3. Build classification (still applies, mapped onto the layers)

Every change is one of four classes; the tree location makes the class explicit.

| Class | Meaning | Location |
| --- | --- | --- |
| **Configure** | Community configuration only (Initializer CSV/JSON, O3 runtime JSON). | `content-packages/*/configuration/**` |
| **Modify + PR** | Change to a community component that WILL be upstreamed. Track patch + PR link. | `packages/modify-pr/.patches/**` |
| **Custom Build** | Greenfield component with no community equivalent. | `packages/esm-*` (frontend), pinned in `distro.properties` |
| **External** | Integration with a system outside O3 (DHIS2, mSupply, FHIR, EIP sync). | `integration/**` |

Notes specific to this project:

- The **e-partograph** is the canonical Custom Build: `packages/esm-liberia-epartograph-app`.
  There is **no community component** — do not scaffold it as a "modify" of anything. It is a
  normal O3 frontend module, versioned and **pinned in the distribution** like any other — it
  is **not** smuggled inside a content package.
- The **sync/EIP layer** is core MOH scope and the **highest engineering risk**. It lives in
  `integration/`, never inside a content package.
- **DHIS2 data-element mappings** are an MOH dependency; stub `integration/dhis2/mappings/`
  and block on delivery.
- **mSupply** integration is deferred to the support period — spec only for now.

---

## 4. Directory structure

```text
liberia-emr/
├── README.md
├── IMPLEMENTATION.md                      # this file
├── CONTRIBUTING.md                        # branch strategy, upstream-PR workflow
├── scaffold.sh                            # regenerates this tree (idempotent)
│
├── distribution/                          # === ASSEMBLE + DEPLOY ===
│   ├── distro.properties                  # PINNED platform + module + content versions
│   ├── gateway/                           # TLS gateway (nginx/traefik)
│   ├── backend/                           # backend Dockerfile + resolved config
│   ├── frontend/                          # frontend Dockerfile + import map
│   ├── compose/facility/                  # offline-first facility stack
│   ├── compose/central/                   # central aggregation stack
│   ├── env/                               # .env templates (NO real secrets)
│   └── ci/                                # pipeline definitions
│
├── content-packages/                      # === DESCRIBE (Configure class) ===
│   ├── content-common/
│   │   ├── content.properties             # version RANGES (>=)
│   │   ├── pom.xml                        # (SDK-generated) packages as Maven ZIP
│   │   ├── assembly.xml
│   │   └── configuration/
│   │       ├── variables.properties       # UUIDs declared ONCE; ${var.*} everywhere
│   │       ├── backend_configuration/     # Initializer-format CSV/JSON
│   │       │   ├── concepts/  ocl/  locations/  locationtags/
│   │       │   ├── encountertypes/  visittypes/  patientidentifiertypes/
│   │       │   ├── programs/  programworkflows/  privileges/  roles/
│   │       │   ├── globalproperties/  ampathforms/  drugs/
│   │       │   └── orderfrequencies/  liquibase/
│   │       └── frontend_configuration/    # valid O3 runtime config JSON
│   │           └── config-*.json
│   ├── content-liberia-mch/               # ANC / L&D / PNC / FP  (first go-live)
│   ├── content-liberia-lab/               # laboratory (HIS-Lite)
│   ├── content-liberia-pharmacy/          # pharmacy/dispensing + stock (HIS-Lite)
│   ├── content-liberia-opd-ipd/           # OPD / IPD
│   ├── content-liberia-national/          # MOH national configuration
│   ├── content-site-careysburg/           # facility-specific
│   ├── content-site-barnersville/         # facility-specific
│   └── content-demo/                      # NEVER shipped to production
│       (each package has the same configuration/ skeleton as content-common)
│
├── packages/
│   ├── esm-liberia-epartograph-app/       # === CUSTOM BUILD === (greenfield ESM)
│   │   └── src/
│   └── modify-pr/.patches/                # === MODIFY + PR === (patch + upstream PR link)
│
├── integration/                           # === EXTERNAL ===
│   ├── eip/routes/                        # facility→central unidirectional push
│   ├── dhis2/mappings/                    # DHIS2 export + data-element mappings (MOH)
│   ├── cross-facility/                    # cross-facility patient query (Sprint 4)
│   ├── msupply/                           # integration-readiness spec (deferred)
│   └── fhir/                              # FHIR profiles / HL7 resources
│
├── docs/
│   ├── architecture/                      # solution architecture (SVG + spec)
│   ├── adr/                               # architecture decision records
│   ├── dak/                               # Digital Adaptation Kit references
│   ├── security/                          # RBAC + MOH ICT SOP / NCS mapping
│   ├── runbooks/                          # deploy, backup/restore, DR, go-live
│   └── metadata-specs/                    # per-programme metadata spec (BEFORE forms)
│
├── qa/                                    # per SQM Framework v1.0
│   ├── api/    e2e/                       # automated (QA Engineer directs)
│   ├── manual/                            # manual/exploratory (Tester executes)
│   ├── uat/                               # UAT scripts + sign-off
│   └── upgrade/                           # clean-install + upgrade harness
│
├── scripts/{validate,build,deploy}/
└── .github/workflows/
```

---

## 5. Implementation order (metadata BEFORE forms)

Starting with forms creates duplicated concepts and inconsistent encounters. Follow this
sequence, per programme, and write a metadata spec in `docs/metadata-specs/` first.

```text
Requirements
  → Concept dictionary (reuse CIEL; add custom only where needed)
  → Identifiers, locations, providers
  → Visit & encounter model
  → Programmes & workflows
  → Forms (ampathforms / O3 form-engine JSON)
  → Frontend runtime configuration
  → Reports & indicators
  → Integration mappings (FHIR, DHIS2, lab)
```

Per-programme metadata spec must cover: concepts (CIEL mappings, answers, units, data
types); encounters (types, roles, locations); visits (types, lifecycle); programmes
(enrolment states, workflows, outcomes); forms (schema, encounter association, version);
orders (tests, drugs, procedures, frequencies); reports (indicators, cohort logic);
integrations (FHIR/DHIS2/terminology/lab mappings).

### Concrete build order for this scaffold

1. **Root files** — `README.md`, `CONTRIBUTING.md`, `.gitignore`, handover notice.
2. **Distribution baseline** — `distribution/distro.properties` pinning the platform, the
   RefApp content package, and (initially empty) our content packages. Bring up
   `distribution/compose/facility/` as a working offline-capable stack.
3. **`content-common`** — variables → concepts → identifiers/locations/providers →
   visit/encounter types → shared roles/privileges → shared forms → shared frontend config.
4. **`content-liberia-national`** — national identifier types, MOH forms, reporting
   mappings, translations.
5. **`content-liberia-mch`** (priority) — ANC/L&D/PNC/FP metadata → programs+workflows →
   forms → frontend config. Then `lab`, `pharmacy`, `opd-ipd`.
6. **Site packages** — `content-site-careysburg`, `content-site-barnersville`: locations,
   wards, local roles, branding, formulary overrides.
7. **Custom Build** — `packages/esm-liberia-epartograph-app` (scaffold + stub; highest
   clinical risk) and the Liberia theme/branding (via site-package frontend config +
   branding assets).
8. **Integration / External** — `integration/eip/routes/` facility→central push; then
   `integration/dhis2/mappings/` (blocked on MOH); `cross-facility/` and `msupply/` later.
9. **QA** — scaffold `qa/*` referencing SQM Framework v1.0; wire the upgrade harness.
10. **CI** — `.github/workflows/` running the release pipeline (§8).

---

## 6. `content.properties` vs `distro.properties` — the version discipline

- **`content.properties`** (in each content package): declare **ranges** — `>=`. "I need
  this or later." Supports platform, OMOD, OWA, and frontend-module deps with semver ranges,
  plus `content.<pkg>` deps on other content packages.
- **`distro.properties`** (in `distribution/`): **pin exact** tested versions. Use the
  `content.` prefix for content packages. **Never** `latest`, dynamic versions, or `-SNAPSHOT`
  outside development.

Version each content package with **semver**: `1.0.0` initial; `1.1.0` backward-compatible
metadata; `1.1.1` non-breaking fix; `2.0.0` breaking metadata/workflow change. A distribution
release records all resolved versions.

---

## 7. Variables, not hard-coded UUIDs

One of the most important content-package practices. Declare each UUID **once** in
`configuration/variables.properties`, then reference `${var.*}` in forms, reports, and
frontend JSON. A consuming site package can override a variable to map onto pre-existing
production metadata, and the distribution author can be forced to supply a value when no safe
default exists. See `content-common/configuration/variables.properties` for the pattern.

Frontend runtime config files are copied into the distribution **but must also be listed in
the runtime `spa.configUrls` / `SPA_CONFIG_URLS`** before O3 will load them. Prefer runtime
JSON for branding, layout, registration fields, chart widgets, form availability, feature
flags, and UUID mappings — these change without rebuilding frontend source.

---

## 8. Release pipeline (CI)

```text
Pull request
  → validate JSON / CSV / XML
  → build content package(s)
  → run Initializer against a CLEAN database
  → run metadata validation tests
  → build custom distribution
  → launch complete Docker environment
  → run API + Cypress tests
  → TEST UPGRADE FROM PREVIOUS RELEASE   # critical
  → publish package + images
  → deploy to staging
  → approve production release
```

Build **immutable, versioned Docker images** (`liberia-emr-backend:x.y.z`,
`-frontend:x.y.z`, `-gateway:x.y.z`); never mount a mutable git checkout into a production
container. Backend image = OpenMRS WAR + exact OMOD versions + Initializer + resolved content
config. Frontend image = O3 app shell + exact frontend-module versions + runtime config +
branding + translations.

Always test **both**: (a) clean install on an empty DB → Initializer loads all metadata → O3
launches; (b) **upgrade** from the previous production DB → migrations run → Initializer
updates metadata → existing patient data stays valid. The upgrade test catches UUID
collisions, changed concepts, retired metadata, and altered workflows that a clean install
never surfaces.

---

## 9. Treat content as append-only in production

Once content is in production, do **not**: change UUIDs; change a numeric concept to
coded/text; remove coded answers without migration analysis; reuse retired concepts for new
meanings; silently change encounter semantics; delete program states already referenced by
patient data; mutate historical forms in ways that change meaning. Instead: retire the
incorrect concept → introduce a corrected one → migrate data; and for form changes, create a
**new form version** preserving the historical schema.

---

## 10. Security (contractual — do not loosen)

RBAC, password policy, session timeout, audit logging, encryption follow the **MOH ICT SOPs
(Feb 2023, v1.1.0)** and **National Cybersecurity Strategy 2025–2029**, documented in
`docs/security/`. Baseline: 13-char password minimum, 90-day expiry, no reuse of last 3,
lockout after 5 failed attempts, 10-minute session timeout, audit logs retained ≥3 months and
readable only by the ICT Unit, TLS for facility↔cloud sync, encrypted backups. Model these as
`privileges/` + `roles/` + `globalproperties/` in `content-liberia-national` (Ministry-wide)
with site overrides only where necessary. **Never** scaffold a looser default.

---

## 11. Guardrails — do NOT

- Do **not** merge distribution and content-package concerns; keep `distribution/` and
  `content-packages/` separate.
- Do **not** pin exact versions in `content.properties` or use ranges in `distro.properties`.
- Do **not** hard-code UUIDs in forms/reports/frontend JSON — use `${var.*}`.
- Do **not** ship `content-demo` (or any demo patients/test users) to production.
- Do **not** put integration logic (DHIS2, mSupply, EIP, FHIR) inside a content package —
  it belongs in `integration/`.
- Do **not** scaffold the e-partograph as a modify of a community component — it is greenfield.
- Do **not** commit secrets, keys, or PHI. Only `.env.example` templates in the repo.
- Do **not** use `latest` / dynamic / `-SNAPSHOT` deps outside development.
- Do **not** describe junior/support roles as independent owners of config or QA strategy;
  strategy and review sit with the senior/QA-Engineer roles.

---

## 12. Definition of done for the base scaffold

- Full tree exists (`.gitkeep` in empty dirs); `README.md`, `CONTRIBUTING.md`, `.gitignore`.
- `distribution/distro.properties` pins platform + RefApp content + our content packages.
- `distribution/compose/facility/` brings up a working offline-capable instance locally.
- `content-common` has `content.properties` (ranges), `variables.properties`, and the
  Initializer + frontend config skeletons.
- `content-liberia-national` seeds SOP-compliant RBAC (privileges/roles/globalproperties).
- `content-site-careysburg` + `content-site-barnersville` seed facility locations.
- `content-liberia-mch` scaffolded for the ANC/L&D/PNC/FP first-go-live scope.
- `packages/esm-liberia-epartograph-app` scaffolded + stubbed. Its `spa.frontendModules`
  line in `distro.properties` is commented out until the module is published: the scaffold
  has no webpack or tsconfig, so it cannot be built, and a pin to a coordinate npm has
  never seen fails `openmrs assemble` and with it the whole distribution.
- `integration/eip/routes/` has a documented facility→central placeholder.
- `qa/upgrade/` harness runs clean-install + upgrade tests; CI runs the §8 pipeline.
- No secrets or PHI anywhere in the repository.

---

## Appendix — deviations in this repository

Two places where the implementation here differs from the letter of the instructions above,
both deliberate:

1. **Single repository rather than separate repos.** §0 describes distribution and content
   packages as separate repositories. They live in one repository here, in separate trees
   with separate Maven modules and separate version streams. The separation §0 actually
   requires — of concerns and of version discipline — is preserved; splitting the git
   history is a later, mechanical step if the MOH wants it.

2. **No `#` comments inside Initializer CSVs.** Initializer parses CSVs row-by-row with no
   comment syntax, so a `#` line is read as a malformed record. Explanatory prose that would
   naturally sit at the top of a CSV lives in a sibling `README.md` instead, and
   `scripts/validate/validate-content.sh` fails the build if a comment line reappears.
