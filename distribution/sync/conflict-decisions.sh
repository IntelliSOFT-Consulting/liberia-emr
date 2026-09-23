#!/bin/sh
# Applies the sync conflict decisions reviewers record in the EMR (Sync conflicts page, at
# central), with dbsync's own procedure: its README, "Conflict Resolution In The Receiver" and
# "Updating Entity Hashes". Sourced by docker-entrypoint-receiver.sh, which calls cd_apply with
# the receiver stopped, inside SYNC_CONFLICT_WINDOW.
#
# For each table whose queued conflicts are ALL decided (dbsync's hash updater refuses a table
# with any unresolved), it marks them resolved, runs the hash updater for those tables, removes
# the rows (they hold the payloads, and dbsync's conflict metric counts every row) and stamps the
# decisions applied. A failed or interrupted run reopens the conflicts and records the failure
# on the decisions, so the next window tries again and the page says why it has not happened.
#
# The receiver's own two accounts are used: the management one for dbsync's tables and the
# OpenMRS one for the decisions table. Neither password reaches a process argument.

CD_MGMT_CNF=/app/config/mgmt.cnf
CD_OPENMRS_CNF=/app/config/openmrs.cnf
CD_LOG=/opt/eip/hash-update.log

# dbsync's table names (TableToSyncEnum) for the model classes it keeps hashes for; the
# module's SyncConflictTables and scripts/sync/conflicts.sh carry the same list.
CD_TABLES="PersonModel:person PatientModel:patient VisitModel:visit EncounterModel:encounter
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

cd_log() {
  echo "conflict decisions: $*"
}

# A value for a MariaDB option file: quoted, with backslashes and quotes escaped.
cd_cnf_value() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# Writes the two client option files (mode 600 under the entrypoint's umask 077).
cd_setup() {
  for which in mgmt openmrs; do
    if [ "$which" = mgmt ]; then user="$MGMT_DB_USER" pw="$MGMT_DB_PASSWORD" file="$CD_MGMT_CNF"
    else user="$OPENMRS_DB_USER" pw="$OPENMRS_DB_PASSWORD" file="$CD_OPENMRS_CNF"; fi
    {
      echo "[client]"
      echo "host=$OPENMRS_DB_HOST"
      echo "port=$OPENMRS_DB_PORT"
      echo "user=$(cd_cnf_value "$user")"
      echo "password=$(cd_cnf_value "$pw")"
      # The same plain connection the receiver's own JDBC datasources make to this database,
      # on the stack's internal network; a MariaDB 11 client otherwise demands TLS.
      echo "skip-ssl"
    } > "$file"
  done
  unset user pw file
}

cd_mgmt() {
  mariadb --defaults-extra-file="$CD_MGMT_CNF" --batch --skip-column-names "$MGMT_DB_NAME" -e "$1"
}

cd_openmrs() {
  mariadb --defaults-extra-file="$CD_OPENMRS_CNF" --batch --skip-column-names "$OPENMRS_DB_NAME" -e "$1"
}

# Waits for a process to end. A signal the shell traps (the entrypoint's check tick) ends a wait
# early with the process still running, so wait again until it is really gone.
cd_wait() {
  while kill -0 "$1" 2>/dev/null; do
    wait "$1" 2>/dev/null || true
  done
}

# SYNC_CONFLICT_WINDOW is HH:MM-HH:MM in UTC, and may wrap past midnight (22:00-04:00). The same
# time at both ends means all day, which QA uses to apply without waiting for the night.
cd_in_window() {
  from="$(printf '%s' "$SYNC_CONFLICT_WINDOW" | cut -d- -f1 | tr -d :)"
  to="$(printf '%s' "$SYNC_CONFLICT_WINDOW" | cut -d- -f2 | tr -d :)"
  now="$(date -u +%H%M)"
  if [ "$from" = "$to" ]; then
    return 0
  elif [ "$from" -lt "$to" ]; then
    [ "$now" -ge "$from" ] && [ "$now" -lt "$to" ]
  else
    [ "$now" -ge "$from" ] || [ "$now" -lt "$to" ]
  fi
}

cd_table_of_model() {
  expr="CASE SUBSTRING_INDEX(model_class_name, '.', -1)"
  for pair in $CD_TABLES; do expr="$expr WHEN '${pair%%:*}' THEN '${pair#*:}'"; done
  echo "$expr ELSE '' END"
}

# Prints "table<TAB>id,id,..." for each table whose queued conflicts all carry a decision that
# is not applied yet. A conflict matches its decision by id and record, never by id alone.
cd_ready() {
  queued="$(cd_mgmt "SELECT id, identifier, $(cd_table_of_model) FROM receiver_conflict_queue ORDER BY id")" || return 1
  [ -n "$queued" ] || return 0
  decided="$(cd_openmrs "SELECT DISTINCT conflict_id, identifier FROM liberiaemr_sync_conflict_decision WHERE date_applied IS NULL")" || return 1
  printf '%s\n--\n%s\n' "$decided" "$queued" | awk -F'\t' '
    $0 == "--" { queue = 1; next }
    !queue { if (NF >= 2) decided[$1 "\t" $2] = 1; next }
    {
      table = $3
      if (table == "" || $2 !~ /^[A-Za-z0-9-]+$/) { blocked[table] = 1; next }
      if (!((($1 "\t" $2) in decided))) { blocked[table] = 1; next }
      if (table in ids) ids[table] = ids[table] "," $1; else ids[table] = $1
      order[++n] = table
    }
    END {
      for (i = 1; i <= n; i++) {
        t = order[i]
        if (!(t in blocked) && !(t in printed)) { print t "\t" ids[t]; printed[t] = 1 }
      }
    }'
}

# SQL matching the decisions for "id<TAB>identifier" lines on stdin.
cd_decision_match() {
  awk -F'\t' 'BEGIN { sep = "" } $2 ~ /^[A-Za-z0-9-]+$/ && $1 ~ /^[0-9]+$/ {
      printf "%s(conflict_id = %s AND identifier = '\''%s'\'')", sep, $1, $2; sep = " OR " }
    END { if (sep == "") printf "FALSE" }'
}

# Puts conflicts back to open. Also run before the receiver starts, which undoes a run that was
# killed before it could reopen them: with the receiver running, a resolved conflict no longer
# holds its record's updates back, and the next one would raise a new, undecided conflict.
cd_reopen() { # [ids]
  if [ -n "${1:-}" ]; then
    cd_mgmt "UPDATE receiver_conflict_queue SET is_resolved = 0 WHERE id IN ($1)"
  else
    cd_mgmt "UPDATE receiver_conflict_queue SET is_resolved = 0 WHERE is_resolved = 1"
  fi
}

# Called with the receiver stopped. $1 is the command that runs the receiver JVM with extra
# arguments; it is started in the background as CD_CHILD so the entrypoint's TERM trap can stop
# it. Returns 0 when there was nothing to do or everything applied.
cd_apply() {
  ready="$(cd_ready)" || { cd_log "could not read the queues; trying again at the next check"; return 1; }
  [ -n "$ready" ] || return 0

  tables="$(printf '%s\n' "$ready" | cut -f1 | paste -sd, -)"
  CD_IDS="$(printf '%s\n' "$ready" | cut -f2 | paste -sd, -)"
  pairs="$(cd_mgmt "SELECT id, identifier FROM receiver_conflict_queue WHERE id IN ($CD_IDS)")"
  match="$(printf '%s\n' "$pairs" | cd_decision_match)"

  cd_log "applying conflicts $CD_IDS in $tables; the receiver is down while dbsync rebuilds the hashes"
  cd_mgmt "UPDATE receiver_conflict_queue SET is_resolved = 1 WHERE id IN ($CD_IDS)" || { CD_IDS=""; return 1; }

  started="$(date +%s)"
  "$1" --hashes.update=true "--hashes.update.tables=$tables" > "$CD_LOG" 2>&1 &
  CD_CHILD=$!
  cd_wait "$CD_CHILD"
  CD_CHILD=""
  cat "$CD_LOG"

  if grep -q "Successfully updated entity hashes" "$CD_LOG"; then
    # Stamped only once the rows are gone: a conflict still queued with its decision stamped
    # would read as undecided and need deciding again. Left unstamped, the next window rebuilds
    # the hashes again (harmless) and removes it.
    if ! cd_mgmt "DELETE FROM receiver_conflict_queue WHERE id IN ($CD_IDS)"; then
      cd_log "the hashes are rebuilt but conflicts $CD_IDS could not be removed; the next window finishes them"
      CD_IDS=""
      return 1
    fi
    cd_openmrs "UPDATE liberiaemr_sync_conflict_decision SET date_applied = NOW(), apply_error = NULL WHERE date_applied IS NULL AND ($match)" \
      || cd_log "WARNING: conflicts $CD_IDS are applied but their decisions could not be stamped applied"
    cd_log "applied conflicts $CD_IDS in $tables in $(( $(date +%s) - started ))s; updates waiting behind them apply on the receiver's first retry run"
    CD_IDS=""
    return 0
  fi

  cd_log "the hash update did not succeed; conflicts $CD_IDS are open again and will be tried in the next window"
  cd_reopen "$CD_IDS" || cd_log "WARNING: could not reopen conflicts $CD_IDS; they are reopened when the receiver next starts"
  cd_openmrs "UPDATE liberiaemr_sync_conflict_decision SET date_apply_failed = NOW(), apply_error = 'The hash update failed; it is tried again in the next window' WHERE date_applied IS NULL AND ($match)" || true
  CD_IDS=""
  return 1
}
