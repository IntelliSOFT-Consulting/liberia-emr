#!/bin/sh
# Applies conflict decisions recorded in the EMR with dbsync's documented procedure ("Updating
# Entity Hashes" in its README). Sourced by docker-entrypoint-receiver.sh, which calls cd_apply
# with the receiver stopped. A table is applied only when all its queued conflicts are decided,
# since dbsync's hash updater refuses otherwise. A failed run reopens the conflicts.

CD_MGMT_CNF=/app/config/mgmt.cnf
CD_OPENMRS_CNF=/app/config/openmrs.cnf
CD_LOG=/opt/eip/hash-update.log

# dbsync's TableToSyncEnum, as in SyncConflictTables and scripts/sync/conflicts.sh.
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

cd_cnf_value() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# Client option files, so no password reaches a process argument.
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
      # As plain as the receiver's own JDBC connections; a MariaDB 11 client demands TLS otherwise.
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

# A trapped signal ends a wait early, so wait until the process is really gone.
cd_wait() {
  while kill -0 "$1" 2>/dev/null; do
    wait "$1" 2>/dev/null || true
  done
}

# HH:MM-HH:MM in UTC, may wrap midnight; the same time at both ends means all day.
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

# Seconds until the window closes; four hours for an all-day window.
cd_seconds_left() {
  from="$(printf '%s' "$SYNC_CONFLICT_WINDOW" | cut -d- -f1)"
  to="$(printf '%s' "$SYNC_CONFLICT_WINDOW" | cut -d- -f2)"
  [ "$from" != "$to" ] || { echo 14400; return; }
  now=$(( $(date -u +%s) % 86400 ))
  # 1HH - 100, because shell arithmetic reads 08 and 09 as bad octal.
  end=$(( (1${to%%:*} - 100) * 3600 + (1${to#*:} - 100) * 60 ))
  echo $(( (end - now + 86400) % 86400 ))
}

cd_table_of_model() {
  expr="CASE SUBSTRING_INDEX(model_class_name, '.', -1)"
  for pair in $CD_TABLES; do expr="$expr WHEN '${pair%%:*}' THEN '${pair#*:}'"; done
  echo "$expr ELSE '' END"
}

# Prints "table<TAB>id,id,..." for each table whose queued conflicts all have an unapplied
# decision, matched by id and record.
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

# Reopens conflicts. Run at start too, to undo a run killed before it could reopen them.
cd_reopen() { # [ids]
  if [ -n "${1:-}" ]; then
    cd_mgmt "UPDATE receiver_conflict_queue SET is_resolved = 0 WHERE id IN ($1)"
  else
    cd_mgmt "UPDATE receiver_conflict_queue SET is_resolved = 0 WHERE is_resolved = 1"
  fi
}

# $1 runs the receiver JVM with extra arguments; it runs as CD_CHILD so a TERM can stop it.
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
  # A hash update that would run into clinic hours is stopped at the end of the window.
  rm -f "$CD_LOG.timeout"
  ( left="$(cd_seconds_left)"; child="$CD_CHILD"
    while [ "$left" -gt 0 ] && kill -0 "$child" 2>/dev/null; do sleep 30; left=$((left - 30)); done
    kill -0 "$child" 2>/dev/null && touch "$CD_LOG.timeout" && kill -TERM "$child" ) &
  watchdog=$!
  cd_wait "$CD_CHILD"
  CD_CHILD=""
  kill "$watchdog" 2>/dev/null || true
  cat "$CD_LOG"

  if grep -q "Successfully updated entity hashes" "$CD_LOG"; then
    # Stamp only once the rows are gone, or a queued conflict would read as undecided.
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

  error="The hash update failed; it is tried again in the next window"
  [ ! -e "$CD_LOG.timeout" ] || error="The hash update did not finish inside the window; it is tried again in the next one"
  cd_log "$error. Conflicts $CD_IDS are open again"
  cd_reopen "$CD_IDS" || cd_log "WARNING: could not reopen conflicts $CD_IDS; they are reopened when the receiver next starts"
  cd_openmrs "UPDATE liberiaemr_sync_conflict_decision SET date_apply_failed = NOW(), apply_error = '$error' WHERE date_applied IS NULL AND ($match)" || true
  CD_IDS=""
  return 1
}
