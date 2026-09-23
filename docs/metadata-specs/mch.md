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

Obstetric history elements from the ANC tab, identifiers read from the live sheet on
2026-09-18. Aliases reuse CIEL; no local concepts. All seven carry Optionality `R` and are
required on ANC Initial v1.2.

| DAK element | Implemented CIEL | Variable |
| --- | --- | --- |
| `LBR.EMR.DE.1` Parity | 1053 | `var.concept.ciel.parity.uuid` |
| `LBR.EMR.DE.2` Gravida | 5624 | `var.concept.ciel.gravida.uuid` |
| `LBR.EMR.DE.3` Last menstrual period (LMP) | 1427 | `var.concept.ciel.lmp.uuid` |
| `LBR.EMR.DE.4` Full-term births (FT) | **160080** | `var.concept.ciel.full-term-births.uuid` |
| `LBR.EMR.DE.5` Preterm births (P) | 160078 | `var.concept.ciel.preterm-births.uuid` |
| `LBR.EMR.DE.6` Abortions (A) | 1823 | `var.concept.ciel.abortions.uuid` |
| `LBR.EMR.DE.7` Living children (LN) | 1825 | `var.concept.ciel.living-children.uuid` |

⚠ The DAK currently states CIEL `162557` for Full-term births. Implementation intentionally
uses CIEL `160080` (“Number of full term pregnancies”) following OCL terminology review and
clinical approval: OCL shows `162557` as total delivered births across outcomes, not
full-term count. Traceability keeps `dak_ciel=162557` and records `concept_uuid_source=CIEL 160080`.

Parity (`var.concept.ciel.parity.uuid`, CIEL 1053) is **`LBR.EMR.DE.1` on the ANC sheet** of
the live Liberia EMR data dictionary, read 2026-09-18, carrying **Optionality `R`** and the
validation `Value >= 0 and <= Gravida`. It is captured in ANC Initial v1.2 as **required**,
alongside Gravida, LMP, FT, P, A and LN, which the same sheet also marks `R`. It reuses the
CIEL concept already used by L&D (`LBR.LD.DE.9`), PNC (`EMR.PND.DE4`) and FP
(`EMR.FP.DE12`) — no new concept and no local duplicate.

Requiredness is expressed as plain `"required": true`; no conditional-required construct is
needed. The engine's save gate (`validateForm`) filters on
`!isHidden && !isParentHidden && !isDisabled` *before* it walks a field's validators, and the
`required` check is itself a validator (`form_field`, appended to every non-group field by the
schema processor). So while Gravida is 1 and Parity is disabled, the mandatory check is never
evaluated and no spurious "Field is mandatory" appears — yet the obs is still submitted,
because obs collection filters only on `isHidden`. From Gravida 2 the field is enabled and a
blank Parity blocks Save with the error attributed to Parity.

The form holds Parity to `Parity >= 0`, `Parity = FT + P` and `Parity <= Gravida - 1`. The
lower bound is an explicit `js_expression` validator *in addition to* `questionOptions.min`,
which the engine does enforce for `number` rendering (`form_field` → "Value must be greater
than 0"). Both fire for a negative value; the explicit validator is listed first in the schema
and the appended `form_field` validator last, so the clinical message
"Parity cannot be less than 0." is the one shown.

Living children is held to `Living children <= Parity` by two mutually exclusive validators.
When Parity has a value the comparison is against **the entered Parity**, so a provider who
types a Parity lower than FT + P sees the conflict flagged on Living children as well as on
Parity, rather than only on Parity. When Parity is blank the rule falls back to
`Living children <= FT + P`, the effective parity, so an incomplete record cannot bypass the
constraint while the provider is still filling the section. The fallback names Full-term births and Preterm births in its message
rather than Parity, because there is no Parity value on screen to reconcile against. Gating
the rule on Parity alone, with no fallback, was rejected: it made the clinical constraint
opt-in. When `Gravida = 1` the field is pinned to 0 by
`questionOptions.calculate.calculateExpression` (`gravida === 1 ? 0 : myValue`) and made
read-only by `disabled.disableWhenExpression` (`gravida === 1`), which both records the
clinically correct 0 for a primigravida and overwrites any Parity typed before Gravida was
corrected. Hiding it instead was rejected: a hidden obs is dropped (or voided on edit) by the
form engine, so Parity would be absent rather than 0.

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

Required clinical answers: Vertex, Breech, Transverse, Oblique, Other.

National Presentation is Vertex-only, so ANC uses a self-contained MCH value set. Parent FSN:
Fetal Presentation at ANC; short name `Fetal presentation` (disambiguated from the national
`Presentation`). `Same-as CIEL:160090` was attempted but omitted: without a CIEL concept
source, Initializer rejects the mapping (`Concept Source is required`) — see open item 19 for
why no CIEL source reaches the runtime. Answer concepts are local only — CIEL answer IDs were
not invented. The national Presentation concept is not used for new MCH forms.

⚠ **The pinned export still does not contain 160090.** It was added to collection *HEAD* on
2026-08-18, but `distro.properties` pins `ocl.collection.version=1.0.1` and the build fetches
a *released* version. Until a new version is cut and that pin is bumped (open item 17), every
build behaves exactly as before.

**CIEL 160090 was added to the `LIB/mch` collection on 2026-08-18**, together with its 12
CIEL answer concepts. That closes the availability question and opens a harder one, because
**160090 is not a drop-in replacement for the local value set**:

| Approved Liberian answer | CIEL 160090 equivalent |
| --- | --- |
| Vertex | `160091 Vertex presentation` — typed `Finding/Boolean` |
| Breech | `146922 Breech presentation` |
| Transverse | ⚠ collapsed with Oblique into `112259 Transverse or oblique fetal presentation` |
| Oblique | ⚠ same concept as Transverse — the two cannot be told apart |
| Other | ⚠ no equivalent |

CIEL also carries 8 answers the DAK does not ask for (Compound, Mentum, Face or brow, Cord,
Frank breech, Occiput anterior, Brow, Face, Footling breech). So migrating onto 160090 means
losing the Transverse/Oblique distinction and "Other", and showing clinicians a 12-item list.

⚠ **The `LIB/mch` collection carries no mappings at all** — 825 concepts, 0 mappings — so the
Q-AND-A links between 160090 and those answers are absent from the export. Even after the
import, 160090 loads as a coded question with no answers attached, and content still has to
declare the answer set itself. See open item 19.

The realistic options are therefore: keep the local value set and carry a `Same as` mapping to
160090 once the collection carries mappings, or accept CIEL's coarser answer set. Either way,
every presentation obs already recorded against the local value set needs a data migration if
the concept changes, because concepts are append-only in production
([IMPLEMENTATION.md §9](../../IMPLEMENTATION.md)).

| Answer (UI label) | Short name | Variable |
| --- | --- | --- |
| Vertex | Vertex presentation | `var.concept.mch.presentation-vertex.uuid` |
| Breech | Breech presentation | `var.concept.mch.presentation-breech.uuid` |
| Transverse | Transverse presentation | `var.concept.mch.presentation-transverse.uuid` |
| Oblique | Oblique presentation | `var.concept.mch.presentation-oblique.uuid` |
| Other | Other presentation | `var.concept.mch.presentation-other.uuid` |

Short names carry the `… presentation` suffix so Form Builder search does not return two
entries rendering as the identical label — national `concepts-national.csv` already has
`Vertex` and `Presentation` as fully specified names.

### ANC IPT model

Signed dictionary semantics (preserve; do not replace with Administered/Deferred):

1. Woman receiving IPT? → coded Yes / No (CIEL 1065 / 1066)
2. If Yes → IPT dose administered → 1st / 2nd / 3rd / 4th
3. If No and deferred → IPTp deferral reason → Malaria treatment initiated (optional)

| Element | Home | Variable |
| --- | --- | --- |
| Woman receiving IPT (`LBR.EMR.DE.53`) | Existing national coded Yes/No | `var.concept.national.woman-receiving-ipt.uuid` |
| IPT dose administered (`LBR.EMR.DE.48`) | New MCH coded question | `var.concept.mch.ipt-dose-administered.uuid` |
| 1st IPT dose | New MCH answer | `var.concept.mch.1st-ipt-dose.uuid` |
| 2nd IPT dose | New MCH answer | `var.concept.mch.2nd-ipt-dose.uuid` |
| 3rd IPT dose | New MCH answer | `var.concept.mch.3rd-ipt-dose.uuid` |
| 4th IPT dose | New MCH answer | `var.concept.mch.4th-ipt-dose.uuid` |
| IPTp deferral reason | New MCH coded question | `var.concept.mch.iptp-deferral-reason.uuid` |
| Malaria treatment initiated | New MCH answer | `var.concept.mch.iptp-deferred-malaria-treatment.uuid` |
| LLIN received at ANC (`LBR.EMR.DE.54`) | Existing national coded Yes/No | `var.concept.national.llin-received-at-anc.uuid` |

**No local Boolean duplicates.** Earlier drafts declared MCH Boolean concepts for Woman
receiving IPT and LLIN received at ANC on the premise that the national coded questions
"do not load (missing CIEL Yes/No)". That premise was wrong: CIEL **1065** (Yes) and **1066**
(No) are both present in `lib-mch-ciel-head.zip`, and the national questions already carry
them as answers. The Boolean fallbacks would not have worked in any case — OpenMRS stores a
Boolean obs by resolving `ConceptService.getTrueConcept()` / `getFalseConcept()`, which read
the `concept.true` / `concept.false` global properties; nothing in this repo sets either, so
the obs would have been rejected on save and the whole encounter POST would have failed.
Both MCH Boolean concepts have been removed. **Do not reintroduce them.** The LLIN Boolean
was also a local duplicate of CIEL 160428 with no `Same as mappings`, which would have
silently zeroed any DHIS2/FHIR LLIN indicator built on 160428.

⚠ **The DAK's CIEL 160428 for DE.54 is a source error, not a missing term.** Checked against
CIEL on 2026-08-18: 160428 is `Long-lasting insecticidal net` (**Misc / N/A**) — the commodity
itself, not a question about whether one was received. Mapping our Yes/No question `Same as
CIEL:160428` would assert that the question *is* a bednet. It was deliberately **not** added to
the collection. No `Same as mappings` is owed here; raise the mismapping with whoever maintains
the DAK sheet, alongside the DE.21 Weight error (`165379` is *total weight gain during current
pregnancy*, not body weight). Both are the same class of defect as `LBR.LD.DE.81` and
`EMR.FP.DE10`.

The national IPT dose question (1st / 2nd / 3rd+) is left unchanged and is not used for the
new MCH ANC forms — it has no exact 4th answer, and `3rd IPT dose+` must not be reused for
exact 3rd. The MCH dose value set is entirely self-contained (no national answer UUID
references) because `concepts-mch.csv` is processed before `concepts-national.csv`. FSNs use
the `… at ANC` / `IPTp …` wording to avoid colliding with national FSNs, and **short names
carry the same disambiguation** (`IPTp dose administered`, `1st IPTp dose`, …) so Form
Builder search does not return two entries with identical labels — `concepts-national.csv`
already has `IPT dose administered`, `1st IPT dose` and `2nd IPT dose` as fully specified
names. No additional deferral reasons in this increment.

**IPTp deferral reason is optional, deliberately.** The answer set holds one clinically
approved reason (Malaria treatment initiated), but IPT is also legitimately not given when
gestational age is below 13 weeks, when the schedule is already complete, on SP stock-out,
or on documented sulfa allergy. Making the question mandatory whenever Woman receiving IPT =
No would force clinicians to record a reason that is false, and that value would flow into
the national IPT dataset as a real observation. Extend the answer set with the clinical team
**before** making it required.

Fatima acceptance representation: Woman receiving IPT = No; IPTp deferral reason = Malaria
treatment initiated. The ANC Initial schema conditionally requires the dose when Yes, and
offers (but does not require) the deferral reason when No.

### Pregnant Woman Health Card

| DAK element | Implemented | Variable |
| --- | --- | --- |
| `LBR.EMR.DE.62` Issue date | Local MCH Date | `var.concept.mch.health-card-issue-date.uuid` |

No other health-card concepts in this increment (name, address, clinic, age, record number
remain outside concept metadata).

### Newborn PNC terminology

Newborn PNC uses a dedicated contact classification. It does **not** reuse maternal `Post-partum care` or the maternal PPC1–PPC4 concepts.

| Newborn contact answer | Variable |
| --- | --- |
| PNC 1: Received within 24 hours | `var.concept.mch.pnc-1-received-within-24hrs.uuid` |
| PNC 2: Received within 7 days | `var.concept.mch.pnc-2-received-within-7-days.uuid` |
| PNC 3: Received within 28 days | `var.concept.mch.pnc-3-received-within-28-days.uuid` |
| PNC 4: Received within 42 days | `var.concept.mch.pnc-4-received-within-42-days.uuid` |

The parent is `Newborn Postnatal Contact` (`var.concept.mch.newborn-pnc-contact.uuid`). PNC 4 is the 42-day contact, which is the six-week contact for later Form Builder static vaccine reminders.

`Newborn Postnatal Complications` (`var.concept.mch.newborn-pnc-complications.uuid`) is a coded question whose answer set preserves the live PNC data dictionary wording and exact 17-answer DAK order:

1. None (CIEL 1107)
2. Noisy breathing (grunting, stridor) — `var.concept.mch.noisy-breathing.uuid` (Local MCH)
3. Cyanosis (CIEL 143050)
4. Slow breathing, gasping, apnoea — `var.concept.mch.slow-breathing-gasping-apnoea.uuid` (Local MCH)
5. Flaring of the nostrils with each breath — `var.concept.mch.flaring-of-nostrils.uuid` (Local MCH)
6. Not able to feed at all or not feeding well — `var.concept.mch.not-able-to-feed.uuid` (Local MCH)
7. Fits or convulsions (CIEL 143388 `Convulsions in the newborn`)
8. Abdominal distension (CIEL 150915)
9. Fast breathing (breathing rate ≥ 60/min) — `var.concept.mch.fast-breathing.uuid` (Local MCH)
10. Severe chest in-drawing — `var.concept.mch.severe-chest-indrawing.uuid` (Local MCH)
11. Movement only when stimulated or no movement at all — `var.concept.mch.movement-only-when-stimulated.uuid` (Local MCH)
12. Draining purulent discharge from stump or cut — `var.concept.mch.draining-purulent-discharge-stump-cut.uuid` (Local MCH)
13. Bleeding from stump or cut — `var.concept.mch.bleeding-from-stump-cut.uuid` (Local MCH)
14. Fever/high body temperature (≥ 37.5 °C) (CIEL 140238)
15. Low body temperature (< 35.5 °C) (CIEL 137998 `Hypothermia of newborn`)
16. Any jaundice in the first 24 hrs of life — `var.concept.mch.jaundice-first-24hrs.uuid` (Local MCH)
17. Other (specify) (CIEL 5622)

None (CIEL 1107), Cyanosis (CIEL 143050), Convulsions in the newborn (CIEL 143388), Abdominal distension (CIEL 150915), Fever (CIEL 140238), Hypothermia of newborn (CIEL 137998), and Other (CIEL 5622) reuse verified CIEL concepts. The 10 remaining answers are local MCH `Misc / N/A` concepts created because no exact/clinically equivalent CIEL term exists. `Other newborn complication details` (`var.concept.mch.other-newborn-complication-details.uuid`) is a companion Question/Text concept for free text when Other is selected.

The numeric temperature `<36.5 °C` hypothermia threshold is implemented as a Form Engine non-blocking warning rule, distinct from the stored DAK coded danger sign `Low body temperature (< 35.5 °C)`. `Any jaundice in the first 24 hrs of life` triggers an urgent visual markdown alert for pathological jaundice. Existing national concepts are retained for Received Kangaroo care (conditionally displayed when birth weight < 2.5 kg), Chlorhexidine administration (Before/After 24hrs), Nevirapine start date, and Complications Identified and Managed. Standard non-obs markdown components provide static PNC1 (BCG before discharge) and PNC4 (6-week vaccines) immunization reminders.

For the pre-deployment runtime inventory requirement, see [Legacy national PNC form superseded](#legacy-national-pnc-form-superseded).

### Form Builder contract (Newborn PNC form)

The source-controlled Newborn PNC form (`newborn-pnc.json`) lives in `content-packages/content-liberia-mch/` bound to `var.form.newborn-pnc.uuid` (`e318b944-6faa-3828-acd6-6b0c98037070`) and encounter `Postnatal Visit`.

| Field ID | Form Label | Rendering | Concept / Variable | Logic / Rules |
| --- | --- | --- | --- | --- |
| `newbornPostnatalContact` | Newborn Postnatal Contact | Coded (radio) | `var.concept.mch.newborn-pnc-contact.uuid` | Required. Answers: PNC 1–4. |
| `pnc1_bcg_reminder` | BCG Reminder | Markdown | N/A (non-obs) | Shown when PNC 1 selected. |
| `pnc4_6wk_vaccine_reminder` | 6-Week Vaccines Reminder | Markdown | N/A (non-obs) | Shown when PNC 4 selected. |
| `birthWeight` | Birth Weight (kg) | Numeric | `var.concept.ciel.birth-weight.uuid` | Optional. Used for weight loss & Kangaroo care. |
| `currentWeight` | Current Weight (kg) | Numeric | `var.concept.ciel.weight-kg.uuid` | Required. |
| `weightLossPercent` | Weight Loss (%) | Numeric (disabled) | N/A (transient) | Calculated transient UI value (`isTransient: true`, non-persisted): `((birthWeight - currentWeight)/birthWeight)*100`. Warning if > 10%. |
| `temperature` | Temperature (°C) | Numeric | `var.concept.ciel.temperature.uuid` | Required. Warning if < 36.5°C. |
| `newbornPostnatalComplications` | Newborn Postnatal Complications | Checkbox-searchable | `var.concept.mch.newborn-pnc-complications.uuid` | Required. 17 answers in DAK order. |
| `jaundice_urgent_alert` | Pathological Jaundice Alert | Markdown | N/A (non-obs) | Shown when `jaundice-first-24hrs` selected. |
| `otherNewbornComplicationDetails` | Other newborn complication details | Textarea | `var.concept.mch.other-newborn-complication-details.uuid` | Shown only when CIEL 5622 (`Other`) selected. |
| `receivedKangarooCare` | Received Kangaroo care | Coded (radio) | `var.concept.national.received-kangaroo-care.uuid` | Shown only when birth weight < 2.5 kg. Answers: Yes/No. |
| `chlorhexidineAdministration` | Chlorhexidine administration | Coded (radio) | `var.concept.national.chlorhexidine-administration.uuid` | Answers: Before 24hrs / After 24hrs. |
| `nevirapineStartDate` | Nevirapine start date | Date | `var.concept.national.nevirapine-start-date.uuid` | Date picker. |
| `complicationsIdentifiedAndManaged` | Complications Identified and Managed | Textarea | `var.concept.national.complications-identified-and-managed.uuid` | Free text. |

### Form Builder contract (ANC observation forms)


| Area | Use |
| --- | --- |
| Obstetric history | CIEL Gravida (5624), LMP (1427), Full-term births (160080), Preterm births (160078), Abortions (1823), Living children (1825), Parity (1053). Parity is required (DAK `LBR.EMR.DE.1`, Optionality `R`) and held to `>= 0`, `= FT + P`, `<= Gravida - 1`; Living children is held to `<= Parity` when Parity is entered and to `<= FT + P` when it is blank; Parity is pinned to 0 and disabled while Gravida is 1 |
| Physical exam Colour (`DE.7`) | National `Color` + CIEL Normal (1115) / Abnormal (1116) — not Colour (HGT) |
| Physical exam abnormality descriptions (ANC Initial) | One local MCH Text question per finding (`var.concept.mch.<finding>-abnormality-description.uuid`), placed directly under that finding, shown and required only while it is Abnormal, `maxLength` 2000. No DAK source: the DAK has only the generic `DE.17` Explain abnormalities, which ANC Initial no longer captures. The generic national concept is unchanged and still used by ANC Follow-up. |
| Heart / Lungs / Breasts / Nipples / Abdomen / Extremities / Pelvic examination / Explain abnormalities | Existing national questions + CIEL Normal / Abnormal. Abdomen uses the Liberia coded Question, not CIEL 1808 (an Anatomy concept with N/A datatype); its fully specified name is `Abdomen examination`, since CIEL 1808 already holds `Abdomen` in locale `en` and a duplicate fully specified name is rejected. |
| Colour (HGT) (`DE.25`) | National Text — prenatal/HGT only; do not use for physical-exam Colour |
| SBP / DBP | National Blood Pressure (Systolic / Diastolic), bounded 50–260 and 30–180 |
| Weight | CIEL 5089 Weight (kg), ANC Initial form range **20–300** kg. CIEL 5089 `ConceptNumeric.hi_absolute` remains **250**. Liberia adds an always-matching Weight ConceptReferenceRange (`criteria` `true`, absolute 0–300) in `weightreferenceranges-national.csv`; ObsValidator therefore uses the CRR as the effective backend persistence range. Narrower form-level limits in other workflows remain unchanged. |
| Gestational age / Fundal height / Fetal heart tone | CIEL 1438 / 1439 / 1440. Both ANC forms use these; the national local equivalents are superseded (see *Converged ANC concepts* below) |
| Other findings / Routine drugs / Treatment remarks | Existing national text (drugs/remarks supplemental only) |
| Return date (`DE.30`) | CIEL 5096 Return visit date (`var.concept.ciel.return-visit-date.uuid`). ANC Initial required date after Treatment remarks; must be on or after the form's encounter date (hidden `encounterDatetime` field `encounterDate`, not `today()`); same-day valid. Not on ANC Follow-up. National ANC Form still uses the local scheduled-date concept. |
| Trimester | CIEL 5272 Pregnancy status with the existing national trimester answers |
| Woman receiving IPT / LLIN received at ANC | Existing **national coded Yes/No** questions, answered by CIEL 1065 / 1066 — **never** a local Boolean |
| Presentation | Local MCH value set — do **not** use national Vertex-only Presentation |
| Danger-sign alerts | Surfaced persistently as Patient Flags (`omod.patientflags`) for High SBP (>=140), High DBP (>=90), Abnormal FHT (<110 or >160 bpm), and Non-vertex presentation based on latest observations. In-form non-blocking advisories are rendered via conditional Form Engine `markdown` elements (`hideWhenExpression`), preserving valid obs persistence. Physical-exam abnormality descriptions remain blocking: on ANC Initial each is required while its own finding is Abnormal; ANC Follow-up keeps the generic explanation validator. |

### Converged ANC concepts

"ANC Form" (`anc-national.json`, encounter `Consultation`) and "ANC Initial Visit"
(`anc-initial.json`, encounter `ANC Initial Visit`) both sit in the Maternal and Child Health
form section and a clinician can open either. They previously recorded the same DAK elements
against **different** concepts, so any ANC coverage, hypertension or IPTp indicator — and the
patient chart flowsheet — saw only the encounters entered on one of the two forms, with no
error anywhere.

Both forms now write the same series for every element where a verified CIEL term exists:

| DAK element | Converged on | Was, in `anc-national.json` |
| --- | --- | --- |
| `DE.2` LMP | CIEL 1427 | `var.concept.national.last-menstrual-period-lmp.uuid` |
| `DE.3` Full-term births | CIEL 160080 | `var.concept.national.full-term-births-f.uuid` |
| `DE.4` Preterm births | CIEL 160078 | `var.concept.national.preterm-births-p.uuid` |
| `DE.5` Abortions | CIEL 1823 | `var.concept.national.abortions-a.uuid` |
| `DE.6` Living children | CIEL 1825 | `var.concept.national.living-children-l-n.uuid` |
| `DE.22` Gestational age | CIEL 1438 | `var.concept.national.gestational-age-weeks.uuid` |
| `DE.23` Fundal height | CIEL 1439 | `var.concept.national.fundal-height-cm.uuid` |
| `DE.26` Fetal heart tone | CIEL 1440 | `var.concept.national.fetal-heart-tone-fht.uuid` |
| `DE.53` Woman receiving IPT | national coded Yes/No (CIEL 1065/1066) | *(MCH form used a local Boolean)* |
| `DE.54` LLIN received at ANC | national coded Yes/No (CIEL 1065/1066) | *(MCH form used a local Boolean)* |

The shared CIEL aliases are declared in
`content-liberia-national/configuration/variables.properties`, not in the MCH package:
content-liberia-national must build without content-liberia-mch, because mch depends on
national and never the reverse.

⚠ **The convergence above covers "ANC Form" and "ANC Initial Visit" only. "ANC Follow-up
Visit" is NOT converged and is unresolved technical-clinical debt.** `anc-followup.json` was
restored byte-for-byte from its authoritative pre-deletion version
(`44c22b41f7c8fa7b3b7b5b6ee482953ac069f0bc`); it predates this convergence and was deleted
before it was applied, so it never received it. For three elements it still writes the
superseded national concepts:

| DAK element | "ANC Form" + "ANC Initial Visit" | **"ANC Follow-up Visit"** |
| --- | --- | --- |
| `DE.22` Gestational age | `var.concept.ciel.gestational-age.uuid` | `var.concept.national.gestational-age-weeks.uuid` |
| `DE.23` Fundal height | `var.concept.ciel.fundal-height.uuid` | `var.concept.national.fundal-height-cm.uuid` |
| `DE.26` Fetal heart tone | `var.concept.ciel.fetal-heart-rate.uuid` | `var.concept.national.fetal-heart-tone-fht.uuid` |

Consequence: gestational age, fundal height and fetal heart tone **do not currently form a
single concept series across Initial + Follow-up**. Any flowsheet, trend or indicator over
these three elements must read both concepts, or it will see only part of a pregnancy.
Fundal height and gestational age have no compensating logic anywhere.

ANC danger-sign behaviour is **not** broken by this: the `Abnormal Fetal Heart Tone (ANC)`
flag in `flags-mch.csv` already matches
`IN ('${var.concept.ciel.fetal-heart-rate.uuid}', '${var.concept.national.fetal-heart-tone-fht.uuid}')`,
and the BP and presentation flags are likewise written across both concept variants.

Resolution is **deliberately deferred, not accepted as permanent.** Remapping the form now
would be a semantic/data-model change rather than the validation-only QA work it was restored
under, and would leave observations already recorded against the national concepts split
regardless. Closing it requires: (1) deciding the canonical CIEL mappings for Follow-up;
(2) assessing observations already stored under the national concepts; (3) determining
migration and reporting compatibility; and (4) applying the appropriate form version/update
semantics under [IMPLEMENTATION.md §9](../../IMPLEMENTATION.md). Tracked as open item 23.

⚠ **Still divergent — needs a clinical value-set decision, not a code change.**

- `DE.24` **Presentation.** "ANC Form" uses national `Presentation` (Vertex-only); "ANC
  Initial Visit" uses the MCH value set (Vertex / Breech / Transverse / Oblique / Other).
  Converging means adding the four missing answers to the *national* question — additive and
  permitted under §9 — but it is a national value-set change that needs clinical sign-off,
  and CIEL 160090 remains the real target once it lands in the collection.
- `DE.48` **IPT dose administered.** "ANC Form" offers 1st / 2nd / **3rd+**; "ANC Initial
  Visit" offers exact 1st / 2nd / 3rd / 4th. These cannot merge until someone decides what
  happens to the national `3rd IPT dose+` answer — it cannot be reused for exact 3rd, and
  offering both alongside each other would be incoherent at the point of care.

Until those two land, an indicator on Presentation or IPT dose must read both concepts.

⚠ **Retirement and migration are deliberately NOT done here.** The superseded national
concepts stay declared: they are append-only ([IMPLEMENTATION.md §9](../../IMPLEMENTATION.md)),
and `var.concept.national.fundal-height-cm.uuid` is still referenced by `pnc-national.json`.
Retiring them — and deciding whether PNC fundal height (`EMR.PND.DE27`) should also move to
CIEL 1439 — needs a migration analysis of any obs already recorded against them. At the time
of this change the distribution is `1.0.0-SNAPSHOT` with no release tag, so there should be
no such obs; confirm against the pilot database before retiring. `anc-national.json` is
bumped to version `1.1` so any existing encounters stay bound to the schema they were
entered under.

### ANC fetal presentation and IPT model

ANC fetal presentation uses the self-contained MCH coded concept
`var.concept.mch.fetal-presentation.uuid`, with Vertex, Breech, Transverse, Oblique and Other
answer variables. This is the runtime fallback for DAK CIEL 160090; no CIEL answer IDs were
invented.

Woman receiving IPT uses the existing NATIONAL coded Yes/No concept (`var.concept.national.woman-receiving-ipt.uuid`).
LLIN received at ANC uses the existing NATIONAL coded Yes/No concept (`var.concept.national.llin-received-at-anc.uuid`).
CIEL 1065 / 1066 (`${var.concept.ciel.yes.uuid}` / `${var.concept.ciel.no.uuid}`) are the answers.
The local Boolean fallbacks were removed and must not be reintroduced.

When Woman receiving IPT is Yes (`${var.concept.ciel.yes.uuid}`), `var.concept.mch.ipt-dose-administered.uuid` is shown with exact 1st–4th MCH answers; when No (`${var.concept.ciel.no.uuid}`), `var.concept.mch.iptp-deferral-reason.uuid` is shown. The only sourced acceptance answer currently represented is `var.concept.mch.iptp-deferred-malaria-treatment.uuid`; no additional reasons are inferred.

### Declared locally

ANC IPT / presentation / health-card concepts. **DE.53 Woman receiving IPT and DE.54 LLIN
received at ANC are NOT here** — they use the existing national coded Yes/No questions; the
local Boolean concepts that once stood in for them have been removed and must not come back.

| Concept (FSN) | Short name | Type | Answers / notes |
| --- | --- | --- | --- |
| IPTp Dose Administered at ANC | IPTp dose administered | Coded | MCH 1st–4th only |
| First / Second / Third / Fourth IPTp Dose at ANC | 1st–4th IPTp dose | N/A | answers |
| IPTp deferral reason | IPTp deferral reason | Coded | Malaria treatment initiated (optional — answer set incomplete) |
| Malaria treatment initiated | Malaria treatment initiated | N/A | answer |
| Fetal Presentation at ANC | Fetal presentation | Coded | Vertex; Breech; Transverse; Oblique; Other (CIEL 160090 traced in docs only) |
| Vertex / Breech / Transverse / Oblique / Other Fetal Presentation at ANC | `… presentation` | N/A | answers; no CIEL answer mappings |
| Pregnant Woman Health Card Issue Date | Health card issue date | Date | — |

Short names are listed because they must not collide with a national fully specified name —
`concepts-national.csv` already carries `Vertex`, `Presentation`, `IPT dose administered`,
`1st IPT dose` and `2nd IPT dose`, and Form Builder search shows short names.

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

### Family Planning

Introduced with the Family Planning form (`3. Family Planning` v2.0). Row-level DAK provenance is in
[`../dak/traceability-mch.csv`](../dak/traceability-mch.csv); this section is the model only.

Local MCH questions:

| Concept (FSN) | Variable (`var.concept.mch.…`) | Type | Role on the form |
| --- | --- | --- | --- |
| Family Planning Client Type | `fp-client-type` | Coded | New vs continuing client |
| Chosen Family Planning Method | `fp-chosen-method` | Coded | Counselling outcome; gates the eligibility, LAM and implant sections |
| Amenorrhea (Menses Not Returned) | `fp-amenorrhea` | Coded | Pregnancy rule-out input; gates every implemented decision-table rule |
| Missed or Late Menses | `fp-missed-menses` | Coded | Non-amenorrhoeic branch input (branch not implemented — open item 25) |
| Days Since Unprotected Sex | `fp-days-since-unprotected-sex` | Numeric | Drives the ≤ 5-day emergency-contraception guidance; integer-only |
| Exclusive Breastfeeding | `fp-exclusive-breastfeeding` | Coded | LAM criterion |
| Date of Last Delivery | `fp-date-of-delivery` | Date | LAM six-month boundary (calendar months, month-end clamped) |
| Unexplained Vaginal Bleeding | `fp-unexplained-vaginal-bleeding` | Coded | WHO MEC implant screen |
| History of Breast Cancer | `fp-history-breast-cancer` | Coded | WHO MEC implant screen |
| Severe Liver Disease or Jaundice | `fp-severe-liver-disease` | Coded | WHO MEC implant screen |
| Current DVT or Pulmonary Embolism | `fp-current-dvt-pe` | Coded | WHO MEC implant screen |
| Contraceptive Implant Inserted | `fp-implant-inserted` | Coded | Procedure performed — deliberately not inferred from the dispensed commodity |
| Date of Contraceptive Implant Insertion | `fp-implant-insertion-date` | Date | Conditionally required when Implant Inserted = Yes |
| Perform Pregnancy Test | `fp-perform-pregnancy-test` | Coded | **Declared but unused** — the form treats it as implied by a recorded Negative result |

Local MCH answer concepts (all Misc / N/A), grouped by the question that carries them:

| Question | Answers (`var.concept.mch.…`) |
| --- | --- |
| Family Planning Client Type | `fp-client-new`, `fp-client-continuing` |
| Purpose of visit (national question, answer set extended) | `fp-purpose-side-effects`, `fp-purpose-jadelle-iucd-removal`, `fp-purpose-post-partum-fp` |
| Chosen Family Planning Method / Family Planning Method Dispensed | `fp-cycle-beads`, `fp-microgynon`, `fp-microlut`, `fp-implants`, `fp-sayana-press` |
| Chosen Family Planning Method only | `fp-lam` — a behaviour, not a dispensable commodity |

Reused concepts needed to read the model:

| Concept | Variable | Type | Note |
| --- | --- | --- | --- |
| Gravida / Parity | `var.concept.ciel.gravida.uuid` / `…parity.uuid` | Numeric | Integer-only on this form |
| Pregnancy test result | `var.concept.ciel.pregnancy-test-result.uuid` (CIEL 45) | Coded | Restricted to CIEL 664 Negative / 703 Positive |
| Return visit date | `var.concept.ciel.return-visit-date.uuid` (CIEL 5096) | Date | Derived, read-only: repeat pregnancy test at encounter date + 21 days. See open item 24 |
| Male / female condoms | `var.concept.ciel.male-condoms.uuid` / `…female-condoms.uuid` | — | Method answers, both questions |
| Injectable contraceptives | `var.concept.ciel.injectable-contraceptives.uuid` (CIEL 5279) | — | Chosen only — see open item 23 |
| Intrauterine device | `var.concept.ciel.iud.uuid` (CIEL 5275) | — | Chosen only — see open item 23 |
| Counselling done, Purpose of visit, Family planning method dispensed, Date method removed, For commodities, IUDs | `var.concept.national.…` | — | Existing national questions and answers, reused unchanged |

The LAM, eligibility and pregnancy guidance blocks are **derived and not stored**: no
"LAM eligible" or "eligible for implant" observation exists, because neither is a finding the
client presents with. Automatic conversion of the next-contact observation into an
`Appointment` is deferred to the separate backend-listener Jira.

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

The six-form status table includes the released Mother PNC and Newborn PNC schemas;
Delivery Summary remains not written. See the
[ampathforms README](../../content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/README.md)
for the inventory and the versioning rule (a released schema is historical data: new
version, new UUID, old schema preserved).

### Labour & Delivery Gravida / Parity prefill

`1. First and Second Stage of Labor and Delivery` keeps CIEL Gravida (5624) and Parity
(1053) editable. On a **new** encounter it prefills each field from the latest applicable
ANC observation in the **current pregnancy**, independently (one value may be blank). The
source is ANC-specific: prefer `ANC Initial Visit` (encounter type / form UUID / form name);
fall back to legacy `1. ANC Form` identified by that form name, never by generic
`Consultation`. Previous-pregnancy ANC is excluded using the same delivery boundary as the
e-partograph (latest Stage 3 / Delivery encounter before now). Existing L&D observations
win on edit. The `Parity cannot be greater than Gravida` validator is unchanged.

The form calls `getCurrentPregnancyAncNumeric` from `calculateExpression`. That helper is
registered at startup by `@liberiaemr/esm-liberia-patient-chart-extension`, which is in
the facility import map and loads for every patient-chart session. It is **not** hosted
by the e-partograph ESM.

### Legacy national Family Planning form superseded

The national `3. Family Planning` v1.0 schema
(`content-liberia-national/.../ampathforms/family_planning-national.json`) remains declared
in metadata and is superseded by MCH `3. Family Planning` v2.0, which is the active FP
workflow. Both schemas carry the same form name, `3. Family Planning`, and are told apart by
version. The legacy schema's JSON `uuid` field reads
`d82ce32c-65fa-4ec5-b644-6517a8359133`; that is the source schema's own identifier for
traceability, not the Form identity Initializer works with at load time, so identify the
legacy form as `3. Family Planning` v1.0 rather than by that value.

Source state and runtime state are not the same thing here, and the difference is the whole
point of the note:

- **At source**, the legacy schema is retained as `published=false` and `retired=false`.
- `retired=false` is intentional at source, not an oversight. Initializer 2.12.0 cannot
  create a brand-new already-retired form on a clean database — its creation path supplies
  no retire reason — so a clean install fails if the schema ships retired.
- **At runtime, `retired=false` is the creation state, not the end state.** On a clean load
  the legacy v1.0 schema is created first; MCH `3. Family Planning` v2.0 is then loaded
  under the same form name, and Initializer's same-name replacement path retires v1 with the
  reason `Replaced with new version by Iniz` before creating v2. Do not read the source
  `retired=false` as a guarantee about the form's state once a complete load has run.
- `published=false` withdraws the legacy form independently of any of that: clinicians
  should no longer launch it for new FP encounters, whatever its retired flag happens to
  read at a given moment.
- MCH `3. Family Planning` v2.0 is the active, published workflow once the load completes.
- Historical encounters stay associated with the legacy form and keep rendering against
  its preserved v1.0 schema.
- This PR performs **no patient-data migration**. Existing FP observations are untouched.

### Legacy national PNC form superseded

The national `2. PNC` v1.0 schema
(`content-liberia-national/.../ampathforms/pnc-national.json`) remains declared in
metadata as `published=false` and `retired=false`: unpublished but not retired.
It is superseded by the published MCH forms `Mother PNC` and `Newborn PNC`, both v1.0.

- `published=false` withdraws the legacy form from new encounter entry while preserving
  its schema and historical encounter associations.
- `retired=false` is intentional, following the Family Planning source-state precedent:
  Initializer 2.12.0 cannot create a brand-new already-retired form without a retire reason.
- The replacement PNC forms have different names from `2. PNC`, so the Family Planning
  same-name version replacement retirement behavior does not apply. Verify actual runtime
  state before deployment.
- Mother PNC is released from `pnc-visit.json`, with canonical runtime Form UUID
  `7e8cc637-0961-3441-9e51-aef987d0313d` (`var.form.pnc-visit.uuid`).
- Newborn PNC is released from `newborn-pnc.json`, with canonical runtime Form UUID
  `e318b944-6faa-3828-acd6-6b0c98037070` (`var.form.newborn-pnc.uuid`).

Before deployment, inventory the target OpenMRS runtime for forms named `Mother PNC` and `Newborn PNC`, including UUID, version, retired status, schemas, encounter counts, and how each form was originally loaded. This runtime inventory is a release prerequisite; the PNC restoration and UUID alignment do not include migration, retirement, or deployment.

### Mother PNC terminology and schema contract

The Mother PNC form (`content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/pnc-visit.json`) was designed and validated through Form Builder, and the exported/versioned JSON in the content package is the deployable, reproducible source of truth. Rendering, requiredness, and hide/show logic live in the form schema, while concept metadata supplies terminology and value sets.

- `Post-partum care` (`1659ca4e-56a1-4dda-8668-8e9a0dcc571e`) retains its existing UUID
  and has PPC 1 within 24 hours (`0717361a-8470-42ff-b457-f02eb48b432e`), PPC 2 within
  7 days (`3a981f7d-2691-469d-921c-470e39a74cb3`), PPC 3 within 28 days
  (`ca6a3b18-00a4-4320-bc2d-f7ff8350ce72`), and PPC 4 within 42 days
  (`820b6a3b-216a-46e0-8f07-b19e93336aa7`).
- `Parity` reuses the runtime-loaded CIEL Numeric/Question concept
  (`1053AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`). The MCH package does not redeclare it.
- National terminology authoritatively owns `Place of Delivery`
  (`68bcf423-25ab-48a5-8c0e-5bd1ee6b7e02`) and its local `Home`
  (`636aece0-5ab8-4e95-b491-192c3349cd79`) answer. `Health facility` reuses the
  runtime-loaded CIEL concept (`1537AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`). MCH reuses these
  loaded concepts and does not redeclare them.
- Initial HIV result (`da0be8c8-ecd0-4680-b0f8-8fd4fcd40ddd`) and `Results at PNC
  re-test` (`c5a63b81-253a-486f-961f-6740e647645e`) both use CIEL 664 Negative,
  CIEL 703 Positive, and CIEL 1067 Unknown. Both are available at every catch-up contact;
  re-test is not gated to six weeks.
- `HIV counselling provided` (`cb61aa35-c0b3-44b3-8f7b-ac78faf7a9b8`) follows the
  Liberia coded Yes/No convention and is available at every catch-up contact.
- Referral uses the shared referral workflow; no PNC-specific referral observation exists.
- `Vitamin A for mother at 6 wks` (`996b496d-1c9d-4492-bb84-a0106ea635d1`) is the
  current DE21 concept. The former DE31 duplicate is not part of the live workbook. It is
  conditionally shown when PPC 4 (42 days) is selected via form hide expression
  `postPartumCare !== '${var.concept.national.ppc-4-received-within-42-days.uuid}'`.

#### DE14 Complications

`Maternal Postnatal Complications` (`0576b7e5-8326-4b16-ba9b-0b6016bdd11c`) is a coded
Question. Its terminology name is deliberately specific because the runtime already has a
demo surgical `Complications` concept (`64fe56e6-5b52-4cdb-adc2-b6d50bfdee63`) with
Misc/Text semantics. The form schema renders it using `checkbox-searchable` with the field
label `Complications`. The live workbook contains Pre-eclampsia twice; that duplication is
preserved in traceability, while the concept value set correctly contains CIEL 129251 only once.

| Answer | UUID |
| --- | --- |
| No labour or birth complications | `1107AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Unknown labour or intrapartum complications | `1067AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Pre-eclampsia | `129251AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Eclampsia | `118744AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Maternal convulsions | `113054AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Other pregnancy or labour problems (specify) | `5622AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Hypertension | `117399AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Severe pre-eclampsia | `113006AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Anaemia | `121629AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| HIV positive | `138571AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| TB positive | `112141AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Syphilis positive | `112493AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Respiratory tract infection, NOS | `999AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Low oximetry | `158211AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Fever | `140238AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| Early onset neonatal sepsis | `91bdbfe7-1b3c-4866-9f6d-3b599bd7e84b` |
| Postpartum haemorrhage | `80e01283-3690-4872-8486-fac16552c19b` |
| Perineal laceration | `468d8e9c-f509-4045-9ac9-519960fbdfa6` |
| Severe hypertension | `7eb59ca2-1c2b-49f0-826a-4c04173eed9a` |
| Iron prescribed | `699c7614-39ea-4673-9aa7-43f59285150b` |
| HIV inconclusive | `16ea7a29-7649-4fb5-8e94-d446c382cfa0` |
| Postpartum infection | `30ac9358-1b9d-4450-86ad-d97c314c861a` |
| Risk of postnatal depression and/or anxiety | `71393e98-5650-480f-83f3-802e0e90e084` |
| Risk of alloimmunization | `3be13f35-03c3-44aa-8302-74dc7f8570a5` |
| Substantial risk of HIV | `4eff9170-7163-4c63-9799-41a19870e12a` |
| Risk of bleeding or postpartum infection | `0bfa2c23-7c4b-437b-8f0d-8338c327c5db` |
| Perineal Infection | `887ca517-5359-451a-99fe-b39b820f09ff` |
| Abnormal caesarean-section wound exam | `17345eaf-ccf6-490a-8536-9747244b8032` |
| Wound infection suspected | `87ef7a27-07d5-45b6-9e06-45da09366d53` |
| Uterine infection suspected | `20d76b7a-050a-4c9a-a022-9c915bb7e125` |
| Postpartum bleeding | `cb077720-badb-4b9f-9827-23f1644b235f` |
| Severe oedema | `b8acbfbf-433a-4342-b809-90cfa14c851c` |

When CIEL 5622 (`Other pregnancy or labour problems (specify)`) is selected, the companion Text Question `Other pregnancy or labour problems details` (`30481431-0ff0-47b1-995c-12fcdc0da7e7`) is displayed via form hide expression `!maternalComplications?.includes('${var.concept.ciel.other.uuid}')`.

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
11. ~~Parity on the ANC Initial form.~~ Closed against the live data dictionary. The ANC
    sheet read 2026-09-18 defines Parity as `LBR.EMR.DE.1` with Optionality `R`, so ANC
    Initial v1.2 captures it as **required**; ANC Follow-up is unchanged. This supersedes the
    earlier reading, taken from the 2026-08-06 extract in
    [`traceability-mch.csv`](../dak/traceability-mch.csv), that ANC had no Parity element.
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
    concepts. Closed: MCH FSNs use distinct `IPTp … at ANC` wording, **and short names now
    carry the same disambiguation** — concise-but-colliding short names were the remaining
    half of this problem, because Form Builder search renders short names.
16. ~~Get CIEL `160090` and `165372` added to the `LIB/mch` OCL collection.~~ **Done
    2026-08-18** via `scripts/build/ocl-add-concepts.sh`: `160090 Fetal presentation` plus its
    12 answer concepts, and `165372 Pelvic examination findings`. `160428` and `165379` were
    deliberately excluded — see item 20.
17. ~~Cut a new released `LIB/mch` collection version and bump `ocl.collection.version`.~~
    **Done 2026-08-18.** `LIB/mch` `1.0.2` was released (825 concepts, against 811 in `1.0.1`)
    and `distribution/distro.properties` now pins it. Verified: `160090`, `165372` and all 12
    presentation answers are in the released version, and `fetch-ciel.sh --version 1.0.2`
    produces `lib-mch-ciel-1.0.2.zip` carrying them. The build is reproducible again — it is
    no longer fetching HEAD.
18. **Decide DE.24 Presentation:** migrate onto CIEL 160090 and lose the Transverse/Oblique
    distinction and "Other", or keep the local value set and carry a `Same as` mapping. See
    *ANC prenatal presentation*. DE.16 Pelvic examination has the same migrate-or-keep
    decision now that 165372 is available.
19. **The `LIB/mch` collection contains 825 concepts and ZERO mappings** — still true in the
    released `1.0.2`. Every one of its 104 coded questions loads with no answer linkage, and no
    `SAME-AS` mapping reaches the runtime, which is the underlying reason `Same as CIEL:…` has
    never been loadable from our CSVs (`Concept Source is required`). Collection-wide, and it
    predates the ANC work.

    **Scoped 2026-08-18 and ready to run.** Sampling 60 of the 825 concepts found a mean of
    6.1 mappings each, so the repair is roughly **5,000 mappings** — trivial beside the ~300,000
    in a full CIEL export that `ocl/README.md` warns about, so the Initializer startup cost the
    curated collection exists to avoid does not apply here. By type: ~66% `SAME-AS` (what the
    DHIS2 and FHIR aggregation in §8 needs), ~16% `Q-AND-A` (what gives coded questions their
    answers), the rest `NARROWER-THAN`/`BROADER-THAN`. Of the `Q-AND-A` answer targets sampled,
    **52 of 54 are already in the collection**, so the repair creates few dangling references —
    and `scripts/build/ocl-add-mappings.py` refuses to add a `Q-AND-A` whose answer concept is
    absent rather than reproducing this defect in mapping form.

    Run `OCL_API_TOKEN=… scripts/build/ocl-add-mappings.py --types SAME-AS,Q-AND-A` for the dry
    run, then `--apply`, then cut `1.0.3` and bump the pin. Doing `Q-AND-A` first is the smaller,
    higher-value half.
20. **Two DAK CIEL codes are wrong at source and must not be implemented as mapped:**
    `LBR.EMR.DE.21` Weight → `165379` is *total weight gain during current pregnancy*, not body
    weight (correct term is `5089`); `LBR.EMR.DE.54` LLIN received at ANC → `160428` is the
    *bednet commodity* (Misc/N/A), not a question. Raise both with the sheet maintainer with
    items in 10.
21. **Clinical decision on the two ANC elements the two forms still record differently** —
    DE.24 Presentation (national is Vertex-only) and DE.48 IPT dose (national `3rd IPT dose+`
    versus exact 3rd/4th). See *Converged ANC concepts*. Until they land, any indicator on
    those two elements must read both concepts.
22. **Retirement and migration analysis for the national ANC concepts superseded by the CIEL
    convergence** (LMP, FT/P/A/LN, gestational age, fundal height, FHT), including whether
    PNC fundal height (`EMR.PND.DE27`) should also move to CIEL 1439. They stay declared
    until that analysis is done. `national.fundal-height-cm` is still live in
    `pnc-national.json`.
23. **"ANC Follow-up Visit" is not converged onto the CIEL ANC terms — UNRESOLVED.**
    `anc-followup.json` still writes `national.gestational-age-weeks`,
    `national.fundal-height-cm` and `national.fetal-heart-tone-fht` where "ANC Form" and "ANC
    Initial Visit" write CIEL 1438 / 1439 / 1440, so DE.22, DE.23 and DE.26 do not form one
    concept series across Initial + Follow-up. Danger-sign FHT is unaffected — its flag reads
    both concepts. Deferred deliberately: closing it needs the canonical CIEL mappings for
    Follow-up decided, existing obs under the national concepts assessed, migration/reporting
    compatibility determined, and form version/update semantics applied under §9. Until then
    any flowsheet or indicator on these three elements must read both concepts. See
    *Converged ANC concepts*; related to item 22.
24. **Upper bounds for the ANC obstetric counts are unspecified.** Gravida on
    `anc-initial.json` is a whole-number field (`min: 1`, `step: 1`,
    `disallowDecimals: true`) because Gravida includes the current pregnancy and
    must be ≥ 1 for a patient in ANC. Full-term births, preterm births, abortions
    and living children remain whole-number fields with `min: 0`, `step: 1`,
    `disallowDecimals: true`. No approved clinical upper bound is currently
    configured. The remaining open question is whether clinically approved upper
    bounds should be introduced; that needs clinical/product sign-off before any
    `max` is configured.

23. **Family Planning Chosen Method vs Method Dispensed use different concepts for the same
    method.** Chosen carries CIEL 5275 *Intrauterine device* and CIEL 5279 *Injectable
    contraceptives*; Dispensed carries the national *IUDs* concept and CIEL 907
    *medroxyprogesterone*. Any indicator counting "IUDs provided" or "injectables provided"
    across the two questions will **split**. Both answer sets predate this work and both load,
    so this is an aggregation defect, not a runtime failure. Decide which concept is canonical
    per method, converge the two questions, and migrate existing observations — the pattern
    already applied to LMP under *Converged ANC concepts*.
24. **The next-contact date has no unambiguous observation contract.** CIEL 5096 *Return visit
    date* is already used on the FP form for the repeat pregnancy test (encounter date + 21
    days). The one-calendar-month contraceptive implant post-insertion review would need a
    second value on that same concept in the same encounter — decision-table rules 3 and 4
    apply to implant clients, so both follow-ups genuinely co-occur — and nothing at the
    observation level distinguishes them. The form therefore persists **only** the +21-day
    date. Automatic conversion of next-contact observations into `Appointment` resources is
    deferred to the separate backend-listener Jira, which needs this contract decided first:
    a distinct concept per follow-up, or a discriminator (obs grouping, or a coded
    service/type obs) alongside CIEL 5096.
25. **The non-amenorrhoeic pregnancy decision-table branches cannot be implemented from the
    current form inputs.** Rules 19, 22 and 23 of sheet `FP.LO.004-3. PregTestNegative` turn on
    `FP.DE.056 Type of pregnancy test` = "Highly sensitive", which the FP form does not capture;
    rules 19 and 22 are otherwise identical and cannot be told apart. Rule 19 is additionally
    self-inconsistent at source (`Provide method` = 0 while its Action reads "Provide the method
    now"). Needs the DAK owner — raise with items 10 and 20.

26. **"Oral Contraceptive Pills (Microlut)" has no confirmed decision-table category.**
    Microlut is a progestogen-only pill and is *deliberately unmapped* in decision table
    `FP.LO.004-3`, which has no POP branch (recorded against `EMR.FP.DE27` in
    [`traceability-mch.csv`](../dak/traceability-mch.csv)). It is therefore absent from
    `fpProvideMethodNow`, `fpEmergencyContraception` and `repeatPregnancyTestDate`, while
    Microgynon (a combined oral contraceptive) is present. Confirm which decision-table
    method category, if any, Microlut maps to before applying `FP.LO.004-3` pregnancy
    guidance to it. Do not infer equivalence with the COC branch from the shared "oral
    contraceptive" label alone. Raise with items 10, 20 and 25.
27. **LAM eligibility cannot be conclusively evaluated when Date of Last Delivery is
    unknown.** The six-month post-partum criterion is guarded by `!isEmpty(dateOfLastDelivery)`,
    so with the date blank the form shows neither the eligible nor the not-eligible guidance
    rather than guessing. LAM has no DAK source at all (`no-dak-source` against Chosen
    method, LAM, Exclusive Breastfeeding and Date of Last Delivery in
    [`traceability-mch.csv`](../dak/traceability-mch.csv)), so **requiredness is not
    sourced** and none has been imposed. Confirm with the clinical/DAK owner whether the
    date should be required for LAM clients, or whether explicit fallback guidance should
    be shown instead.

28. **Pre-deployment PNC runtime inventory remains required.** Inventory `Mother PNC` and
    `Newborn PNC` UUIDs, versions, retired status, schemas, encounter counts, and original
    loading mechanism before deployment; see
    [Legacy national PNC form superseded](#legacy-national-pnc-form-superseded).

29. **The rest of the ANC tab has not been re-read, and optionality is still not carried.**
    The Obstetric History block is current: `LBR.EMR.DE.1`-`.7` (Parity, Gravida, LMP, FT, P,
    A, LN) were read from the live sheet on 2026-09-18 and
    [`traceability-mch.csv`](../dak/traceability-mch.csv) is synchronised to them. **Nothing
    else on the ANC tab was re-read**, and the rest of the file is not claimed to be current.
    Two consequences:
    (a) **One residual identifier collision.** Inserting Parity at DE.1 shifted the block down
    by one, so Living children now holds `LBR.EMR.DE.7` while Physical Examination *Colour*
    still holds it from the 2026-08-11 read. Colour has presumably shifted to `DE.8`, and the
    elements after it likewise, but those values were not read and have **not** been guessed.
    Re-extract the remainder of the ANC tab and resynchronise it as its own piece of work.
    (b) **Optionality is not represented.** `traceability-mch.csv` has no optionality column,
    although [docs/dak/README.md](../dak/README.md) records that the ANC tab carries it under
    *Validation Condition*, read by position. Parity's `R` came from reading the live sheet
    directly, not from this repository. Add the column when the tab is re-extracted, so
    requiredness stops depending on an out-of-band read.

Items 1–3 block the forms. Item 8 blocks the e-partograph implementation. Item 9 blocks any
claim that MCH is specified. Item 17 gates whether the 2026-08-18 OCL import reaches any
build at all; item 19 is the one with the widest blast radius.
