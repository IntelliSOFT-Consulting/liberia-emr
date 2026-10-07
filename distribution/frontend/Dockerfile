# LiberiaEMR frontend image
#
# = O3 app shell + exact frontend-module versions + runtime configuration + branding +
# translations. Immutable and versioned (liberia-emr-frontend:x.y.z).
# See IMPLEMENTATION.md §8.

# ---------------------------------------------------------------------------
# Stage 0 — this commit's chart modules
# ---------------------------------------------------------------------------
# distro.properties still names the npm pins assemble downloads below. Those pins
# do not contain this commit's privilege-aware partograph or chart extension.
# Build that source here and overlay it before the SPA is bundled.
FROM node:22-bookworm-slim AS local-chart-esms

WORKDIR /src
COPY local-esm/ /src/
RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
  && cd /src/esm-liberia-epartograph-app && yarn install --frozen-lockfile && yarn build \
  && cd /src/esm-liberia-patient-chart-extension && yarn install --frozen-lockfile && yarn build

# ---------------------------------------------------------------------------
# Stage 1 — assemble the SPA from the pinned import map
# ---------------------------------------------------------------------------
FROM node:20-alpine AS assemble

WORKDIR /app

# The `openmrs` CLI IS the app shell, so its version is spa.core and nothing else. Passed in
# by scripts/build/build-distribution.sh straight from distro.properties rather than written
# here, because a second copy of the number is a second thing to forget: this file previously
# pinned 5.9.0 against a spa.core of 10.0.0, a version npm has never published.
ARG SPA_CORE
RUN [ -n "$SPA_CORE" ] || { echo "SPA_CORE build-arg is required (spa.core in distro.properties)" >&2; exit 2; }; \
    npm install -g "openmrs@${SPA_CORE}"

# spa-assemble-config.json is GENERATED from distribution/distro.properties by
# scripts/build/generate-import-map.sh — do not hand-edit it.
COPY spa-assemble-config.json /app/spa-assemble-config.json

RUN openmrs assemble --manifest --mode config --config /app/spa-assemble-config.json --target /app/spa

COPY --from=local-chart-esms /src/esm-liberia-epartograph-app/dist/ /tmp/local-dist/epartograph/dist/
COPY --from=local-chart-esms /src/esm-liberia-epartograph-app/src/routes.json /tmp/local-dist/epartograph/routes.json
COPY --from=local-chart-esms /src/esm-liberia-patient-chart-extension/dist/ /tmp/local-dist/chart/dist/
COPY --from=local-chart-esms /src/esm-liberia-patient-chart-extension/src/routes.json /tmp/local-dist/chart/routes.json
COPY overlay-local-chart-esms.cjs /app/overlay-local-chart-esms.cjs
RUN node /app/overlay-local-chart-esms.cjs

# assemble downloads the frontend modules and writes the import map. It does NOT produce an
# app shell — no index.html, no bootstrap script — so an image built from assemble alone
# serves nginx's default welcome page at /openmrs/spa/ and nothing else. `build` generates
# the shell around the assembled import map.
#
# --spa-path and --api-url are baked in here because this nginx image serves static files
# and does not template index.html at runtime the way the community frontend image does:
# the SPA_PATH and API_URL environment variables in the compose files are inert against
# this image, and these two values are what actually take effect. They must stay in step
# with the gateway's routes (distribution/gateway/nginx.conf).
#
# SPA_CONFIG_URLS is the collected layer order (scripts/build/collect-frontend-config.sh
# writes it, build-distribution.sh passes it). It has to be baked in for the same reason:
# the app shell reads its config list from the HTML it was built with, so a config file
# that is only named in the compose environment is never fetched — the image ships every
# layer's configuration and applies none of it.
ARG SPA_CONFIG_URLS
RUN set -eu; \
    [ -n "${SPA_CONFIG_URLS}" ] || { echo "SPA_CONFIG_URLS build-arg is required" >&2; exit 2; }; \
    config_args=""; \
    for url in $(echo "${SPA_CONFIG_URLS}" | tr ',' ' '); do \
      config_args="${config_args} --config-url ${url}"; \
    done; \
    echo "config urls:${config_args}"; \
    openmrs build --target /app/spa --build-config /app/spa-assemble-config.json \
      --spa-path /openmrs/spa/ --api-url /openmrs/ --page-title LiberiaEMR ${config_args}

# Registration app 11.1.0 disables its button through Formik state, but two click events can
# enter onSubmit before React commits that state. The patch is pinned and asserts the exact
# compiled input, so an upstream release cannot silently receive an incompatible rewrite.
COPY patch-patient-registration.cjs /app/patch-patient-registration.cjs
RUN node /app/patch-patient-registration.cjs

# Orders app 12.3.4 swallows validation errors (like globalErrors and fieldErrors) when
# posting encounters and just says "Invalid Submission". This patch extracts detailed
# validation errors and displays them.
COPY patch-patient-orders.cjs /app/patch-patient-orders.cjs
RUN node /app/patch-patient-orders.cjs

# Dispensing 1.11.1 lists prescriptions through a generic encounter query and gates the
# Dispense button on a task privilege outside the module access matrix. The patch reads
# MedicationRequest and shows Dispense for Manage Pharmacy.
COPY patch-dispensing-pharmacy.cjs /app/patch-dispensing-pharmacy.cjs
RUN node /app/patch-dispensing-pharmacy.cjs

# Service queues app 11.1.0: the QueueFields component sets `queueLocation` default as
# `sessionLocation?.uuid ?? ''` in react-hook-form's `defaultValues`, but because
# `useSession()` resolves asynchronously the value is always undefined at first render
# and the field starts blank. This patch adds the missing `useEffect` that selects the
# session location once both the location UUID and the queue-location list are loaded.
COPY patch-service-queues-location.cjs /app/patch-service-queues-location.cjs
RUN node /app/patch-service-queues-location.cjs

# Patient search app 11.1.0 has no ExtensionSlot where a custom app can add Remote Search
# (patients on the central server). This patch adds three slots - results (header dropdown,
# /search page, workspaces), toggle (Refine Search sidebar) and summary (/search heading) -
# and relabels the local heading to "LOCAL SEARCH - N MATCHES", in chunks 8383, 4959 and
# 5882. It asserts every anchor and fails the build if the pinned bundle changed.
# The app that fills those slots, esm-liberia-remote-search-app, is assembled with the other
# apps from the spa.frontendModules pin in distro.properties; it is not copied in here.
COPY patch-patient-search-remote.cjs /app/patch-patient-search-remote.cjs
RUN node /app/patch-patient-search-remote.cjs

# ---------------------------------------------------------------------------
# Stage 2 — runtime configuration + branding
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Frontend" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

# Served UNDER /openmrs/spa/, matching --spa-path above and the location blocks in
# nginx.conf. At the document root instead, every one of those blocks misses: nginx falls
# back to its own welcome page and the config directory 404s.
COPY --from=assemble /app/spa/ /usr/share/nginx/html/openmrs/spa/

# Frontend runtime configuration collected from every content package's
# configuration/frontend_configuration/ by scripts/build/collect-frontend-config.sh.
#
# Copying these files is NOT enough: each one must also be listed in SPA_CONFIG_URLS
# (spa.configUrls) or O3 will silently ignore it. See IMPLEMENTATION.md §7 and the
# SPA_CONFIG_URLS value in distribution/compose/facility/docker-compose.yml.
COPY config/ /usr/share/nginx/html/openmrs/spa/config/

# Liberia MOH branding assets referenced from the site package frontend config.
COPY branding/ /usr/share/nginx/html/openmrs/spa/branding/

COPY nginx.conf /etc/nginx/conf.d/default.conf
