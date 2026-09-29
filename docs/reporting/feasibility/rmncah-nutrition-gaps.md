# RMNCAH and Nutrition feasibility: gaps and shared data elements

Companion to [`rmncah-nutrition.csv`](rmncah-nutrition.csv): 45 indicators, RMNCAH-009 to 030 and
NUT-001 to 023. The review ran against `main` at `811b1d7`.

| Classification | RMNCAH | Nutrition | Total |
| --- | --- | --- | --- |
| Feasible now | 7 | 3 | 10 |
| Feasible with content change | 2 | 1 | 3 |
| Needs new data capture | 3 | 6 | 9 |
| Not EMR-sourced | 10 | 13 | 23 |

How the classes were applied:

* **Needs new data capture.** No form, order or diagnosis in the repository records the element
  that defines the numerator.
* **Feasible with content change.** The numerator is captured, but a denominator, answer or
  concept set has to be added or fixed before the figure is right.
* **Population denominators.** Where the denominator is a population, the row is classed on
  its numerator and marked "numerator only".

How it was checked:

* Every UUID was resolved from `variables.properties`.
* Every form UUID was re-derived the way Initializer does it:
  `nameUUIDFromBytes("794c4598-…_<name>_<version>")`.
* Every question and answer concept was checked against the concept CSVs and against the OCL
  exports in `~/ocl-archive` (`lib-mch-ciel-1.0.5` plus the 18 common exports).

**Caveat.** The pin is `ocl.collection.version=1.0.11`, but the newest local export is 1.0.5.
Absence from 1.0.5 is therefore not proof of absence at runtime. The only question concept
missing from 1.0.5 is CIEL 160085, which was added in 1.0.8.

## 1. Content gaps (one ticket each)

1. **Birth outcome is not captured anywhere.** This blocks RMNCAH-027 and the denominator of
   RMNCAH-016. It is also the root cause for NUT-019, and for live-birth denominators in the
   other sheets.
   * No L&D form asks for live birth or stillbirth, and `Delivery Summary`
     (`var.form.delivery-summary.uuid`) is still unwritten.
   * `var.concept.ciel.birth-outcome.uuid`, Qualitative birth outcome CIEL 159917, is declared
     and present in OCL, but no form uses it. The DAK README confirms it has no such element.
   * **Ask:** add a per-baby Birth outcome question (live birth / fresh stillbirth / macerated
     stillbirth) to a new version of `3. Third Stage of Labor and Delivery` (v1.1), or write the
     Delivery Summary. A new version creates a new form UUID, so reports must union v1.0 and v1.1.
2. **Newborn data sits on the mother's chart.**
   * `3. Third Stage` records the baby's weight as `Weight (kg)` CIEL 5089, the same concept as
     the mother's weight, on the mother's encounter.
   * `Newborn PNC` is listed in `liberiaemr.forms.femaleOnlyUuids` (`gp-forms.xml`), so it
     cannot be filled on a male newborn's chart.
   * Child-level indicators therefore cannot rely on these forms: birth weight, NMR
     disaggregation, NUT-003 and NUT-019.
   * **Ask:** switch the baby weight to Birth weight CIEL 5916 in a new Third Stage version.
     Either remove Newborn PNC from the female-only list, or record it explicitly as
     mother-chart data.
3. **No nutrition (CMAM/OTP) programme.** This blocks NUT-007, NUT-010 and NUT-011.
   * **Ask:** a Nutrition programme with an admission form (MUAC, WHZ, oedema, admission
     criterion) and a workflow of exit states: cured, defaulted, died, non-response, transferred.
   * The SAM diagnoses (CIEL 163302 and relatives) and RUTF (`85be45f9-…`) already exist.
4. **No SGBV case form.** This blocks RMNCAH-022 and RMNCAH-029.
   * **Ask:** a clinical-management-of-rape/GBV form with type of violence, hours since
     incident, HTS offered and result, PEP given, and EC given.
   * Also add a levonorgestrel 1.5 mg Drug row to `drugs-pharmacy.csv`. CIEL 78796 exists as a
     concept only, and 160570 "Emergency contraceptive pills" is a MedSet.
5. **Immunization form has no Vitamin A Red answer** (NUT-006).
   * `Supplementary immunization activities` (`7b9409e2-…`) offers only
     `Vit.-A.Blue 100,000iu` (`eb2f71a4-…`).
   * **Ask:** add a `Vit.-A.Red 200,000iu` answer concept (local, national layer), and add MNP
     as an answer or Drug row (NUT-004). Both go into Immunization v1.2.
6. **No infant-feeding status per child** (NUT-003).
   * The only question is `Exclusive Breastfeeding` (`b16bbe12-…`), asked of the mother on the
     FP form for LAM.
   * **Ask:** add an infant-feeding question (exclusive / partial / none) to Newborn PNC and to
     the child immunization contact. Choose the CIEL term with the terminology owner; do not guess
     a CIEL id.
7. **No early-initiation-of-breastfeeding question** (NUT-019). Add "breastfed within 1 hour"
   per baby to Third or Fourth Stage, in the same new version as gap 1.
8. **Neurological-disorder concept set** (RMNCAH-030).
   * Add a reporting ConvSet that lists the qualifying diagnoses.
   * Add hydrocephalus to the `LIB/mch` (or a new) OCL collection. It is in no loaded dictionary.
9. **Cause-of-death answers are too coarse.** This affects NUT-010, the facility proxies for
   RMNCAH-009 to 012, and the mortality indicators on the Malaria and NCD sheets.
   * The global property `concept.causeOfDeath` points to
     `9272a14b-7260-4353-9e5b-5787b5dead9d`, whose OCL answers are only: Infectious disease,
     Other, Traumatic injury, Unnatural death, Neoplasm/cancer, Unknown.
   * No maternal, neonatal or SAM cause, and no malaria, CVD or diabetes cause, can be coded.
10. **FP encounter-type variable is declared twice with different values.**
    * `var.encountertype.family-planning.uuid` is `87cba9c7-e1c9-4919-8b55-1251670d43d5` in
      content-liberia-national and `d260ac4b-8e21-4045-8bed-8cf60ad4b6c3` in
      content-liberia-mch.
    * The national `Family Planning` row and the MCH `Family Planning Visit` row therefore
      resolve to one UUID in the merged tree, and which name survives depends on load order.
    * `validate-content.sh` checks for duplicates within a file only, so it does not catch this.
    * **Ask:** give the MCH type its own key. Until then, reports should key on the form UUID.
    * **Resolved (LE-343).** The MCH type is now `var.encountertype.mch-family-planning.uuid`,
      with its value unchanged. `validate-content.sh` fails on a key that differs between
      programme layers, and on a UUID declared under two names.
    * **Correction to the second bullet.** The two rows never collapsed into one. Each package
      filters its own `variables.properties` last, so the national row resolved to `87cba9c7-…`
      and the MCH row and form to `d260ac4b-…`. The real hazard was that the national key's
      value depended on which chain resolved it. The ETL and QA chains got MCH's value; the
      reports module, filtered from the national file only, got national's.
11. **Repo form variables for OPD and Triage are not the runtime UUIDs.**
    * `var.form.opd-consultation.uuid=96b72a44-…` and `var.form.triage.uuid=cc825000-…` hold the
      JSON `uuid` literal, which `AmpathFormsLoader` ignores.
    * The runtime UUIDs are `0144c282-738a-375a-a7c4-8f2c80075899` (OPD Consultation Form v2.0)
      and `869443be-61f3-397f-be1c-ee3dcb591149` (Triage Form v2.0).
    * `1. ANC Form` v1.1 (`bd1ae06c-f522-34dd-816f-1235c89bebee`) has no variable at all.
    * **Ask:** set these variables to the derived values, as the MCH README already requires.
    * **Fixed (LE-344):** both variables now hold the derived UUIDs, `var.form.anc-national.uuid`
      is declared, and the ETL matches both forms on those tokens. `validate-content.sh` now
      fails on any `var.form.*` that is not the derived UUID of a form.
12. **The L&D encounter type is not the one the MCH config expects.**
    * All four labour forms and the partograph save under the national `Labor & Delivery` type
      (`659775fb-05e4-427f-8d9f-7e4cabe19962`).
    * `config-mch.json` points the e-partograph and chart extension at `Partograph Observation`
      (`9e2c4f70-…`) and `Delivery` (`7c0a2d58-…`), which no form writes.
    * Reports must use `659775fb` together with the form UUID.
13. **ANC is captured by two form families that use different concepts.**
    * The families are `ANC Initial`/`ANC Follow-up` (MCH) and `1. ANC Form` (national, published,
      on the shared `Consultation` encounter type).
    * Gestational age: 1438 on ANC Initial, local `00663865-…` on ANC Follow-up.
    * Fundal height: 1439 on ANC Initial, local `c696ec1b-…` on ANC Follow-up.
    * IPT dose: MCH `edf4344a-…` with answers 1st to 4th; national `7d6e6ee9-…` with 1st, 2nd
      and 3rd+.
    * **Ask:** retire `1. ANC Form`, or document it as supported. Either way the ETL must union
      both families.
14. **Delivery method answers.** `Delivery method` (`1b4f3a40-…`) offers only SVD and Caesarean,
    so assisted vaginal and breech deliveries cannot be separated (RMNCAH-026). The DAK
    duplicates this element (LBR.LD.DE.12 and .95).
15. **Place of delivery answers** (RMNCAH-028). The only answers are Home and Health facility;
    add "en route/other".
16. **Paediatric antibiotic formulary** (RMNCAH-021). Amoxicillin is available only as 250 mg and
    500 mg capsules, with no dispersible tablet or suspension. Paediatric zinc is also absent,
    which matters for ORS+zinc if MOH adds it.
17. **`LIB/mch` still carries zero mappings.** No `Same as` mapping reaches the runtime.
    * Local answer concepts cannot be aggregated by CIEL code, so the ETL must key on the local
      UUIDs recorded in the CSV: Home, SVD, the FP methods, the IPT doses and Vit-A Blue.
    * No Feasible-now row depends on a coded answer that fails to resolve. Every answer used
      exists either as a local concept or as a CIEL concept in the collection.

## 2. Data elements shared with other sheets

One flat table per group below should serve every listed indicator.

* **ANC visit table** (ANC Initial, ANC Follow-up and 1. ANC Form, one row per contact, with a
  pregnancy-episode key from LMP 1427 or ANC programme enrolment `38c602a1-…`). It serves
  RMNCAH-016 and **MAL-002/003**.
  * IPTp dose: MCH `edf4344a-2e9f-4e0e-88d1-824bd3f25069`, answers `025d9262` / `5b45044d` /
    `769be397` / `460f19eb`; national `7d6e6ee9-4d71-b84b-8383d39c30b9`, answers `6ff4c373` /
    `802e28be` / `dc083ea2`.
  * Woman receiving IPT `ed584a40-5ea6-4111-a41b-39fd65200d38`; IPTp deferral reason
    `22dae112-b695-4b93-9149-1755601f81cb`.
  * Pregnancy trimester `5272AAAA…` with 3rd-trimester answer `5750e3ac-2e65-4a09-a789-c9b87a952634`,
    which is the MAL-003 denominator.
  * Gestational age (1438 and `00663865-9680-476c-9033-60bd55e15970`); ANC visit number
    `94028f5e-…`, which is the MAL-002 denominator (first ANC).
  * LLIN received at ANC `a1fe2d79-6a7b-46db-8562-e6a11922d76e`, for **MAL-011**.
  * The SP drug `Pyrimethamine Sulfadoxine` (concept `35191c44-1b60-4f6f-b378-d3bc34b83612`)
    exists in the formulary as an alternative IPTp source.
* **Under-5 illness episode table** (visit-note diagnoses plus drug orders and dispenses by
  visit, with age in months). It serves RMNCAH-018 to 021 and **MAL-001/004/015/016**: the same
  diagnosis and ACT-order join, with an RDT lab result. It also serves NUT-007/010 SAM diagnoses.
* **Anthropometry table** (weight 5089, height 5090, MUAC 1343, W/Z score `67bae27d-…`, BMI
  1342 from Triage, OPD and the vitals app, plus ETL-derived WHZ/HAZ/WAZ). It serves NUT-008,
  NUT-009, NUT-012 to 014 proxies and **NCD-008** (adult BMI proxy).
* **Delivery table** (L&D forms: delivery method, baby sex, weight, APGAR, and birth outcome once
  gap 1 lands). It serves RMNCAH-014, 016, 026, 027, NUT-019, and any live-birth denominator.
* **Deaths table** (`person.dead`, `death_date`, `cause_of_death`, age at death, last visit
  location). It serves the RMNCAH-009 to 012 proxies, NUT-010, **MAL-018** and **NCD-001 to
  004**. Gap 9 limits every one of them.
* **Haemoglobin** (CIEL 21 from lab results and Mother PNC). It serves NUT-002/015 proxies and
  NCD work.
* **Form and encounter identity.** Gaps 10 to 12 (duplicate FP key, stale OPD/Triage form
  variables, the L&D encounter type) affect every sheet and the **EMR-Operational**
  completeness indicators.

## 3. Disaggregations the EMR cannot provide

| Disaggregation | Status in the repository |
| --- | --- |
| Socio-economic status / wealth quintile | No person attribute. The only types are Purpose of Visit, Referred From, Referred By, Referral Reference Number, Reason for Referral, Telephone Number and Unknown patient. |
| Place of residence, urban/rural | No field. The address hierarchy is County (`STATE_PROVINCE`) → Health District (`CITY_VILLAGE`), with Town/Community (`ADDRESS_2`) as free text. County and district are available; urban/rural is not. |
| Education | No attribute. Needed for RMNCAH-017. |
| Marital status | No attribute. Needed for RMNCAH-014. |
| Facility type | No location attribute. The MFL carries type as a DHIS2 group set, not yet integrated. |
| Cadre of professionals | No provider attribute. Only the encounter provider is known. |
| Birth weight | Captured only on Newborn PNC (5916), and that form is female-only (gap 2). |
| Breastfeeding status, disability, emergency-affected status | Not captured. |
| Age, sex, facility, month/season, provider | Supported: birthdate, gender, encounter location, encounter datetime, encounter provider. |
