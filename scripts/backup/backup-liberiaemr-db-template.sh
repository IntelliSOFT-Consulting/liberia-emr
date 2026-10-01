#!/usr/bin/env bash
# Backs up LiberiaEMR's MariaDB database (running in a Docker container)
# to a compressed, timestamped dump.
#
# Usage: ./backup-liberiaemr-db.sh
# Typically run via cron (see backup_cron.sh).
#
# This is a TEMPLATE: double-brace placeholders are filled in by render.sh from an
# env file. Do not run the .tpl directly; run the rendered copy.

set -euo pipefail

# ---- Configuration -----------------------------------------------------

CONTAINER_NAME="{{CONTAINER_NAME}}"
DB_NAME="{{DB_NAME}}"
DB_USER="{{DB_USER}}"

# Where the container's compose project keeps its env file, which holds
# MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD (this image also accepts a
# MARIADB_ prefix, so both are checked). The password is read from this file
# at run time and never stored in this script.
ENV_FILE="{{ENV_FILE}}"

# Local backup destination
BACKUP_DIR="{{BACKUP_DIR}}"
RETENTION_DAYS="{{RETENTION_DAYS}}"

# Optional: send each backup somewhere off this server after a successful
# local dump. Leave REMOTE_UPLOAD as false to skip this (local-only backups).
#
# UPLOAD_METHOD picks how:
#   rclone - anything rclone supports: S3-compatible storage, Google Drive,
#            an SFTP server, etc. Configure the remote with `rclone config`
#            first, then set RCLONE_REMOTE to "remote-name:path".
#   scp    - a single server you already have SSH key access to. No rclone
#            needed. Set SCP_DESTINATION to "user@host:/path/".
REMOTE_UPLOAD="{{REMOTE_UPLOAD}}"
UPLOAD_METHOD="{{UPLOAD_METHOD}}"        # rclone or scp
RCLONE_REMOTE="{{RCLONE_REMOTE}}"        # used when UPLOAD_METHOD=rclone
SCP_DESTINATION="{{SCP_DESTINATION}}"    # used when UPLOAD_METHOD=scp, e.g. backups@10.0.0.5:/srv/backups/

# Strongly recommended: these backups contain full patient records (PHI).
# Encrypt the dump at rest with GPG before it's written to disk, using a
# public key you control (never share the private key or store it on
# this server). Required if REMOTE_UPLOAD is ever enabled — don't send
# unencrypted patient data off this box.
# ENCRYPT_BACKUPS=false is only for testing before a GPG key exists.
ENCRYPT_BACKUPS="{{ENCRYPT_BACKUPS}}"
GPG_RECIPIENT="{{GPG_RECIPIENT}}"   # key fingerprint or email; must be in this user's GPG keyring

LOG_FILE="{{LOG_FILE}}"

# ---- Script body ---------------------------------------------------------

timestamp="$(date +%Y-%m-%d_%H-%M-%S)"
dump_file="${BACKUP_DIR}/${DB_NAME}_${timestamp}.sql.gz"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "${LOG_FILE}"
}

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# Credentials are passed to `docker exec` via --env-file rather than -e,
# because -e VALUE appears in `ps aux` output on the host for the
# duration of the command — visible to any other local user. --env-file
# reads from a file instead, which we lock down to this user only and
# delete immediately after use, including on failure.
cred_file="$(mktemp)"
chmod 600 "${cred_file}"
trap 'rm -f "${cred_file}"' EXIT

if [ ! -f "${ENV_FILE}" ]; then
  log "ERROR: env file not found at ${ENV_FILE}"
  exit 1
fi

# Pull the DB password out of the compose env file without sourcing the
# whole thing (it may contain other vars we don't want in our shell).
# Check MYSQL_PASSWORD first, fall back to MARIADB_PASSWORD.
DB_PASSWORD="$(grep -E '^MYSQL_PASSWORD=' "${ENV_FILE}" | cut -d'=' -f2- || true)"
if [ -z "${DB_PASSWORD}" ]; then
  DB_PASSWORD="$(grep -E '^MARIADB_PASSWORD=' "${ENV_FILE}" | cut -d'=' -f2- || true)"
fi

if [ -z "${DB_PASSWORD}" ]; then
  log "ERROR: could not read MYSQL_PASSWORD or MARIADB_PASSWORD from ${ENV_FILE}"
  exit 1
fi

echo "MYSQL_PWD=${DB_PASSWORD}" > "${cred_file}"
unset DB_PASSWORD   # don't keep it in this shell's environment longer than needed

log "==> Starting backup of ${DB_NAME} from container ${CONTAINER_NAME}"

if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)" != "true" ]; then
  log "ERROR: container ${CONTAINER_NAME} is not running"
  exit 1
fi

# mariadb-dump lives at this path in the mariadb:10.11 image (aliased to
# mysqldump too, either works). --env-file requires Docker Engine 20.10+;
# check with `docker --version` if this fails on an older host.
if [ "${ENCRYPT_BACKUPS}" = "true" ]; then
  final_file="${dump_file}.gpg"
  if docker exec --env-file "${cred_file}" "${CONTAINER_NAME}" \
       mariadb-dump --single-transaction --routines --triggers --events \
       -u "${DB_USER}" "${DB_NAME}" \
       | gzip \
       | gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always \
             --output "${final_file}"; then
    size="$(du -h "${final_file}" | cut -f1)"
    log "==> Backup succeeded (encrypted): ${final_file} (${size})"
  else
    log "ERROR: mariadb-dump or gpg encryption failed"
    rm -f "${final_file}"
    exit 1
  fi
else
  final_file="${dump_file}"
  log "WARNING: ENCRYPT_BACKUPS=false — backup will contain unencrypted patient data at rest"
  if docker exec --env-file "${cred_file}" "${CONTAINER_NAME}" \
       mariadb-dump --single-transaction --routines --triggers --events \
       -u "${DB_USER}" "${DB_NAME}" | gzip > "${final_file}"; then
    size="$(du -h "${final_file}" | cut -f1)"
    log "==> Backup succeeded: ${final_file} (${size})"
  else
    log "ERROR: mariadb-dump failed"
    rm -f "${final_file}"
    exit 1
  fi
fi

# ---- Optional remote upload ----

if [ "${REMOTE_UPLOAD}" = "true" ]; then
  if [ "${ENCRYPT_BACKUPS}" != "true" ]; then
    log "ERROR: REMOTE_UPLOAD=true requires ENCRYPT_BACKUPS=true — refusing to send"
    log "       unencrypted patient data off this server. Fix the config and rerun."
    exit 1
  fi

  case "${UPLOAD_METHOD}" in
    rclone)
      if [ -z "${RCLONE_REMOTE}" ]; then
        log "ERROR: UPLOAD_METHOD=rclone but RCLONE_REMOTE is empty — set it in backup.env"
        exit 1
      fi
      if command -v rclone &>/dev/null; then
        log "==> Uploading to ${RCLONE_REMOTE} (rclone)"
        if rclone copy "${final_file}" "${RCLONE_REMOTE}"; then
          log "==> Upload succeeded"
        else
          log "WARNING: upload failed, local backup is still intact"
        fi
      else
        log "WARNING: REMOTE_UPLOAD=true but rclone is not installed, skipping upload"
      fi
      ;;
    scp)
      if [ -z "${SCP_DESTINATION}" ]; then
        log "ERROR: UPLOAD_METHOD=scp but SCP_DESTINATION is empty — set it in backup.env"
        exit 1
      fi
      if command -v scp &>/dev/null; then
        log "==> Uploading to ${SCP_DESTINATION} (scp)"
        # BatchMode=yes: fail instead of hanging on a password prompt cron can't answer.
        if scp -o BatchMode=yes -o ConnectTimeout=15 "${final_file}" "${SCP_DESTINATION}"; then
          log "==> Upload succeeded"
        else
          log "WARNING: upload failed (check SSH key access to ${SCP_DESTINATION}), local backup is still intact"
        fi
      else
        log "WARNING: REMOTE_UPLOAD=true but scp is not installed, skipping upload"
      fi
      ;;
    *)
      log "ERROR: UPLOAD_METHOD must be 'rclone' or 'scp', got '${UPLOAD_METHOD}'"
      exit 1
      ;;
  esac
fi

# ---- Retention: delete local backups older than RETENTION_DAYS ----

log "==> Pruning local backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz*" -mtime "+${RETENTION_DAYS}" -print -delete | tee -a "${LOG_FILE}"

log "==> Done"