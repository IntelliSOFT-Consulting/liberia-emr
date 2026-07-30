# Metadata specification — Maternal Health (ANC / L&D / PNC / FP)

**First go-live scope.** Written *before* the forms, per the build order in
IMPLEMENTATION.md §5. Everything below is implemented by
[`content-packages/content-liberia-mch/`](../../content-packages/content-liberia-mch/).

> Status: **first cut.** Sections marked ⚠ are open and must be closed with the clinical
> team and the DAK before forms are written.

---

## 1. Concepts

Reuse CIEL. Add a local concept only where CIEL has no usable term — a local duplicate of a
CIEL concept fragments reporting and breaks the FHIR and DHIS2 mappings downstream.

### Reused from CIEL

| Concept | Variable | Type |
| --- | --- | --- |
| Last menstrual period | `concept.ciel.lmp.uuid` | Date |
| Estimated date of delivery | `concept.ciel.edd.uuid` | Date |
| Gravida | `concept.ciel.gravida.uuid` | Numeric |
| Parity | `concept.ciel.parity.uuid` | Numeric |
| Gestational age | `concept.ciel.gestational-age.uuid` | Numeric (weeks) |
| Fundal height | `concept.ciel.fundal-height.uuid` | Numeric (cm) |
| Fetal heart rate | `concept.ciel.fetal-heart-rate.uuid` | Numeric (bpm) |
| ANC visit number | `concept.ciel.anc-visit-number.uuid` | Numeric |
| Mode of delivery | `concept.ciel.delivery-mode.uuid` | Coded |
| Birth outcome | `concept.ciel.birth-outcome.uuid` | Coded |
| Family planning method | `concept.ciel.fp-method.uuid` | Coded |

### Declared locally

Partograph observations (no adequate CIEL term found — ⚠ each still needs a CIEL lookup
recorded or an explicit "none exists" note):

| Concept | Type | Range | Units |
| --- | --- | --- | --- |
| Cervical Dilation | Numeric | 0–10 | cm |
| Descent of Fetal Head | Numeric | 0–5 | fifths |
| Uterine Contractions per 10 Minutes | Numeric | 0–10 | contractions |
| Uterine Contraction Duration | Numeric | 0–180 | seconds |
| Amniotic Fluid Character | Coded | — | — |
| Fetal Skull Moulding | Coded | — | — |

⚠ The coded answers for the last two are referenced **by name** and are not yet declared or
mapped. Resolve before load — see the
[concepts README](../../content-packages/content-liberia-mch/configuration/backend_configuration/concepts/README.md).

---

## 2. Identifiers, locations, providers

- **ANC Number** — facility-scoped register number, assigned on ANC enrolment. Declared in
  `content-liberia-national`; ⚠ format pending the MOH identifier specification.
- **MOH Health Record Number** — the primary facility identifier, required.
- Maternity locations are declared per site (`location.maternity.uuid`), tagged
  `Visit Location`, `Admission Location` and `Transfer Location`.
- Providers: the `Midwife` role inherits `Nurse` and adds programme enrolment privileges.

---

## 3. Visit and encounter model

### Visit types

| Visit type | When |
| --- | --- |
| Antenatal Care | Any scheduled antenatal contact |
| Maternity | Presentation in labour through the immediate postpartum stay |
| Outpatient | Family planning and postnatal outpatient contacts |

### Encounter types

| Encounter type | Visit type | Recorded by |
| --- | --- | --- |
| ANC Initial Visit | Antenatal Care | Midwife |
| ANC Follow-up Visit | Antenatal Care | Midwife / Nurse |
| Labour Admission | Maternity | Midwife |
| Partograph Observation | Maternity | Midwife — **serial**, many per visit |
| Delivery | Maternity | Midwife |
| Postnatal Visit | Maternity or Outpatient | Midwife / Nurse |
| Family Planning Visit | Outpatient | Nurse / Midwife |

`Partograph Observation` is the one encounter type with no form: it is written by the
e-partograph ESM, because a serial time-plotted chart is not something the form engine
renders.

---

## 4. Programmes and workflows

| Programme | Workflow | States |
| --- | --- | --- |
| Antenatal Care | ANC Status | Active → Delivered / Lost to Follow-up / Transferred Out |
| Labour and Delivery | — | Enrolment only |
| Postnatal Care | — | Enrolment only |
| Family Planning | FP Status | On Method ↔ Discontinued |

⚠ **Outcome concepts are unset** on all four programmes, pending the clinical decision on
permitted exit outcomes. ⚠ "Lost to follow-up" needs a defined interval before it can be
computed for reporting.

Program states are referenced by patient data. Once a patient has occupied a state it is
permanent — retire, never delete (IMPLEMENTATION.md §9).

---

## 5. Forms

Five schemas, none written yet. See the
[ampathforms README](../../content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/README.md)
for the inventory and the versioning rule (a released schema is historical data: new
version, new UUID, old schema preserved).

---

## 6. Orders

⚠ Not yet specified. Needs: routine ANC laboratory panel, iron/folate and IPTp regimens
with the frequencies from `content-common`, and the referral pathway for obstetric
emergencies.

---

## 7. Reports and indicators

⚠ Indicator definitions pending. The cohort logic is ours and can be written now; only the
DHIS2 data-element mapping is blocked on the MOH
([`integration/dhis2/mappings/`](../../integration/dhis2/mappings/)). Expected set: ANC 1st
visit, ANC 4+ visits, IPTp doses, skilled birth attendance, live births, stillbirths,
PNC within 48 hours, FP new acceptors and continuing users.

---

## 8. Integration mappings

| Target | Status |
| --- | --- |
| FHIR | Profiles to be defined in `integration/fhir/` |
| DHIS2 | ⚠ Blocked on MOH data-element mappings |
| Sync | MCH encounters and programme enrolments ride the standard facility→central push |

---

## Open items summary

1. CIEL mappings for the six partograph concepts.
2. Declare or map the coded answers for amniotic fluid and moulding.
3. Programme outcome concepts.
4. Definition of the lost-to-follow-up interval.
5. ANC Number format from the MOH.
6. Orders section.
7. Indicator definitions.
8. WHO alert/action line geometry confirmed against the DAK.

Items 1–3 block the forms. Item 8 blocks the e-partograph implementation.
