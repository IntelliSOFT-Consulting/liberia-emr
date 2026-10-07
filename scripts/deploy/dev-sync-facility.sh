#!/usr/bin/env bash
# Turns sync on at the facility dev server. Run there over SSH by
# .github/workflows/enable-dev-sync.yml, one step at a time; every step can be run again.
#
#   COMPOSE_DIR=... FACILITY=careysburg CENTRAL_HOST=... [SYNC_REST_USER=... SYNC_REST_PASSWORD=...] \
#     dev-sync-facility.sh preflight|base|credentials|sender|status
#
#   preflight  shows any local change in the checkout, checks the env file has the database
#              settings today's compose file needs, backs up the env file and the database
#   base       fast-forwards the checkout (a local change is kept in a named stash), adds the
#              sync settings the env file lacks, restarts the database with the binary log on
#              and creates the sync database users, and starts the EMR
#   sender     starts the sync sender and its monitoring, once its OpenMRS user exists
#   status     what runs, and whether the binary log is on
set -euo pipefail

STEP="${1:-}"
cd "${COMPOSE_DIR:?COMPOSE_DIR is required}"
ENV_FILE=facility.env
DB=liberiaemr-facility-db-1
BACKUPS="$HOME/liberiaemr-backups"

compose() { LIBERIAEMR_VERSION=latest LEGACY_ADMIN_UI=true docker compose --env-file "$ENV_FILE" --profile sync "$@"; }
log() { echo "[facility] $*"; }
value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
policy_ok() { [ ${#1} -ge 13 ] && [[ "$1" =~ [A-Z] ]] && [[ "$1" =~ [a-z] ]] && [[ "$1" =~ [0-9] ]]; }
# Adds a setting only when the env file lacks it or leaves it empty; a value is never changed.
setting() {
  if [ -n "$(value "$1")" ]; then log "kept $1"; return; fi
  sed -i "/^$1=/d" "$ENV_FILE"
  [ -z "$(tail -c1 "$ENV_FILE")" ] || echo >> "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  log "added $1"
}
secret() { printf 'Dv%s7q' "$(openssl rand -hex 18)"; }
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
    changes="$(git -C "$top" status --porcelain --untracked-files=no)"
    if [ -n "$changes" ]; then
      log "local change in the checkout:"; echo "$changes"
      git -C "$top" diff HEAD --stat
      if git -C "$top" diff HEAD --name-only | grep -E '(^|/)(docker-compose[^/]*\.ya?ml|initdb/)' >/dev/null; then
        log "it changes the compose setup itself; decide what to keep before running this"; exit 1
      fi
      log "the next step keeps it in a named stash"
    fi
    [ -f "$ENV_FILE" ] || { log "no $ENV_FILE in $PWD"; exit 1; }
    for k in MYSQL_USER MYSQL_PASSWORD MYSQL_ROOT_PASSWORD; do
      [ -n "$(value "$k")" ] || { log "$ENV_FILE has no $k, which today's compose file needs"; exit 1; }
    done
    code="$(value FACILITY_CODE)"
    [ -z "$code" ] || [ "$code" = "${FACILITY:?}" ] \
      || { log "$ENV_FILE says FACILITY_CODE=$code, not $FACILITY"; exit 1; }
    mkdir -p "$BACKUPS"; ts="$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "$ENV_FILE" "$BACKUPS/facility.env.$ts"
    docker exec "$DB" sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --all-databases' \
      | gzip > "$BACKUPS/facility-db.$ts.sql.gz"
    log "backed up the env file and the database to $BACKUPS (*.$ts)"
    ;;
  base)
    top="$(git rev-parse --show-toplevel)"
    if [ -n "$(git -C "$top" status --porcelain --untracked-files=no)" ]; then
      git -C "$top" stash push -q -m "kept before enabling sync $(date -u +%FT%TZ)"
      log "local change kept in: $(git -C "$top" stash list | head -1)"
    fi
    git -C "$top" fetch -q origin main
    if git -C "$top" symbolic-ref -q HEAD >/dev/null; then
      git -C "$top" merge -q --ff-only origin/main
    else
      git -C "$top" checkout -q --detach origin/main
    fi
    log "checkout at $(git -C "$top" rev-parse --short HEAD)"
    setting FACILITY_CODE "${FACILITY:?}"
    # Over HTTPS on 443 (LE-372, ADR 0014): the facility's sync-tunnel answers as artemis and
    # carries the session inside https://<central>/sync/broker/, so 61617 need not be open.
    # setting keeps a value already there, so a facility set up before LE-372, still dialling
    # central's 61617 directly, is moved onto the tunnel here. Any other value is left alone.
    if [ "$(value ARTEMIS_URL)" = "ssl://${CENTRAL_HOST:?}:61617" ]; then
      sed -i '/^ARTEMIS_URL=/d' "$ENV_FILE"
      log "moving ARTEMIS_URL from central's 61617 onto the sync tunnel"
    fi
    setting ARTEMIS_URL "ssl://artemis:61617"
    setting SYNC_CENTRAL_URL "https://${CENTRAL_HOST:?}"
    setting SYNC_CERTS_DIR /etc/liberiaemr/sync-certs
    setting COMPOSE_PROFILES sync
    setting SYNC_SNAPSHOT_MODE initial
    setting DEBEZIUM_DB_PASSWORD "$(secret)"
    setting SYNC_MGMT_DB_PASSWORD "$(secret)"
    # The sender signs in with an account of its own, never an operator's.
    case "$(value SYNC_REST_USER)" in admin|daemon) sed -i -e '/^SYNC_REST_USER=/d' -e '/^SYNC_REST_PASSWORD=/d' "$ENV_FILE" ;; esac
    # The EMR refuses a password outside its policy; the generated one below meets it.
    policy_ok "$(value SYNC_REST_PASSWORD)" || sed -i '/^SYNC_REST_PASSWORD=/d' "$ENV_FILE"
    setting SYNC_REST_USER "${SYNC_REST_USER:?}"
    setting SYNC_REST_PASSWORD "${SYNC_REST_PASSWORD:?}"
    compose config -q
    compose pull -q
    # The binary log the sender reads comes from the database's command line; this applies it.
    compose up -d db
    healthy "$DB" 300
    docker exec "$DB" bash /docker-entrypoint-initdb.d/10-sync-db-users.sh
    [ "$(docker exec "$DB" sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "SELECT @@log_bin"')" = 1 ] \
      || { log "the binary log is still off"; exit 1; }
    services="$(compose config --services | grep -vx -e sync -e sync-capture -e prometheus -e alertmanager | tr '\n' ' ')"
    # shellcheck disable=SC2086 # one word per service
    compose up -d $services
    healthy liberiaemr-facility-backend-1 900
    # nginx keeps the address a recreated backend had; a restart looks it up again.
    compose restart gateway
    log "binary log on, sync database users in place, EMR up"
    ;;
  sender)
    compose up -d
    # The sender reads its certificates at start; a run that issued new ones needs a fresh one.
    compose up -d --force-recreate sync
    deadline=$((SECONDS + 600))
    # A first load reads every existing record before it streams, which can take a while; its
    # start is as good a sign as the stream itself that the sender is working.
    until docker logs liberiaemr-facility-sync-1 2>&1 | grep -a -E "Connected to MySQL binlog|Snapshot step 1" >/dev/null; do
      if docker logs liberiaemr-facility-sync-1 2>&1 | grep -a "refusing to start" >/dev/null; then
        docker logs --tail 20 liberiaemr-facility-sync-1 >&2; exit 1
      fi
      (( SECONDS < deadline )) || { docker logs --tail 40 liberiaemr-facility-sync-1 >&2; exit 1; }
      sleep 10
    done
    log "sender running: loading existing records, then streaming new ones"
    ;;
  credentials)
    # The sender's OpenMRS account, for the workflow to create; it masks the password.
    printf '%s\t%s\n' "$(value SYNC_REST_USER)" "$(value SYNC_REST_PASSWORD)"
    ;;
  status)
    docker ps --format '{{.Names}}\t{{.Status}}' | grep liberiaemr-facility | sort
    echo "log_bin: $(docker exec "$DB" sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "SELECT @@log_bin"')"
    ;;
  *) echo "usage: dev-sync-facility.sh preflight|base|credentials|sender|status" >&2; exit 2 ;;
esac
