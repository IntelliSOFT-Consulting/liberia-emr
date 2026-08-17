# Metadata specification — Maternal Health (ANC / L&D / PNC / FP)

**First go-live scope.** Written *before* the forms, per the build order in
IMPLEMENTATION.md §5. Everything below is implemented by
[`content-packages/content-liberia-mch/`](../../content-packages/content-liberia-mch/).

> Status: **first cut.** Sections marked ⚠ are open and must be closed with the clinical
> team and the DAK before forms are written.

Traceability to the DAK lives in
[`../dak/traceability-mch.csv`](../dak/traceability-mch.csv), re-read from the data
dictionary on 2026-08-06 (prior full extract 2026-07-30);
[`../runbooks/dak-to-iniz.md`](../runbooks/dak-to-iniz.md) is the procedure for working it.
**This spec covers a small fraction of what the DAK asks for**: 245 MCH data elements are in
the DAK; the sections below record the decisions taken so far and are not the full scope.

---

## 1. Concepts

Reuse CIEL. Add a local concept only where CIEL has no usable term — a local duplicate of a
CIEL concept fragments reporting and breaks the FHIR and DHIS2 mappings downstream.

### Reused from CIEL

| Concept | Variable | Type |
| --- | --- | --- |
| Last menstrual period | `var.concept.ciel.lmp.uuid` | Date |
| Estimated date of delivery | `var.concept.ciel.edd.uuid` | Date |
| Gravida | `var.concept.ciel.gravida.uuid` | Numeric |
| Parity | `var.concept.ciel.parity.uuid` | Numeric |
| Full-term births | `var.concept.ciel.full-term-births.uuid` | Numeric |
| Preterm births | `var.concept.ciel.preterm-births.uuid` | Numeric |
| Abortions | `var.concept.ciel.abortions.uuid` | Numeric |
| Living children | `var.concept.ciel.living-children.uuid` | Numeric |
| Gestational age | `var.concept.ciel.gestational-age.uuid` | Numeric (weeks) |
| Fundal height | `var.concept.ciel.fundal-height.uuid` | Numeric (cm) |
| Fetal heart rate | `var.concept.ciel.fetal-heart-rate.uuid` | Numeric (bpm) |
| ANC visit number | `var.concept.ciel.anc-visit-number.uuid` | Numeric |
| Mode of delivery | `var.concept.ciel.delivery-mode.uuid` | Coded |
| Birth outcome | `var.concept.ciel.birth-outcome.uuid` | Coded |
| Family planning method | `var.concept.ciel.fp-method.uuid` | Coded |

### ANC obstetric history (PARA)

Obstetric history elements from the ANC tab. Aliases reuse CIEL; no local concepts.

| DAK element | Implemented CIEL | Variable |
| --- | --- | --- |
| `LBR.EMR.DE.1` Gravida | 5624 | `var.concept.ciel.gravida.uuid` |
| `LBR.EMR.DE.2` Last menstrual period (LMP) | 1427 | `var.concept.ciel.lmp.uuid` |
| `LBR.EMR.DE.3` Full-term births (FT) | **160080** | `var.concept.ciel.full-term-births.uuid` |
| `LBR.EMR.DE.4` Preterm births (P) | 160078 | `var.concept.ciel.preterm-births.uuid` |
| `LBR.EMR.DE.5` Abortions (A) | 1823 | `var.concept.ciel.abortions.uuid` |
| `LBR.EMR.DE.6` Living children (LN) | 1825 | `var.concept.ciel.living-children.uuid` |

⚠ The DAK currently states CIEL `162557` for Full-term births. Implementation intentionally
uses CIEL `160080` (“Number of full term pregnancies”) following OCL terminology review and
clinical approval: OCL shows `162557` as total delivered births across outcomes, not
full-term count. Traceability keeps `dak_ciel=162557` and records `concept_uuid_source=CIEL 160080`.

Parity (`var.concept.ciel.parity.uuid` / national Parity) exists in repository metadata for
other programmes (L&D, PNC, FP) but is **not** part of the ANC Initial Form Builder
contract. Capture Gravida, LMP, FT, P, A, and LN only.

### ANC physical examination Colour (`LBR.EMR.DE.7`)

| DAK element | Implemented | Variable | Status |
| --- | --- | --- | --- |
| `LBR.EMR.DE.7` Colour | Existing national Color (Coded Normal/Abnormal) | `var.concept.national.color.uuid` | Runtime confirmed |

Distinct from `LBR.EMR.DE.25` Colour (HGT) (`var.concept.national.colour-hgt.uuid`, Text).
Do not substitute Colour (HGT) for physical-exam Colour.

### ANC prenatal presentation

| DAK element | Implemented | Variable | Status |
| --- | --- | --- | --- |
| `LBR.EMR.DE.24` Presentation | Local MCH coded (traced to CIEL 160090) | `var.concept.mch.fetal-presentation.uuid` | Runtime fallback |

Required clinical answers: Vertex, Breech, Transverse, Oblique, Other. CIEL 160090 is not
present in the local dictionary and national Presentation is Vertex-only, so ANC uses a
self-contained MCH value set. Parent FSN: Fetal Presentation at ANC; short name Presentation.
`Same-as CIEL:160090` was attempted but omitted: without a CIEL concept source, Initializer
rejects the mapping (`Concept Source is required`). Approved CIEL 160090 remains in
traceability. Answer concepts are local only — CIEL answer IDs were not invented. The
national Presentation concept is not used for new MCH forms.

| Answer (UI label) | Variable |
| --- | --- |
| Vertex | `var.concept.mch.presentation-vertex.uuid` |
| Breech | `var.concept.mch.presentation-breech.uuid` |
| Transverse | `var.concept.mch.presentation-transverse.uuid` |
| Oblique | `var.concept.mch.presentation-oblique.uuid` |
| Other | `var.concept.mch.presentation-other.uuid` |

### ANC IPT model

Signed dictionary semantics (preserve; do not replace with Administered/Deferred):

1. Woman receiving IPT? → Boolean (true / false)
2. If true → IPT dose administered → 1st / 2nd / 3rd / 4th
3. If false and deferred → IPTp deferral reason → Malaria treatment initiated

| Element | Home | Variable |
| --- | --- | --- |
| Woman receiving IPT (`LBR.EMR.DE.53`) | Local MCH Boolean fallback | `var.concept.mch.woman-receiving-ipt.uuid` |
| IPT dose administered (`LBR.EMR.DE.48`) | New MCH coded question | `var.concept.mch.ipt-dose-administered.uuid` |
| 1st IPT dose | New MCH answer | `var.concept.mch.1st-ipt-dose.uuid` |
| 2nd IPT dose | New MCH answer | `var.concept.mch.2nd-ipt-dose.uuid` |
| 3rd IPT dose | New MCH answer | `var.concept.mch.3rd-ipt-dose.uuid` |
| 4th IPT dose | New MCH answer | `var.concept.mch.4th-ipt-dose.uuid` |
| IPTp deferral reason | New MCH coded question | `var.concept.mch.iptp-deferral-reason.uuid` |
| Malaria treatment initiated | New MCH answer | `var.concept.mch.iptp-deferred-malaria-treatment.uuid` |
| LLIN received at ANC (`LBR.EMR.DE.54`) | Local MCH Boolean fallback | `var.concept.mch.llin-received-at-anc.uuid` |

National Woman receiving IPT / LLIN received at ANC Yes/No concepts are left unchanged and
are not used for new MCH ANC forms (they fail to load without CIEL Yes/No). FSN for the IPT
Boolean is `Woman Receiving IPT at ANC`; for LLIN `LLIN Received During ANC Contact`. Form
Builder labels stay `Woman receiving IPT` and `LLIN received at ANC`.

The national IPT dose question (1st / 2nd / 3rd+) is left unchanged and is not used for the
new MCH ANC forms. The MCH dose value set is entirely self-contained (no national answer
UUID references) because `concepts-mch.csv` is processed before `concepts-national.csv`.
FSNs use the `… at ANC` / `IPTp …` wording to avoid colliding with national FSNs; short
names and Form Builder labels stay clinically concise (`IPT dose administered`,
`1st IPT dose`, …). Do not reuse national `3rd IPT dose+` for exact 3rd. No additional
deferral reasons in this increment.

Fatima acceptance representation: Woman receiving IPT = false; IPTp deferral reason = Malaria
treatment initiated. The ANC Initial schema conditionally requires the dose when true and the
deferral reason when false.

### Pregnant Woman Health Card

| DAK element | Implemented | Variable |
| --- | --- | --- |
| `LBR.EMR.DE.62` Issue date | Local MCH Date | `var.concept.mch.health-card-issue-date.uuid` |

No other health-card concepts in this increment (name, address, clinic, age, record number
remain outside concept metadata).

### Form Builder contract (ANC observation forms)

| Area | Use |
| --- | --- |
| Obstetric history | Gravida, LMP, Full-term births, Preterm births, Abortions, Living children — **no Parity row** |
| Physical exam Colour (`DE.7`) | National `Color` + national Normal / Abnormal — not Colour (HGT) |
| Heart / Lungs / Breasts / Nipples / Abdomen / Extremities / Pelvic examination / Explain abnormalities | Existing national questions + national Normal / Abnormal |
| Colour (HGT) (`DE.25`) | National Text — prenatal/HGT only; do not use for physical-exam Colour |
| SBP / DBP / Weight | National Blood Pressure (Systolic/Diastolic) / Weight (kg) |
| Gestational age / Fundal height / Fetal heart tone | Prefer existing national equivalents at Form Builder time if MCH CIEL aliases are absent from the local dictionary |
| Other findings / Routine drugs / Treatment remarks | Existing national text (drugs/remarks supplemental only) |
| Trimester | Existing national Pregnancy status question/value set — do **not** alias CIEL 5272 |
| Woman receiving IPT / LLIN received at ANC | Local MCH Boolean fallbacks below |
| Presentation | Local MCH value set — do **not** use national Vertex-only Presentation |

### Declared locally

ANC IPT / LLIN / presentation / health-card concepts:

| Concept (FSN) | Type | Answers / notes |
| --- | --- | --- |
| Woman Receiving IPT at ANC | Boolean | signed DE.53 Boolean semantics |
| LLIN Received During ANC Contact | Boolean | signed DE.54 Boolean semantics |
| IPTp Dose Administered at ANC | Coded | MCH 1st–4th only |
| First / Second / Third / Fourth IPTp Dose at ANC | N/A | answers |
| IPTp deferral reason | Coded | Malaria treatment initiated |
| Malaria treatment initiated | N/A | answer |
| Fetal Presentation at ANC | Coded | Vertex; Breech; Transverse; Oblique; Other (CIEL 160090 traced in docs only) |
| Vertex / Breech / Transverse / Oblique / Other Fetal Presentation at ANC | N/A | answers; no CIEL answer mappings |
| Pregnant Woman Health Card Issue Date | Date | — |

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

Updated against the DAK read on 2026-08-06 — see
[`../dak/README.md`](../dak/README.md) for what that read found.

1. CIEL mappings for the six partograph concepts. **The DAK cannot supply these**: it has no
   partograph and no intrapartum monitoring elements at all. Look them up in OCL directly.
2. Declare or map the coded answers for amniotic fluid and moulding — same position as item 1.
3. Programme outcome concepts. **The DAK has no enrolment or exit model**, so this is a
   clinical decision, not an extraction.
4. Definition of the lost-to-follow-up interval. The DAK enumerates ANC visits 1st–4th
   (`LBR.EMR.DE.43`–`.47`) but gives no interval.
5. ANC Number format from the MOH.
6. Orders section.
7. Indicator definitions.
8. WHO alert/action line geometry. **Not in the DAK.** Either the DAK gains a partograph
   section or it is recorded that WHO SMART Guidelines govern the partograph instead — that
   decision is now the blocker, not the lookup.
9. Decide and record the remaining `pending` DAK elements. This is the bulk of the remaining
   MCH metadata work and none of it is represented in the sections above.
10. Two DAK mappings are wrong at source (`LBR.LD.DE.81`, `EMR.FP.DE10`) and two pairs of
    elements are duplicated (`LBR.LD.DE.12`/`.95`, `LBR.LD.DE.45`/`.99`). Raise with whoever
    maintains the sheet. The ANC Full-term births DAK claim (`162557` vs implemented
    `160080`) is a related source discrepancy already resolved in metadata.
11. ~~Parity on the ANC Initial form.~~ Closed for Form Builder: ANC captures Gravida / LMP /
    FT / P / A / LN only. Repository Parity concepts remain for L&D / PNC / FP; they are not
    selected on the ANC observation forms.
12. **Decision on whether EDD is derived from LMP or separately recorded.** EDD is declared
    here; the DAK has no EDD data element.
13. **Review of `LBR.LD.DE.21 Intact` as a coded answer under Perineum**
    (`LBR.LD.DE.20`), including the full Perineum answer set (Intact / Episiotomy /
    Laceration). Source row is structurally misaligned and needs correction plus terminology
    and clinical approval.
14. ~~Runtime confirmation that CIEL 160090 Presentation exposes Vertex / Breech /
    Transverse / Oblique / Other.~~ Closed: local MCH Presentation value set created;
    CIEL 160090 retained in traceability (Same-as omitted until CIEL source exists);
    answer CIEL IDs not invented.
15. ~~OpenMRS fully-specified-name collision risk~~ between national and MCH IPT dose
    concepts. Closed: MCH FSNs use distinct `IPTp … at ANC` wording; short names remain
    concise for Form Builder labels.

Items 1–3 block the forms. Item 8 blocks the e-partograph implementation. Item 9 blocks any
claim that MCH is specified.
