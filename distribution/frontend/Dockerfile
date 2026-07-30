# LiberiaEMR frontend image
#
# = O3 app shell + exact frontend-module versions + runtime configuration + branding +
# translations. Immutable and versioned (liberia-emr-frontend:x.y.z).
# See IMPLEMENTATION.md §8.

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
