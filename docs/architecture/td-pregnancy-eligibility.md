# Td pregnancy eligibility

The Liberia EMR Data Dictionary is authoritative. Mercy Kamau's clarification
resolves the eligibility wording: Td is for pregnant women. The dictionary
heading "Vaccination Schedule for Adolescent girls & Women of child bearing aged"
is the target-population context, not the gate. Pregnancy status has to be
validated before Td is given. Sex, age, and that demographic category are not
enough.

This was read from the live dictionary workbook on 2026-10-16.

| Dictionary row | What it contributes |
| --- | --- |
| `EMR.IMMZ.DE36` | Section context only. Not an eligibility rule. |
| `EMR.IMMZ.DE39` TD | Given to pregnant women at first contact. Links to the ANC TT1–TT5 schedule. |
| `EMR.IMMZ.DE40` TD2 | Four weeks after TD1. |
| `EMR.IMMZ.DE41` TD3 | Six months after the previous dose. The parenthetical is the protection period (five years), the same pattern as TD4 (ten years) and TD5 (lifelong). |
| `EMR.IMMZ.DE42` TD4 | One year after TD3. |
| `EMR.IMMZ.DE43` TD5 | One year after TD4. |
| `LBR.EMR.DE.40` Pregnancy status | CIEL 5272. The value set is the trimester of the current pregnancy. |
| `LBR.EMR.DE.41`–`DE.43` | 1st, 2nd, and 3rd trimester. Any one of these confirms pregnancy. |
| `LBR.EMR.DE.56`–`DE.60` | Date of TT1–TT5. The observation value is the administration date. |

There is no separate permanent "Td eligible" flag. A trimester recorded before the
latest delivery belongs to the previous pregnancy and is not reused.

## Pregnancy status

The concept is CIEL 5272 (`var.concept.ciel.pregnancy-status.uuid`), already used
by ANC Initial, ANC Follow-up, and the national ANC form. The current episode is
the one already used for ANC obstetric history: observations after the latest
delivery, on or before the immunization encounter date.

| Latest value in that episode | Result |
| --- | --- |
| 1st, 2nd, or 3rd trimester | Pregnant. Td can proceed to the sequence rules. |
| No observation | Unknown. Td is blocked. Absence is not a recorded "not pregnant" state. |
| Unreadable or unrecognized value | Unknown. Td is blocked. CIEL 1065 Yes and CIEL 1066 No are not answers of this concept in shipped content. |
| Disagreeing values at the same time | Unknown. Td is blocked. |

The dictionary does not define a recordable "not pregnant" answer, so this gate
does not invent one. An ANC visit, female sex, or child-bearing age does not
confirm pregnancy.

## One TT/Td sequence

ANC TT history and immunization Td history are the same doses. Dose 1 uses
`var.concept.national.td.uuid` (there is no `td1` variable).

| Canonical dose | Immunization answer | ANC observation |
| --- | --- | --- |
| 1 | TD | Date of TT1 |
| 2 | TD2 | Date of TT2 |
| 3 | TD3 | Date of TT3 |
| 4 | TD4 | Date of TT4 |
| 5 | TD5 | Date of TT5 |

The same canonical dose on the same administration date counts once, whether it
came from TT, Td, or both. Two different valid dates for one dose block every Td
answer until the history is reconciled. An unreadable date on a mapped dose
blocks Td as unresolved, including when another record for that history has a
valid date. An unreadable record does not replace dates already collected, and
the result does not depend on encounter order. Unreadable history takes
precedence over a date conflict. Other vaccines are ignored and are not blocked
by Td history.

Immunization doses are vaccine-name observations on the Immunization form. That
form has no administration-date question, so the encounter's Monrovia calendar
date is the administration date. TT dates are the observation values, not the
ANC encounter date. Tetanus doses are not cleared by a later delivery.

Intervals use the merged date helper. There is no extra age gate: the dictionary
does not give Td a minimum age. `overdueAfterDays` is null because the
dictionary does not define an overdue grace. A pregnant patient is due, not
overdue, once the previous dose and interval are met.

| Dose | Previous dose | Minimum interval |
| --- | --- | --- |
| TD | None | None. First contact once pregnancy is confirmed. |
| TD2 | TD1-equivalent | 4 weeks |
| TD3 | TD2-equivalent | 6 calendar months |
| TD4 | TD3-equivalent | 1 calendar year |
| TD5 | TD4-equivalent | 1 calendar year |

## What the form does

Immunization form 1.6 adds TD–TD5 to Vaccine Name. Childhood answers stay as
they were: BCG is hidden from age 1, and OPV0 and OPV1 stay limited to age 18
and below (`age > 18`). OPV0 keeps that limit on the answer because the
vaccination section is no longer hidden at `age > 18`, so Td can be recorded
at any age. The explanatory notice uses that same cutoff: it is hidden only
when `age < 18`, so it is shown at age 18 and above. The Td answers are not
hidden. Saving one is rejected unless the helper returns `allowed`.

The helper fails closed when the patient id is missing, the birth or encounter
date is unusable, or pregnancy or tetanus history cannot be loaded. Encounter
pages follow the OpenMRS REST list contract, the same paging style as the
facility list. The first page requests `totalCount=true` with `limit=100` and
`startIndex=0`. Another page is fetched only when that `totalCount` is still
larger than the rows loaded, or when `links` contains an entry with `rel`
`next`. A page of exactly 100 with neither signal is complete. Page length
alone is not a truncation signal. If a later page fails, comes back empty while
another page is still indicated, or `next` is still set after the page cap, the
history is incomplete and Td is blocked. Those cases block Td only.

The sequence helper from the unmerged interval work is not on main and is not
used here. This gate calls the merged `evaluateEligibility` helper for the
dictionary intervals above.

## Technical integration

LE-564's Immunization v1.4 remains a historical Vitamin A form, UUID
`36f41158-2060-399d-959b-f99718b154be`. Current main already published
Immunization v1.5 (`ed2202f0-c074-34ab-bde0-a08468ab3900`) with OPV0 and the
Vitamin A behavior, so LE-565 does not reuse that version. Immunization v1.6, UUID `337600b2-9ea3-310a-bbc5-cb2dfa221318`, is frozen as
`var.form.immunization.v1-6.uuid`. The current form is v1.7. v1.4 and v1.5 are not
republished under a second body.

LE-561 contains overlapping TT/Td canonical-history and interval logic. LE-565
implements that sequence independently because LE-561 is not on main. Reconcile
the two to one source of truth when both land. LE-561 has broader FHIR and
national-form history coverage than this Td-only gate.
