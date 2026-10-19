# Vitamin A supplementation

Child Vitamin A on the national Immunization form is a supplement. It is stored as an
Observation under **Supplementary immunization activities** (`EMR.IMMZ.DE50`). It is not a
FHIR Immunization, it is not an answer of CIEL:984, and it has no vaccine dose number.

The Immunization sheet of the Liberia EMR data dictionary is the source of truth, read
2026-10-16. A product clarification is used only where that sheet does not state the rule.
It does not replace a rule the sheet does state.

## Data dictionary

| ID | Label | Type | Optionality | Rule used |
| --- | --- | --- | --- | --- |
| EMR.IMMZ.DE47 | Route | Coding: Oral, intradermal, sub-cutaneous, intramuscular | R | One Route question is shared with the vaccine. Vitamin A defaults it to the existing Oral answer only when no vaccine is selected. |
| EMR.IMMZ.DE48 | Date received | Date | R | Required when a Vitamin A strength is recorded. This is the Date Given. |
| EMR.IMMZ.DE49 | Return Date | Date | R | The existing "Return date for the next vaccination" concept. Calculated for a Vitamin A-only visit. The form still does not mark this question required; that gap predates Vitamin A and is not closed here. |
| EMR.IMMZ.DE50 | Supplementary immunization activities | Coding | R | The observation question. Blue and Red are its answers. |
| EMR.IMMZ.DE51 | Vit.-A.Blue 100,000iu | Code | R | 100,000 IU. Age 6–11 months. The sheet says to block a dose that does not match the child's age. |
| EMR.IMMZ.DE52 | Vit.-A.Red 200,000iu | Code | R | 200,000 IU. Age 12–59 months. Same age-band rule, stated on DE51. |

DE51's validation text is: Blue/100,000 IU for 6–11 months, Red/200,000 IU for 12–59 months,
and the system must block the dose that does not match the child's recorded age.

DE51's description says "10,000iu" and DE52's description says "20,000iu". Those
descriptions are wrong. Blue is 100,000 IU and Red is 200,000 IU. The Red concept
description in content uses 200,000 IU. The Blue concept's existing name already says
100,000 IU; that name and its UUID are unchanged. The wrong dictionary descriptions were
not copied into content.

## Age

Age uses the child's date of birth and calendar months. The 6-month, 12-month and 5th
birthdays are the boundaries. A birthday that falls past the end of a month lands on that
month's last day, including 29 February.

| Age on the date under consideration | Strength |
| --- | --- |
| Before the 6-month birthday | Not eligible |
| From the 6-month birthday until the day before the 12-month birthday | Blue 100,000 IU |
| From the 12-month birthday until the day before the 5th birthday | Red 200,000 IU |
| On the 5th birthday and after | Not eligible |

The strength that may be recorded is the strength for the child's age **on the encounter
date**. Date received must fall inside that same band, on or after birth and on or before
the encounter date. A missed Blue dose is not offered once the child is in the Red band,
even if Date received is backdated into the Blue months.

## Schedule

Blue may be given once in the 6–11 month band. A previous Blue administration blocks
another Blue. A previous Red dose does not make Blue available outside that band.

Red's routine interval is six calendar months after the actual previous Vitamin A
administration date, whether that dose was Blue or Red. It is not 180 days. The day
before that date is not the routine due date. The date itself is.

The first Red dose, including a child who first presents after 12 months and a child whose
Blue dose was missed, is due at the current visit. It is not held to an imaginary earlier
schedule. After a recent Blue dose, Red may be given once the child is in the Red band and
the minimum interval below has elapsed, even when six months have not. Routine Red doses
after that are six calendar months from the Red administration.

Whether a later Red dose may be given between 30 days and six calendar months is not
settled. The dictionary says every six months. The product clarification keeps the routine
at six months and also asks for the 30-day floor, pending the national guideline. This
build allows that early Red dose to be saved and does not call it routinely due.
`VITAMIN_A_RED_REPEAT_ALLOWED_BEFORE_ROUTINE` isolates that choice. It is true today.
Setting it to false blocks the save. Do not treat either reading as confirmed.

## Minimum interval of 30 days

The data dictionary does not state a minimum interval. Mercy Kamau asked for 30 days
between doses, subject to confirmation against the current national guidelines, and said
the routine schedule remains six-monthly.

`VITAMIN_A_MINIMUM_INTERVAL_DAYS` in
`packages/esm-liberia-patient-chart-extension/src/forms/vitamin-a-supplementation.ts` is
that provisional rule. It is a minimum allowed gap, not the routine return interval.
Change that constant when the guideline or the dictionary confirms a different number.
A dose fewer than 30 calendar days after any other Vitamin A administration is blocked.
A dose exactly 30 days later meets the minimum and can still be earlier than the
six-month routine date.

## What is stored

| Field | Concept | Behaviour |
| --- | --- | --- |
| Strength | Supplementary immunization activities = Blue or Red | The wrong colour is hidden and a validator rejects it. Hiding alone is not the control. |
| Date received | Date received (DE48) | Required when a strength is selected. Future dates are rejected. |
| Route | Route = Oral (existing CIEL Oral concept) | Filled only for a Vitamin A-only administration when Route is empty. A vaccine on the same encounter keeps the route that was entered. Not a second Oral concept. |
| Return date | Return date for the next vaccination (DE49) | See below. |

No lot, batch, provider, remarks, or dose number is collected. The dictionary does not
require them for these elements. DE55 batch number belongs to AEFI, not to Vitamin A.

The Immunization form is version 1.6. Initializer derives
`337600b2-9ea3-310a-bbc5-cb2dfa221318`, which is `var.form.immunization.uuid`. The earlier
forms stay in the database. v1.5 (`ed2202f0-c074-34ab-bde0-a08468ab3900`) is the released
predecessor, including its Vitamin A behavior, and is not reused as the current form:

| Version | UUID |
| --- | --- |
| 1.1 | `5ec3f3ef-f63d-3d4a-a828-8a0be01c1fb8` |
| 1.2 | `af9b642f-15d7-3687-812d-9ea2c890cfbd` |
| 1.3 | `c1b0a028-d35d-3f54-a240-c027d51ac1df` |
| 1.4 | `36f41158-2060-399d-959b-f99718b154be` |
| 1.5 | `ed2202f0-c074-34ab-bde0-a08468ab3900` |
| 1.6 | `337600b2-9ea3-310a-bbc5-cb2dfa221318` |

`mamba_fact_nutrition_vitamin_a` counts a Blue observation on any of those versions. It
matches the form name and version, and also the current form variable, because the
Immunization form shares the Consultation encounter type. Historical versions are not
`var.form.*` keys: that check requires a form file still in the package.

## Route

DE47 is one Route question. The national form has one Route field, shared by the vaccine
and by Vitamin A. That field cannot store BCG's intradermal route and Vitamin A's oral
route on the same encounter, and this change does not add a second field.

- Vitamin A only: an empty Route becomes the existing Oral answer. Any other route is rejected.
- Vaccine only: Route is left as entered. Vitamin A does not default it or validate it.
- Vaccine and Vitamin A together: the shared field keeps the vaccine route. It does not
  record Vitamin A's route on its own.

The answer list on that field is still only Oral. A combined visit therefore still cannot
choose Intradermal from this control. That is a pre-existing limit of the shared field.

## Return date

Calculated when the visit has a Vitamin A strength and Date received and no vaccine is
selected. A vaccine on the same encounter keeps whatever return date was entered for the
vaccination. Vitamin A does not replace it and does not clear it.

- After Blue, the return date is the later of the 12-month birthday and Date received plus
  30 days. That is the earliest date Red is allowed. Another Blue is not scheduled.
- After Red, the return date is Date received plus six calendar months.
- No date is produced when that day is not after today, or when it falls on or after the
  5th birthday.

When Vitamin A is the source and those inputs no longer produce a date, the calculated
result is null. Recalculation writes that null, which clears the stale Vitamin A return
date and voids the saved observation. The encounter processor's first pass does not apply
an empty calculate result, so the saved date remains on screen until an input changes.

DE49 is marked required in the dictionary. The form does not require Return date for a
vaccine-only visit. That requiredness gap was already there and is left as it is.

## History

Previous doses are Supplementary immunization activities observations whose answer is Blue
or Red. The administration date is Date received when that observation is on the same
encounter. Older forms did not record Date received; those doses use the encounter date.
A dose with no usable date makes history incomplete, and the form then refuses to save
another dose rather than assuming there were none.

A Vitamin A MedicationRequest or drug order is not an administration. Reporting may still
count a capsule order toward an indicator; that path is not reused here.

While an encounter is being edited, only that encounter's Vitamin A observations are left
out of the prior-dose check. The form passes the encounter UUID from the open patient
form workspace, because the form-engine expression context does not include it. A
different encounter on the same calendar day stays in history and still counts for the
once-only Blue rule and the 30-day gap. If the UUID cannot be read, edit mode does not
drop any dose. Dropping by date would hide the other encounter.

History is loaded through `loadVitaminAAdministrations`. If it cannot be confirmed, including
when 100 or more matching observations are returned, the dose is not saved.

## Where the rules live

`vitamin-a-supplementation.ts` is the date and eligibility logic. The national Immunization
form calls `vitaminACurrentStrength`, `vitaminABlock`, `vitaminAReturnDateValue`,
`vitaminASharedReturnValue`, `vitaminARouteValue`, `vitaminARouteRejected`,
`vitaminAEditingEncounterUuid`, and `loadVitaminAAdministrations`, which are registered
when the patient-chart extension starts.
The form rules do not run unless that extension is the one loaded with the form.
