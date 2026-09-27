# Distribution — assemble and deploy

Selects and **pins** the OpenMRS platform, backend modules, frontend modules and
content-package versions, then produces deployable Docker images. It answers *"this release
uses exactly version Y"*, while the content packages answer *"I require version X or later"*
([ADR 0001](../docs/adr/0001-two-artefact-model.md)).

| | |
| --- | --- |
| [`distro.properties`](distro.properties) | **The pin list.** Exact versions, no exceptions |
| [`backend/`](backend/) | OpenMRS WAR + OMODs + the in-tree `liberiaemr` OMOD + Initializer + resolved content config |
| [`frontend/`](frontend/) | O3 app shell + pinned ESMs + runtime config + branding, plus pinned patches to three upstream ESMs |
| [`gateway/`](gateway/) | TLS termination and routing; blocks the legacy admin UI unless `LEGACY_ADMIN_UI=true` |
| [`sync/`](sync/) | dbsync sender (facility) and receiver (central), built from source |
| [`broker/`](broker/) | The mutual-TLS Artemis broker at central that facilities push to |
| [`monitoring/`](monitoring/) | Prometheus and Alertmanager configuration, alert rules, the certificate expiry exporter |
| [`compose/facility/`](compose/facility/) | Offline-first facility stack, and the demo/training overlay |
| [`compose/central/`](compose/central/) | Central aggregation stack |
| [`env/`](env/) | `.env` **templates only** — no real secrets |
| [`ci/`](ci/) | Pipeline notes; the workflows themselves live in `.github/workflows/` |

## Version discipline

Exact pins here. Ranges (`>=`) in each package's `content.properties`. Never the reverse, and
never `latest`, a dynamic version or `-SNAPSHOT` outside development —
`scripts/validate/validate-content.sh` and the release guard both enforce this.

Two backend pieces do not follow the `omod.*` pattern, on purpose:

- **The `liberiaemr` OMOD** (`modules/liberiaemr`) has never been published to
  mavenrepo.openmrs.org, so `scripts/build/resolve-modules.sh` could not resolve a pin. A stage
  of `backend/Dockerfile` builds it from the source in the commit being built and stamps it
  with the distribution version, so a release image never carries a SNAPSHOT omod. See
  [modules/liberiaemr/README.md](../modules/liberiaemr/README.md#how-it-reaches-production).
- **dbsync** is pinned as `sync.dbsync` (the source tag `sync/Dockerfile` builds), with
  `sync.eip` recording the openmrs-eip version that tag declares. Bump the two together.

The custom ESMs from `packages/` are pinned like any other frontend module, as
`spa.frontendModules.@liberiaemr/*`: `esm-liberia-epartograph-app`,
`esm-liberia-patient-chart-extension`, `esm-liberia-sync-status-app` (the national sync status
page; at a facility its menu item is hidden and the page shows a not-available notice) and
`esm-liberia-login-app`, which replaces the core `esm-login-app` (commented out). A `-pre.N` pin is a pre-release `packages.yml` published from
`main`; re-pin deliberately, never to the `next` tag.

## Images

Seven per release, immutable and versioned, each tagged `${REGISTRY}/<image>:x.y.z`.
`REGISTRY` defaults to `intellisoftdev` in `scripts/build/build-distribution.sh`; the
compose files read it from the stack's `.env`.

| Image | Built from | Runs in |
| --- | --- | --- |
| `liberia-emr-backend` | `backend/Dockerfile` | facility, central |
| `liberia-emr-frontend` | `frontend/Dockerfile` | facility, central |
| `liberia-emr-gateway` | `gateway/Dockerfile` | facility, central |
| `liberia-emr-sync` | `sync/Dockerfile --target sender` | facility (`sync` profile) |
| `liberia-emr-sync-receiver` | `sync/Dockerfile --target receiver` | central |
| `liberia-emr-broker` | `broker/Dockerfile` | central (the `artemis` service) |
| `liberia-emr-cert-expiry` | `monitoring/cert-expiry/Dockerfile` | central |

Prometheus and Alertmanager run the upstream images, pinned by tag in the compose files.
The central stack also names `liberia-emr-dhis2-export` under the `dhis2` profile; nothing in
this repository builds that image yet.

A mutable git checkout is never mounted into a production container. If you find yourself
wanting to, the answer is a runtime config change, not a bind mount. The stacks do mount
two checkout directories read-only, both configuration rather than code: `monitoring/` for
Prometheus and Alertmanager, and each stack's own `initdb/` for MariaDB's first boot. A host
deployed from images alone still needs both; without `initdb/`, a fresh volume never gets
the sync database principals and the sender or receiver cannot connect.

## Stacks

| Service | Facility | Central |
| --- | --- | --- |
| `db` (MariaDB 10.11) | yes, with the binary log the sync sender reads | yes |
| `backend`, `frontend` | yes | yes |
| `gateway` | ports 80 and 443 | port 443 |
| `sync` (sender) | `sync` profile | — |
| `artemis`, `sync-receiver`, `cert-expiry` | — | yes |
| `prometheus`, `alertmanager` | `sync` profile | yes |
| `dhis2-export` | — | `dhis2` profile |

Each stack's `initdb/` creates the sync database principals on the first boot of an empty
volume (see the `initdb/README.md` in each). The demo overlay, `compose/facility/docker-compose.demo.yml`,
swaps in the `-demo` backend and frontend images and disables `sync`.

## Environment

`env/facility.env.example`, `env/central.env.example` and `env/demo.env.example` are the
templates. Copy one to `<stack>.env` beside it (`*.env` is gitignored) and pass it with
`docker compose --env-file`. The templates hold placeholders (`CHANGE_ME` or empty), and the
demo template's passwords are deliberately not secrets; real secrets come from the MOH
secret store.

Besides the database, release and sync settings, the facility and central templates carry:

- `ALERT_*` and `PROM_BIND_ADDR`: where alerts are delivered, and which interface the
  Prometheus and Alertmanager UIs bind (loopback by default). See
  [monitoring/README.md](monitoring/README.md).
- `LIBERIAEMR_SMTP_*` and `LIBERIAEMR_FRONTEND_URL`: the password reset relay for the
  `liberiaemr` module, passed through to `backend` by both compose files. Prefer
  `LIBERIAEMR_SMTP_PASSWORD_FILE` to the plain variable. Unset means no reset mail.
- `LIBERIAEMR_SYNC_MONITORING_URL` (central only): the Prometheus the sync status endpoint
  reads, `http://prometheus:9090` by default. Empty turns the page off.
- `LEGACY_ADMIN_UI` (facility and demo, commented out): one variable drives both the
  gateway block and the backend switch, and unset means false. Only a dev, staging or local
  box sets it true; CI's dev deploy passes it on the command line. Central hard-codes
  false.

## Two ordering constraints that fail silently

**Content layer order** — `backend/Dockerfile` unpacks packages in the order
common → national → programme → site, then `content-demo` for a `--demo` build. Later layers
override earlier ones.

**Frontend config order** — O3 reads only the config files listed in `SPA_CONFIG_URLS`, in
that order. Copying a file into the image is **not** enough, and a file listed out of order
overrides the wrong layer without erroring.

`scripts/build/collect-frontend-config.sh` writes a `.config-urls` file recording the order
it actually used. `build-distribution.sh` bakes that list into the frontend image
(`openmrs build --config-url`), because the app shell reads its config list from the HTML it
was built with; the `SPA_CONFIG_URLS` environment variable in a compose file does not change
what the running image loads. The facility compose value (or the demo overlay's, for
`--demo`) must still match: the build diffs it against `.config-urls` and fails on drift.
The central compose file's list is not checked, and changes nothing either: the central
stack runs the same frontend image, built with a facility site's list. The
`config-central.json` it names exists in no content package.

## Building

```bash
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg
```

Runs the validators first, refuses `-SNAPSHOT` and `latest`, and refuses to include
`content-demo`. Before the images it fetches the OCL exports (the MOH's CIEL collections need
`OCL_API_TOKEN`; without it the build warns and concepts that map to CIEL will not load),
resolves the OMODs and generates the frontend import map.

`--no-frontend` skips the frontend image only. Its assemble stage npm-installs the app shell
and downloads every pinned ESM, which dominates the build, so CI's clean-install gate — which
asserts nothing about the SPA — leaves it out. A release build must never use it: the images
carry one version and are meant to ship together.

`--no-sync` skips the sync sender, receiver, broker and certificate expiry images.

For a training stack, `--demo` builds `liberia-emr-{backend,frontend}-demo` with
`content-demo` added as the last content layer (the gateway keeps its normal name, and the
sync, broker and exporter images are not built), and
`compose/facility/docker-compose.demo.yml` runs them with sync disabled. Full procedure:
[docs/runbooks/demo-stack.md](../docs/runbooks/demo-stack.md).
