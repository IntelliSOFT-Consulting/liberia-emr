#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="1.0.0"
SITE="careysburg"
DEMO="false"
REGISTRY="${REGISTRY:-intellisoftdev}"

echo "== generating the frontend import map =="
"$ROOT/scripts/build/generate-import-map.sh" --out "$ROOT/distribution/frontend/spa-assemble-config.json"

echo "== collecting frontend runtime configuration =="
"$ROOT/scripts/build/collect-frontend-config.sh" --site "$SITE" --demo "$DEMO" \
  --out "$ROOT/distribution/frontend/config"

echo "== building frontend =="
spa_core="$(grep -E '^spa\.core=' "$ROOT/distribution/distro.properties" | cut -d= -f2)"
spa_config_urls="$(paste -sd, "$ROOT/distribution/frontend/config/.config-urls")"

site_frontend="$("$ROOT/scripts/build/image-refs.sh" --site "$SITE" --role site | grep '^liberia-emr-frontend-')"

docker build \
  -f "$ROOT/distribution/frontend/Dockerfile" \
  --build-arg "SPA_CORE=${spa_core}" \
  --build-arg "SPA_CONFIG_URLS=${spa_config_urls}" \
  --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
  -t "${REGISTRY}/liberia-emr-frontend:${VERSION}" \
  ${site_frontend:+-t "${REGISTRY}/${site_frontend}:${VERSION}"} \
  "$ROOT/distribution/frontend"

echo "Frontend built successfully!"
