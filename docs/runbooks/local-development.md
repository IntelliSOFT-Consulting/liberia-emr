# Runbook — local development environment

How to get a LiberiaEMR instance running on your own machine and iterate on it. For a
training room, use [demo-stack.md](demo-stack.md); for a facility, [deploy.md](deploy.md).

Verified on 2026-07-30, macOS/arm64 with Colima. Where something does **not** work yet, this
says so and names what is missing — an instruction that has never been run is a guess.

## Prerequisites

| | |
| --- | --- |
| Docker + Compose v2 | Everything runs in containers. ~8 GB available to the VM. |
| Java 17 + Maven | Content packages build on the host as well as in the image. |
| Node | **Only** for frontend module work — and see §4, which does not work yet. |

Ports 80 and 443 must be free. Colima only mounts paths under `$HOME`, so anything you
bind-mount (certificates, a module checkout) has to live there, not in `/tmp`.

## 1. First run — a complete stack

The fastest way to something you can click around in is the demo stack:
[demo-stack.md](demo-stack.md) steps 1–4. In short:

```bash
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg --demo
cp distribution/env/demo.env.example distribution/env/demo.env   # then edit it
./scripts/deploy/deploy-facility.sh --env distribution/env/demo.env --demo --local
```

15–25 minutes to build cold, 5–10 for the first boot. Drop `--demo` from both commands for a
production-shaped stack with no demo content — which is what you want when checking how the
Liberia configuration behaves on its own:

```bash
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg
./scripts/deploy/deploy-facility.sh --env distribution/env/demo.env --local
```

The env file still wants to be a throwaway (`demo.env`, or a copy of `facility.env.example`
with the database and `CENTRAL_URL` pointed somewhere local) — without `--demo` the compose
overlay that neutralises sync is not applied. The deploy prompts you to confirm that, and
warns if `CENTRAL_URL` still points at the real central instance.

`--local` matters in both cases: without it the deploy pulls from the registry and fails on a
tag nobody has pushed. It is the flag that says "run what this daemon already has", so the
images it starts are unpublished — a facility still deploys a published tag ([ADR
0001](../adr/0001-two-artefact-model.md)).

## 2. Content changes — the loop you will live in

Configuration is baked into the backend image, so editing a CSV means rebuilding that image.
Validate first; it is seconds against minutes.

```bash
./scripts/validate/validate-content.sh          # JSON, CSV, collisions, variables, versions
mvn -B -q -DskipTests package                   # resolves ${var.*} into */target/configuration

docker build -f distribution/backend/Dockerfile \
  --build-arg SITE_PACKAGE=liberiaemr-site-careysburg \
  --build-arg DEMO_PACKAGE=liberiaemr-demo \
  --build-arg LIBERIAEMR_VERSION=1.0.0 \
  -t ghcr.io/intellisoft-consulting/liberia-emr-backend-demo:1.0.0 .

cd distribution/compose/facility
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env up -d backend
```

Omit `DEMO_PACKAGE` and the second `-f` for a non-demo stack.

**Initializer is idempotent**, so a restart re-applies changed metadata against the existing
database — about two minutes. You need a full reset (`down -v`, then `OMRS_CREATE_TABLES=true`)
only when you change something append-only (a UUID, a concept datatype) or want to prove a
clean install.

**Read the log, do not trust the health check.** `OMRS_CONFIG_INITIALIZER_STARTUP_LOAD` is
currently set to a value Initializer does not recognise, so metadata errors do not fail the
boot:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env logs backend | grep -iE 'ERROR|Exception' | head -40
```

Four failure modes account for most of what you will see there, all of which fail *silently*
in the sense that the stack still comes up:

- `'${var.x}' did not pass the soft check for being a valid OpenMRS UUID` — the variable is
  not declared in any `variables.properties`, or you edited the source tree and rebuilt the
  image without re-running `mvn package`.
- A row rejected for a value that is obviously a list — Initializer separates multi-value
  fields with **`;`**, not `,`.
- Metadata that simply is not there — two layers shipping the same file name, where the
  later layer replaces the earlier one. `validate-content.sh` fails on this now.
- `Concept Source is required` — CIEL is not loaded on any local build; see §5.

## 3. Frontend runtime configuration

`configuration/frontend_configuration/config-*.json` is collected in layer order into the
frontend image, and the app shell resolves its config list from the HTML it was **built**
with. `SPA_CONFIG_URLS` in the compose files is inert against our nginx image — it exists so
the build can diff intent against what was collected. So a config change means rebuilding the
frontend image:

```bash
mvn -B -q -DskipTests package
./scripts/build/collect-frontend-config.sh --site careysburg --demo true \
  --out distribution/frontend/config
docker build -f distribution/frontend/Dockerfile \
  --build-arg SPA_CORE=10.0.0 \
  --build-arg "SPA_CONFIG_URLS=$(paste -sd, distribution/frontend/config/.config-urls)" \
  --build-arg LIBERIAEMR_VERSION=1.0.0 \
  -t ghcr.io/intellisoft-consulting/liberia-emr-frontend-demo:1.0.0 distribution/frontend
docker compose ... up -d frontend
```

Or just re-run `build-distribution.sh`, which does all of it in the right order.

## 4. Frontend module (`packages/esm-liberia-epartograph-app`)

**This does not run yet.** `yarn start` (`openmrs develop`) cannot start the module in its
current state. Verified by installing the toolchain and working through the failures one at
a time; each of these is a separate missing piece:

| Blocker | Status |
| --- | --- |
| `routes.json` at the package root | **fixed** — `@openmrs/rspack-config` requires `src/routes.json` |
| no `tsconfig.json` | **fixed** — the type checker aborts without one |
| no `translations/` directory | outstanding — `src/index.ts` does `require.context('../translations', …)` |
| no `src/partograph/*.component.tsx` | outstanding — `index.ts` and `src/routes.json` both reference them; this is the implementation work the README defers |
| no build config | outstanding — the CLI needs `webpack.config.js` (`module.exports = require('@openmrs/webpack-config').default`) or `rspack.config.js` plus `--use-rspack` |
| no `yarn.lock`, no workspace root | outstanding — installing the `next`-tagged toolchain with yarn 1 resolves duplicate `webpack` copies under `openmrs` and `@openmrs/webpack-config`, and the build dies on `The 'compilation' argument must be an instance of Compilation` |

The last one is the real work: the package needs a proper JS workspace (root
`package.json`, yarn 4, and `resolutions` pinning a single webpack), not another
one-off file. Until then, treat `packages/` as a scaffold, and note that CI's
`yarn verify` step is still a `TODO` echo — nothing is checking this.

When it is fixed, the loop is the standard O3 one — the dev server proxies to the stack you
already have running:

```bash
cd packages/esm-liberia-epartograph-app
yarn install
yarn start --backend https://localhost --no-open      # self-signed cert
```

On a machine with no Node (this one), run it in a container on the compose network, which
resolves the gateway by service name and needs no host toolchain:

```bash
docker run --rm -it --network liberiaemr-facility_liberiaemr -p 8080:8080 \
  -v "$HOME/path/to/esm-liberia-epartograph-app":/app -w /app \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 node:20-alpine \
  sh -c 'corepack enable && yarn install && \
         ./node_modules/.bin/openmrs develop --host 0.0.0.0 --port 8080 \
           --backend https://gateway --no-open'
```

The checkout must be under `$HOME` for Colima to mount it.

## 5. What does not work locally, and is not your fault

- **`mvn verify` fails on Apple Silicon.** The packager plugin's `validate-configurations`
  goal starts a testcontainer whose bundled JNA is x86-only, and Colima's socket is not at
  `/var/run/docker.sock`. It fails identically for every package. Locally use
  `mvn package` plus the validate scripts; CI on ubuntu-latest runs the real goal.
- **CIEL is not loaded without an OCL token.** `build-distribution.sh` fetches the
  collections pinned in `distribution/distro.properties` when `OCL_API_TOKEN` is set, and
  warns and continues when it is not. To pull one into an existing checkout by hand, run
  `OCL_API_TOKEN=... scripts/build/fetch-ciel.sh` — it writes a gitignored
  `lib-<collection>-ciel-*.zip` into `content-common/.../ocl/`. Until you do, concepts
  mapping to a CIEL source fail and parts of the MCH content do not load. The demo package's
  own OCL exports do load.
- **A full CIEL export makes a clean install take hours.** ~59,000 concepts and ~300,000
  mappings are imported on first boot before the backend answers `/health/started`; the
  curated collections in `distro.properties` exist to avoid exactly that. If a first boot
  looks hung, check whether the concept count is still climbing before assuming a failure —
  `qa/upgrade/run-clean-install.sh` prints it while it waits.
- **Nothing is pushed to the registry.** Every local run builds its own images; `--local`
  on the deploy script exists for exactly that.

## 6. Files that are yours, not the repository's

Git-ignored, and absent from a fresh clone — expect to recreate them:

| Path | How |
| --- | --- |
| `distribution/env/*.env` | copy from the matching `.env.example` |
| TLS certificates | `openssl req -x509 …`, see [demo-stack.md](demo-stack.md) §2 |
| `content-packages/content-demo/…/ocl/*.zip` | `./scripts/build/lift-demo-content.sh --ocl-only` |
| `distribution/backend/modules/`, `distribution/frontend/config/` | generated by the build scripts |

## Before you open a PR

```bash
./scripts/validate/validate-content.sh
./scripts/validate/no-secrets.sh
./scripts/build/lift-demo-content.sh --check    # content-demo still matches upstream 1.9.2
mvn -B clean verify                             # see §5 if you are on Apple Silicon
```

And the conventions that decide *where* a change goes are in
[CONTRIBUTING.md](../../CONTRIBUTING.md) — classify the change before writing it.
