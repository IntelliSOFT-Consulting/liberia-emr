#!/usr/bin/env bash
# The indicator-report stack check (LE-336): loads the synthetic fixtures into a running stack,
# runs the reporting ETL in full and then incrementally, and compares every report with
# qa/reporting/expected-values.csv. Along the way it asserts what ADR 0010 makes the ETL's
# definition of done:
#
#   1. setupEtl() deployed the ETL as the dedicated ETL user: every routine and event in
#      liberiaemr_etl has that user as definer, the backend's mambaetl.analysis.db.username
#      names it, and the user holds no global privilege (no SUPER);
#   2. a full run on the fixtures succeeds, with an empty _mamba_etl_error_log, and every
#      report row matches expected-values.csv (compare-reports.py);
#   3. one late row added after that run (load-fixtures.py load-late-row), back-dated so core's
#      timestamp test would miss it, is picked up by the next incremental run: the encounter,
#      its obs, its visit and its anthropometry fact all appear. The reports still match;
#   4. at a facility, the binlog holds no liberiaemr_etl event, while it does hold the
#      fixtures' openmrs rows (so the check cannot pass on an empty or disabled binlog).
#
#   qa/reporting/run-stack-check.sh --role facility --site careysburg -- <docker compose args>
#   qa/reporting/run-stack-check.sh --role central -- <docker compose args>
#
# Everything after `--` is passed to `docker compose` to address the stack under test, e.g.
#   -- -f distribution/compose/facility/docker-compose.yml --env-file qa/upgrade/clean-install.env
# The stack's db and backend must be up and the backend started. Load the fixtures onto a FRESH
# stack only: several expected values count every patient in the database, and the fixtures
# cannot be unloaded.
#
# --role central prepares central for the fixtures (both sites' locations and the County and
# District scaffold, load-fixtures.py prepare-central --admin-hierarchy), loads both sites
# directly rather than through sync, and waits for the identity task to link every fixture
# patient before the ETL runs. docs/runbooks/reporting-etl.md, "Checking a stack", covers it.
#
# Options:
#   --timings FILE   also write "step seconds" lines here (and to $GITHUB_STEP_SUMMARY in CI)
#   --python-image   the image compare-reports.py runs in (default python:3.12-alpine)
#   --deploy-wait S  seconds to wait for setupEtl()'s first run (default 1200)
#   --dump-dir DIR   after the incremental run, write every report data set read to
#                    DIR/<instance>.json, all columns, for compare-instances.py (the
#                    facility-equals-central check). Synthetic figures only; no PHI.
#
# The database is reached through `docker compose exec db`, with the credentials the db
# container already holds (MARIADB_ROOT_PASSWORD, ETL_DB_USER, ETL_DB_PASSWORD); none is passed
# on a command line or printed. compare-reports.py runs in a throwaway Python container on the
# stack's own network, because neither stack publishes the backend's port. Synthetic data only:
# refuses nothing by URL, so never point it at a stack that holds real patients.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE=""
SITE="careysburg"
TIMINGS=""
PYTHON_IMAGE="python:3.12-alpine"
DEPLOY_WAIT=1200
DUMP_DIR=""
COMPOSE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)         ROLE="$2"; shift 2 ;;
    --site)         SITE="$2"; shift 2 ;;
    --timings)      TIMINGS="$2"; shift 2 ;;
    --python-image) PYTHON_IMAGE="$2"; shift 2 ;;
    --deploy-wait)  DEPLOY_WAIT="$2"; shift 2 ;;
    --dump-dir)     DUMP_DIR="$(mkdir -p "$2" && cd "$2" && pwd)"; shift 2 ;;
    --) shift; COMPOSE_ARGS=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ROLE" in
  facility) INSTANCE="facility:${SITE}" ;;
  central)  INSTANCE="central" ;;
  *) echo "--role facility|central is required" >&2; exit 2 ;;
esac
[[ ${#COMPOSE_ARGS[@]} -gt 0 ]] || { echo "pass the stack's docker compose arguments after --" >&2; exit 2; }

dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

fail() { echo "FAIL: $*" >&2; exit 1; }

# SQL as root or as the ETL user. Both sessions default to liberiaemr_etl: at a facility the
# binlog filters on the DEFAULT database, so nothing this script writes to the ETL schema can
# reach it. Reads only, as root.
root_sql() { dc exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B liberiaemr_etl'; }
etl_sql()  { dc exec -T db sh -c 'exec mariadb -u"${ETL_DB_USER:-mambaetl}" -p"$ETL_DB_PASSWORD" -N -B liberiaemr_etl'; }
etl_user() { dc exec -T db sh -c 'printf %s "${ETL_DB_USER:-mambaetl}"'; }

STEP_START=0
STEP_NAME=""
step() {
  end_step
  STEP_NAME="$1"
  STEP_START=$SECONDS
  echo "== ${STEP_NAME} =="
}
end_step() {
  if [[ -n "$STEP_NAME" ]]; then
    local took=$(( SECONDS - STEP_START ))
    echo "   (${took}s)"
    [[ -z "$TIMINGS" ]] || printf '%s\t%s\n' "$STEP_NAME" "$took" >> "$TIMINGS"
    [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || printf '| %s | %ss |\n' "$STEP_NAME" "$took" >> "$GITHUB_STEP_SUMMARY"
    STEP_NAME=""
  fi
}
[[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || printf '\n### Indicator reports on %s\n\n| Step | Time |\n| --- | --- |\n' "$INSTANCE" >> "$GITHUB_STEP_SUMMARY"

DB_CONTAINER="$(dc ps -q db)"
BACKEND_CONTAINER="$(dc ps -q backend)"
[[ -n "$DB_CONTAINER" && -n "$BACKEND_CONTAINER" ]] || fail "the stack's db and backend are not running"
ETL_USER="$(etl_user)"

# ---------------------------------------------------------------------------------------------
step "setupEtl() deploys the ETL and completes its first run"
deadline=$(( SECONDS + DEPLOY_WAIT ))
while true; do
  # Into a variable first: under pipefail, grep -m1 stopping early would SIGPIPE `logs` and
  # turn a match into a failed pipeline, hiding exactly the line being looked for.
  backend_log="$(dc logs --no-color backend 2>&1 || true)"
  if grep -m1 -E "Failed to deploy MambaETL|Access denied for user '${ETL_USER}'" <<<"$backend_log"; then
    fail "the ETL did not deploy (backend log above)"
  fi
  state="$(root_sql <<'SQL' 2>/dev/null || true
SELECT CONCAT(
  (SELECT COUNT(*) FROM information_schema.EVENTS
    WHERE EVENT_SCHEMA = 'liberiaemr_etl' AND EVENT_NAME = '_mamba_etl_scheduler_event'), ':',
  (SELECT COUNT(*) FROM _mamba_etl_schedule
    WHERE transaction_status = 'COMPLETED' AND completion_status = 'SUCCESS' AND end_time IS NOT NULL));
SQL
)"
  if [[ "$state" =~ ^1:[1-9] ]]; then
    echo "   deployed; first scheduled run completed"
    break
  fi
  (( SECONDS < deadline )) || fail "no completed ETL run within ${DEPLOY_WAIT}s (event:runs = ${state:-schema not there yet})"
  sleep 10
done

# ---------------------------------------------------------------------------------------------
step "the ETL runs as its own user, without SUPER"
definers="$(root_sql <<'SQL'
SELECT DISTINCT DEFINER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = 'liberiaemr_etl'
UNION SELECT DISTINCT DEFINER FROM information_schema.EVENTS WHERE EVENT_SCHEMA = 'liberiaemr_etl';
SQL
)"
routines="$(root_sql <<< "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = 'liberiaemr_etl';")"
[[ "$definers" == "${ETL_USER}@%" ]] \
  || fail "routines and events in liberiaemr_etl must all be defined by ${ETL_USER}@%; found: $(tr '\n' ' ' <<<"$definers")"
echo "   ${routines} routines and the scheduler events, all defined by ${ETL_USER}@%"
configured="$(dc exec -T backend sh -c "sed -n 's/^mambaetl\.analysis\.db\.username=//p' /openmrs/data/openmrs-runtime.properties" | tr -d '\r')"
[[ "$configured" == "$ETL_USER" ]] \
  || fail "the backend's mambaetl.analysis.db.username is '${configured}', not '${ETL_USER}'"
echo "   the backend connects the ETL as ${configured}"
# Only the privilege columns and the GRANT lines' heads are read: SHOW GRANTS also prints the
# password hash, which must not reach a CI log.
global="$(root_sql <<< "SHOW GRANTS FOR '${ETL_USER}'@'%';" | sed -E 's/ IDENTIFIED BY .*//' | grep -E ' ON \*\.\* ' || true)"
[[ "$global" =~ ^GRANT\ USAGE\ ON\ \*\.\*\ TO ]] && [[ "$(wc -l <<<"$global")" -eq 1 ]] \
  || fail "the ETL user holds a global privilege: ${global}"
super="$(root_sql <<< "SELECT CONCAT(Super_priv, Grant_priv) FROM mysql.user WHERE User = '${ETL_USER}' AND Host = '%';")"
[[ "$super" == "NN" ]] || fail "the ETL user has SUPER or GRANT OPTION (${super})"
echo "   ${global}  (no SUPER, no global grant)"
for flag in event_scheduler performance_schema; do
  value="$(root_sql <<< "SELECT @@GLOBAL.${flag};")"
  [[ "$value" == "ON" || "$value" == "1" ]] || fail "${flag} is ${value}; the ETL needs it ON (ADR 0010 decision 3)"
done
consumer="$(root_sql <<< "SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME = 'events_statements_current';")"
[[ "$consumer" == "YES" ]] || fail "the events_statements_current consumer is ${consumer} (ADR 0010 A1)"
echo "   event_scheduler, performance_schema and its events_statements_current consumer are on"

# ---------------------------------------------------------------------------------------------
if [[ "$ROLE" == "central" ]]; then
  step "prepare central and load both sites' fixtures"
  python3 "$HERE/load-fixtures.py" prepare-central --db-container "$DB_CONTAINER" --admin-hierarchy
  python3 "$HERE/load-fixtures.py" load --site all --db-container "$DB_CONTAINER"

  step "the identity task links every fixture patient"
  deadline=$(( SECONDS + 900 ))
  while true; do
    unlinked="$(root_sql <<'SQL' 2>/dev/null || echo "?"
SELECT COUNT(*) FROM openmrs.patient p
  JOIN openmrs.person pe ON pe.person_id = p.patient_id
  LEFT JOIN openmrs_identity.patient_link l ON l.patient_uuid = pe.uuid
 WHERE p.voided = 0 AND l.patient_uuid IS NULL;
SQL
)"
    [[ "$unlinked" == "0" ]] && { echo "   every patient has a CPI"; break; }
    (( SECONDS < deadline )) || fail "${unlinked} patients still have no CPI after 15 minutes"
    sleep 15
  done
else
  step "load the ${SITE} fixtures"
  python3 "$HERE/load-fixtures.py" load --site "$SITE" --db-container "$DB_CONTAINER"
fi

# Runs the ETL once, now, as the ETL user, and asserts that it succeeded. $1 is full or
# incremental. A run the event started is waited out first: sp_mamba_etl_schedule does nothing
# while another run holds the schedule, so the new row is what proves this call ran.
run_etl() {
  local mode="$1" before row
  local deadline=$(( SECONDS + 3600 ))
  until [[ "$(etl_sql <<< "SELECT COUNT(*) FROM _mamba_etl_schedule WHERE transaction_status = 'RUNNING';")" == "0" ]]; do
    (( SECONDS < deadline )) || fail "an ETL run has held the schedule for an hour"
    echo "   waiting for a scheduled run to finish"
    sleep 10
  done
  before="$(etl_sql <<< "SELECT COALESCE(MAX(id), 0) FROM _mamba_etl_schedule;")"
  if [[ "$mode" == "full" ]]; then
    # The documented full rebuild (docs/runbooks/reporting-etl.md): switch incremental mode off
    # for one run, then back on.
    etl_sql <<< "UPDATE _mamba_etl_user_settings SET incremental_mode_switch = 0; CALL sp_mamba_etl_schedule(); UPDATE _mamba_etl_user_settings SET incremental_mode_switch = 1;"
  else
    etl_sql <<< "CALL sp_mamba_etl_schedule();"
  fi
  row="$(etl_sql <<< "SELECT CONCAT_WS('|', id, transaction_status, completion_status, COALESCE(success_or_error_message, '-'), end_time IS NOT NULL, execution_duration_seconds) FROM _mamba_etl_schedule WHERE id > ${before} ORDER BY id DESC LIMIT 1;")"
  IFS='|' read -r _id txn completion message ended took <<<"$row"
  [[ -n "$row" ]] || fail "sp_mamba_etl_schedule() started no run"
  [[ "$txn|$completion|$message|$ended" == "COMPLETED|SUCCESS|-|1" ]] \
    || fail "the ${mode} run did not succeed: ${row}"
  # Which path ran: only incremental runs keep mamba_etl_liberia_incremental_state (the LE-363
  # overrides write it), and a full run drops it with every other mamba_* table.
  local state
  if [[ "$mode" == "full" ]]; then
    state="$(etl_sql <<< "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'liberiaemr_etl' AND TABLE_NAME = 'mamba_etl_liberia_incremental_state';")"
    [[ "$state" == "0" ]] || fail "asked for a full run, but the incremental state table survived it"
  else
    state="$(etl_sql <<< "SELECT COUNT(*) FROM mamba_etl_liberia_incremental_state WHERE last_run_time >= (SELECT start_time FROM _mamba_etl_schedule WHERE id = ${_id});")"
    [[ "$state" =~ ^[1-9] ]] || fail "asked for an incremental run, but run ${_id} did not take the incremental path"
  fi
  echo "   ${mode} run ${_id} completed in ${took}s"
  assert_no_etl_errors
}

assert_no_etl_errors() {
  local errors
  errors="$(etl_sql <<< "SELECT CONCAT_WS(' | ', error_time, procedure_name, error_code, LEFT(error_message, 200)) FROM _mamba_etl_error_log ORDER BY id;")"
  [[ -z "$errors" ]] || { echo "$errors" >&2; fail "_mamba_etl_error_log is not empty"; }
  echo "   _mamba_etl_error_log is empty"
}

# $1, optional: write every data set read to $DUMP_DIR/<instance>.json (compare-instances.py).
compare() {
  local network dump=()
  network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$BACKEND_CONTAINER" | head -1)"
  [[ -n "$network" ]] || fail "cannot find the backend's network"
  if [[ -n "${1:-}" && -n "$DUMP_DIR" ]]; then
    dump=(-v "$DUMP_DIR:/out" -u "$(id -u):$(id -g)")
    set -- --dump "/out/${INSTANCE/:/-}.json"
  else
    set --
  fi
  docker run --rm --network "$network" -v "$HERE:/qa/reporting:ro" ${dump[@]+"${dump[@]}"} "$PYTHON_IMAGE" \
    python3 /qa/reporting/compare-reports.py --url http://backend:8080 --instance "$INSTANCE" "$@" \
    || fail "the reports do not match expected-values.csv (mismatches above)"
}

# ---------------------------------------------------------------------------------------------
step "a full ETL run on the fixtures"
run_etl full

step "every report matches expected-values.csv (${INSTANCE})"
compare

# ---------------------------------------------------------------------------------------------
step "an incremental run picks up a late row"
python3 "$HERE/load-fixtures.py" load-late-row --db-container "$DB_CONTAINER"
# Plain variables, not an associative array: macOS still ships bash 3.2.
late_visit="" late_encounter="" late_obs=""
while IFS='=' read -r name value; do
  case "$name" in
    visit) late_visit="$value" ;;
    encounter) late_encounter="$value" ;;
    obs) late_obs="$value" ;;
  esac
done < <(python3 "$HERE/load-fixtures.py" late-row-uuids)
[[ -n "$late_visit" && -n "$late_encounter" && -n "$late_obs" ]] || fail "load-fixtures.py late-row-uuids printed no UUIDs"
counts_sql="SELECT CONCAT_WS(' ',
  (SELECT COUNT(*) FROM mamba_dim_encounter WHERE uuid = '${late_encounter}'),
  (SELECT COUNT(*) FROM mamba_z_encounter_obs z JOIN openmrs.obs o ON o.obs_id = z.obs_id WHERE o.uuid = '${late_obs}'),
  (SELECT COUNT(*) FROM mamba_fact_emr_ops_visit f JOIN openmrs.visit v ON v.visit_id = f.visit_id WHERE v.uuid = '${late_visit}'),
  (SELECT COUNT(*) FROM mamba_fact_nutrition_anthropometry f JOIN openmrs.encounter e ON e.encounter_id = f.encounter_id
    WHERE e.uuid = '${late_encounter}' AND f.weight_kg = 11.2));"
before_counts="$(root_sql <<< "$counts_sql")"
[[ "$before_counts" == "0 0 0 0" ]] || fail "the late row is in the ETL before any run: ${before_counts}"
run_etl incremental
after_counts="$(root_sql <<< "$counts_sql")"
[[ "$after_counts" == "1 1 1 1" ]] \
  || fail "the incremental run missed the late row (encounter, obs, visit fact, anthropometry fact: ${after_counts})"
echo "   the encounter, its obs, its visit and its anthropometry row are in the ETL"
found_new="$(etl_sql <<< "SELECT last_run_new FROM mamba_etl_liberia_incremental_state WHERE etl_table = 'mamba_dim_encounter';")"
[[ "$found_new" =~ ^[1-9] ]] || fail "mamba_dim_encounter's incremental state lists no new key (${found_new:-no row})"
echo "   found as new by key: ${found_new} encounter (its date_created predates the run)"
compare dump
[[ -z "$DUMP_DIR" ]] || echo "   every data set read is in ${DUMP_DIR}/${INSTANCE/:/-}.json"

# ---------------------------------------------------------------------------------------------
if [[ "$ROLE" == "facility" ]]; then
  step "no liberiaemr_etl event reaches the binlog"
  # SHOW BINLOG EVENTS names the schema of every Table_map (row) event and prefixes every
  # Query event with its default database, so an ETL write shows up either way. Streamed and
  # counted inside the container: the clean install's metadata import makes the listing large.
  # shellcheck disable=SC2016
  counts="$(dc exec -T db sh -c '
    m() { mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B "$@"; }
    for f in $(m -e "SHOW BINARY LOGS" | cut -f1); do
      m -e "SHOW BINLOG EVENTS IN '"'"'$f'"'"'"
    done | awk "/liberiaemr_etl/ { e++ } /\\(openmrs\\.encounter\\)/ { x++ } END { print e + 0, x + 0 }"')"
  read -r etl_events encounter_maps <<<"$counts"
  [[ "${encounter_maps:-0}" -gt 0 ]] || fail "the binlog holds no openmrs.encounter rows, so it cannot show the ETL is filtered"
  [[ "${etl_events:-1}" == "0" ]] || fail "${etl_events} binlog events name liberiaemr_etl"
  echo "   0 events name liberiaemr_etl; ${encounter_maps} openmrs.encounter row events show the binlog is on"
fi

end_step
echo
echo "indicator report stack check passed on ${INSTANCE}"
