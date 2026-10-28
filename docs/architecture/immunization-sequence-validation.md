# LE-561: immunization dose sequencing and interval validation

O3 Immunizations (`@openmrs/esm-patient-immunizations-app`, pinned at 12.3.4) remains
the vaccine-entry workflow except where the national Immunization form blocks a save.
Pediatric Pfizer uses that form. Dose sequencing does not replace the routine childhood
schedule and does not add a second eligibility engine. It reuses `evaluateEligibility`
and `addDateOffset` from [LE-560](vaccine-eligibility-le560.md). The schedule dashboard
is the separate [LE-559](routine-childhood-immunization.md) policy.

`evaluateSequence` reads consolidated history and returns that evaluator's status.
`canAdminister` is true only for `DUE` or `OVERDUE`. These rules set
`overdueAfterDays` to null, so an eligible dose stays `DUE`. Pediatric Pfizer
dose 2 is the exception: it is `DUE` on its eligible date and `OVERDUE` on
every later day until it is recorded. That mark is not a maximum interval.

| Clinical meaning | Status |
| --- | --- |
| Eligible | `DUE` |
| Already documented | `ADMINISTERED` |
| Predecessor missing | `WAITING_FOR_PREREQUISITE` |
| Minimum interval not reached | `WAITING_FOR_INTERVAL` |
| Before the scheduled age | `NOT_YET_DUE` |
| After an explicit maximum age | `NOT_ELIGIBLE` |
| History cannot be sequenced safely | `UNRESOLVED` |

Where a dose has both a scheduled age and a predecessor interval, `eligibleDate` is
the later of the date of birth plus that age and the predecessor's actual
administration date plus the interval. Months and years use `addDateOffset`
calendar arithmetic. They are not converted to a fixed number of days. A dose with
no stated minimum age uses a zero-day due offset, which means this change does not
add an age gate. It is not a recommendation to give the dose at birth.

## History

Both collections are required. A missing list is `UNRESOLVED` for every dose.
Historical doses from either source count.

- FHIR `Immunization` resources for the patient: `completed` only, and
  `occurrenceDateTime`. Display text is ignored. A coding with no system is the
  OpenMRS concept UUID. A coding with a system is not: it matches only an explicit
  `fhirDoseMappings` entry of `code`, `system`, and `sequenceNumber` to a canonical
  dose ID. `entered-in-error` and `not-done` do not count. Any other status, a missing
  code, a dose-number string, more than one protocol, or a sequence other than
  the clinical sequence or `1` is unresolved. Sequence `1` is accepted on a
  dose-specific concept because that concept is already the dose.
- National Immunization encounters whose form UUID is in runtime
  `routineImmunizations.nationalFormUuids`. National config lists frozen Immunization
  v1.0 through v1.11 and `${var.form.immunization.uuid}`, the current v1.12 form.
  The vaccine-name question is `vaccineQuestionUuid`. The
  form has no administration-date observation, so the encounter datetime is
  the clinical date. Other observations, including the return date, are not
  administrations, so sequencing does not carry the return-date concept UUID.
- ANC encounters whose form UUID is in `ancFormUuids`. Date of TT1–TT5 concepts
  are `ancTtConceptUuids`, keyed by the canonical TD dose. The observation
  value is the administration date. The encounter datetime is not.

Timestamps are converted to the `Africa/Monrovia` calendar date. The same
canonical dose on the same date, from both sources or from TT and TD, counts
once. Two dates for one dose are unresolved for that series. A missing or invalid
administration date on a record already mapped to a dose blocks only that series.
An unknown code is unresolved for every series, because it might be the predecessor. Concept UUIDs
configured in `vaccineConceptUuids` without a sequence rule, including BCG and MCV, do not block
unrelated series. AEFI vaccine answers are not administration evidence.

`src/immunizations/history.ts` is the shared history module. `consolidateHistory` is the
sequencing reader. `normalizeHistory` and `duplicateRecordIds` are the routine-schedule
reader. Neither pages a live server or writes history. There is one `routine-config.ts`
and one `routineImmunizations` object. The schedule reader uses the form list, vaccine
question, concept map, and `fhirDoseMappings`. Sequencing uses those same fields and
also `ancFormUuids` and `ancTtConceptUuids`. A coding with a system matches only a
verified mapping. A coding with no system matches the concept map, and an empty-system
mapping can match it as well.

## Sequence and intervals

Identity is the canonical dose ID in `src/immunizations/sequence-rules.ts`, plus the clinical
sequence number. The OpenMRS concept UUID for that ID comes from runtime `vaccineConceptUuids`.
National values are `${var.*}` entries in `config-national.json`, not literals in the module.

| Dose | Predecessor | Minimum interval | Age |
| --- | --- | --- | --- |
| OPV1 | None | None | None specified |
| OPV2 | OPV1 | 28 days after actual OPV1 | None specified |
| OPV3 | OPV2 | None | None specified |
| Penta2, Pneumo2, Rota2 | Matching dose 1 | None | None specified |
| Penta3, Pneumo3 | Matching dose 2 | None | None specified |
| Malaria2, Malaria3, Malaria4 | The previous malaria dose | None | None specified |
| HPV1 | None | None | 9th birthday through the day before the 14th birthday |
| HPV2 | HPV1 | 6 calendar months | Same window |
| Pediatric Pfizer 1 | None | None | 5th birthday through the day before the 12th birthday |
| Pediatric Pfizer 2 | Pediatric Pfizer 1 | 28 days after the actual dose 1 date | No separate age window |
| TD2 | TD1-equivalent | 4 weeks | None specified |
| TD3 | TD2-equivalent | 6 calendar months | None specified |
| TD4 | TD3-equivalent | 1 calendar year | None specified |
| TD5 | TD4-equivalent | 1 calendar year | None specified |

OPV2's shipped rule has no minimum age. A test supplies a 100-day scheduled age
only to prove that the later of that date and the 28-day interval is used. That
age is not national policy. There is no OPV2-to-OPV3 interval, no Penta, Pneumo,
Rota, or malaria interval, and no Rota or malaria maximum age.

MCV1 and MCV2 concepts exist. The routine schedule requires MCV1 before MCV2.
This sequencing change does not add a second MCV gate and does not invent an MCV
interval. The LE-560 evaluator can express a prerequisite without an interval if a
later sequencing change configures one.

## TT and TD

ANC TT history and TD immunizations are one tetanus-containing sequence.

| Sequence | ANC TT observation | Canonical TD concept |
| --- | --- | --- |
| TT1 ↔ TD | `var.concept.national.date-of-tt1.uuid` | `var.concept.national.td.uuid` |
| TT2 ↔ TD2 | `var.concept.national.date-of-tt2.uuid` | `var.concept.national.td2.uuid` |
| TT3 ↔ TD3 | `var.concept.national.date-of-tt3.uuid` | `var.concept.national.td3.uuid` |
| TT4 ↔ TD4 | `var.concept.national.date-of-tt4.uuid` | `var.concept.national.td4.uuid` |
| TT5 ↔ TD5 | `var.concept.national.date-of-tt5.uuid` | `var.concept.national.td5.uuid` |

Dose 1 uses the concept named TD. There is no `td1` variable, and none is created.
`vaccineConceptUuids.TD1` is that concept. `ancTtConceptUuids.TD1` is Date of TT1.
The same pairing applies through TD5. A site can point either key at an existing concept.

## Duplicates

A target dose already present in consolidated history is `ADMINISTERED` and
cannot be administered again, including when that record is dated after the
evaluation date. This is the eligibility result only.

The O3 immunization workspace in 12.3.4 can show a duplicate warning and still
save. Its submit path has no eligibility hook. FHIR2 does not enforce one row
per patient, vaccine, and dose. Sequencing itself does not add that
enforcement. Pediatric Pfizer dose 1 and dose 2 are the exception recorded on
the national Immunization form, whose validators reject a second save. See
[Pediatric Pfizer COVID-19 vaccination](pediatric-pfizer-covid-vaccination.md).
O3 remains warning-only for every vaccine, including these two doses.

## History display and the ANC Date-of-TT gate (LE-563)

[`immunization-history-display.md`](immunization-history-display.md) covers the chronological,
deduplicated "Previous immunizations" display built from this module's two readers, and the new
symmetric save-time gate on the ANC form's Date-of-TT1–TT5 questions (the Immunization form's
`td_gate` already had one; the ANC side did not). It also re-confirms the duplicate-save blocker
below is unchanged.

## What this is not

This is not the routine childhood schedule. That policy, its due ages, and its
dashboard stay in the LE-559 schedule. Sequencing does not define due ages for
the 6-, 10-, or 14-week contacts, BCG, OPV0, or MCV, and it does not replace
the schedule widget. The two layers share canonical dose identity and history.
