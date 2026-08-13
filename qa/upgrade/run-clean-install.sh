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
  rm -rf "$ROOT/qa/upgrade/.ci-certs"
}
trap cleanup EXIT

# Throwaway credentials for an ephemeral test database. Not secrets: this stack is
# destroyed at the end of the run and never holds real data. Declared here rather than
# written straight into the env file because the progress query below needs the same value.
DB_ROOT_PASSWORD=ci-ephemeral-root

# The gateway mounts this directory and nginx will not start without fullchain.pem and
# privkey.pem in it — an empty directory crashloops it on 'cannot load certificate', and
# restart: unless-stopped makes that loop unbreakable. Creating the directory and no
# certificates is what this used to do, which stayed invisible only because the gateway was
# never started here. Self-signed and thrown away with the stack; a real deployment mounts
# MOH-issued material (distribution/env/facility.env.example).
#
# Kept inside the repository rather than under /tmp because Docker Desktop on macOS shares
# neither /tmp nor /private/tmp by default: a bind mount of either silently resolves to an
# empty directory inside the VM, so the certificates written here would be invisible to the
# container and nginx would fail exactly as if they had never been generated.
CERT_DIR="$ROOT/qa/upgrade/.ci-certs"
mkdir -p "$CERT_DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=liberiaemr-ci" \
  -keyout "$CERT_DIR/privkey.pem" \
  -out    "$CERT_DIR/fullchain.pem" >/dev/null 2>&1 \
  || { echo "FAIL: could not generate the CI certificate (is openssl installed?)" >&2; exit 1; }

cat > "$ENV_FILE" <<ENV
REGISTRY=${REGISTRY:-ghcr.io/intellisoft-consulting}
LIBERIAEMR_VERSION=${VERSION}
FACILITY_CODE=careysburg
MYSQL_DATABASE=openmrs
MYSQL_USER=openmrs
MYSQL_PASSWORD=ci-ephemeral
MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
OMRS_CREATE_TABLES=true
BACKEND_HEAP=2g
TLS_CERT_DIR=${CERT_DIR}
CENTRAL_URL=http://localhost
ENV
echo "== starting a clean stack at ${VERSION} =="
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d db backend

echo "== waiting for the backend to report started =="
# Initializer logs a rejected row and carries on, so a boot that completes is NOT by itself
# evidence that the metadata applied — the log assertion further down is what decides that.
#
# A CLEAN install pays for the whole OCL import in one boot — every concept and every
# mapping in the dictionary, against an empty database. That is minutes for the curated
# subset this distribution is supposed to ship (see the ocl/ README: "Do not load all of
# CIEL"), but well over an hour if the full CIEL export is in the tree instead. The old
# 15-minute deadline could not cover either case with any margin, and it failed in the way
# that reads as a broken build rather than a slow one: the trap tore the stack down, so the
# logs that would have shown a healthy import in progress were gone before anyone saw them.
# Override for a machine or a dictionary that needs longer still.
TIMEOUT="${CLEAN_INSTALL_TIMEOUT:-5400}"
deadline=$(( SECONDS + TIMEOUT ))
until docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T backend \
        curl -fs http://localhost:8080/openmrs/health/started >/dev/null 2>&1; do
  if (( SECONDS > deadline )); then
    echo "FAIL: backend did not start within $(( TIMEOUT / 60 )) minutes" >&2
    echo "  A large OCL export can legitimately exceed this — check whether the concept" >&2
    echo "  count below was still climbing before treating it as a hang." >&2
    docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T db \
      mariadb -uroot -p"$DB_ROOT_PASSWORD" -N -e \
      'select concat("concepts loaded: ", count(*)) from openmrs.concept;' >&2 2>/dev/null || true
    docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail 200 backend >&2
    exit 1
  fi
  # A metadata failure does not stop the backend, so this would otherwise wait out the whole
  # deadline before reporting something already decided in the first minutes. Bail as soon as
  # the failure is in the log. Matched on Initializer's own loader rather than 'error'
  # anywhere, because the boot legitimately logs unrelated errors (a Tomcat filter warning,
  # a Liquibase notice) that say nothing about whether the configuration applied.
  if docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs backend 2>/dev/null \
       | grep -qE 'could not be constructed or saved|Unable to start OpenMRS'; then
    echo "FAIL: Initializer could not apply the configuration" >&2
    docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs backend 2>/dev/null \
      | grep -A6 'could not be constructed or saved' | head -60 >&2
    exit 1
  fi

  # Silence for an hour is indistinguishable from a hang, and the import itself logs
  # nothing per concept — so report the row count that is actually moving.
  loaded="$(docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T db \
    mariadb -uroot -p"$DB_ROOT_PASSWORD" -N -e \
    'select count(*) from openmrs.concept;' 2>/dev/null | tr -d '[:space:]')"
  echo "   ${SECONDS}s elapsed — concepts loaded: ${loaded:-0}"
  sleep 30
done

echo "== asserting Initializer completed without error =="
logs="$(docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs backend)"

# A reachable backend does NOT mean the metadata applied. Initializer logs a rejected row
# and moves on, and its module failing to start does not stop the web application, so
# OpenMRS answers /health/started with 200 while whole CSVs sit rejected — measured at 410
# failed rows on a healthy instance. Assert on Initializer's dedicated log instead, which it
# writes to the app data directory and which is complete by the time the backend is up.
#
# The pattern this replaces, 'initializer.*(error|failed|exception)', matched NONE of those
# 410: the failures read 'ERROR - BaseCsvLoader ... could not be constructed or saved',
# where the word Initializer never precedes the word error on the line.
#
# Sound HERE because the stack is always created fresh: the log lives on the openmrs-data
# volume, which cleanup() destroys with `down -v`, so it can only describe this run. Do NOT
# lift this assertion into a test that RESTARTS a backend — Initializer was observed leaving
# the file untouched on a restart (mtime and line count unchanged) while still applying
# changed files, so there the log describes the first boot and a stale pass looks green.
iniz_log="$(docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T backend \
  cat /openmrs/data/initializer.log 2>/dev/null || true)"
if [[ -z "$iniz_log" ]]; then
  echo "FAIL: Initializer wrote no log — it did not run" >&2
  exit 1
fi
if grep -q 'ERROR' <<<"$iniz_log"; then
  echo "FAIL: Initializer rejected metadata" >&2
  echo "  $(grep -c 'ERROR' <<<"$iniz_log") error lines; first failures:" >&2
  grep -A6 'ERROR' <<<"$iniz_log" | head -40 >&2
  exit 1
fi

echo "== asserting no unresolved \${var.*} placeholders reached the database =="
# Both streams: an unsubstituted token can surface in a rejected row (Initializer's log) or
# in a value that loaded verbatim (the console log).
if grep -q '\${var\.' <<<"$logs" || grep -q '\${var\.' <<<"$iniz_log"; then
  echo "FAIL: unresolved variable placeholder in loaded metadata" >&2
  printf '%s\n%s\n' "$logs" "$iniz_log" | grep '\${var\.' | head -10 >&2
  exit 1
fi

if [[ "$FRONTEND" == "true" ]]; then
  echo "== starting the frontend and the gateway =="
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d frontend gateway

  # The gateway is the only way anyone actually reaches this stack, and it fails CLOSED on a
  # bad certificate mount or a proxy_pass naming a service that is not there. Leaving it out
  # of the gate meant a release could ship an edge that crashlooped on first boot.
  # Probed from inside the network, over the compose service name, so the assertion does not
  # depend on host ports 80/443 being free. -k because the CI certificate is self-signed.
  echo "== asserting the gateway serves the SPA and the API =="
  gw_deadline=$(( SECONDS + 120 ))
  until docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T backend \
          curl -fsk -o /dev/null https://gateway/openmrs/spa/ 2>/dev/null; do
    if (( SECONDS > gw_deadline )); then
      echo "FAIL: gateway did not serve /openmrs/spa/ within 2 minutes" >&2
      docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail 40 gateway >&2
      exit 1
    fi
    sleep 5
  done

  # Plain HTTP must redirect rather than serve: TLS is contractual for this deployment.
  code="$(docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T backend \
    curl -s -o /dev/null -w '%{http_code}' http://gateway/ 2>/dev/null | tr -d '[:space:]')"
  if [[ "$code" != "301" ]]; then
    echo "FAIL: gateway answered plain HTTP with ${code}, expected a 301 redirect to TLS" >&2
    exit 1
  fi
else
  echo "== frontend and gateway == SKIPPED (--no-frontend)"
fi

echo
echo "clean install passed at ${VERSION}"
