#!/usr/bin/env bash
# Checks that a facility database's first boot writes no account password to the binlog
# (LE-361). The facility runs with a ROW binlog kept for up to 99 days for the sync sender's
# Debezium reader, so a CREATE USER ... IDENTIFIED BY '<pw>' logged there is a clear-text
# credential on disk, and in every binlog backup, for that long.
#
#   qa/sync/verify-binlog-secrets.sh [--keep]
#
# Boots only the facility `db` service, from the real compose file and initdb/ scripts, on a
# throwaway project and volume, with test passwords for every account initdb creates. Then it
# decodes every binlog with `mariadb-binlog -vv` and fails if the output contains
# `IDENTIFIED BY` or any of the passwords. It also fails if the binlog does not show the
# image's own CREATE DATABASE, so a binlog that is off or unreadable cannot pass. Needs docker.
set -euo pipefail

KEEP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$ROOT/distribution/compose/facility/docker-compose.yml"
PROJECT="lemr-binlog-secrets-$$"
WORK="$(mktemp -d)"

# Test values only. Distinct, so a hit names the account that leaked.
ROOT_PW='binlogTestRoot-7f3a'
PASSWORDS=(
  "MYSQL_ROOT_PASSWORD=$ROOT_PW"
  "MYSQL_PASSWORD=binlogTestApp-2c91"
  "DEBEZIUM_DB_PASSWORD=binlogTestDbz-5e04"
  "SYNC_MGMT_DB_PASSWORD=binlogTestMgmt-8b62"
  "ETL_DB_PASSWORD=binlogTestEtl-1d7c"
)
printf '%s\n' MYSQL_DATABASE=openmrs MYSQL_USER=openmrs "${PASSWORDS[@]}" > "$WORK/test.env"

# The env example supplies every other variable the file names; the test values override it.
dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE" \
    --env-file "$ROOT/distribution/env/facility.env.example" --env-file "$WORK/test.env" "$@"
}

cleanup() {
  if [[ "$KEEP" == "true" ]]; then
    echo "kept project $PROJECT and $WORK"
  else
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

echo "== booting the facility db on a fresh volume =="
dc up -d db >/dev/null 2>"$WORK/up.err" || { cat "$WORK/up.err" >&2; exit 1; }
cid="$(dc ps -q db)"
for _ in $(seq 1 90); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo gone)"
  [[ "$status" == healthy || "$status" == gone ]] && break
  sleep 2
done
logs="$(docker logs "$cid" 2>&1 || true)"
if [[ "${status:-}" != healthy ]] || ! grep -q 'MariaDB init process done' <<<"$logs"; then
  echo "FAIL: the db did not finish first-boot init (status: ${status:-unknown})" >&2
  tail -n 40 <<<"$logs" >&2
  exit 1
fi
# Every initdb script must have run, or a skipped account could pass by omission.
for want in "created Debezium replication user" "created sync management schema" \
            "created the reporting ETL user" "created the OpenMRS application user"; do
  grep -q "$want" <<<"$logs" || { echo "FAIL: initdb did not log '$want'" >&2; exit 1; }
done

echo "== decoding the binlog =="
docker exec "$cid" sh -c 'cd /var/lib/mysql && mariadb-binlog -vv $(ls binlog.[0-9]* | sort)' > "$WORK/binlog.txt"
echo "decoded $(wc -l < "$WORK/binlog.txt") lines from $(docker exec "$cid" sh -c 'ls /var/lib/mysql/binlog.[0-9]* | wc -l') binlog file(s)"

# shellcheck disable=SC2016 # literal backticks, as mariadb-binlog prints them
grep -q 'CREATE DATABASE IF NOT EXISTS `openmrs`' "$WORK/binlog.txt" \
  || { echo "FAIL: the binlog does not show CREATE DATABASE openmrs; is it on and decoded?" >&2; exit 1; }

fail=0
if grep -n -i 'IDENTIFIED BY' "$WORK/binlog.txt" | sed 's/^/  /' >&2; then
  echo "FAIL: the binlog contains IDENTIFIED BY (lines above)" >&2
  fail=1
fi
for kv in "${PASSWORDS[@]}"; do
  if grep -q -F "${kv#*=}" "$WORK/binlog.txt"; then
    echo "FAIL: the binlog contains the value of ${kv%%=*}" >&2
    fail=1
  fi
done
[[ "$fail" == 0 ]] || exit 1
echo "PASS: no IDENTIFIED BY and no initdb password in the facility binlog"
