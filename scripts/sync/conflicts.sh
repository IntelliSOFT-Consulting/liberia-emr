#!/usr/bin/env bash
# Lists and resolves the sync receiver's conflicts at central with dbsync's own procedure
# (its README, "Conflict Resolution In The Receiver" and "Updating Entity Hashes"). A
# conflict means central's copy of a record was changed outside sync, so the facility's
# update to it, and every later one, is held back.
#
#   scripts/sync/conflicts.sh list
#   scripts/sync/conflicts.sh resolve --table <table> --conflict <id>[,<id>...] --by "<name, role>" --reason "<why>"
#
# resolve stops the receiver, checks that the conflicts given are exactly the ones queued for
# the table (dbsync's hash updater refuses a table with any unresolved), marks them resolved,
# runs the hash updater for that table as a one-off container, removes those rows (they hold
# the payloads, and dbsync's conflict metric counts every row) and starts the receiver again if
# it was running. If the hash update fails or the run is interrupted, the conflicts are reopened
# and the same command can be run again. Updates waiting behind them apply on the receiver's
# first retry run, two minutes after it starts. The decision is written to the host's syslog;
# never put a patient's name or identifier in the reason.
#
# Options before the command: --receiver <container> and --db <container>, found from the
# compose labels when omitted.
set -euo pipefail

RECEIVER=""
DB=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --receiver) RECEIVER="$2"; shift 2 ;;
    --db)       DB="$2"; shift 2 ;;
    *) break ;;
  esac
done
COMMAND="${1:-}"
[[ $# -gt 0 ]] && shift

usage() {
  grep '^#   scripts/sync/conflicts.sh' "$0" | sed 's/^#   /usage: /' >&2
  exit 2
}
case "$COMMAND" in list|resolve) ;; *) usage ;; esac

service_container() { # compose-service [project]
  docker ps -a --filter "label=com.docker.compose.service=$1" --filter label=com.docker.compose.oneoff=False \
    ${2:+--filter "label=com.docker.compose.project=$2"} --format '{{.Names}}' | head -1
}
[[ -n "$RECEIVER" ]] || RECEIVER="$(service_container sync-receiver)"
[[ -n "$RECEIVER" ]] || { echo "no sync-receiver container found; pass --receiver" >&2; exit 1; }
# docker prints <no value> for a label the container does not carry; an empty answer is easier
# for the callers to act on.
label() { docker inspect -f "{{index .Config.Labels \"com.docker.compose.$1\"}}" "$RECEIVER" | sed 's/^<no value>$//'; }
[[ -n "$DB" ]] || DB="$(service_container db "$(label project)")"
[[ -n "$DB" ]] || { echo "no db container found; pass --db" >&2; exit 1; }

receiver_env() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$RECEIVER" | sed -n "s/^$1=//p"; }
MGMT_DB="$(receiver_env MGMT_DB_NAME)"
MGMT_USER="$(receiver_env MGMT_DB_USER)"
MGMT_PASSWORD="$(receiver_env MGMT_DB_PASSWORD)"
[[ "$MGMT_DB" =~ ^[A-Za-z0-9_]+$ ]] || { echo "unexpected management schema name '$MGMT_DB'" >&2; exit 1; }

# The password is the first line on stdin, so it is in no file and no process argument.
sql() { # mariadb-output-flags statement
  # shellcheck disable=SC2016 # expanded inside the container
  { printf '%s\n' "$MGMT_PASSWORD"; printf '%s\n' "$2"; } | docker exec -i "$DB" sh -c \
    'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mariadb -u "$1" $2 "$3"' sh "$MGMT_USER" "$1" "$MGMT_DB"
}

OPENMRS_DB="$(receiver_env OPENMRS_DB_NAME)"
OPENMRS_USER="$(receiver_env OPENMRS_DB_USER)"
OPENMRS_PASSWORD="$(receiver_env OPENMRS_DB_PASSWORD)"
openmrs_sql() { # statement
  # shellcheck disable=SC2016 # expanded inside the container
  { printf '%s\n' "$OPENMRS_PASSWORD"; printf '%s\n' "$1"; } | docker exec -i "$DB" sh -c \
    'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mariadb -u "$1" --batch --skip-column-names "$2"' sh "$OPENMRS_USER" "$OPENMRS_DB"
}

# dbsync's table names (TableToSyncEnum) for the model classes it keeps hashes for.
TABLES="PersonModel:person PatientModel:patient VisitModel:visit EncounterModel:encounter
ObservationModel:obs PersonAttributeModel:person_attribute PatientProgramModel:patient_program
PatientStateModel:patient_state VisitAttributeModel:visit_attribute
EncounterDiagnosisModel:encounter_diagnosis ConditionModel:conditions PersonNameModel:person_name
AllergyModel:allergy PersonAddressModel:person_address PatientIdentifierModel:patient_identifier
OrderModel:orders DrugOrderModel:drug_order TestOrderModel:test_order RelationshipModel:relationship
EncounterProviderModel:encounter_provider OrderGroupModel:order_group
PatientProgramAttributeModel:patient_program_attribute UserModel:users ProviderModel:provider
DiagnosisAttributeModel:diagnosis_attribute OrderGroupAttributeModel:order_group_attribute
OrderAttributeModel:order_attribute ReferralOrderModel:referral_order
EntityBasisMapModel:datafilter_entity_basis_map"
TABLE_OF_MODEL="CASE SUBSTRING_INDEX(model_class_name, '.', -1)"
for pair in $TABLES; do TABLE_OF_MODEL+=" WHEN '${pair%%:*}' THEN '${pair#*:}'"; done
TABLE_OF_MODEL+=" ELSE '(unknown)' END"

case "$COMMAND" in
  list)
    sql --table "
      SELECT c.id AS conflict, $TABLE_OF_MODEL AS \`table\`, c.identifier AS uuid, c.date_created AS raised,
             (SELECT COUNT(*) FROM receiver_retry_queue r WHERE r.identifier = c.identifier) AS waiting,
             IF(c.is_resolved, 'resolved, not removed', 'open') AS state
      FROM receiver_conflict_queue c ORDER BY c.id;"
    ;;

  resolve)
    table="" ids="" by="" reason=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --table)    table="$2"; shift 2 ;;
        --conflict) ids="$2"; shift 2 ;;
        --by)       by="$2"; shift 2 ;;
        --reason)   reason="$2"; shift 2 ;;
        *) usage ;;
      esac
    done
    [[ "$ids" =~ ^[0-9]+(,[0-9]+)*$ && -n "$by" && -n "$reason" ]] || usage
    if ! [[ "$table" =~ ^[a-z_]+$ ]] || ! grep -qE "(^|[[:space:]])[A-Za-z]+:$table([[:space:]]|$)" <<<"$TABLES"; then
      echo "'$table' is not a table dbsync keeps hashes for" >&2; exit 2
    fi
    ids="$(tr ',' '\n' <<<"$ids" | sort -n -u | paste -sd, -)"

    # The hash updater runs the receiver's own image from the stack's compose and env files, so
    # they must still describe the receiver that is deployed.
    compose=(docker compose -p "$(label project)" --project-directory "$(label project.working_dir)")
    IFS=',' read -r -a files <<<"$(label project.config_files)"
    for f in "${files[@]}"; do compose+=(-f "$f"); done
    IFS=',' read -r -a envfiles <<<"$(label project.environment_file)"
    for f in "${envfiles[@]}"; do [[ -z "$f" ]] || compose+=(--env-file "$f"); done
    service="$(label service)"
    [[ "$("${compose[@]}" config --hash "$service")" == "$service $(label config-hash)" ]] \
      || { echo "the compose and env files no longer describe the deployed $service; resolve with the files it was started from" >&2; exit 1; }

    was_running="$(docker inspect -f '{{.State.Running}}' "$RECEIVER")"
    runner="liberiaemr-hashes-update-$$"
    state=none
    finish() {
      docker rm -f "$runner" >/dev/null 2>&1 || true
      case "$state" in
        resolved) sql "--batch --skip-column-names" "UPDATE receiver_conflict_queue SET is_resolved = 0 WHERE id IN ($ids);" \
                    && echo "conflicts $ids are open again" >&2 \
                    || echo "WARNING: conflicts $ids are marked resolved without their hashes rebuilt; run the same command again" >&2 ;;
        rebuilt)  echo "WARNING: the $table hashes are rebuilt but conflicts $ids are still queued; run the same command again" >&2 ;;
      esac
      [[ "$was_running" != "true" ]] || docker start "$RECEIVER" >/dev/null || echo "WARNING: start $RECEIVER by hand" >&2
    }
    trap finish EXIT
    # A hangup or a cancelled run has to reach that trap, or the conflicts stay marked resolved
    # with their hashes not rebuilt, which no command here would show or undo.
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    echo "stopping the receiver"
    docker stop "$RECEIVER" >/dev/null

    queued="$(sql "--batch --skip-column-names" \
      "SELECT id FROM receiver_conflict_queue WHERE $TABLE_OF_MODEL = '$table' ORDER BY id;" | paste -sd, -)"
    [[ "$queued" == "$ids" ]] || { echo "the conflicts queued for $table are '${queued:-none}', not '$ids'; review them all first" >&2; exit 1; }

    sql "--batch --skip-column-names" "UPDATE receiver_conflict_queue SET is_resolved = 1 WHERE id IN ($ids);"
    state=resolved
    echo "marked conflicts $ids resolved; rebuilding the $table hashes, which scans the whole table"

    started=$SECONDS
    output="$("${compose[@]}" run --rm --no-deps --name "$runner" -e SYNC_HASHES_UPDATE=true \
      -e "SYNC_HASHES_UPDATE_TABLES=$table" -e LOG_LEVEL=INFO "$service" 2>&1 || true)"
    if ! grep -q "Successfully updated entity hashes" <<<"$output"; then
      echo "the hash update did not succeed" >&2
      grep -E "ERROR|Exception|refusing" <<<"$output" | head -10 >&2
      exit 1
    fi
    state=rebuilt
    echo "hashes rebuilt in $((SECONDS - started))s"

    # Written before the rows go, so the decision outlives a failure to remove them.
    record="resolved conflicts $ids in $table by $by ($(id -un)@$(hostname)): $reason"
    logger -t liberiaemr-sync-conflicts "$record" 2>/dev/null || echo "WARNING: could not write to syslog" >&2
    pairs="$(sql "--batch --skip-column-names" "SELECT id, identifier FROM receiver_conflict_queue WHERE id IN ($ids);")"
    sql "--batch --skip-column-names" "DELETE FROM receiver_conflict_queue WHERE id IN ($ids);"
    state=removed
    # Decisions recorded on the Sync conflicts page for these conflicts are now applied.
    match="$(awk -F'\t' 'BEGIN { sep = "" } $2 ~ /^[A-Za-z0-9-]+$/ && $1 ~ /^[0-9]+$/ {
        printf "%s(conflict_id = %s AND identifier = '\''%s'\'')", sep, $1, $2; sep = " OR " }
      END { if (sep == "") printf "FALSE" }' <<<"$pairs")"
    openmrs_sql "UPDATE liberiaemr_sync_conflict_decision SET date_applied = NOW(), apply_error = NULL WHERE date_applied IS NULL AND ($match);" \
      || echo "WARNING: could not mark the page's decisions for conflicts $ids applied" >&2
    echo "$record"
    [[ "$was_running" != "true" ]] || echo "starting the receiver; waiting updates apply on its first retry run, in about two minutes"
    ;;
esac
