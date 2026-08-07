# Runbook — deploy a facility instance with demo data

For training rooms, UAT sessions and demonstrations. The stack is a complete facility stack
running the `-demo` images: the same platform, modules and Liberia content as production,
plus `content-demo` — the reference application demo metadata, lifted verbatim from
[openmrs-content-referenceapplication-demo](https://github.com/openmrs/openmrs-content-referenceapplication-demo)
1.9.2 (`content-packages/content-demo/`).

Verified end to end on 2026-07-30 against `1.0.0` built from this repository: 67 locations,
4,176 concepts, 10 demo forms, 322 drugs, 34 roles.

> **Never on a facility production machine, and never against a facility database.** Staff
> train on this stack; they never train on production ([go-live.md](go-live.md)).

## What "demo data" means here

- **Metadata, not patients.** Starter concepts, diagnoses, drugs, lab tests, demo forms
  (SOAP note, Covid 19, mental health assessment, test forms), queues, appointment
  services, billing services and cash points, training roles. The
  `referencedemodata` module that generates demo *patients* is not pinned in
  `distro.properties`, so the instance starts with an empty patient list and trainees
  create their own practice records.
- **It loads last and it wins.** Layer order is common → national → programme → site →
  **demo**. Where upstream demo metadata collides with ours the demo values are what the
  training instance shows — the location picker, for example, lists Ward 1–3 and Site 1–50
  alongside the six Careysburg locations. A demo stack is **not a rehearsal of production
  configuration**; verify site behaviour on a non-demo build. The one exception is the
  address hierarchy: the demo layer's `addresshierarchy/` is dropped at image build time, so
  registration uses the Liberia counties and health districts, not upstream's Cambodian
  provinces.
- **It cannot sync.** The demo overlay neutralises the sync service three ways over, so
  fabricated patients cannot reach the central instance.

## Preconditions

- Docker and Docker Compose v2. The build needs network access and ~8 GB of memory
  available to the Docker VM; the backend image is ~1.6 GB and the frontend ~480 MB.
- Ports 80 and 443 free on the host.
- A release version that is **not** `-SNAPSHOT` — `build-distribution.sh` refuses to build
  an image at a snapshot version.
- Either access to the registry (published `-demo` images) or a checkout to build from.

## 1. Build the images

```bash
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg --demo
```

Allow 15–25 minutes on a cold cache. In order, this validates the content, builds the
content packages (resolving `${var.*}` into `target/configuration`), fetches the demo OCL
concept exports if they are missing, resolves the 32 OMODs pinned in `distro.properties`,
generates the import map, collects the frontend config in layer order, checks that order
against `SPA_CONFIG_URLS` in the demo compose file, and builds three images:

```text
liberia-emr-backend-demo:1.0.0     platform + OMODs + Liberia content + content-demo
liberia-emr-frontend-demo:1.0.0    app shell + config-core/national/mch/site/demo
liberia-emr-gateway:1.0.0          shared with production — there is no -demo gateway
```

`--demo` is what puts `content-demo` into the backend image (`DEMO_PACKAGE` in
`distribution/backend/Dockerfile`) and adds `config-demo.json` to the frontend. **A build
without `--demo` produces production images with no demo content**, and the compose overlay
cannot add it afterwards — the overlay only selects an image. If queues, diagnoses and demo
forms are missing at the end of this runbook, that is the cause; rebuild.

To fetch the gitignored OCL exports by hand (`--ocl-only` is also run automatically above):

```bash
./scripts/build/lift-demo-content.sh --ocl-only
```

## 2. TLS certificates

The gateway terminates TLS and will not start without `fullchain.pem` and `privkey.pem`.
Self-signed is fine for training — the browser warning is a useful reminder of where you
are. Any directory the Docker daemon can mount works; a home directory avoids `sudo`:

```bash
mkdir -p ~/.liberiaemr/demo-certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout ~/.liberiaemr/demo-certs/privkey.pem \
  -out    ~/.liberiaemr/demo-certs/fullchain.pem \
  -subj "/CN=liberiaemr-demo.local"
```

## 3. Environment file

```bash
cp distribution/env/demo.env.example distribution/env/demo.env
```

Then set:

| Key | Value |
| --- | --- |
| `LIBERIAEMR_VERSION` | the version built in step 1 (`1.0.0`) |
| `FACILITY_CODE` | the site the image was built with (`careysburg`) |
| `TLS_CERT_DIR` | the directory from step 2, absolute path |
| `MYSQL_*` | throwaway passwords — never a facility credential |
| `OMRS_CREATE_TABLES` | `true` for the first boot on an empty database |
| `CENTRAL_URL` | leave on localhost |

`demo.env` is git-ignored. The deploy script refuses an env file that points a training
stack at a real central instance.

## 4. Start the stack

```bash
./scripts/deploy/deploy-facility.sh --env distribution/env/demo.env --demo --local
```

`--local` skips the registry pull and uses the images just built; drop it when deploying
published ones. Equivalent by hand — **both** compose files, in this order:

```bash
cd distribution/compose/facility
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env up -d
```

Omitting `-f docker-compose.demo.yml` silently starts production images against the demo
database. Nothing errors; you simply get no demo content.

First boot creates the schema and loads every content layer — 5 to 10 minutes, during which
compose holds `frontend` and `gateway` back until the backend health check passes. Watch it:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env logs -f backend
```

## 5. Verify

```bash
cd distribution/compose/facility
C="-f docker-compose.yml -f docker-compose.demo.yml --env-file ../../env/demo.env"

docker compose $C ps                       # db, backend, frontend, gateway — and NO sync
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/openmrs/spa/          # 200
curl -sk -u admin:Admin123 https://localhost/openmrs/ws/rest/v1/session           # authenticated
curl -sk -u admin:Admin123 \
  'https://localhost/openmrs/ws/rest/v1/location?tag=Login+Location&limit=100'    # not empty
```

Then in a browser at [https://localhost/openmrs/spa/](https://localhost/openmrs/spa/)
(accept the self-signed certificate), log in as `admin` / `Admin123`:

- [ ] The location picker offers demo locations (Outpatient Clinic, Ward 1–3, Site 1–50)
      **and** the site's own (Careysburg Health Center, OPD, Maternity, Inpatient Ward,
      Laboratory, Pharmacy)
- [ ] The instance is labelled `DEMO — NOT FOR PATIENT DATA`
- [ ] Service queues and appointment services are populated
- [ ] A diagnosis search for a common term returns starter-kit results
- [ ] A demo form (SOAP Note, Covid 19, Test Form) opens in a visit
- [ ] Register a synthetic patient end to end — that is the training path

An empty location picker means the metadata did not load. Read the backend log for
Initializer errors before rebuilding anything:

```bash
docker compose $C logs backend | grep -iE 'ERROR|Exception' | head -40
```

## 6. Reset between training sessions

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env down -v
```

`-v` removes the database volume, so set `OMRS_CREATE_TABLES=true` in `demo.env` again
before the next start. Nothing of value is lost — everything on a demo stack is synthetic
by construction.

## 7. Upgrading a training stack

Change `LIBERIAEMR_VERSION` in `demo.env` and re-run step 4. There is no backup step and no
maintenance window: on a training box the correct response to a bad upgrade is a reset
(step 6), not a restore. Do not use this to rehearse a facility upgrade — that rehearsal
needs the real data shape and lives in [deploy.md](deploy.md) and `qa/upgrade/`.

## Known gaps on a fresh build

Expected in the backend log; none of them stop the stack or the training path.

- **CIEL is not loaded.** `scripts/build/fetch-ciel.sh` is unimplemented, so concepts that
  map to a CIEL source fail with `conceptMappings[n].conceptReferenceTerm.conceptSource:
  Concept Source is required`, and parts of the MCH programme content (partograph numerics,
  workflow states) do not load. The demo package's own OCL exports do load, which is why
  there are still 4,176 concepts.
- **`Bad concept class name 'State'`** in the MCH package — a content bug, not a build one.
- **`OMRS_CONFIG_INITIALIZER_STARTUP_LOAD=continue_on_error=false`** in the compose files is
  not a value Initializer recognises. It falls back to continuing on error, which is why a
  boot with the errors above still reports healthy. The intended value is `fail_on_error`;
  do not change it without first clearing the errors above, or no stack will boot at all.

## Guardrails

- No real patient data on a demo stack, ever. A demo dataset built by copying production
  records is a PHI breach with extra steps.
- No production credentials in `demo.env`. A training box holding a facility database
  password is a route into production.
- Never pass `--profile sync`. The overlay stops the service anyway, but the intent matters:
  a training stack has nothing central should ever receive.
- Do not sign off a facility's configuration on a demo instance — demo metadata overrides
  the site layer, so what you approved is not what goes live.
