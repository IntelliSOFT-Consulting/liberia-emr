#!/usr/bin/env bash
# Installs a cron job that runs the backup script on a schedule.
# Run once with sudo, so the job lands in root's crontab (root owns the backup
# directory and holds the GPG key).
#
# Usage: sudo ./backup_cron.sh [path-to-backup-script]
#
# This is a TEMPLATE: double-brace placeholders are filled in by render.sh from an
# env file. Do not run the .tpl directly; run the rendered copy.

set -euo pipefail

DEFAULT_SCRIPT_PATH="{{BACKUP_SCRIPT_PATH}}"
CRON_SCHEDULE="{{CRON_SCHEDULE}}"
CRON_LOG_FILE="{{CRON_LOG_FILE}}"

SCRIPT_PATH="${1:-${DEFAULT_SCRIPT_PATH}}"

if [ ! -f "${SCRIPT_PATH}" ]; then
  echo "ERROR: ${SCRIPT_PATH} not found. Copy the rendered backup script there first,"
  echo "or pass its actual path as an argument to this script."
  exit 1
fi

chmod +x "${SCRIPT_PATH}"

CRON_LINE="${CRON_SCHEDULE} ${SCRIPT_PATH} >> ${CRON_LOG_FILE} 2>&1"

# grep -v exits 1 when it selects no lines (e.g. no crontab yet), which would
# silently abort under set -e, so it is guarded with || true.
existing="$(crontab -l 2>/dev/null || true)"
{ printf '%s\n' "${existing}" | grep -vF "${SCRIPT_PATH}" || true; echo "${CRON_LINE}"; } | crontab -

echo "Installed cron job:"
echo "  ${CRON_LINE}"
crontab -l