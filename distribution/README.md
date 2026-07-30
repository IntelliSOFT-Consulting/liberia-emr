# Distribution — assemble and deploy

Selects and **pins** the OpenMRS platform, backend modules, frontend modules and
content-package versions, then produces deployable Docker images. It answers *"this release
uses exactly version Y"*, while the content packages answer *"I require version X or later"*
([ADR 0001](../docs/adr/0001-two-artefact-model.md)).

| | |
| --- | --- |
| [`distro.properties`](distro.properties) | **The pin list.** Exact versions, no exceptions |
| [`backend/`](backend/) | OpenMRS WAR + OMODs + Initializer + resolved content config |
| [`frontend/`](frontend/) | O3 app shell + pinned ESMs + runtime config + branding |
| [`gateway/`](gateway/) | TLS termination and routing |
| [`compose/facility/`](compose/facility/) | Offline-first facility stack |
| [`compose/central/`](compose/central/) | Central aggregation stack |
| [`env/`](env/) | `.env` **templates only** — no real secrets |
| [`ci/`](ci/) | Pipeline notes; the workflows themselves live in `.github/workflows/` |

## Version discipline

Exact pins here. Ranges (`>=`) in each package's `content.properties`. Never the reverse, and
never `latest`, a dynamic version or `-SNAPSHOT` outside development —
`scripts/validate/validate-content.sh` and the release guard both enforce this.

## Images

Three per release, immutable and versioned:

```text
liberia-emr-backend:x.y.z
liberia-emr-frontend:x.y.z
liberia-emr-gateway:x.y.z
```

A mutable git checkout is never mounted into a production container. If you find yourself
wanting to, the answer is a runtime config change, not a bind mount.

## Two ordering constraints that fail silently

**Content layer order** — `backend/Dockerfile` unpacks packages in the order
common → national → programme → site. Later layers override earlier ones.

**Frontend config order** — the same order must appear in `SPA_CONFIG_URLS` in the compose
files. Copying a config file into the image is **not** enough: O3 only reads what is listed
there. And a file listed out of order overrides the wrong layer without erroring.

`scripts/build/collect-frontend-config.sh` writes a `.config-urls` file recording the order
it actually used, so the compose value can be diffed against the build.

## Building

```bash
./scripts/build/build-distribution.sh --version 1.0.0 --site careysburg
```

Runs the validators first, refuses `-SNAPSHOT` and `latest`, and refuses to include
`content-demo`.

For a training stack, `--demo` builds `liberia-emr-{backend,frontend}-demo` with
`content-demo` added as the last content layer, and
`compose/facility/docker-compose.demo.yml` runs them with sync disabled. Full procedure:
[docs/runbooks/demo-stack.md](../docs/runbooks/demo-stack.md).
