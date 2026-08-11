# Metadata specification — OPD and Triage (Screening Room / General Consultation)

**First go-live scope.** Written *before* the forms, per the build order in IMPLEMENTATION.md §5. Everything below is implemented by `content-packages/content-liberia-opd-ipd/`.

> Status: **first cut.** Sections marked ⚠ are open and must be closed with the clinical team before forms are written.

Traceability to the DAK covers Business Process C (Screening Room / General Consultation), including Triage and OPD data dictionaries.

---

## 1. Concepts

Reuse CIEL where possible. Local concepts are added only when CIEL has no usable term. 

### Reused from CIEL / LOINC / ICD

**Triage / Vitals**
| Concept | Variable | Type | Note |
| --- | --- | --- | --- |
| Temperature | `concept.ciel.temperature.uuid` | Numeric (°C) | CIEL 5088 |
| Heart rate | `concept.ciel.heart-rate.uuid` | Numeric (bpm) | CIEL 5087 |
| Respiratory rate | `concept.ciel.respiratory-rate.uuid` | Numeric (bpm) | CIEL 5242 |
| Systolic Blood Pressure | `concept.ciel.sbp.uuid` | Numeric (mmHg) | CIEL 5085 |
| Diastolic Blood Pressure | `concept.ciel.dbp.uuid` | Numeric (mmHg) | CIEL 5086 |
| Oxygen Saturation | `concept.ciel.spo2.uuid` | Numeric (%) | CIEL 5092 |
| Weight | `concept.ciel.weight.uuid` | Numeric (kg) | CIEL 5089 |
| Height/Length | `concept.ciel.height.uuid` | Numeric (cm) | CIEL 5090 |
| BMI | `concept.ciel.bmi.uuid` | Numeric | CIEL 1342 |
| MUAC | `concept.ciel.muac.uuid` | Numeric (cm) | CIEL 1343 |

**Clinical History & Assessment**
| Concept | Variable | Type | Note |
| --- | --- | --- | --- |
| Presenting Complaint | `concept.ciel.presenting-complaint.uuid` | Text | CIEL 160531 |
| History of Presenting Complaint | `concept.ciel.history-presenting-complaint.uuid` | Text | CIEL 1390 |
| Past Medical History | `concept.ciel.past-medical-history.uuid` | Text | CIEL 1633 |
| Known Allergies | `concept.ciel.known-allergies.uuid` | Text | |
| Current Medications | `concept.ciel.current-medications.uuid` | Text | |
| General Examination Findings | `concept.ciel.general-exam.uuid` | Text | CIEL 1119 |
| Primary Diagnosis | `concept.ciel.primary-diagnosis.uuid` | Coded | |
| Disposition | `concept.ciel.disposition.uuid` | Coded | CIEL 159488 |
| Follow-up Date | `concept.ciel.follow-up-date.uuid` | Date | CIEL 5096 |
| Referral Reason | `concept.ciel.referral-reason.uuid` | Text | CIEL 164359 |

### Declared locally

| Concept | Type | Range |
| --- | --- | --- |
| Triage Category | Coded | Green, Yellow, Orange, Red (Reuse existing OpenMRS concept) |
| Red Emergency Signs | Coded (Multi) | Apnoea, Cyanosis, Severe resp. distress, etc. |
| Yellow Priority Signs | Coded (Multi) | Tiny baby, Abnormal temp, Urgent trauma, etc. |
| Ebola Screening Result | Coded | Positive, Negative |

⚠ **Note on Triage Form/Concepts**:
- We will reuse the existing OpenMRS triage form and concepts, extending them with any missing sections required by the Liberia DAK. New local concepts will only be created if they do not exist in CIEL.
- The Triage Category will not prevent the clinician from proceeding if it is "Red".

---

## 2. Identifiers, locations, providers

- **OPD Number** — facility-scoped register number.
- Triage and OPD locations are declared per site (`location.triage.uuid`, `location.opd.uuid`).
- Providers: `Nurse`, `Physician Assistant`, `Medical Doctor`.

---

## 3. Visit and encounter model

### Visit types

| Visit type | When |
| --- | --- |
| Outpatient | Any general consultation / screening contact |

### Encounter types

| Encounter type | Visit type | Recorded by |
| --- | --- | --- |
| Triage / Vitals | Outpatient | Nurse |
| General Consultation | Outpatient | Physician Assistant / Medical Doctor |

---

## 4. Programmes and workflows

There is no long-term programme enrolment for a standard OPD visit unless the patient is routed to a chronic care program (e.g., TB, HIV). The workflow moves from Triage → Consultation → Lab / Pharmacy → Disposition.

---

## 5. Forms

Two main schemas will be needed:
1. **Triage Form**: Extend the existing OpenMRS triage form to cover vital signs, Ebola screening, triage signs (Yellow/Red), and the Triage Category.
2. **OPD Consultation Form**: Covers chief complaint, history, physical exam, diagnosis, investigations, and disposition.

---

## 6. Orders

- Laboratory Investigations: Tests ordered during the OPD consultation (linked to `content-liberia-lab`).
- Pharmacy / Prescriptions: Medications prescribed (linked to `content-liberia-pharmacy`).

---

## 7. Reports and indicators

⚠ Pending DAK reporting requirements for general OPD (e.g., total outpatient visits, top 10 diagnoses, malaria cases).

---

## 8. Integration mappings

| Target | Status |
| --- | --- |
| FHIR | Encounters will map to FHIR Encounter resources. |
| DHIS2 | ⚠ Blocked on MOH mappings (e.g., HMIS 105 or similar OPD summary). |

