#!/usr/bin/env bash
# Upgrade test: an existing database with patient data -> the release under test -> the
# metadata still loads and the data is still valid.
#
#   qa/upgrade/run-upgrade.sh --to <version> [--from-image <registry>/liberia-emr-backend:<tag>]
#                             [--project-name upgrade-test]
#
# THE critical gate. A clean install runs against an empty database where nothing can
# collide. This is the only test that runs new metadata against a database that already holds
# metadata and patients, and so the only one that surfaces a shipped UUID moved to a name an
# older row still holds, a changed concept datatype, and retired metadata still referenced by
# patient data. See README.md. Both dev servers hit the first of these on 2026-10-03 (LE-400).
#
# What it upgrades FROM: --from-image, or by default the newest backend image published from
# main at or before the point this tree merges into main. A pull request's checkout is a merge
# commit whose first parent is main; elsewhere it is the merge base with origin/main. Main's CI
# publishes liberia-emr-backend:<sha> for every green commit, and this walks main's
# first-parent history back to the nearest one that exists. That is what the dev servers run,
# and what any database built from main carries.
#
# Steps:
#   1. run-clean-install.sh at the FROM image, keeping the stack up
#   2. seed-upgrade-data.py: synthetic patients, observations on every Numeric, Coded, Text,
#      Boolean and Date concept in FROM's content, an encounter of every type, an enrolment in
#      every programme
#   3. snapshot what the data references
#   4. recreate the backend at --to on the same database, as an upgrade does
#   5. assert: the boot finished, Initializer saved every row it read, no ${var.*} leaked, and
#      the snapshot is unchanged (same counts; no referenced concept changed datatype; nothing
#      the data references was retired)
#
# Images are started, not built. The --to image must exist locally or be pullable; build it with
# scripts/build/build-distribution.sh --no-frontend at the same version.
set -euo pipefail

if [[ "${CLEAN_INSTALL_CAFFEINATED:-}" != "1" ]] && command -v caffeinate >/dev/null 2>&1; then
  export CLEAN_INSTALL_CAFFEINATED=1
  exec caffeinate -is "${BASH:-/bin/bash}" "$0" "$@"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/distribution/compose/facility/docker-compose.yml"
ENV_FILE="$ROOT/qa/upgrade/clean-install.env"   # written by run-clean-install.sh
WORK="$ROOT/qa/upgrade/.upgrade-work"          # inside the repo: Docker Desktop does not share /tmp
TO=""
TO_REGISTRY="${REGISTRY:-intellisoftdev}"
FROM_IMAGE=""
FROM_REPO="${FROM_REPO:-intellisoftdev/liberia-emr-backend}"
PROJECT_NAME="upgrade-test"
UPGRADE_TIMEOUT="${UPGRADE_TIMEOUT:-3600}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)           TO="$2"; shift 2 ;;
    --from-image)   FROM_IMAGE="$2"; shift 2 ;;
    --project-name) PROJECT_NAME="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TO" ]] || { echo "--to <version> is required (the image under test)" >&2; exit 2; }

dc() { docker compose -f "$COMPOSE" --env-file "$ENV_FILE" -p "$PROJECT_NAME" "$@"; }
# shellcheck disable=SC2016  # the container expands its own MARIADB_ROOT_PASSWORD
sql() { dc exec -T db sh -c 'mariadb -N -uroot -p"$MARIADB_ROOT_PASSWORD" openmrs' <<<"$1"; }

cleanup() {
  [[ -f "$ENV_FILE" ]] && dc down -v >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  rm -rf "$ROOT/qa/upgrade/.ci-certs" "$WORK"
}
trap cleanup EXIT

# --- 0. What to upgrade from -----------------------------------------------------------------
if [[ -z "$FROM_IMAGE" ]]; then
  if git -C "$ROOT" rev-parse -q --verify 'HEAD^2' >/dev/null; then
    start="$(git -C "$ROOT" rev-parse 'HEAD^1')"            # a PR merge commit: its main side
  else
    start="$(git -C "$ROOT" merge-base HEAD origin/main 2>/dev/null || true)"
    [[ -n "$start" ]] || { echo "FAIL: no origin/main to upgrade from; fetch it, or pass --from-image" >&2; exit 1; }
    [[ "$start" != "$(git -C "$ROOT" rev-parse HEAD)" ]] || start="$(git -C "$ROOT" rev-parse 'HEAD^1')"
  fi
  echo "== finding the newest main image at or before ${start:0:7} =="
  for sha in $(git -C "$ROOT" rev-list --first-parent -n 30 "$start"); do
    if docker manifest inspect "$FROM_REPO:$sha" >/dev/null 2>&1; then
      FROM_IMAGE="$FROM_REPO:$sha"
      break
    fi
  done
  [[ -n "$FROM_IMAGE" ]] || { echo "FAIL: none of the 30 main commits up to ${start:0:7} has a published $FROM_REPO image" >&2; exit 1; }
fi
from_repo="${FROM_IMAGE%:*}"
from_tag="${FROM_IMAGE##*:}"
[[ "$from_repo" == */liberia-emr-backend ]] \
  || { echo "--from-image must name <registry>/liberia-emr-backend:<tag>, got $FROM_IMAGE" >&2; exit 2; }
from_registry="${from_repo%/liberia-emr-backend}"
echo "upgrade test: $FROM_IMAGE -> $TO_REGISTRY/liberia-emr-backend:$TO"
docker image inspect "$FROM_IMAGE" >/dev/null 2>&1 || docker pull -q "$FROM_IMAGE" >/dev/null
# main's images are built on amd64 runners. On an arm64 machine they run emulated and a clean
# install takes hours; build FROM locally at the same main commit and pass --from-image.
case "$(uname -m)" in arm64|aarch64) host_arch=arm64 ;; x86_64) host_arch=amd64 ;; *) host_arch="$(uname -m)" ;; esac
from_arch="$(docker image inspect -f '{{.Architecture}}' "$FROM_IMAGE" 2>/dev/null || true)"
if [[ -n "$from_arch" && "$from_arch" != "$host_arch" ]]; then
  echo "WARNING: $FROM_IMAGE is $from_arch on an $host_arch host: it runs emulated and may take hours." >&2
  echo "  Build it natively: scripts/build/build-distribution.sh --version <tag> --no-frontend --no-sync" >&2
  echo "  at that main commit (a git worktree), then pass --from-image intellisoftdev/liberia-emr-backend:<tag>." >&2
fi

# --- 1. The database to upgrade --------------------------------------------------------------
echo "== 1. installing the FROM release on an empty database =="
if ! REGISTRY="$from_registry" "$ROOT/qa/upgrade/run-clean-install.sh" \
       --version "$from_tag" --no-frontend --keep-stack --project-name "$PROJECT_NAME"; then
  echo "FAIL: the FROM image ($FROM_IMAGE) did not install cleanly, so there is nothing to upgrade." >&2
  echo "  That is a fault in the baseline, not necessarily in this change; its own CI run says more." >&2
  exit 1
fi

# --- 2. Synthetic patient data ---------------------------------------------------------------
echo "== 2. writing synthetic patient data against FROM's metadata =="
mkdir -p "$WORK"
dc exec -T backend sh -c 'cat /openmrs/distribution/openmrs_config/concepts/*.csv 2>/dev/null' \
  | grep -oE '^[0-9A-Za-z-]{36}' | sort -u > "$WORK/concepts.txt" || true
echo "   $(wc -l < "$WORK/concepts.txt" | tr -d ' ') concepts in FROM's content"
[[ -s "$WORK/concepts.txt" ]] || { echo "FAIL: found no concept CSVs in the FROM image" >&2; exit 1; }
docker run --rm --network "${PROJECT_NAME}_liberiaemr" \
  -v "$ROOT/qa/upgrade:/qa:ro" -v "$WORK:/work:ro" python:3.12-alpine \
  python /qa/seed-upgrade-data.py --base-url http://backend:8080/openmrs --concepts /work/concepts.txt

# --- 3. What the data references ---------------------------------------------------------------
# Counts of the data itself, and every piece of metadata it points at with the two properties an
# upgrade must not change under it: a concept's datatype, and anything's retired flag.
SNAPSHOT_SQL="
SELECT 'count', 'patients', COUNT(*) FROM patient WHERE voided = 0
UNION ALL SELECT 'count', 'visits', COUNT(*) FROM visit WHERE voided = 0
UNION ALL SELECT 'count', 'encounters', COUNT(*) FROM encounter WHERE voided = 0
UNION ALL SELECT 'count', 'observations', COUNT(*) FROM obs WHERE voided = 0
UNION ALL SELECT 'count', 'enrolments', COUNT(*) FROM patient_program WHERE voided = 0
UNION ALL SELECT 'count', 'states', COUNT(*) FROM patient_state WHERE voided = 0;
SELECT 'obs question', c.uuid, d.name, c.retired FROM (SELECT DISTINCT concept_id FROM obs WHERE voided = 0) o
  JOIN concept c USING (concept_id) JOIN concept_datatype d ON d.concept_datatype_id = c.datatype_id ORDER BY c.uuid;
SELECT 'obs answer', c.uuid, c.retired FROM (SELECT DISTINCT value_coded FROM obs WHERE voided = 0 AND value_coded IS NOT NULL) o
  JOIN concept c ON c.concept_id = o.value_coded ORDER BY c.uuid;
SELECT 'encounter type', t.uuid, t.retired FROM (SELECT DISTINCT encounter_type FROM encounter WHERE voided = 0) e
  JOIN encounter_type t ON t.encounter_type_id = e.encounter_type ORDER BY t.uuid;
SELECT 'form', f.uuid, f.retired FROM (SELECT DISTINCT form_id FROM encounter WHERE voided = 0 AND form_id IS NOT NULL) e
  JOIN form f USING (form_id) ORDER BY f.uuid;
SELECT 'visit type', t.uuid, t.retired FROM (SELECT DISTINCT visit_type_id FROM visit WHERE voided = 0) v
  JOIN visit_type t USING (visit_type_id) ORDER BY t.uuid;
SELECT 'location', l.uuid, l.retired FROM (SELECT DISTINCT location_id FROM encounter WHERE voided = 0) e
  JOIN location l USING (location_id) ORDER BY l.uuid;
SELECT 'programme', p.uuid, p.retired FROM (SELECT DISTINCT program_id FROM patient_program WHERE voided = 0) x
  JOIN program p USING (program_id) ORDER BY p.uuid;
SELECT 'state', s.uuid, s.retired FROM (SELECT DISTINCT state FROM patient_state WHERE voided = 0) x
  JOIN program_workflow_state s ON s.program_workflow_state_id = x.state ORDER BY s.uuid;"
sql "$SNAPSHOT_SQL" > "$WORK/before.txt"
echo "== 3. snapshot: $(grep -c . "$WORK/before.txt") rows; $(grep '^count' "$WORK/before.txt" | awk '{printf "%s %s, ", $3, $2}' | sed 's/, $//')"

# --- 4. Upgrade in place ---------------------------------------------------------------------
echo "== 4. recreating the backend at $TO_REGISTRY/liberia-emr-backend:$TO on the same database =="
sed -i.bak -e "s|^REGISTRY=.*|REGISTRY=$TO_REGISTRY|" -e "s|^LIBERIAEMR_VERSION=.*|LIBERIAEMR_VERSION=$TO|" \
  -e "s|^OMRS_CREATE_TABLES=.*|OMRS_CREATE_TABLES=false|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
dc up -d --no-deps --force-recreate backend

# The recreated container's log covers this boot only, which is why it is read here rather than
# initializer.log (left untouched on a restart; see run-clean-install.sh). Initializer applies
# changed CSVs synchronously during startup, before Tomcat logs "Server startup in"; only an
# OCL import carries on after it, on its own thread.
FAILED_ROWS='could not be constructed or saved|entities were not saved|Unable to start OpenMRS'
deadline=$(( SECONDS + UPGRADE_TIMEOUT ))
rejected_early=false
until dc logs backend 2>/dev/null | grep -q 'Server startup in'; do
  # Rejected rows are already the verdict; go straight to reporting them.
  if dc logs backend 2>/dev/null | grep -qE "$FAILED_ROWS"; then rejected_early=true; break; fi
  (( SECONDS < deadline )) || { echo "FAIL: the upgraded backend did not start within $(( UPGRADE_TIMEOUT / 60 )) minutes" >&2; dc logs --tail 80 backend >&2; exit 1; }
  sleep 20
done
if ! $rejected_early; then
  until [[ "$(sql 'SELECT COUNT(*) FROM openconceptlab_import WHERE local_date_stopped IS NULL' 2>/dev/null | tr -d '[:space:]')" == "0" ]]; do
    (( SECONDS < deadline )) || { echo "FAIL: an OCL import was still running after $(( UPGRADE_TIMEOUT / 60 )) minutes" >&2; exit 1; }
    sleep 20
  done
  dc exec -T backend curl -fs http://localhost:8080/openmrs/health/started >/dev/null \
    || { echo "FAIL: the upgraded backend logged its start but does not answer /health/started" >&2; exit 1; }
fi

# --- 5. Assertions ---------------------------------------------------------------------------
echo "== 5. asserting the upgrade =="
fail=0
log="$(dc logs backend 2>/dev/null)"
if grep -qE "$FAILED_ROWS" <<<"$log"; then
  echo "FAIL: Initializer rejected metadata on the upgrade boot" >&2
  grep -oE "[^ ]+ \('[a-z]+' domain\) was processed and [0-9]+ out of [0-9]+ entities were not saved" <<<"$log" \
    | sort -u | sed 's/^/    /' >&2 || true
  grep -oE '(org\.(openmrs|hibernate)[a-zA-Z.]*)(Exception|Error): [^|]*' <<<"$log" \
    | sort | uniq -c | sort -rn | head -10 | sed 's/^/    /' >&2 || true
  { grep -A4 'could not be constructed or saved' <<<"$log" | head -40 | sed 's/^/    /' >&2; } || true
  echo "  A row that loaded on a clean install and fails here usually means content moved a shipped" >&2
  echo "  UUID to a name an existing row still holds, or changed a datatype that observations use." >&2
  echo "  Shipped content is append-only (IMPLEMENTATION.md section 9)." >&2
  fail=1
else
  echo "   Initializer saved every row it read"
fi
# shellcheck disable=SC2016  # a literal ${var. is what is being looked for
if grep -q '\${var\.' <<<"$log"; then
  echo "FAIL: unresolved \${var.*} placeholder on the upgrade boot" >&2
  # shellcheck disable=SC2016
  grep '\${var\.' <<<"$log" | head -5 | sed 's/^/    /' >&2
  fail=1
fi

sql "$SNAPSHOT_SQL" > "$WORK/after.txt"
if ! diff -u "$WORK/before.txt" "$WORK/after.txt" > "$WORK/snapshot.diff"; then
  echo "FAIL: the data, or the metadata it references, changed under the upgrade" >&2
  echo "  (- before, + after; a count that moved is lost or invented data, a datatype that moved" >&2
  echo "   breaks existing observations, a retired flag 0 -> 1 retires something patient data uses)" >&2
  grep -E '^[-+][^-+]' "$WORK/snapshot.diff" | head -40 | sed 's/^/    /' >&2
  fail=1
else
  echo "   the data and every piece of metadata it references are unchanged"
fi

if (( fail )); then
  exit 1
fi
echo
echo "upgrade passed: $FROM_IMAGE -> $TO_REGISTRY/liberia-emr-backend:$TO"
