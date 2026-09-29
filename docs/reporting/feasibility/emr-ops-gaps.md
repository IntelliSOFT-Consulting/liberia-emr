# EMR-Operational indicators: gaps, definitions and sync risk

Companion to [`emr-ops.csv`](emr-ops.csv), which holds one row per indicator (EMR-OPS-001…017)
in the shared feasibility-matrix schema. Source of the indicators: the EMR-Operational
section of *Liberia EMR Indicator.xlsx*. That section has no EMR Priority column, so
`emr_priority` is empty for every row.

Deployment model assumed throughout: every facility and central run their own local
reporting (the ETL, the reports module and any flat tables). Nothing ETL-related is synced.
dbsync pushes facility → central only.

**Result:** 3 `Feasible now` (007, 008, 015), 4 `Feasible with content change` (005, 006,
011, 014), 2 `Needs new data capture` (009, 010), 8 `Not EMR-sourced` (001–004, 012, 013,
016, 017). None of the feasible rows needs a Mamba flat table. All
of them are direct SQL datasets on local system tables inside `liberiaemrreports`.

## What the repo and the pinned upstream versions actually record

Everything here was checked in source at the pinned versions: dbsync `4.0.0`, openmrs-eip
`4.2.0`, authentication `2.3.0` and core `2.8.x`. None of it is inferred from the docs.

| Question | Finding |
| --- | --- |
| Sender state (facility `openmrs_mgmt`) | `debezium_event_queue` (`date_created` TIMESTAMP(3), `table_name`, `identifier`, `operation`, `snapshot`) and `sender_retry_queue` (`date_created`, `date_changed`, `attempt_count`, `exception_type`). Both are **transient**: a row is removed once the message reaches the broker. No history of sent records is kept. |
| Receiver state (central `openmrs_mgmt`) | `receiver_sync_msg` (`date_created` = arrival at the receiver), `receiver_synced_msg` (`date_sent` = sender's `metadata.dateSent`, stamped when it serialised the message; `date_received`), `receiver_retry_queue`, `receiver_conflict_queue`, `site_info`. `receiver_sync_msg` and `receiver_synced_msg` are **transient**: `CleanerProcessor` deletes a synced message once cache eviction and indexing are done. **There is no archive table in 4.0.0.** `sync-eip.md` and `sync-module-evaluation.md` said "synced-message archiving"; corrected by LE-354 (`sync-eip.md` §5.8). |
| Durable per-record receipt time | **The per-entity hash tables at central** (`encounter_hash`, `patient_hash`, `visit_hash`, `obs_hash`, …): `identifier` = entity uuid; `date_created` = `LocalDateTime.now()` when central first applied the record (`OpenmrsLoadProducer`); `date_changed` = the latest update, overwritten each time. |
| Does central keep the facility's `date_created`? | **Yes.** dbsync writes through its own JPA entities: `BaseCreatableEntity` maps `date_created` from the payload, and `BaseChangeableDataEntity` does the same for `date_changed`. The OpenMRS `AuditableInterceptor` is not involved, so central holds the facility values. |
| Facility of origin at central | Not on the replica rows. dbsync keeps `metadata.sourceIdentifier` only inside payloads that are later deleted, and `SyncStatusService` notes that it records no sender on queued or failed records. Use the root of `encounter.location_id` / `visit.location_id`, or `openmrs_identity.patient_link.facility_location_uuid` (the root of the identifier location, set by `IdentityService`). |
| Login events | **Not persisted.** Core writes only the last login as `user_property` `lastLoginTimestamp` (epoch ms, `HibernateContextDAO.setLastLoginTime`). The authentication module 2.3.0 keeps active logins in memory (`UserLoginTracker`) and emits `UserLogin` INFO events with marker `AUTHENTICATION_EVENT`. Its README documents an opt-in log4j2 JDBC appender, which this repo does not configure. No `authentication.*` property is set anywhere in the repo. |
| Audit log | `gp-audit.xml` (content-liberia-national) sets `auditlog.auditingStrategy=ALL` and `auditlog.storeLastStateOfDeletedItems`, **but the auditlog module is not pinned in `distribution/distro.properties`**, so those GPs configure nothing. Even when installed, auditlog records object changes, not logins. |
| DHIS2 | No push exists. `dhis2-export` in the central compose names an image that nothing builds (profile `dhis2`, off). `integration/dhis2/mappings/` is blocked on the MOH. |
| MPI | The CPI service in the liberiaemr module (central only): `openmrs_identity.cpi`, `patient_link` (`patient_uuid`, `cpi_id`, `facility_location_uuid`, `basis`, `national_id`), `cpi_event`, `match_review`. Only the deterministic National ID rule is built. Fellegi–Sunter scoring is not. |

## 1. Gaps (each ready to become a ticket)

1. **Grant the facility EMR DB user read access to the sender management schema (EMR-OPS-005).**
   `distribution/compose/facility/initdb/10-sync-db-users.sh` creates `openmrs_mgmt`, but
   unlike the central script it grants no `SELECT` to `MARIADB_USER`. Grant `SELECT` on
   `debezium_event_queue(date_created, table_name, snapshot)` and on `sender_retry_queue`
   (the metadata columns only), not on the whole schema. The statement also has to be run
   by hand on existing facility databases.
   *Done when* a `liberiaemrreports` dataset at the facility can count queue rows older than 48h.

   **Done differently (LE-354).** The grant goes to the **ETL user**, not the EMR user, because
   reports read only the ETL schema (ADR 0010 decision 6) and the EMR user is the web
   application's credential. `initdb/30-etl-sync-queue-grant.sh` grants column-level `SELECT`
   on the metadata columns of both queues, applied by a self-dropping event once the sender has
   created the tables (MariaDB refuses a column grant on a missing table).
   `sp_mamba_fact_emr_ops_sync_queue` copies the pending rows into
   `mamba_fact_emr_ops_sync_queue` on every ETL run, and `mamba_fact_emr_ops_sync_status` says
   when it sampled them and whether they were readable. A report counts rows with
   `is_snapshot = 0` and `date_created < sampled_at - INTERVAL 48 HOUR`.

2. **Record a sync go-live date per facility (EMR-OPS-005).** The initial snapshot applies
   months of history in one go, and every such record would score as "late". Store the
   date the sender first started for each facility, for example as a GP
   `liberiaemr.sync.goLiveDate` at the facility plus a central lookup keyed by the root
   location uuid. Exclude records whose `date_created` is earlier than that date.

   **Facility half done (LE-354).** Each site package declares `var.site.sync-go-live-date`
   (empty until enrolment) and seeds it as the GP `liberiaemr.sync.goLiveDate`; the ETL copies
   it into `mamba_fact_emr_ops_sync_status.sync_go_live_date`. A GP rather than a runtime
   property, because the ETL reads it in SQL (runtime properties never reach the database),
   and because the site package is the versioned, per-facility source that Initializer
   re-applies on every start. Global properties are not synced, so **central's lookup is still
   open**: it belongs with central's per-facility location content (LE-339), carrying the same
   date per facility root. Until then, the first arrival at central
   (`MIN(<entity>_hash.date_created)` over a facility's records) approximates it.

3. **Facility-side record counts for the true denominator (EMR-OPS-005).** Central sees only
   the records that arrived, so its rate is conditional on arrival. The honest denominator
   is the facility's own count of records created in the period, which is exactly the
   per-entity, per-day count that the `sync-eip.md` §5.5 reconciliation job would produce.
   Build §5.5, or at least publish facility daily counts to central monitoring, and compute
   005 against them. Until then, report central's figure as "of records received".

4. **Done (LE-354).** ~~Correct the "synced-message archiving" claim~~ in
   `docs/architecture/sync-eip.md` and `sync-module-evaluation.md`. dbsync 4.0.0 deletes
   processed messages and has no archive; `sync-eip.md` §5.8 now says so, with the source for
   each table, and names the hash tables as the only durable receipt record.

5. **Define the core minimum dataset (EMR-OPS-006).** Author the per-form CMDS in section 2
   as content, reviewed by the MCH, OPD and TB programme leads. Include a validation check
   in `scripts/validate/` that every concept variable in it resolves.

6. **Persist login events (EMR-OPS-011, and 009's "logged in").** Add a table, for example
   `liberiaemr_login_event (id, user_uuid, event, date_created)`, through the liberiaemr
   liquibase. Configure the log4j2 JDBC appender that the authentication module README
   describes, filtered on the `AUTHENTICATION_EVENT` marker, and ship it in the backend
   image. Keep the table out of `eip.watchedTables`. Set a retention period, because the
   table is personal data. **Spike first:** confirm that an O3 REST session login emits
   `UserLogin` events when no `authentication.scheme` is configured.

7. **Mark trained users (EMR-OPS-009, 012).** Decide with the MOH whether "trained" is
   recorded in the EMR, for example as a person attribute type "EMR training date" on the
   user's person, which syncs so central sees it, or whether it stays in the training
   register. Until then, 009 uses active clinical-role accounts as a proxy denominator.

8. **Install or drop the auditlog module.** `gp-audit.xml` configures a module the
   distribution does not ship, so the "audit logging enabled" control in the global
   properties README is not met. This is not an indicator gap, but it came up here and it
   affects the MOH security controls.

9. **DHIS2 exporter with a transmission log (EMR-OPS-014).** When the exporter is built,
   it must persist each push: org unit, dataset, period, import summary status, counts and
   timestamp. It also needs a per-dataset deadline from the MOH to define "on time".
   Blocked on the MOH mappings.

10. **Probabilistic matching and a review-queue owner (EMR-OPS-007, 015).** Without scoring,
    central catches only exact National ID duplicates, so 007 is a floor and 015 largely
    measures National ID capture. This is already tracked by ADR 0005's open items; these
    indicators depend on it.

11. **Paper-register denominator (EMR-OPS-010).** Choose one source for the "EMR + paper"
    total: a monthly facility tally form, or HMIS OPD attendance pulled from DHIS2 at central.

12. **Optional monitoring for 001/004/017.** A connectivity probe at facilities (blackbox
    exporter, or a heartbeat to central) and gateway access logs with `$request_time` would
    give system proxies. They supplement the register or assessment sources; they do not
    replace them.

## 2. Proposed core minimum dataset (EMR-OPS-006)

**Rule.** An encounter is CMDS-complete when every header check holds **and** every
unconditional CMDS concept for its form has at least one non-voided obs in the encounter.
Conditional fields are left out (for example, IPT dose, which applies only when the woman
is receiving IPT), so the definition stays evaluable in plain SQL.

**Header checks (all clinical encounter types):**

- `encounter.encounter_datetime` is not null and not in the future;
- `encounter.location_id` is set and resolves to this facility's location tree;
- `encounter.visit_id` is set;
- at least one non-voided `encounter_provider`;
- `encounter.form_id` is set, for form-based types;
- the patient has `person.gender`, `person.birthdate` and a non-voided MOH Health Record
  Number.

**Per form.** Key the CMDS on encounter type plus form **name**, not form uuid. The
encounter type alone is not enough, because `Consultation` is shared by the OPD form and
five national forms. The form uuid is not stable either, because it is derived from name
and version, so bumping `version` creates a new form. Concept variables are the
`${var.concept.*}` keys used by the forms.

| Encounter type / form | CMDS concepts (unconditional) | Basis |
| --- | --- | --- |
| ANC Initial Visit / anc-initial | ciel.gravida, ciel.parity, ciel.lmp, national.blood-pressure-systolic, national.blood-pressure-diastolic, ciel.weight-kg, ciel.gestational-age, ciel.pregnancy-status, national.woman-receiving-ipt, ciel.return-visit-date | form `required` flags, minus conditional abnormality descriptions and the health-card date |
| ANC Follow-up Visit / anc-followup | national.blood-pressure-systolic, national.blood-pressure-diastolic, ciel.weight-kg, national.gestational-age-weeks, ciel.pregnancy-status, national.woman-receiving-ipt | form `required` flags, minus conditional ones |
| Labor & Delivery / first_and_second_stage… | national.delivery-method, ciel.systolic-bp, ciel.diastolic-bp | **proposal**: the form has no required fields |
| Labor & Delivery / third_stage… | national.time-at-which-the-baby-was-delivered, national.sex, ciel.weight-kg, national.total-apgar-score, national.blood-loss-amount, national.placenta-status | **proposal**: the form has no required fields |
| Postnatal Visit / pnc-visit (mother) | national.place-of-delivery, pnc.complications, national.general-health-status | **proposal**: the form has no required fields |
| Postnatal Visit / newborn-pnc | mch.newborn-pnc-contact, ciel.weight-kg, ciel.temperature, mch.newborn-pnc-complications | form `required` flags |
| Family Planning / family_planning | mch.fp-client-type, national.counselling-done, national.purpose-of-visit | form `required` flags (method-specific dates are conditional) |
| TB Screening / tb_screening-national | national.contact-of-tb-patient, national.previously-treated-for-tb, national.coughing-2-weeks-or-more, national.night-sweats, national.weight-loss, national.fever, national.swelling-in-any-part-of-the-body, national.date-the-screening-was-conducted, national.result-of-the-sputum-test… | form `required` flags, minus the conditional treatment date and the free-text comment |
| Consultation / aefi-national | national.aefi-vaccine, ciel.vaccine-lot-number, national.date-of-onset-of-the-…, national.complaint-experienced | form `required` flags |
| Consultation / immunization-national | national.vaccine-name, national.return-date-for-the-next-vaccination | **proposal** |
| Consultation / anc-national, pnc-national, family_planning-national | the same concepts as the MCH equivalents above, where the form carries them | **proposal**; confirm whether these national forms stay in use beside the MCH package |
| Consultation / opd_consultation_form | visit-type-opd (patient category), ciel.presenting-complaint, plus at least one non-voided `encounter_diagnosis` | form `required` flags (provider, location and date are covered by the header) plus the diagnosis |
| Triage / triage_form | ebola-screening-result, ciel.temperature, ciel.pulse, ciel.weight | **proposal**: only the Ebola screen and child triage category are required today |

**Why the form flags are not enough on their own.** The form engine already refuses to
submit a form with an empty required field, so completeness on those fields is close to
100% by construction. The value of the CMDS lies in the forms with no required fields
(L&D, mother PNC, the national forms) and in the header checks. The proposed rows must be
signed off by the programme leads before they are used.

**Where the definition should live.** In **content, not code**, so that one definition is
shipped identically to facility and central in the content image and can change without a
module release (ADR 0001, two-artefact model). Proposal: a CSV
`content-packages/content-liberia-national/configuration/reporting/cmds.csv` with columns
`encounter_type_var, form_name, check_kind (header|concept|diagnosis), concept_var, notes`.
`liberiaemrreports` reads it and the SQL dataset joins against it. The final folder and
format follow the reporting ADR that LE-330 owns. If Initializer rejects an unknown
`configuration/` subfolder, place the file beside `configuration/` in the package.

Rejected alternative: concept sets (ConvSet) per form. They would be queryable in SQL
through `concept_set`, but they need OCL/terminology work, they cannot express header or
diagnosis checks, and `validate-content.sh` does not validate the Members column today.

## 3. Facility versus central definition of each feasible row

All of these are direct SQL datasets in `liberiaemrreports`, and none needs a flat table.
The "facility" of a row at central is the root of the location hierarchy above
`encounter.location_id` (or `visit.location_id`). This is the same walk that
`IdentityService.facilityLocation` does.

| Code | Facility (sender) | Central (receiver) |
| --- | --- | --- |
| **005** | *Backlog:* records captured locally but not yet delivered to the broker after 48h. `openmrs_mgmt.debezium_event_queue` + `sender_retry_queue` rows with `date_created < now() - 48h` (and `snapshot = 0`), as a count and as the oldest age. There is no history, so this is a point-in-time stock, sampled at report time. Needs gap 1. | *Timeliness:* of the facility's records created in month M (after its go-live), the share first applied at central within 48h: `TIMESTAMPDIFF(HOUR, e.date_created, h.date_created) <= 48` for `openmrs.encounter e JOIN openmrs_mgmt.encounter_hash h ON h.identifier = e.uuid`, and likewise for `patient`/`patient_hash` and `visit`/`visit_hash`. Evaluate M only after M+48h has passed. The denominator is a lower bound until gap 3 is done. |
| **006** | Encounters in the period with the header checks and the CMDS concepts present ÷ clinical encounters in the period. Authoritative. | The same SQL over replicated rows (obs, encounter, encounter_provider and encounter_diagnosis are all synced). Equal to the facility figure once sync has caught up. The difference between the two is itself a sync-completeness signal. |
| **007** | Probable within-facility duplicates: non-voided patients sharing normalised given name, family name, birthdate and gender, or sharing a non-voided identifier value of the same type ÷ non-voided patients. Merges already done: `person_merge_log`. | Same-facility duplicates the CPI service has linked: primary CPIs with more than one `patient_link` row for the **same** `facility_location_uuid` ÷ primary CPIs. Open `match_review` rows are reported beside the rate. Cross-facility links are the design, not duplicates. |
| **008** | `DATE(date_created) = DATE(encounter_datetime)` ÷ non-voided clinical encounters with `encounter_datetime` in the period. Report the lag distribution (0, 1, 2–7, >7 days) beside it. | Identical, since `date_created` is preserved by dbsync. Encounters not yet synced are missing, so compute it after the backlog clears. |
| **015** | Patients with ≥2 visits who have exactly one non-voided MOH HRN and no voided HRN rows (the identifier never changed) ÷ patients with ≥2 visits. | Persons (primary CPIs) with ≥2 visits across their linked records, whose linked records carry one consistent National ID, or whose links were made on basis `NATIONAL_ID`, ÷ persons with ≥2 visits. |
| **009** (after gap 7) | Trained users with `lastLoginTimestamp` within 30 days **and** ≥1 created row (encounter, obs, patient or visit) within 30 days ÷ trained users. | Activity only (≥1 created row, from the preserved `creator`), because `user_property` is not synced. |
| **011** (after gap 6) | Login events in the week ÷ distinct users with ≥1 login event in the week. | Not meaningful: facility logins are not synced, and they should not be. |
| **014** (after gap 9) | Not applicable: no facility pushes. | Facilities (org units) with a successful import summary for the dataset and period before the deadline ÷ EMR facilities. |

## 4. Risks to the sync pipeline from querying its tables

- **The management schema is dbsync's private liquibase schema, not a contract.** Column
  types have already changed once (`ModifyDateDatatypeChangeSet` in 2025), and a dbsync bump
  can rename or drop tables. Tie every query on `openmrs_mgmt` to the `sync.dbsync` pin, and
  add a CI check that the columns used still exist after a bump.
- **Blocking upgrades and the hash updater.** Receiver upgrades run liquibase changesets
  with `HALT` preconditions and DDL, and conflict resolution runs dbsync's hash updater on
  the decided tables. A long reporting read holds a metadata lock that makes that DDL
  wait. Keep queries short and indexed (`identifier` is the lookup key), run them outside
  `SYNC_CONFLICT_WINDOW`, and use `READ COMMITTED` with a statement timeout.
- **PHI in queue tables.** `receiver_sync_msg`, `receiver_retry_queue`,
  `receiver_conflict_queue` and `receiver_synced_msg` carry `entity_payload`, which is
  clinical content. Central already grants the EMR user `SELECT` on the whole schema for the
  conflicts page. Report datasets must select metadata columns only. Better, use a view or
  column-level grants, and the same at the facility (gap 1).
- **Never write to replicated tables at central.** Any write by a report, ETL or scheduled
  task to a replicated row makes it disagree with its stored hash. The next update from
  the facility is then diverted to `receiver_conflict_queue` and sync for that record stops
  until a person decides. The ETL and report outputs must live in their own schema or tables.
- **Binlog and sync volume at the facility.** Reads create no binlog. ETL or flat-table
  writes do enlarge the binlog that Debezium must read and that retention must hold. Put
  ETL output in a separate schema. It is never in `eip.watchedTables`, so it is not synced,
  which matches the decided model.
- **Shared database I/O.** At both sites the management schema lives on the same MariaDB
  as OpenMRS. A full scan of `obs_hash` (one row per obs) competes with the receiver's
  writes. Aggregate encounter, patient and visit hashes for 005, not obs.
- **Unverified.** Whether core's `lastLoginTimestamp` write on login also bumps
  `users.date_changed`. If it does, every login emits a `USERS` sync event, and a central
  login would update a replicated `users` row and raise conflicts for facility-created
  accounts. Check this during the gap 6 spike. It matters regardless of this indicator.
