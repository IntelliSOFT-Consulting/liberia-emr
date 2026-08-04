#!/usr/bin/env bash
# Clean-install test: empty database -> Initializer loads all metadata -> O3 launches.
#
#   qa/upgrade/run-clean-install.sh [--version 1.0.0] [--no-frontend]
#
# This is the cheaper half of the release gate. It catches broken CSVs, unresolved
# ${var.*} references and forward references between layers. It does NOT catch upgrade
# failures — see run-upgrade.sh and README.md for why that distinction matters.
#
# The images it starts must already exist locally or be pullable: this script tests a built
# distribution, it does not build one. See scripts/build/build-distribution.sh.
# --no-frontend pairs with that script's flag of the same name — every assertion below is
# about the backend, so a caller that skipped the frontend image skips starting it too.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/distribution/compose/facility/docker-compose.yml"
ENV_FILE="$ROOT/qa/upgrade/clean-install.env"
VERSION="${LIBERIAEMR_VERSION:-1.0.0-SNAPSHOT}"
FRONTEND="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     VERSION="$2"; shift 2 ;;
    --no-frontend) FRONTEND="false"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cleanup() {
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" down -v >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

# Throwaway credentials for an ephemeral test database. Not secrets: this stack is
# destroyed at the end of the run and never holds real data.
cat > "$ENV_FILE" <<ENV
REGISTRY=${REGISTRY:-ghcr.io/intellisoft-consulting}
LIBERIAEMR_VERSION=${VERSION}
FACILITY_CODE=careysburg
MYSQL_DATABASE=openmrs
MYSQL_USER=openmrs
MYSQL_PASSWORD=ci-ephemeral
MYSQL_ROOT_PASSWORD=ci-ephemeral-root
OMRS_CREATE_TABLES=true
BACKEND_HEAP=2g
TLS_CERT_DIR=/tmp/liberiaemr-ci-certs
CENTRAL_URL=http://localhost
ENV
mkdir -p /tmp/liberiaemr-ci-certs

echo "== starting a clean stack at ${VERSION} =="
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d db backend

echo "== waiting for the backend to report started =="
# The backend runs with continue_on_error=false, so a boot that completes is itself part of
# the assertion: any metadata error stops the startup rather than half-applying.
deadline=$(( SECONDS + 900 ))
until docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T backend \
        curl -fs http://localhost:8080/openmrs/health/started >/dev/null 2>&1; do
  if (( SECONDS > deadline )); then
    echo "FAIL: backend did not start within 15 minutes" >&2
    docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail 200 backend >&2
    exit 1
  fi
  sleep 10
done

echo "== asserting Initializer completed without error =="
logs="$(docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs backend)"
if grep -qiE 'initializer.*(error|failed|exception)' <<<"$logs"; then
  echo "FAIL: Initializer reported errors" >&2
  grep -iE 'initializer.*(error|failed|exception)' <<<"$logs" >&2
  exit 1
fi

echo "== asserting no unresolved \${var.*} placeholders reached the database =="
if grep -q '\${var\.' <<<"$logs"; then
  echo "FAIL: unresolved variable placeholder in loaded metadata" >&2
  exit 1
fi

if [[ "$FRONTEND" == "true" ]]; then
  echo "== starting the frontend =="
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d frontend
else
  echo "== frontend == SKIPPED (--no-frontend)"
fi

echo
echo "clean install passed at ${VERSION}"
