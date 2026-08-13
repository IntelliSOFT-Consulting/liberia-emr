#!/usr/bin/env bash
# Builds the immutable, versioned LiberiaEMR images.
#
#   scripts/build/build-distribution.sh --version 1.0.0 [--site careysburg] [--demo]
#                                       [--no-frontend]
#
# Images: liberia-emr-backend|-frontend|-gateway :<version>
# A mutable git checkout is never mounted into a production container.
#
# --no-frontend skips ONLY the frontend image, whose assemble stage npm-installs the O3 app
# shell and downloads every pinned ESM — minutes, and the largest single cost here. It is for
# callers that exercise the backend alone, i.e. the clean-install gate in CI; a release must
# never use it, because the three images are versioned as one distribution. Everything the
# frontend image depends on still runs, so the SPA_CONFIG_URLS drift check below keeps its
# value on every build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=""
SITE="careysburg"
DEMO="false"
FRONTEND=true
REGISTRY="${REGISTRY:-intellisoftdev}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     VERSION="$2"; shift 2 ;;
    --site)        SITE="$2";    shift 2 ;;
    --demo)        DEMO="true";  shift ;;
    --no-frontend) FRONTEND="false"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$VERSION" ]] || { echo "--version is required" >&2; exit 2; }

case "$VERSION" in
  *SNAPSHOT*|latest)
    echo "refusing to build a release image at version '$VERSION'" >&2
    echo "distro.properties forbids latest/dynamic/-SNAPSHOT outside development." >&2
    exit 2 ;;
esac

"$ROOT/scripts/validate/validate-content.sh"
"$ROOT/scripts/validate/no-secrets.sh"

if [[ "$DEMO" == "false" ]]; then
  "$ROOT/scripts/validate/no-demo-in-release.sh"
  suffix=""
  demo_package=""
  ocl_dir="$ROOT/content-packages/content-common/configuration/backend_configuration/ocl"

  # Two different dictionaries land here and they are NOT interchangeable, so each is guarded
  # by its own file name. A single "any *.zip present" guard made them mutually exclusive:
  # whichever ran first satisfied it and the other never ran at all.
  #
  # 1. The upstream reference-application exports (*-common.zip) — no credentials needed.
  if ! compgen -G "$ocl_dir/*-common.zip" >/dev/null; then
    echo "== fetching the common OCL exports =="
    "$ROOT/scripts/build/lift-common-content.sh"
  fi

  # 2. The MOH's own curated CIEL collections (lib-<collection>-ciel-*.zip). This is the
  # subset the ocl/ README means by "Do not load all of CIEL": a build that skips it still
  # produces images, but every concept mapping to a CIEL source fails to load, so say so
  # rather than let it pass silently.
  ocl_org="$(sed -n 's/^ocl\.org=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"
  ocl_collections="$(sed -n 's/^ocl\.collections=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"
  ocl_version="$(sed -n 's/^ocl\.collection\.version=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"

  if [[ -z "${OCL_API_TOKEN:-}" ]]; then
    echo "WARNING: OCL_API_TOKEN is not set — skipping the MOH CIEL collections." >&2
    echo "         Concepts that map to a CIEL source will not load in these images." >&2
    echo "         See content-packages/content-common/configuration/backend_configuration/ocl/README.md" >&2
  else
    if [[ -z "$ocl_version" ]]; then
      echo "WARNING: ocl.collection.version is empty in distro.properties — exporting HEAD." >&2
      echo "         A release must pin a published collection version; HEAD is not reproducible." >&2
    fi
    for collection in ${ocl_collections//,/ }; do
      if compgen -G "$ocl_dir/lib-${collection}-ciel-*.zip" >/dev/null; then
        echo "== OCL collection ${collection} already present =="
        continue
      fi
      echo "== fetching the OCL collection ${ocl_org}/${collection} =="
      # Only MCH has smoke-test expectations in fetch-ciel.sh.
      smoke=()
      [[ "$collection" == "mch" ]] || smoke=(--no-smoke-test)
      OCL_ORG="$ocl_org" OCL_COLLECTION="$collection" \
        "$ROOT/scripts/build/fetch-ciel.sh" \
          ${ocl_version:+--version "$ocl_version"} "${smoke[@]}"
    done
  fi

  "$ROOT/scripts/build/sanitize-ocl-export.sh" \
    "$ROOT"/content-packages/content-common/configuration/backend_configuration/ocl/*.zip
else
  echo "WARNING: building DEMO images — training and test use only."
  suffix="-demo"
  demo_package="liberiaemr-demo"
  # content-demo is lifted from upstream; its OCL exports are gitignored, so a fresh
  # checkout has the CSVs and forms but none of the concepts they reference.
  if ! compgen -G "$ROOT/content-packages/content-demo/configuration/backend_configuration/ocl/*.zip" >/dev/null; then
    echo "== fetching the demo OCL exports =="
    "$ROOT/scripts/build/lift-demo-content.sh" --ocl-only
  fi
  "$ROOT/scripts/build/sanitize-ocl-export.sh" \
    "$ROOT"/content-packages/content-demo/configuration/backend_configuration/ocl/*.zip
fi


# Builds the content ZIPs and, with them, target/configuration — the tree with ${var.*}
# resolved. The backend image builds these again inside its own content stage; the local
# build is what the frontend config collection below reads.
echo "== building content packages =="
mvn -B -q -DskipTests -f "$ROOT/pom.xml" clean package

echo "== resolving OMODs from distro.properties =="
"$ROOT/scripts/build/resolve-modules.sh" --out "$ROOT/distribution/backend/modules"

echo "== generating the frontend import map =="
"$ROOT/scripts/build/generate-import-map.sh" --out "$ROOT/distribution/frontend/spa-assemble-config.json"

echo "== collecting frontend runtime configuration =="
"$ROOT/scripts/build/collect-frontend-config.sh" --site "$SITE" --demo "$DEMO" \
  --out "$ROOT/distribution/frontend/config"

# A config file is only loaded if it is BOTH in the image and named in SPA_CONFIG_URLS, and
# the order there is the override order. Nothing fails at runtime when the two disagree —
# O3 just quietly runs on the wrong configuration — so the drift is caught here instead.
echo "== checking SPA_CONFIG_URLS against what was collected =="
compose="$ROOT/distribution/compose/facility/docker-compose.yml"
[[ "$DEMO" == "true" ]] && compose="$ROOT/distribution/compose/facility/docker-compose.demo.yml"
declared="$(sed -n '/SPA_CONFIG_URLS/,/^ *[A-Za-z_]*:/p' "$compose" \
  | grep -oE '/openmrs/spa/config/[A-Za-z0-9._-]+\.json')"
if ! diff -u <(echo "$declared") "$ROOT/distribution/frontend/config/.config-urls" \
     --label "SPA_CONFIG_URLS in ${compose#$ROOT/}" --label "collected in layer order"; then
  echo "FAIL: SPA_CONFIG_URLS does not match the collected configuration" >&2
  exit 1
fi
echo "  ok: $(echo "$declared" | wc -l | tr -d ' ') config files, in order"

echo "== backend =="
docker build \
  -f "$ROOT/distribution/backend/Dockerfile" \
  --build-arg "SITE_PACKAGE=liberiaemr-site-${SITE}" \
  --build-arg "DEMO_PACKAGE=${demo_package}" \
  --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
  -t "${REGISTRY}/liberia-emr-backend${suffix}:${VERSION}" \
  "$ROOT"

if [[ "$FRONTEND" == "true" ]]; then
  echo "== frontend =="
  spa_core="$(grep -E '^spa\.core=' "$ROOT/distribution/distro.properties" | cut -d= -f2)"
  [[ -n "$spa_core" ]] || { echo "spa.core is not pinned in distro.properties" >&2; exit 1; }
  # The app shell resolves its configuration from the list it was BUILT with; the compose
  # environment cannot add to it. Same order the files were collected in, which the check
  # above has already reconciled with SPA_CONFIG_URLS in the compose file.
  spa_config_urls="$(paste -sd, "$ROOT/distribution/frontend/config/.config-urls")"
  docker build \
    -f "$ROOT/distribution/frontend/Dockerfile" \
    --build-arg "SPA_CORE=${spa_core}" \
    --build-arg "SPA_CONFIG_URLS=${spa_config_urls}" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-frontend${suffix}:${VERSION}" \
    "$ROOT/distribution/frontend"
else
  echo "== frontend == SKIPPED (--no-frontend)"
fi

echo "== gateway =="
docker build \
  -f "$ROOT/distribution/gateway/Dockerfile" \
  --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
  -t "${REGISTRY}/liberia-emr-gateway:${VERSION}" \
  "$ROOT/distribution/gateway"

echo
echo "built ${VERSION} (site: ${SITE}, demo: ${DEMO}, frontend: ${FRONTEND})"
