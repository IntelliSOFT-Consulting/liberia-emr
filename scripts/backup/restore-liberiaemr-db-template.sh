#!/usr/bin/env bash
# Restores a LiberiaEMR MariaDB backup created by backup-liberiaemr-db.sh.
# Handles plain (.sql.gz) and GPG-encrypted (.sql.gz.gpg) backups.
#
# Usage:
#   ./restore-liberiaemr-db.sh --test <backup-file>   Restore drill: loads the backup into a
#                                                     scratch database, checks it, drops it.
#                                                     Does NOT touch the live database.
#   ./restore-liberiaemr-db.sh <backup-file>          Real restore: OVERWRITES the live database.
#
# Real restore flow: confirm -> safety backup of the current DB -> stop the backend
# -> restore -> verify -> start the backend.
# Run with sudo (needs docker and root's GPG keyring, same as the backup script).
#
# This is a TEMPLATE: double-brace placeholders are filled in by render.sh from an
# env file. Do not run the .tpl directly; run the rendered copy.

set -euo pipefail

CONTAINER_NAME="{{CONTAINER_NAME}}"
BACKEND_CONTAINER="{{BACKEND_CONTAINER}}"
# Comma-separated list of any other containers that write to the database and
# must also be stopped during a real restore (e.g. sync workers). Optional —
# leave it out of backup.env entirely if there are none.
EXTRA_STOP_CONTAINERS="{{EXTRA_STOP_CONTAINERS}}"
DB_NAME="{{DB_NAME}}"
DB_USER="{{DB_USER}}"
ENV_FILE="{{ENV_FILE}}"

# Set SKIP_SAFETY_BACKUP=true only if the live database is too broken to dump.
SKIP_SAFETY_BACKUP="${SKIP_SAFETY_BACKUP:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup-liberiaemr-db.sh"
SCRATCH_DB="${DB_NAME}_restore_test"

TEST_MODE=false
if [ "${1:-}" = "--test" ]; then
  TEST_MODE=true
  shift
fi
DUMP_FILE="${1:?Usage: $0 [--test] <path-to-backup.sql.gz[.gpg]>}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "ERROR: backup file not found: ${DUMP_FILE}"
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: env file not found at ${ENV_FILE}"
  exit 1
fi

# Reads the first variable name that has a value from the compose env file.
# (|| true: grep exits 1 on no match, which would silently abort under set -e.)
env_value() {
  local name val=""
  for name in "$@"; do
    val="$(grep -E "^${name}=" "${ENV_FILE}" | cut -d'=' -f2- || true)"
    if [ -n "${val}" ]; then break; fi
  done
  printf '%s' "${val}"
}

# True if the named container is running. Uses `docker inspect` rather than
# `docker ps | grep -q`: under pipefail, grep -q exiting early can SIGPIPE docker
# and make the check fail intermittently.
is_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]
}

# Passwords go to `docker exec` via --env-file, not -e, so they never appear
# in `ps aux`. Files are mode 600 and removed on exit, including on failure.
DB_CRED=""
ROOT_CRED=""
SCRATCH_CREATED=false
cleanup() {
  if [ "${SCRATCH_CREATED}" = "true" ] && [ -n "${ROOT_CRED}" ]; then
    docker exec --env-file "${ROOT_CRED}" "${CONTAINER_NAME}" mariadb -u root \
      -e "DROP DATABASE IF EXISTS \`${SCRATCH_DB}\`" >/dev/null 2>&1 || true
  fi
  rm -f "${DB_CRED}" "${ROOT_CRED}"
}
trap cleanup EXIT

DB_PASSWORD="$(env_value MYSQL_PASSWORD MARIADB_PASSWORD)"
if [ -z "${DB_PASSWORD}" ]; then
  echo "ERROR: could not read MYSQL_PASSWORD or MARIADB_PASSWORD from ${ENV_FILE}"
  exit 1
fi
DB_CRED="$(mktemp)"
chmod 600 "${DB_CRED}"
printf 'MYSQL_PWD=%s\n' "${DB_PASSWORD}" > "${DB_CRED}"
unset DB_PASSWORD

if ! is_running "${CONTAINER_NAME}"; then
  echo "ERROR: container ${CONTAINER_NAME} is not running"
  exit 1
fi

# For encrypted backups, fail fast if the private key isn't in this keyring.
if [[ "${DUMP_FILE}" == *.gpg ]]; then
  key_id="$(gpg --list-packets --batch "${DUMP_FILE}" 2>/dev/null \
            | grep -oE 'keyid [0-9A-Fa-f]+' | head -1 | cut -d' ' -f2 || true)"
  if [ -n "${key_id}" ] && ! gpg --list-secret-keys "${key_id}" >/dev/null 2>&1; then
    echo "ERROR: this backup is encrypted to key ${key_id}, but its private key is not"
    echo "       in this user's GPG keyring. Import your offline copy first:"
    echo "         sudo gpg --import /path/to/private-key.asc"
    exit 1
  fi
fi

# Streams the plain SQL to stdout. Loopback pinentry lets gpg prompt for the
# passphrase directly, which works under sudo and inside a pipeline.
stream_dump() {
  if [[ "${DUMP_FILE}" == *.gpg ]]; then
    gpg --pinentry-mode loopback --decrypt "${DUMP_FILE}" | gunzip -c
  else
    gunzip -c "${DUMP_FILE}"
  fi
}

count_tables() {   # $1 = cred file, $2 = user, $3 = database
  docker exec --env-file "$1" "${CONTAINER_NAME}" mariadb -N -B -u "$2" \
    -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$3'" \
    | tr -d '[:space:]'
}

count_patients() { # $1 = cred file, $2 = user, $3 = database
  docker exec --env-file "$1" "${CONTAINER_NAME}" mariadb -N -B -u "$2" \
    -e "SELECT COUNT(*) FROM \`$3\`.patient" 2>/dev/null | tr -d '[:space:]' || true
}

# ---------------------------------------------------------------------------
# TEST MODE: restore into a scratch database, verify, drop it.
# ---------------------------------------------------------------------------
if [ "${TEST_MODE}" = "true" ]; then
  ROOT_PASSWORD="$(env_value MYSQL_ROOT_PASSWORD MARIADB_ROOT_PASSWORD)"
  if [ -z "${ROOT_PASSWORD}" ]; then
    echo "ERROR: could not read MYSQL_ROOT_PASSWORD from ${ENV_FILE} (needed to create the scratch DB)"
    exit 1
  fi
  ROOT_CRED="$(mktemp)"
  chmod 600 "${ROOT_CRED}"
  printf 'MYSQL_PWD=%s\n' "${ROOT_PASSWORD}" > "${ROOT_CRED}"
  unset ROOT_PASSWORD

  echo "==> TEST MODE: restoring ${DUMP_FILE}"
  echo "    into scratch database '${SCRATCH_DB}' (live database '${DB_NAME}' is not touched)."
  echo "    Note: this uses extra disk and I/O on the live DB container, so avoid peak hours."

  docker exec --env-file "${ROOT_CRED}" "${CONTAINER_NAME}" mariadb -u root \
    -e "DROP DATABASE IF EXISTS \`${SCRATCH_DB}\`; CREATE DATABASE \`${SCRATCH_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  SCRATCH_CREATED=true

  if ! stream_dump | docker exec -i --env-file "${ROOT_CRED}" "${CONTAINER_NAME}" \
         mariadb -u root "${SCRATCH_DB}"; then
    echo "TEST FAILED: the backup could not be loaded (wrong passphrase, corrupt file, or SQL error)."
    exit 1
  fi

  scratch_tables="$(count_tables "${ROOT_CRED}" root "${SCRATCH_DB}")"
  live_tables="$(count_tables "${DB_CRED}" "${DB_USER}" "${DB_NAME}")"
  scratch_patients="$(count_patients "${ROOT_CRED}" root "${SCRATCH_DB}")"
  live_patients="$(count_patients "${DB_CRED}" "${DB_USER}" "${DB_NAME}")"

  echo ""
  echo "    tables:        backup=${scratch_tables}   live=${live_tables}"
  echo "    patient rows:  backup=${scratch_patients:-n/a}   live=${live_patients:-n/a}"
  echo ""

  if [ "${scratch_tables:-0}" -lt 1 ]; then
    echo "TEST FAILED: the restored scratch database is empty."
    exit 1
  fi
  echo "TEST PASSED: backup decrypted and loaded. Row counts can be lower than live"
  echo "if data was added after this backup was taken. Scratch database is dropped on exit."
  exit 0
fi

# ---------------------------------------------------------------------------
# REAL RESTORE
# ---------------------------------------------------------------------------
echo "About to restore ${DUMP_FILE}"
echo "into database '${DB_NAME}' on container '${CONTAINER_NAME}'."
extra_note=""
if [ -n "${EXTRA_STOP_CONTAINERS}" ]; then
  extra_note=" (and: ${EXTRA_STOP_CONTAINERS})"
fi
echo "THIS OVERWRITES THE LIVE DATABASE, and the backend '${BACKEND_CONTAINER}'${extra_note} will be stopped during the restore."
echo "Tip: avoid running this near 00:00 / 08:00 / 16:00, when the scheduled backup runs."
read -p "Type 'yes' to continue: " confirm
if [ "${confirm}" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

if [ "${SKIP_SAFETY_BACKUP}" = "true" ]; then
  echo "WARNING: SKIP_SAFETY_BACKUP=true, not backing up the current database first."
else
  echo "==> Taking a safety backup of the CURRENT database first..."
  if [ ! -x "${BACKUP_SCRIPT}" ]; then
    echo "ERROR: ${BACKUP_SCRIPT} not found or not executable."
    echo "       Fix that, or rerun with SKIP_SAFETY_BACKUP=true if you accept the risk."
    exit 1
  fi
  if ! "${BACKUP_SCRIPT}"; then
    echo "ERROR: safety backup failed, aborting before anything was changed."
    exit 1
  fi
  echo "==> Safety backup done (it is the newest file in the backup directory)."
fi


# Build the full list of containers to stop: the backend, plus anything in
# EXTRA_STOP_CONTAINERS (comma-separated, spaces around commas are tolerated).
STOP_CONTAINERS=("${BACKEND_CONTAINER}")
if [ -n "${EXTRA_STOP_CONTAINERS}" ]; then
  IFS=',' read -ra _extra <<< "${EXTRA_STOP_CONTAINERS}"
  for c in "${_extra[@]}"; do
    c="$(echo "${c}" | xargs)"   # trim whitespace
    [ -n "${c}" ] && STOP_CONTAINERS+=("${c}")
  done
fi

# Track which ones were actually running, so we only start those back up —
# never start something that was already stopped before we began.
WAS_RUNNING=()
for c in "${STOP_CONTAINERS[@]}"; do
  if is_running "${c}"; then
    echo "==> Stopping ${c}"
    docker stop "${c}" >/dev/null
    WAS_RUNNING+=("${c}")
  fi
done

echo "==> Restoring (you may be prompted for the GPG key passphrase)..."
if ! stream_dump | docker exec -i --env-file "${DB_CRED}" "${CONTAINER_NAME}" \
       mariadb -u "${DB_USER}" "${DB_NAME}"; then
  echo "ERROR: restore failed part-way. The database may be in a partial state."
  echo "       All stopped containers were left STOPPED on purpose. Use the safety"
  echo "       backup (newest file in the backup directory) or retry with a good"
  echo "       backup, then start them back up:"
  for c in "${WAS_RUNNING[@]}"; do echo "         docker start ${c}"; done
  exit 1
fi

tables="$(count_tables "${DB_CRED}" "${DB_USER}" "${DB_NAME}")"
if [ "${tables:-0}" -lt 1 ]; then
  echo "ERROR: restore finished but '${DB_NAME}' has no tables. All stopped containers left STOPPED."
  exit 1
fi
echo "==> Restore complete: ${tables} tables in ${DB_NAME}."

for c in "${WAS_RUNNING[@]}"; do
  echo "==> Starting ${c}"
  docker start "${c}" >/dev/null
done
if [ "${#WAS_RUNNING[@]}" -gt 0 ]; then
  echo "    Containers can take a few minutes to become healthy: docker ps"
fi