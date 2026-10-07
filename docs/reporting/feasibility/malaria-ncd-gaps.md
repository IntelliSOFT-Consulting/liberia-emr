# Malaria and NCD indicators: gaps and derived data

This is the companion to [`malaria-ncd.csv`](malaria-ncd.csv). It covers the 38 Malaria
(MAL-001…019) and NCDI (NCD-001…019) rows of the *Liberia EMR Indicator* sheet.

**Result:** 8 are Feasible now, 8 need a content change, 3 need new data capture and 19 are
Not EMR-sourced.

| Sheet | Feasible now | Feasible with content change | Needs new data capture | Not EMR-sourced |
| --- | --- | --- | --- | --- |
| Malaria | 3 | 3 | 2 | 11 |
| NCD | 5 | 5 | 1 | 8 |

**How this was checked.** The repo was treated as the source of truth, together with the OCL
exports that the build loads. The refapp common ZIPs at the pinned upstream commit were read,
and so was `lib-mch-ciel`. The `LIB/mch` **1.0.11** version pinned in `distro.properties` was
queried on the OCL API: it still reports `active_mappings: 0`. The table and column names below
follow the OpenMRS 2.8 data model and `eip.watchedTables`. They have **not** been checked
against a live database yet.

---

## 1. Content gaps

Each gap is written so it can become a content ticket.

- **pharmacy: add ACT products to the formulary.** `drugs-pharmacy.csv` has no
  artemether-lumefantrine, artesunate-amodiaquine or injectable artesunate. None of the loaded
  OCL exports has a concept for them either. Add the CIEL drug concepts to a LIB collection,
  and add the Liberia-EML strengths as drugs. This blocks MAL-001 and MAL-016.
- **pharmacy: add morphine (oral and injectable) to the formulary.** CIEL 80106 is loaded
  from BasicDrugs, but no drug row references it. This blocks NCD-017.
- **pharmacy: add metformin and glibenclamide to the formulary.** CIEL 79651 is in BasicDrugs
  and CIEL 77071 is in LIB/mch. Without them, the "on medication" part of NCD-009 misses most
  treated diabetics.
- **pharmacy: map the SP drug to CIEL.** *Pyrimethamine Sulfadoxine* uses the local concept
  `35191c44-1b60-4f6f-b378-d3bc34b83612` (drug `cbab62a0-6c0f-5bb1-8574-72b5af919098`) and has
  no `Same as mappings`. CIEL 105232 *Pyrimethamine / sulfadoxine* is already loaded. The same
  applies to ORS (`98764756-…`, `28001e9e-…`), which RMNCAH needs.
- **national: give cause of death a usable answer set.** The `concept.causeOfDeath` global
  property points to `9272a14b-7260-4353-9e5b-5787b5dead9d`, which has only 6 answers:
  Infectious disease, Neoplasm/cancer, Traumatic injury, Unnatural death, Other and Unknown.
  Malaria, CVD, stroke, diabetes, chronic respiratory disease and cancer site cannot be coded.
  Point the property at a question whose answers are the ICD-10-grouped diagnoses, or add those
  diagnoses as answers. This blocks MAL-018, NCD-001, NCD-003 and NCD-004, and the site split
  of NCD-002. It also affects RMNCAH mortality.
- **opd-ipd: add a "Died" outcome.** The OPD Consultation Form's *Outcome/Disposition* offers
  only Discharged, Admitted and Referred. No emrapi `dispositionConfig.json` is loaded outside
  `content-demo`. A facility death is therefore recorded only through *Mark patient deceased*,
  which has no encounter and no location.
- **opd-ipd: add a diagnosis question to the OPD Consultation Form.** This could use the
  form-engine `diagnosis` type that writes `encounter_diagnosis`. The concept
  `var.concept.ciel.primary-diagnosis` is declared in `concepts.csv` but no form uses it.
  Today a diagnosis exists only if the clinician also opens the Visit Note.
- **opd-ipd: capture suspected malaria.** Add a coded *suspected malaria* or *fever* item, or
  a coded chief complaint, on Triage and OPD. *Presenting Complaint* (CIEL 160531) is free
  text. This is the MAL-015 denominator.
- **opd-ipd / lab: add a point-of-care malaria RDT result on Triage and OPD**, or make the
  lab-order route mandatory by workflow. At present an RDT that is not entered as a lab order
  is invisible (MAL-001, 004, 015, 016).
- **national: add LLIN distribution to the Immunization form.** Only the ANC forms ask *LLIN
  received at ANC*, and it is Yes/No, not a quantity. This affects MAL-011.
- **new package or national: add cervical and breast cancer screening.** No VIA, Pap smear,
  HPV test or clinical breast examination concept or form exists (NCD-006). Add the CIEL tests
  to the lab collection and add a screening form.
- **national: replace the local ANC blood-pressure concepts.** *Blood Pressure
  (Systolic/Diastolic)* `17b1204b-…`/`a7367960-…` duplicate CIEL 5085/5086 and are used by all
  three ANC forms. Map them `SAME-AS` CIEL, or migrate the forms. Until then NCD-007 must union
  both pairs.
- **mch: unify gestational age.** ANC Initial uses CIEL 1438; ANC Follow-up uses local
  `00663865-9680-476c-9033-60bd55e15970`. MAL-003 needs both.
- **mch / national: settle one IPTp value set.** The MCH forms use `edf4344a-…` with exact
  1st–4th answers. The national *1. ANC Form* uses `7d6e6ee9-…` with 1st/2nd/3rd+ and saves
  under the **Consultation** encounter type. Both are live concepts. Pick one, or document the
  union.
- **OCL: fix the LIB/mch mappings (existing issue).** LIB/mch 1.0.11 still has 0 mappings.
  None of the malaria lab concepts depend on it: 1643, 32 and 161246–8 come from refapp
  BasicLabTests, with answers. But 117399 *Hypertension*, 111103 *CVA*, 887, 790 and 1006 are
  in **both** collections. **To verify on a clean install:** confirm that their ICD-10
  `SAME-AS`/`NARROWER-THAN` maps survive the LIB/mch import. The ICD-10 grouping in section 2
  depends on them.
- **national / lab: turn "Tests Orderability" into a real concept set, or retire it.** The
  concept `1748a953-…` lists 48 tests by name, omits the malaria tests, and nothing references
  it. If it is ever wired to `labOrderableConcepts`, malaria RDT and smear would stop being
  orderable.
- **reporting metadata: add ETL concept sets.** These are *first-line antimalarials*, *strong
  opioids*, *glucose-lowering drugs* and *antibiotics for pneumonia*, so that the ETL does not
  hard-code drug UUIDs.
- **MOH definition: MAL-003.** The numerator text says "three or more doses" (copied from
  MAL-002), but the name says "two doses in the third trimester". Get a ruling. Asked in
  [`../moh-decisions-le-356.md`](../moh-decisions-le-356.md) (LE-356), decision 4, together
  with whether to report the facility-attendee proxies for NCD-008 and NCD-010 (decisions 5
  and 6).

## 2. Derived data the ETL needs

Every instance runs its own ETL. Facility and central both hold these tables, except
`medication_dispense`: it is **not** in `eip.watchedTables`
(`distribution/sync/application.properties.template`), so **central has no dispensing data**.
dbsync 4.0.0 cannot sync the table, and the decision of 6 October 2026 (LE-358) is to leave it
out ([sync-entity-coverage.md](../../architecture/sync-entity-coverage.md) §4.1). Central time
windows use the drug order's `date_activated`, and facility and central figures for a
dispense-time window can legitimately differ
([reporting-etl.md](../../runbooks/reporting-etl.md) section 7). Attribution uses
`encounter.location_id`, falling back to `visit.location_id`.

### Diagnosis fact (`fact_diagnosis`)

- **Source:** `encounter_diagnosis`
  - `diagnosis_coded`, `diagnosis_non_coded`, `certainty` (CONFIRMED/PROVISIONAL), `dx_rank`,
    `encounter_id`, `patient_id`, `condition_id`, `voided`, `date_created`
- **Joined to:** `encounter` (`encounter_datetime`, `location_id`, `encounter_type`, `visit_id`)
- **Grouping:** add an ICD-10 group from `concept_reference_map` → `concept_reference_term`
  (source ICD-10-WHO, map types SAME-AS **and** NARROWER-THAN).
  - Checked in the exports: 116128 → B54, 160148 → B54 (narrower), 117399 → I10 (narrower),
    119481 → E14.9, 116023 → C53.9, 113753 → C50.9, 134788 → C61, 1295 → J44.9,
    113338 → N19, 114100 → J18.9, 142412 → A09.9.
- **Groups:**
  - malaria B50–B54
  - CVD I00–I99
  - cancer C00–C97
  - diabetes E10–E14
  - CRD J30–J98
  - renal N00–N19
  - pneumonia J12–J18
  - diarrhoea A00–A09
- **Written by:** the O3 Visit Note (encounter type Visit Note
  `d7151f82-c1f3-4152-a605-2f9ea7414a79`, the esm-patient-notes-app default; its diagnosis
  search is concept class *Diagnosis*). No LiberiaEMR form writes `encounter_diagnosis`.
- **Secondary source:** `conditions` (synced), for chronic NCD status.
- **Derived columns:** first-ever diagnosis per patient per group (incidence), and age at
  diagnosis.

### Lab-result fact with timestamps (`fact_lab_result`)

- **Source:** `orders` + `test_order`
  - `order_id`, `concept_id`, `patient_id`, `encounter_id`, `date_activated`,
    `fulfiller_status`, `voided`
- **Joined to:** result `obs` on `obs.order_id`
  - `concept_id`, `value_coded`, `value_numeric`, `obs_datetime`, `date_created`, `status`,
    `interpretation`, `voided`
- **Timestamps:**
  - `ordered_at` = `orders.date_activated`
  - `resulted_at` = result `obs.obs_datetime`, with `obs.date_created` as the entry-time
    fallback
- **Tests:** 1643, 32, 161426 set members, 160912, 887, 1458, 1006, 790, 164364, 857 and
  161132.
- **Flags:** a `positive` flag for malaria (value_coded IN 703, 161246, 161247, 161248) and
  threshold flags (glucose ≥126 mg/dL, cholesterol ≥5.0 mmol/L).
- **Assumption to verify on a live instance:** esm-laboratory-app writes the result obs with
  `order_id` set, into the order's encounter (Order `39da3525-afe4-45ff-8977-c53b7b359158`).
  Nothing in this repo configures that.

### Drug order and dispense fact with timestamps (`fact_drug`)

- **Source:** `orders` + `drug_order`
  - `drug_inventory_id`, `date_activated`, `date_stopped`, `auto_expire_date`, `quantity`,
    `patient_id`, `encounter_id`, `voided`
- **Left-joined to:** `medication_dispense`
  - `drug_order_id`, `drug_id`, `status`, `date_handed_over`, `location_id` (facility ETL only)
- **Timestamps:**
  - `prescribed_at` = `orders.date_activated`
  - `dispensed_at` = `medication_dispense.date_handed_over`
- **Drug-class tags** come from the concept sets proposed in section 1: ACT, SP, strong
  opioid, glucose-lowering, antihypertensive, antibiotic, ORS and zinc.
- **MAL-001 window:** `resulted_at ≤ treated_at ≤ resulted_at + 24h`, where `treated_at` is
  `dispensed_at` at facility level (falling back to `prescribed_at`) and `prescribed_at` at
  central.

### Death fact (`fact_death`)

- **Source:** `person` (synced)
  - `dead`, `death_date`, `cause_of_death` (coded), `cause_of_death_non_coded`, `birthdate`,
    `gender`
- **Joined to:** `person_address` (`state_province` = County, `city_village` = Health
  District)
- **Location:** `person` has no location, so take `location_id` from the patient's last
  `visit`/`encounter` on or before `death_date`.
- **Derived columns:**
  - age at death
  - an `under5` flag
  - a `30_69` flag
  - a coded cause group (only 6 coarse answers today)
  - a *proxy cause* = the ICD-10 group of the last `encounter_diagnosis` before `death_date`
    (label it as a proxy)
- **Coverage:** facility deaths recorded through *Mark patient deceased* only. There is no
  death form and no "Died" disposition.

## 3. Data shared with RMNCAH

One flat table can serve both the Malaria and the RMNCAH reviews.

- **IPTp in ANC (MAL-002, MAL-003, RMNCAH ANC):**

  | Concept | UUID |
  | --- | --- |
  | Woman receiving IPT | `ed584a40-5ea6-4111-a41b-39fd65200d38` (Yes 1065 / No 1066) |
  | MCH IPTp dose | `edf4344a-2e9f-4e0e-88d1-824bd3f25069` |
  | MCH dose answers: 1st / 2nd / 3rd / 4th | `025d9262-…` / `5b45044d-…` / `769be397-…` / `460f19eb-…` |
  | National IPT dose | `7d6e6ee9-7914-4d71-b84b-8383d39c30b9` |
  | National dose answers: 1st / 2nd / 3rd+ | `6ff4c373-…` / `802e28be-…` / `dc083ea2-…` |
  | Deferral | `22dae112-b695-4b93-9149-1755601f81cb` |
  | Trimester | CIEL 5272 → 3rd `5750e3ac-2e65-4a09-a789-c9b87a952634` |
  | Gestational age | CIEL 1438 / local `00663865-…` |
  | LLIN at ANC | `a1fe2d79-6a7b-46db-8562-e6a11922d76e` |
  | SP drug | `cbab62a0-6c0f-5bb1-8574-72b5af919098` |

  Encounter types are ANC Initial `1e4a7c92-…`, ANC Follow-up `3f6c9e14-…` and Consultation
  `dd528487-…` (national form). All of these are local CSV concepts, so the LIB/mch defect
  does not affect them.
- **Pneumonia and diarrhoea diagnoses (RMNCAH-018…021):**
  - Come from `fact_diagnosis`: pneumonia 114100 (J18.9), diarrhoea 142412 (A09.9), 1467,
    149856 and 142407.
  - Treatment comes from `fact_drug`: amoxicillin drugs `4c076228-…`, `7eb6de8c-…` and
    `a5211201-…`; ORS `8c266df2-…`.
  - **Zinc is not in the formulary.** CIEL 86688 is loaded, but no drug row uses it.
- **Under-5 deaths (RMNCAH-010/011/012):** come from `fact_death` with `under5`. Neonatal
  deaths need `death_date - birthdate ≤ 28 days`. Deaths outside a facility are not captured.
- **Malaria in pregnancy:** diagnoses 134594 and 135361 via `fact_diagnosis`, with the ANC
  deferral reason *Malaria treatment initiated* (`f9bc5cc3-…`).

## 4. Disaggregations the EMR cannot provide at all

- Socio-economic status or wealth quintile. No field anywhere.
- Education. No field.
- Urban/rural or remote-rural community type. The address hierarchy stops at County → Health
  District → Town/Community, with no classification.
- Marital status. Not in registration.
- Occupation or "category of people" beyond pregnant women (MAL-011).
- Private pharmacies, medicine stores and community (CHA) delivery points. LiberiaEMR is not
  deployed there.
- Place of residence finer than County/Health District, where the address was not filled.
  The fields are optional (`requiredInHierarchy=false`).
- Place of death, and deaths outside a facility.
