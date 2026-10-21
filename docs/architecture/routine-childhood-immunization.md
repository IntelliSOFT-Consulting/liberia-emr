# LE-559: routine childhood immunization schedule

Starts from origin/main `401fc1a88e502fb2e9a7dfc34191b2afe32c28bd` (merged LE-560).
Policy source: the approved schedule and Mercy/executive clarifications supplied
with LE-559 implementation instructions. No external clinical cutoffs are imported.
The full approved DD was not supplied separately; implementation follows the
explicit decisions in that request.

## Rules

`src/immunizations/routine-schedule.json` in the patient-chart extension is the
version-controlled national policy: canonical dose id, label, due age, upper age,
prerequisite by canonical dose id, minimum interval, and sequence. It does not
contain concept UUIDs. Those UUIDs are runtime config under
`routineImmunizations.vaccineConceptUuids`, supplied by national frontend
configuration as `${var.*}` from `variables.properties`. That same
`routineImmunizations` object is also the sequencing identity map: one
`routine-config.ts`, the historical form list, `fhirDoseMappings`, and the ANC TT
fields sequencing adds. A site package overrides one concept key without
rebuilding the ESM. Schedule policy stays in this JSON file and is not replaced
by sequencing rules. `evaluateEligibility` and `addDateOffset`
from LE-560 are reused unchanged. No second evaluator or new persistence path
is introduced.

| Doses | DOB offset | Required predecessor | Minimum interval | Upper limit |
| --- | --- | --- | --- | --- |
| BCG | Birth | None | None | Strictly below 11 calendar months |
| OPV0 | Birth | None | None | Day 7 inclusive; no catch-up from day 8 |
| OPV1, Penta1, Pneumo1, Rota1 | 42 days | None | None | None specified |
| OPV2 | 70 days | OPV1 | 28 days after actual administration | None specified |
| Penta2, Pneumo2, Rota2 | 70 days | Corresponding dose 1 | None | None specified |
| OPV3, Penta3, Pneumo3 | 98 days | Corresponding dose 2 | None | None specified |
| Malaria1 | 5 calendar months | None | None | None specified |
| Malaria2 | 6 calendar months | None | None | None specified |
| Malaria3 | 7 calendar months | None | None | None specified |
| MCV1, TCV, Yellow Fever | 9 calendar months | None | None | None specified |
| MCV2 | 15 calendar months | MCV1 | None | None specified |
| Malaria4 | 18 calendar months | None | None | None specified |

Malaria doses are age-based only. A missed earlier Malaria dose stays overdue
and does not block a later Malaria dose. MCV means **measles-containing vaccine**.
Other missed doses remain available indefinitely within the approved policy,
subject to prerequisites.
A later recorded dose never hides an earlier missed dose. There are no invented
Rota cutoffs or other elapsed-time intervals.

Calendar-month offsets clamp using LE-560. No completed-years age is used.
DOB remains date-only; timestamps and today's date use `Africa/Monrovia`.
The dashboard updates the clinical day and reloads history every 30 seconds,
revalidates on focus, and offers manual refresh. This is schedule presentation,
not a save-time eligibility check.

The adapter presents LE-560 `NOT_ELIGIBLE` as `OUTSIDE_ELIGIBILITY_WINDOW`.
It exposes eligibleDate = max(scheduledDate, explicit intervalDate). On that
first eligible day it presents DUE, including OPV2 after late OPV1; later days
are OVERDUE. LE-560's generic overdue semantics remain unchanged.

## History

Both complete, paginated collections are required:

- FHIR2 `/Immunization?patient=...`: completed Immunizations, actual
  `occurrenceDateTime`, vaccine coding and protocol dose number.
- REST `/encounter?patient=...`: encounters whose form UUID is one of
  `routineImmunizations.nationalFormUuids`, and whose vaccine-name answer uses
  `routineImmunizations.vaccineQuestionUuid`. National frontend configuration
  lists the frozen Immunization identities v1.0 through v1.6 and
  `${var.form.immunization.uuid}`, the current form (Immunization v1.7). The vaccine-name question
  is `${var.concept.national.vaccine-name.uuid}` on every one of these versions.
  Current form identity alone is not enough: an upgrade that only recognized
  the new form UUID would drop administrations recorded on an older version.
  A site that sets `nationalFormUuids` replaces the whole list. Frontend config
  arrays are not merged element by element, so the site lists every version it
  still wants counted. Current form has no explicit administration-date
  observation, so its encounter datetime is used. Return-date Obs and AEFI
  vaccine mentions are never administration evidence.

The current national form is Immunization v1.7, supplied through
`${var.form.immunization.uuid}`. Accepted historical national forms are v1.0
through v1.6. This change reads all recognized historical national dose answers
but does not expand or redesign that form or change its existing age/return-date
behavior. `normalizeHistory` is the schedule reader. It does not treat ANC
Date-of-TT observations as childhood doses. Sequencing reads the same module
through `consolidateHistory`. A vaccine answer that is not one of these 21
schedule doses stays unresolved for the schedule.

Each normalized dose retains canonical ID, date, internal LE-560 identity,
and source-qualified record IDs. Internal sequence 1 is paired with the unique
**dose-specific** concept UUID; OPV0 is never represented by FHIR sequence zero.
Same canonical dose/day coalesces, preserving all source IDs. Conflicting dates
for one dose require reconciliation before sequencing. Entered-in-error,
not-done and voided records do not count. Invalid dates, absent identity, unknown
coding/sequence, patient mismatch and incomplete loads never imply absence.

Dose-specific national codes map through the configured canonical-dose UUID
table, not through literals in the schedule. Where a sequence is also supplied,
only 1 (single dose-specific concept) or the matching clinical dose number is
accepted. Generic FHIR vaccine codes require an explicit verified mapping under
`@liberiaemr/esm-liberia-patient-chart-extension.routineImmunizations.fhirDoseMappings`:

```json
{
  "code": "verified-vaccine-concept-uuid",
  "system": "",
  "sequenceNumber": 2,
  "canonicalDoseId": "Penta2"
}
```

An empty system matches O3/FHIR2's local UUID coding without a system. Other
systems must match exactly. No display-name guessing or assumed OPV0 numbering
is used. Defaults contain no unverified generic mappings. Deployment must supply
verified mappings for generic concepts used locally; until then those records
produce a visible reconciliation state. Unrelated unknown vaccines conservatively
block availability too, rather than being silently discarded as irrelevant.
Known valid administered doses remain represented. Historical records are never
modified. Remote-history summaries omit sequence and are not used as a substitute.

## UI and duplicate enforcement blocker

One schedule-status table is registered in the existing
`patient-chart-immunizations-dashboard-slot`, alongside the upstream history
components. It distinguishes not yet due, due, overdue, prerequisite/interval
waiting, administered, outside window and unresolved history. It does not copy
the O3 administered-history table or replace the Immunization workspace.

**BLOCKER / follow-up required: authoritative duplicate-save prevention.**
Inspection of published `@openmrs/esm-patient-immunizations-app@12.3.4` confirms
`immunizations-form.workspace.tsx` computes `duplicateDoseWarning`, while its
`onSubmit` calls `savePatientImmunization` without rejecting duplicates. There is
no submit extension hook for combined-source enforcement. The existing national
form and backend have no shared authoritative uniqueness facility either
(see [LE-560 architecture](vaccine-eligibility-le560.md)). The user explicitly
excluded a broad persistence redesign when no safe hook exists.

This implementation detects duplicates in combined history and marks recorded
doses ADMINISTERED/unavailable in the schedule. The normalization helper can
exclude one source-qualified edited record while retaining another duplicate;
it is not wired to upstream saves. Existing writers can still save duplicates.
A frontend schedule or warning does **not** satisfy the ticket's must-prevent
criterion. Follow-up needs authoritative validation covering FHIR and legacy
writes, edit/void handling and concurrency. No claim of enforcement is made.
Re-checked for LE-563 against current main: unchanged. See
[`immunization-history-display.md`](immunization-history-display.md).

## Verification

Focused Node tests cover all 21 dose schedules, exact day/week/month boundaries,
BCG/OPV0 limits, OPV2 actual-date intervals, catch-up, every predecessor, absence
of unspecified cutoffs/intervals, both history sources, coalescing, duplicate/edit
identity, malformed and conflicting history, non-administration exclusions,
explicit generic mappings, Liberia timestamp conversion and complete pagination.
Run the package test script in UTC, Africa/Monrovia and America/Los_Angeles.
TypeScript checks include the component. A live backend/UI test is still needed
to verify deployed permissions, generic code mappings and real record shapes.
