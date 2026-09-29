# 0011: Compose central as its own build, with `content-central` in the site layer's place

**Status:** Accepted (Option A, 27 September 2026)
**Date:** 27 September 2026 · **Ticket:** LE-359 (related: LE-339, LE-324)

## Context

Central needs settings that no facility may have. The first is the MFL facility switcher
(LE-324, PR #160): `chooseLocation.locationTag = "Health Facility"` in the login app, which at
a facility would replace the login-location picker with a list of about 1,000 facilities.
LE-339 raises the backend side of the same question: central has to hold the locations of
every facility that syncs to it.

What central runs today was established from the code, not the docs:

1. **The frontend config list is fixed when the image is built.** `openmrs build --config-url`
   (CLI 10.0.0, `spa.core` in `distro.properties`) sets `OMRS_CONFIG_URLS`. The app shell's
   rspack config (`@openmrs/esm-app-shell` 10.0.0, `rspack.config.js`) writes it into
   `index.html` as `initializeSpa({ configUrls: [...] })`. Our frontend image is plain
   `nginx:1.27-alpine` serving static files, with no start-up script that templates
   `index.html` the way the community frontend image does. So `SPA_CONFIG_URLS`, `SPA_PATH` and
   `API_URL` in a compose file change nothing in the running app;
   `distribution/frontend/Dockerfile` already says so for the last two.
2. **Central runs a Careysburg build.** `distribution/compose/central/docker-compose.yml`
   pulls `liberia-emr-frontend:${LIBERIAEMR_VERSION}` and `liberia-emr-backend:…`, the images
   `build-distribution.sh --site careysburg` produces. CI and the dev deploy always build
   `careysburg`. So central loaded `config-core`, `-national`, `-mch`, `-opd` and **Careysburg's
   `config-site.json`**, including Careysburg's logo text and billing cash point. The
   `config-central.json` its compose file named existed in no package and was never fetched.
   Its backend likewise carries Careysburg's site layer, and no other site's.
3. **A config URL that fails to load is not an error.** The app shell's config loader
   (`src/run.ts`, `createConfigLoader`) logs a failed fetch to the console and treats that
   layer as `{}`. That makes a runtime-optional layer possible (option B), but also means a
   missing layer fails silently.

## Options

**A. Central is its own composition.** A `content-central` package takes the site layer's place
in a central build: `build-distribution.sh --site central`. It produces `-central` images, the
same way `--demo` produces `-demo` images.

**B. A runtime layer on the shared image.** Every image lists an extra URL, e.g.
`config-deployment.json`. Central supplies the file at deploy time, by a mounted file or an
nginx rule keyed on an environment variable. At a facility the file is absent, and the shell
reads it as `{}`.

**C. Put central settings in `config-national.json` behind a runtime condition.** O3 config
has no per-deployment condition, and adding one means patching every module that reads the key.
Rejected without further comparison.

| Criterion | A: own composition | B: runtime layer |
| --- | --- | --- |
| Two-artefact model (ADR 0001) | Central config is versioned content, built into an immutable image | The file lives outside content (a deploy-time mount) or in every image behind an env switch |
| Layering (ADR 0003) | Uses the existing site slot; no new mechanism | A new, unlayered override outside the build's order checks |
| Same backend image at facility and central | Unchanged today; central gets its own backend only when LE-339 needs it | Unchanged |
| Facility gets central config by accident | Impossible: a facility build never collects `content-central` | One mis-set variable or a copied mount does it, and nothing reports it |
| Fixes central running Careysburg's `config-site.json` | Yes | No: central still runs a Careysburg image |
| Build and CI cost | One more frontend image per release (minutes). CI adds a list check only | None |
| Operations | Central pulls one differently named image; a missing central build fails the pull loudly | Operators manage a config file or variable by hand; a missing file fails silently (fact 3) |
| Extends to LE-339 | Yes: the same layer gains `backend_configuration` | No: backend content cannot be supplied this way |

## Decision

**Option A.** Central is a build composition of its own:

- **`content-central`** is a content package, `liberiaemr-central`, in the reactor after the
  site packages. It is the last layer of a central build, where a facility build has its site
  layer, and it is never part of a facility build. `collect-frontend-config.sh` adds it only
  for `--site central`.
- **`build-distribution.sh --site central`** builds `liberia-emr-frontend-central:<version>`
  and, since LE-339, `liberia-emr-backend-central:<version>` ([ADR 0012](0012-central-site-locations.md)).
  It refuses `--demo`; `--no-frontend` builds the central backend alone. It checks the central compose file's
  `SPA_CONFIG_URLS` against the collected order, just as a facility build checks the facility
  compose file. CI runs that check on every change without building the image
  (`scripts/validate/spa-config-urls.sh`), and the release matrix builds `central` alongside
  the sites.
- **Central's frontend and backend differ from a facility's.** Its backend,
  `liberia-emr-backend-central`, adds every site package's locations (LE-339,
  [ADR 0012](0012-central-site-locations.md)). Central runs the facility release's gateway and
  sync images of the same version; a central build does not rebuild them.
- **The central frontend layers** are core, national, mch, opd, then central.
- **`config-central.json`** does three things:
  - It keeps the non-site settings central used to get from `config-site.json`: the login
    location picker and the registration encounter type. Moving central onto the new layer
    therefore changes nothing there.
  - It drops Careysburg's billing cash point, since central does not bill.
  - It adds one visible, harmless setting that only central has: the navigation logo's alt
    text, "… National Central Server". This proves the mechanism.

**Enabling LE-324** at central, once #160 is merged, is one line in
`content-packages/content-central/configuration/frontend_configuration/config-central.json`,
inside `"@liberiaemr/esm-liberia-login-app"` → `"chooseLocation"`:

```json
"locationTag": "Health Facility"
```

## LE-339: how this extends to central's backend

**Decided in [ADR 0012](0012-central-site-locations.md) (29 September 2026), as recommended
here.** The direction this ADR set out:

- `content-central` gains `backend_configuration/`.
- `--site central` also builds `liberia-emr-backend-central` with
  `SITE_PACKAGE=liberiaemr-central`.
- The central backend image unpacks the `locations/` of **every** site package, not the whole
  site layer. Site packages also carry facility-only content, such as identifier sequences and
  cash points, that central must not load.

The site location files are already safe to load side by side: their files and location names
are distinct per site, and each is resolved against its own variables when the package is
built. `location.facility-root.uuid` is only used inside the site packages, so a central
backend with no single site root breaks nothing in the upstream layers. The facility switcher
filters on `Health Facility`, so the wards of every site don't flood central's picker. With
this, ADR 0009's prerequisite holds by construction: central holds each site root before that
site's first MFL sync.

## Consequences

- A release builds one more image. The deploy runbook says central needs its central build
  published as well as its facility build.
- A change meant for central alone is a **Configure** change in `content-central`. Nothing in
  it can reach a facility.
- Central's navigation text now reads "National Central Server" instead of Careysburg's.
  Nothing else central users see changes.
- **Not fixed here, fixed since by LE-360:** the release matrix built Careysburg and Barnersville
  under the same image names and tags, although their backend and frontend images differ by site
  layer, so a multi-site release would have overwritten one site's images with the other's.
  Releases now publish those two images per site, `liberia-emr-backend-<site>` and
  `liberia-emr-frontend-<site>`, the way `-central` names central's frontend (see
  `distribution/README.md`).
