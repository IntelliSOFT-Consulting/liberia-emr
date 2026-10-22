# Pediatric Pfizer COVID-19 vaccination

The Immunization sheet of the Liberia EMR data dictionary is the clinical source.
`EMR.IMMZ.DE34` is Pediatric Pfizer COVID-19 dose 1. `EMR.IMMZ.DE35` is dose 2.
Both validation conditions in the dictionary are empty. The rules below are the
literal reading of the labels and descriptions. Anything else in this note is a
product requirement for saving and displaying the record, not a dictionary rule.

## Data dictionary

| ID | Label | Description used |
| --- | --- | --- |
| EMR.IMMZ.DE34 | Pediatric Pfizer COVID-19 dose 1 | Five to (5–11) years at first contact |
| EMR.IMMZ.DE35 | Pediatric Pfizer COVID-19 dose 2 | Twenty eight days (28) after first dose |

Dose 1 can be given on the 5th birthday and through the day before the 12th
birthday. The day before the 5th birthday is too young. The 12th birthday is
too old for a new dose 1.

Dose 2 requires a recorded dose 1. The earliest day is 28 calendar days after
the actual dose 1 date. That day is allowed. The day before it is not. The
dictionary does not repeat the 5–11 age window for dose 2, and dose 2 has no
upper age of its own. A dose 1 given at age 5–11 can be followed by dose 2
after the 12th birthday once 28 days have passed.

There is no booster, no maximum interval, no catch-up grace, and no further
Pediatric Pfizer dose. Adult Pfizer, J&J, and the COVID-19 booster are
unchanged. Pediatric Pfizer is not part of the under-2 routine schedule.

## Product requirements that are not dictionary rules

Duplicate prevention is a data-integrity requirement. A dose already present in
combined history cannot be saved again.

Overdue status is a display requirement for dose 2:

| History | Status |
| --- | --- |
| Dose 1 absent | `WAITING_FOR_PREREQUISITE` |
| Dose 1 present, before 28 days | `WAITING_FOR_INTERVAL` |
| Exactly 28 days after dose 1, dose 2 absent | `DUE` |
| More than 28 days after dose 1, dose 2 absent | `OVERDUE` |
| Dose 2 recorded | `ADMINISTERED` |

`DUE` and `OVERDUE` may both be saved. The dictionary does not say that a late
dose 2 is refused.

## Where a dose is saved

O3 Immunizations (`@openmrs/esm-patient-immunizations-app` 12.3.4) can warn
about a duplicate and still save. Its submit path has no eligibility hook, so
it does not enforce this rule.

The national Immunization form does. Immunization v1.7 adds the two doses to
Vaccine Name and runs `pediatricPfizerAdministrationGate` before save. A
failing validator blocks the save. The gate reads the same consolidated
history as sequencing: completed FHIR Immunizations and national Immunization
encounters. AEFI vaccine answers are not administrations. The same canonical
dose on the same date counts once. Two dates for one dose, or history that
does not load, stays unresolved and the save is blocked.

The form expression passes `patient.id` for the patient whose chart is open.
History is requested for that patient. A record, or a later history page, for
a different patient is unresolved. The encounter processor saves the form for
that same chart patient. Re-saving the encounter that is open does not count
as a second dose; any other record of that dose still does.

The visible Pediatric Pfizer status field shows Due or Overdue. It is not
stored. The dictionary concepts are `${var.concept.national.pediatric-pfizer-covid-19-dose-1.uuid}`
and `${var.concept.national.pediatric-pfizer-covid-19-dose-2.uuid}`.

Immunization v1.6 (`337600b2-9ea3-310a-bbc5-cb2dfa221318`) stays in history as
`var.form.immunization.v1-6.uuid`. v1.7 is `e44cf2d4-169e-3c98-a617-f7d937fbcd74`,
the Initializer derivation of the name Immunization at version 1.7, frozen as
`var.form.immunization.v1-7.uuid`. The current form is v1.8
(`85e6b4f8-620c-3377-82a4-9db35eac1769`), stored as `var.form.immunization.uuid`.
