# LE-563: immunization history and record display

Starts from merged LE-559/LE-561/LE-565/Pediatric Pfizer. Mercy's clarification: TT1–TT5 and
TD1–TD5 are directly equivalent by dose (already modeled by `ancTtConceptUuids` since LE-561/565),
and a Td vaccination represented in both ANC and Immunization history is one vaccination event
for eligibility, sequencing, interval validation, and duplicate prevention. This change closes two
remaining gaps against that policy and adds a chronological, deduplicated history display.

## What already existed

`consolidateHistory`/`evaluateSequence` (sequence.ts) already coalesce the same canonical dose on
the same Monrovia calendar date across FHIR, the national Immunization form, and ANC Date-of-TT,
and already surface two different dates for one dose as `UNRESOLVED` rather than guessing. That
part of the canonical-tetanus-history requirement needed no new code.

## Gap 1: the Td gate read only half the history

`decideTdGate` (td-pregnancy.ts) had its own `readTdHistory`, built before `evaluateSequence`
existed, and never reconciled onto it (`td-pregnancy-eligibility.md`'s "Technical integration"
flagged this explicitly). It read only REST national/ANC encounters, never FHIR Immunization
history. A Td dose recorded through the O3 Immunizations workspace (a FHIR `Immunization`
resource) was invisible to this gate, so it could be re-recorded as a second, conflicting
administration through the national Immunization form — the opposite of "must never be counted
twice."

Fix: `decideTdGate` now fetches FHIR history (`sequenceHistoryUrls`/`loadHistory`, the same helper
Pediatric Pfizer uses, moved to `load-history.ts`) and calls `evaluateSequence` for dose identity,
coalescing, and interval evaluation. Pregnancy classification is unchanged and stays a Td-specific
gate layered on top. No form content changed, so no Immunization form version bump was needed.

## Gap 2: ANC Date-of-TT had no symmetric gate

The Immunization form's `vaccine_name` question already rejects saving a Td dose that is already
given, in conflict, or unresolvable (`td_gate`, blocking `js_expression` validators). The ANC
form's Date-of-TT1–TT5 questions had no equivalent: a provider could record a TT date that
duplicated or conflicted with a Td dose already given through the Immunization form, with nothing
to stop the save.

Fix: ANC Form 1.2 (`anc-national.json`) adds one transient gate question per TT field
(`tt1_gate`…`tt5_gate`), each calling the new `ttAdministrationGate(patient.id, 'TD<n>', tt<n>,
vitaminAEditingEncounterUuid())` helper, and a validator on each TT field that fails when its own
gate is `unresolved` or `history-conflict`. `anc-tt.ts` holds the pure decision
(`decideTtGate`); `anc-tt-gate.ts` wires it to OpenMRS REST/FHIR.

This is a **fact-entry gate, not an administration gate**: recording a TT date is documenting when
a dose happened, not deciding to give one now. It therefore:

- does not require pregnancy status (the ANC encounter already establishes that context);
- does not re-validate the Td minimum-interval/prerequisite policy (that policy governs giving a
  dose today, not recording when a past one happened);
- allows saving the same date again (re-confirming a dose already on file is not a conflict, and
  already coalesces to one event);
- blocks only a genuine conflict (a different date already on file for the same canonical dose)
  or a history that cannot be reconciled at all — using the exact same
  `consolidateHistory`/`CONFLICTING_DATES_ISSUE` the Immunization form's gate uses, so both sides
  of the sequence agree.

`routineImmunizations.ancFormUuids` now lists the frozen v1.1 identity
(`var.form.anc-national.v1-1.uuid`) ahead of the current v1.2 identity, the same pattern
`nationalFormUuids` uses for Immunization form versions. `sp_mamba_fact_rmncah_anc_visit.sql`
matches on both ANC form UUIDs for the same reason: matching only the current variable would have
silently dropped historical v1.1 encounters from reporting the moment the form version changed.

## History display

`administeredTimeline` (history.ts) is a new, purely-additive reader for display: it merges
`normalizeHistory`'s 21 routine-schedule doses (real administration dates) with the TD/HPV/
Pediatric Pfizer doses from `consolidateHistory` (the three canonical series `normalizeHistory`
does not cover), reverse-mapped from vaccine concept UUID to canonical dose ID. A Td/TT dose
present in both ANC and Immunization history appears once, not twice, by construction — both
readers already coalesce a same-dose/same-date match before this merge sees it.

Routine-schedule history is not inherently deduplicated, though: `normalizeHistory` flags a
canonical dose that has two different administration dates as an issue, but — unlike
`consolidateHistory` — does not remove the conflicting entries from its own `doses` array.
`administeredTimeline` filters those out itself: a canonical dose that occurs more than once in
`normalized.doses` is omitted from the displayed timeline entirely, under neither date, rather
than guessing which one is right. The conflict still surfaces, the same way a TD/HPV/Pediatric
Pfizer conflict does — the timeline comes back `unresolved: true`, driven by `normalizeHistory`'s
own issue for that record, so the caller knows this patient's history needs reconciliation. A
same-dose/same-date match across sources is unaffected and still coalesces normally.

Entries sort newest-administration-first, with source-qualified record IDs preserved for
provenance/debugging. `normalizeHistory` separately, conservatively marks any vaccine outside its
21-dose schedule as unresolved "for the schedule" (see `routine-childhood-immunization.md`); this
merge drops that specific false-positive for a record the other reader already resolved, without
touching `normalizeHistory` itself or its existing callers.

The existing `RoutineSchedule` extension (`routine-schedule.extension.tsx`) renders this as a
second table, "Previous immunizations," alongside the existing schedule-status table, reusing the
same SWR fetch/refresh (`mutate()`), so a newly saved record reappears the same way the schedule
table already does — no new dashboard registration, no new network round trip.

## Duplicate prevention: still one open blocker

Re-checked against current main and the pinned `@openmrs/esm-patient-immunizations-app@12.3.4`:
Td and Pediatric Pfizer are captured through the national Immunization form, whose
`js_expression` validators authoritatively reject an unsafe save — this is enforcement, not a
warning. Every other vaccine (OPV, Penta, Pneumo, Rota, Malaria, BCG, MCV, TCV, Yellow Fever, HPV)
is still captured through the upstream O3 Immunizations workspace, which computes a duplicate
warning but has no submit-time hook to block the save, and no backend validator or save handler
exists in `modules/liberiaemr` for FHIR `Immunization`/`Obs` to close that gap. This matches the
blocker `routine-childhood-immunization.md` already recorded for LE-559/561, unchanged. No new
hook was invented here, per instruction: the narrowest bounded option identified — a
`org.openmrs.validator`-style component registered against `Obs`/`Encounter` saves, scoped to the
sequenced vaccine concepts — has not been verified safe (it would run on every `Obs` save
platform-wide) and is follow-up work, not implemented in this change.
