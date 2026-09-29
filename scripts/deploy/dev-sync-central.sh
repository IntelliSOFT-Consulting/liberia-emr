#!/usr/bin/env bash
# Turns sync on at the central dev server. Run there over SSH by
# .github/workflows/enable-dev-sync.yml, one step at a time; every step can be run again.
#
#   COMPOSE_DIR=... [ENV_FILE=../../env/central.env] [REGISTRY=intellisoftdev] \
#     dev-sync-central.sh preflight|base|credentials|receiver|status
#
#   preflight  refuses a checkout with local changes; backs up the env file and the database
#   base       fast-forwards the checkout, points the env file at the sync certificates, creates
#              the sync management and identity schemas, starts everything but the receiver,
#              and restarts the backend so the module creates its identity tables
#   receiver   starts the receiver, once its OpenMRS user exists
#   status     what runs
set -euo pipefail

STEP="${1:-}"
cd "${COMPOSE_DIR:?COMPOSE_DIR is required}"
ENV_FILE="${ENV_FILE:-../../env/central.env}"
REGISTRY="${REGISTRY:-intellisoftdev}"
DB=liberiaemr-central-db-1
BACKUPS="$HOME/liberiaemr-backups"

compose() { REGISTRY="$REGISTRY" LIBERIAEMR_VERSION=latest docker compose -f docker-compose.yml --env-file "$ENV_FILE" "$@"; }
log() { echo "[central] $*"; }
# Adds a setting only when the env file lacks it; an existing value is never changed.
setting() {
  if grep -q "^$1=" "$ENV_FILE"; then log "kept $1"; return; fi
  [ -z "$(tail -c1 "$ENV_FILE")" ] || echo >> "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; log "added $1"
}
value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
# Replaces a setting's value; only ever used on the receiver's account, below.
replace() { sed -i "/^$1=/d" "$ENV_FILE"; setting "$1" "$2"; }
healthy() { # container seconds
  local deadline=$((SECONDS + $2))
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; do
    (( SECONDS < deadline )) || { log "$1 not healthy after $2 s"; docker logs --tail 30 "$1" >&2 || true; exit 1; }
    sleep 5
  done
}

case "$STEP" in
  preflight)
    top="$(git rev-parse --show-toplevel)"
    if [ -n "$(git -C "$top" status --porcelain --untracked-files=no)" ]; then
      log "the checkout has local changes; commit or discard them first:"; git -C "$top" status --short >&2; exit 1
    fi
    [ -f "$ENV_FILE" ] || { log "no env file at $ENV_FILE"; exit 1; }
    mkdir -p "$BACKUPS"; ts="$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "$ENV_FILE" "$BACKUPS/central.env.$ts"
    docker exec "$DB" sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --all-databases' \
      | gzip > "$BACKUPS/central-db.$ts.sql.gz"
    log "backed up the env file and the database to $BACKUPS (*.$ts)"
    ;;
  base)
    top="$(git rev-parse --show-toplevel)"
    git -C "$top" fetch -q origin main
    git -C "$top" merge -q --ff-only origin/main
    log "checkout at $(git -C "$top" rev-parse --short HEAD)"
    setting BROKER_CERTS_DIR /etc/liberiaemr/broker-certs
    setting RECEIVER_CERTS_DIR /etc/liberiaemr/receiver-certs
    # The receiver signs in with an account of its own, never an operator's.
    case "$(value SYNC_REST_USER)" in
      ""|admin|daemon)
        replace SYNC_REST_USER sync-receiver
        replace SYNC_REST_PASSWORD "Dv$(openssl rand -hex 18)7q"
        log "the receiver now signs in as sync-receiver, not an operator account" ;;
    esac
    compose config -q
    compose pull -q
    compose up -d db
    healthy "$DB" 300
    docker exec "$DB" bash /docker-entrypoint-initdb.d/10-sync-mgmt-db.sh
    docker exec "$DB" bash /docker-entrypoint-initdb.d/20-identity-db.sh
    services="$(compose config --services | grep -vx sync-receiver | tr '\n' ' ')"
    before="$(docker inspect -f '{{.Id}}' liberiaemr-central-backend-1 2>/dev/null || true)"
    # shellcheck disable=SC2086 # one word per service
    compose up -d $services
    # The broker reads its certificates at start; a run that issued new ones needs a fresh one.
    compose up -d --force-recreate artemis cert-expiry
    # The module creates the identity tables at start, and the schema is new: a backend that
    # up -d left running has to start again.
    if [ "$(docker inspect -f '{{.Id}}' liberiaemr-central-backend-1)" = "$before" ]; then
      compose restart backend
    fi
    healthy liberiaemr-central-backend-1 900
    healthy liberiaemr-central-artemis-1 300
    # nginx keeps the address a recreated backend had; a restart looks it up again.
    compose restart gateway
    log "broker, monitoring and the EMR are up"
    ;;
  receiver)
    compose up -d --force-recreate sync-receiver
    deadline=$((SECONDS + 300))
    until docker logs liberiaemr-central-sync-receiver-1 2>&1 | grep -a "Started Application" >/dev/null; do
      if docker logs liberiaemr-central-sync-receiver-1 2>&1 | grep -a "refusing to start" >/dev/null; then
        docker logs --tail 20 liberiaemr-central-sync-receiver-1 >&2; exit 1
      fi
      (( SECONDS < deadline )) || { docker logs --tail 30 liberiaemr-central-sync-receiver-1 >&2; exit 1; }
      sleep 5
    done
    log "receiver started"
    ;;
  credentials)
    # The receiver's OpenMRS account, for the workflow to create; it masks the password.
    printf '%s\t%s\n' "$(sed -n 's/^SYNC_REST_USER=//p' "$ENV_FILE" | tail -1)" "$(sed -n 's/^SYNC_REST_PASSWORD=//p' "$ENV_FILE" | tail -1)"
    ;;
  status)
    docker ps --format '{{.Names}}\t{{.Status}}' | grep liberiaemr-central | sort
    ;;
  *) echo "usage: dev-sync-central.sh preflight|base|credentials|receiver|status" >&2; exit 2 ;;
esac
