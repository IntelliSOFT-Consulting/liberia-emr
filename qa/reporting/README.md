# Indicator-report fixtures and expected values

This directory holds the synthetic dataset and the hand-computed expected values for the 21
*Feasible now* indicators of the MOH indicator reports (LE-336, parent LE-326), and the
scripts that compare a stack's reports with them. CI runs the Careysburg comparison on a clean
facility stack (`run-stack-check.sh`, in the *Initializer against a clean database* job);
central's is run by hand. How and why is in the ETL runbook,
[docs/runbooks/reporting-etl.md](../../docs/runbooks/reporting-etl.md) section 10.

The indicator definitions come from the feasibility matrix, `docs/reporting/feasibility/*.csv`
and the `*-gaps.md` files beside it. The deployment model and location attribution come from
[ADR 0010](../../docs/adr/0010-indicator-reporting-mamba-etl.md) and
[`docs/reporting/README.md`](../../docs/reporting/README.md).

| File | Format | What it is |
| --- | --- | --- |
| `fixtures/patients.csv` | CSV, one row per patient record | 113 synthetic patient records: 81 at Careysburg and 32 at Barnersville |
| `fixtures/forms.csv` | CSV | The 11 forms that encounters reference, by `${var.*}` or `form:<name>@<version>`. One of them, ANC Initial Visit v1.1, is created retired if it is missing |
| `fixtures/encounters.csv` | CSV | 147 encounters: time, type, form, location, back-dated entry time, voided flags |
| `fixtures/obs.csv` | CSV | 182 observations: numeric, coded (`${var.*}` or `CIEL:<id>`) or `date:YYYY-MM-DD`, with a result time and an order for lab results |
| `fixtures/diagnoses.csv` | CSV | 30 `encounter_diagnosis` rows, as written by the O3 Visit Note |
| `fixtures/orders.csv` | CSV | 33 orders: 12 drug orders and 21 test orders |
| `expected-values.csv` | CSV, 14 columns | 336 rows: 21 indicators × 2 periods × 8 instance and scope pairs |
| `load-fixtures.py` | Python 3, standard library only | Lints the fixtures, prints the SQL, or loads it into a stack's database. `load-late-row` adds the one row the incremental-run check needs |
| `compare-reports.py` | Python 3, standard library only | Runs the five reports on a stack through reportingrest and compares them with `expected-values.csv`; `--dump` writes every data set it read |
| `compare-instances.py` | Python 3, standard library only | From two `--dump` files, checks that a facility's reports equal central's reports scoped to it, every column, EMR-OPS-007, EMR-OPS-015 and MAL-001 excepted by default |
| `run-stack-check.sh` | bash | The ETL's definition of done on a fresh stack: loads the fixtures, runs the ETL in full and then incrementally, compares the reports, and checks the ETL user, its error log and the binlog |

The `purpose` column explains each row that exists for a particular indicator or edge case.

## The dataset

**Periods.** There are two calendar quarters: `2026-Q1` (1 January to 31 March 2026) and
`2026-Q2` (1 April to 30 June 2026). Both are inclusive, from 00:00:00 to 23:59:59, as §3.2 of
the contracts page requires. A few events sit before Q1, in 2025, to give look-back
indicators some history. One event sits just after Q2, on 1 July 2026 at 00:00:00.

**Facilities.** Careysburg Health Center (Careysburg District) and Barnersville Health Center
(Greater Monrovia District) are both in Montserrado County. Each has a site package. Events are
recorded at the site's OPD, Maternity or Laboratory, so a report must roll departments up to
their facility root.

**People.** Every record is marked as synthetic:

- the given name is `Qa` and the family name is `Rpt <key>`;
- MOH Health Record Numbers are `<site prefix>-QA<nnnn>`;
- National IDs are `QA-NID-<nnnn>`.

All patients are registered on 15 December 2025, or at 07:00 on the day of their first
encounter if that is earlier. Each calendar day a patient has encounters gives one visit,
located at the facility root.

**Edge cases.** Each case below is covered by the rows listed:

| Edge case | Rows |
| --- | --- |
| Age-band boundaries | exactly 6 months (`C-VITA1`); 5 months 27 days (`C-VITA2`); exactly 12 months (`C-VITA3`); 11 months 29 days (`B-VITA1`); exactly 60 months (`C-MUAC3`, `C-DIA2`, `C-PNE4`); 59 months (`C-MUAC4`, `C-DIA3`, `C-PNE3`, `B-WHZ2`); 17 years (`C-BP4`, `C-CHOL3`, `C-REN4`); the 18th birthday (`C-BP5`); the 30th birthday (`C-DTH3`); exactly 70 (`C-DTH2`); 49, turning 50 between the two period ends (`C-FP5`) |
| Value thresholds | MUAC exactly 11.5 (`C-MUAC5`); BP 139/89 and 120/90 (`C-BP2`, `C-BP3`); cholesterol exactly 5.0 (`C-BP1`); gestational age exactly 28 and 27 (`C-ANC1-3`, `C-ANC6-1`); WHZ below −3 (`C-WHZ4`) |
| Voided encounters | `C-ANC4-1`, `C-FP6-1`, `C-LD4-1` (its visit is voided too) |
| Voided obs and diagnoses | `C-ANC4-2` (a 3rd dose replaced by a 2nd), `C-VITA6-1`, `C-MUAC8-1`, `C-BP7-1`, `C-MAL4-1`, `C-REN5-1`; the diagnoses on `C-DIA6-1` and `C-CAN3-1` |
| One patient at both facilities | person X is `C-X` and `B-X`: same name, birthdate, sex and National ID `QA-NID-0001` |
| Old and new form versions | ANC Initial Visit v1.1 (`C-ANC2-1`) and v1.2; 3. Family Planning v1.0 (national, `C-FP2-1`) and v2.2 |
| Both ANC form families | MCH ANC Initial/Follow-up, and the national `1. ANC Form` (`C-ANC3`, `B-ANC2`) |
| Forms on the shared Consultation encounter type | `1. ANC Form`, `3. Family Planning` v1.0, Immunization, OPD Consultation Form (`B-BP2-1`) |
| Events at period boundaries | 31 March at 23:59:59 (`C-ANC2-2`, `C-MAL5` result, `B-PNC2-1`); 1 April at 00:00:00 (`C-ANC3-1`); 30 June at 23:59:59 (`C-ANC3-2`, `B-DIA3-1`); 1 July at 00:00:00 (`C-LD3-1`); an episode that spans the Q1/Q2 boundary (`C-DIA5`) |
| Death with no encounter | `C-DTH1`–`C-DTH4` and `B-DTH1`: the death is on `person` only, and location comes from the last visit |
| Encounter with no location | `C-MUAC7-1`, attributed by its visit's location |
| Same-day versus back-dated entry (EMR-OPS-008) | `C-MUAC7-1` (3 days late), `C-PNE2-2` (7 days), `B-PNC2-1` (entered after midnight), `B-BP2-1` (2 days); every other encounter is entered at `encounter_datetime` |
| Duplicate-patient pairs (EMR-OPS-007) | `C-DUP1A`/`B` share name, birthdate and sex, with no National ID. `B-DUP2A`/`B` also share a National ID, so central's CPI service links them |
| Identifier consistency (EMR-OPS-015) | `C-ANC1` has a voided, re-issued HRN; `B-PNE1` holds two live HRNs |
| Repeats and episodes | two L&D forms for one delivery (`C-LD2`); two PNC visits for one delivery (`C-PNC1`); diarrhoea on days 0, 9 and 31 (`C-DIA4`); a positive RDT and then a positive smear 10 days later (`C-MAL3`); a repeat cancer diagnosis (`C-CAN1`) |
| Trap values | a triage W/Z score of −2.6, which is weight-for-*age*, on a child whose WHZ is normal (`C-WHZ3`); weight and height recorded on different encounters (`C-WHZ5`); Vitamin A 200 000 IU (`C-VITA5`); ORS ordered in a later visit (`C-DIA7`) |

## UUIDs: none in the committed files

`CONTRIBUTING.md` forbids hard-coded UUIDs in forms, reports and frontend JSON. `qa/` already
follows the same rule for metadata: the sync drills resolve metadata by name at run time, and
the only literals are platform-fixed ones such as the daemon and admin users. These fixtures
go further and hold **no UUID at all**. `load-fixtures.py lint` fails on any dashed or
CIEL-shaped literal.

| Reference | Written as | Resolved by the loader to |
| --- | --- | --- |
| Metadata with a variable | `${var.concept.ciel.muac.uuid}` | the value from `variables.properties`, in the build's filter order: common, national, mch, lab, pharmacy, opd-ipd, then the patient's site package; a later value wins |
| A CIEL concept with no variable | `CIEL:161132` | `161132AAAA…`, the 36-character CIEL UUID |
| A form with no variable | `form:3. Family Planning@1.0` | Initializer's derivation `nameUUIDFromBytes("794c4598-…_<name>_<version>")` |
| The fixture's own rows | the row key, e.g. `C-ANC1-3` | `nameUUIDFromBytes("liberiaemr-qa-reporting/LE-336/<kind>/<key>")`, identical on every load |

UUIDs therefore appear only in the generated SQL, which is never committed. `load-fixtures.py
sql` prints it for review.

Two resolutions to know about:

- **FP encounters use `var.encountertype.mch-family-planning.uuid`**, *Family Planning Visit*,
  the encounter type of the v2.2 form. `var.encountertype.family-planning.uuid` is the national
  layer's separate *Family Planning* type, which no form uses. Until LE-343 the MCH type shared
  that key with a second value (rmncah-nutrition gap 10), and the chain resolved it to MCH's.
- **Forms with no variable** are referenced by `form:`: `3. Family Planning` v1.0, and the
  retired `ANC Initial Visit` v1.1. Every `var.form.*` holds the runtime uuid Initializer
  derives from the form's name and version (gap 11, fixed by LE-344), and `validate-content.sh`
  checks it, so a form that has a variable is referenced by it.

## Loading

`load-fixtures.py` writes rows with SQL through `docker exec <db> mariadb -uroot`, the access
the `qa/sync` drills use. It does not go through REST, for three reasons:

- REST cannot set `encounter.date_created`, which EMR-OPS-008 is measured on;
- REST cannot give fixture rows fixed UUIDs;
- REST cannot create the retired old form version.

At a facility, the inserts reach the binlog, and dbsync carries them to central like any
clinical data.

The whole load runs in one transaction. It starts with a guard that stops the load, with
nothing written, in two cases:

- the fixtures are already present;
- any referenced concept, form, drug, encounter type, location, visit type or identifier type
  is missing. The missing items are listed.

Load the fixtures onto a **fresh stack** only: there is no unload. Several expected values
count every patient or encounter in the database: EMR-OPS-007, 008 and 015, and the
denominators. They assume the fixtures are the database's only clinical data.

```bash
qa/reporting/load-fixtures.py lint                                   # offline; no stack needed
qa/reporting/load-fixtures.py sql --site careysburg --out /tmp/c.sql # review the SQL
```

**Facility stacks.** Load each facility stack with its own site. The stack must have been
built with that `SITE_PACKAGE`, or the guard stops on the missing facility root:

```bash
qa/reporting/load-fixtures.py load --site careysburg   --db-container <careysburg db container>
qa/reporting/load-fixtures.py load --site barnersville --db-container <barnersville db container>
```

**Central, through sync.** This is the path the consistency check needs. Prepare central first,
then load each facility as above and wait for sync to catch up:

```bash
qa/reporting/load-fixtures.py prepare-central --db-container <central db container> [--admin-hierarchy]
```

`prepare-central` does three things:

- **Barnersville's locations.** It creates any location that central lacks, from each site
  package's `locations` CSV, with the same UUIDs, parents and tags. Central is built with one
  site package, and the receiver rejects records at an unknown location (ADR 0010,
  Consequences).
- **The old form version.** It creates the retired ANC Initial Visit v1.1 form row. Forms are
  metadata, and metadata is not synced.
- **County and District parents, with `--admin-hierarchy`.** It creates *Montserrado*,
  *Careysburg District* and *Greater Monrovia District* from the site variables, and parents
  each facility root under its district. Use this only until the MFL sync (ADR 0009, LE-317)
  provides the real nodes. Without some such hierarchy, the district and county rows cannot
  be run.

**Central, loaded directly** (no sync): run `prepare-central`, then `load --site all` against
central's database. Use this for the central report checks when sync itself is not under test.

**After loading at central**, wait for the CPI service (`IdentityService`) to process the new
patients before checking EMR-OPS-007 or EMR-OPS-015, or anything else that counts persons. It
links `C-X`/`B-X` and `B-DUP2A`/`B-DUP2B` on their National IDs. At a facility, nothing needs
to wait: the ETL runs on its own schedule, or `setupEtl()` can be run for a full build.

## `expected-values.csv`

| Column | Meaning |
| --- | --- |
| `indicator` | The matrix code, e.g. `MAL-002` |
| `period`, `period_start`, `period_end` | `2026-Q1` or `2026-Q2`; these are the report's `startDate` and `endDate` |
| `instance` | `facility:careysburg` and `facility:barnersville` are the facility's own stack, with `LIBERIAEMR_INSTANCE_ROLE=facility`. `central` is the central stack |
| `scope_level`, `scope` | The report's `location` parameter: `facility` (a Health Center), `district`, `county`, or `national` (no location) |
| `numerator`, `denominator` | Hand-counted from the fixtures. `denominator` is empty for numerator-only and count rows |
| `value` | 100 × numerator ÷ denominator, rounded to 1 decimal. It is empty when there is no denominator or the denominator is 0 |
| `value_kind` | `percent`; `numerator only (population denominator)`; `count indicator`; or a note that a percentage is crude, or uses the facility denominator where the sheet has a population one |
| `alt_numerator_by_record`, `alt_denominator_by_record` | Only where central's result depends on counting persons rather than patient records. These are the values if central counts records. See ambiguity 13 |
| `reasoning` | One line: which fixture rows count and which are excluded, and why |

Each indicator and period has eight rows:

- **Two facility-instance rows.** Each facility sees only its own data.
- **Central, for each facility.** This equals the facility instance, which is the consistency
  check, except for EMR-OPS-007 and 015, where the matrix gives central its own definition.
- **Central, for each district.** Each district has one fixture facility.
- **Central, for Montserrado and nationally.** The two are equal, because both facilities are
  in Montserrado. Here patient-level counts take each person once.

Both periods are before today, so no event is in the future.

**How the later tests compare.** For each row, the test runs the sheet's report through
reportingrest (`reportDataSet/{reportUuid}/indicators`, contracts §4) on the named instance,
with `startDate`, `endDate` and `location` set from the row. It then compares these columns:

| Report column | Expected-values column |
| --- | --- |
| `<CODE>_NUM` | `numerator` |
| `<CODE>_DEN` | `denominator`, when present |
| `<CODE>_PCT` | `value`, when present, to within 0.05 |

`<CODE>` is the code upper-cased with `-` replaced by `_`, per §3.3. A numerator-only row must
have no `_DEN` value, or an empty one. The consistency check re-uses the central facility rows
against the facility instance's rows.

## Definitions adopted, and the ambiguities

Where the matrix is ambiguous, the reading is the one in the CSV notes. Where the notes say
nothing, the reading is stated here, and the fixtures are built so that the reasonable
alternatives give the same number wherever possible.

1. **MAL-003 (MOH decision LE-356).** The sheet's numerator text ("three or more doses")
   conflicts with its name ("two doses in the third trimester"). Adopted the CSV note:
   - **denominator:** women with a 3rd-trimester ANC contact in the period, meaning trimester =
     3rd, or gestational age of at least 28 weeks on either concept;
   - **numerator:** those with an IPTp dose of 2nd or higher on such a contact.
2. **NUT-005 (LE-356).** Implemented as named, per the CSV: children aged 6–11 months who got
   Vitamin A Blue, from either the Immunization form or a 100 000 IU drug order. Each child is
   counted once. A 200 000 IU order does not count.
3. **NUT-009 (LE-356).** Implemented as named, per the CSV: moderate wasting, with WHZ in
   [−3, −2).
   - WHZ is computed from same-encounter weight and height, with the WHO 2006 LMS tables:
     weight-for-length under 731 days of age, weight-for-height from then on. The WHZ fixture
     children (`C-WHZ*`, `B-WHZ*`) are all 24–59 months old, so they exercise only the
     weight-for-height table.
   - The triage W/Z score is weight-for-age and is ignored.
   - The report counts a child if **any** measurement in the period is in the band. Each
     fixture child has one measurement, so "latest" and "any" give the same count.

   The MOH's options for all three rows, and NUT-007's, are in
   [`docs/reporting/moh-decisions-le-356.md`](../../docs/reporting/moh-decisions-le-356.md).
   - NUT-007 is *Needs new data capture*, so it is not in this set.
4. **Numerator-only rows.** These are RMNCAH-017, 019, 020 and 028, NUT-005, MAL-004, NCD-002
   and NCD-005. NUT-009 is a count. They have no denominator or value; the population is not
   in the EMR.
   - RMNCAH-026 and NUT-008 carry the facility denominator from the CSV. The sheet's
     denominator is a population.
   - The CSV marks RMNCAH-017, 019, 020 and 028 as numerator only.
5. **RMNCAH-017 protection windows.** The CSV gives ranges; the values used are:
   - injectable: 3 months;
   - pills: 1 month (the lower bound);
   - implant: 3 years;
   - IUD: 10 years.

   No fixture falls between the bounds of a range. Other rules:
   - "Latest FP encounter" is the latest on or before the period end, from any version of
     `3. Family Planning`. This follows contracts §2.3, "every version of the form included".
     The matrix row lists only v2.2.
   - A removal date on that encounter ends use.
   - Age 15–49 is measured at the period end.
6. **Episode windows.** These are proposals in the CSV notes:
   - 14 days for diarrhoea and pneumonia;
   - 28 days for confirmed malaria;
   - 42 days for one delivery (RMNCAH-026 and 028).

   An episode belongs to the period of its first event, looking back across the period start.
   The repeats are spaced so that a sliding window and a fixed window agree.
7. **RMNCAH-018 and 021 count distinct children**, per the CSV text, not cases.
   - "Same visit" means the drug order's encounter is in the diagnosis encounter's visit.
   - The order is used, not a dispense. There are no `medication_dispense` rows, so the
     facility and central values are equal.
   - No row in this set has a dispense-based time window. The central order-time rule (LE-358)
     matters from MAL-001 on: `medication_dispense` is not synced, so central times treatment by
     the order and a facility by the dispense (`docs/runbooks/reporting-etl.md` section 7).
     `compare-instances.py` skips MAL-001 by default for that reason. A fixture that adds a
     dispense must add an expected row for each instance, and they may differ.
8. **Numerators that are not subsets of their denominators.** For MAL-002 and NCD-015 the CSV
   defines the numerator independently of the denominator. Careysburg Q2 for MAL-002 is
   therefore 2/1 (200.0%), and this is deliberate. The CSV says to report both parts and let
   the MOH choose.
9. **NCD-007 and NCD-011 are crude, not age-standardised.**
   - The CSV names WHO standard weights but not the bands for 18+. The rows carry crude values,
     and the reasoning lists the ages.
   - Each person's latest reading in the period is used.
   - The local ANC BP concepts are included. Pregnant women are *not* excluded: the CSV says
     "probably" but lists the ANC concepts.
10. **NCD-005 "first ever"** is judged within the report's scope, for each person and cancer
    type.
    - At a facility, "first ever" means new to that facility. Central, filtered to that
      facility, must give the same, which is the consistency rule.
    - Roll-ups use the person's first diagnosis anywhere in the scope. So person X's cervical
      cancer counts at Barnersville in Q2, but not in Montserrado or nationally.
11. **Ages** are completed months or years (`TIMESTAMPDIFF`) at the event date. RMNCAH-017 is
    the exception: age there is taken at the period end.
12. **Location and period.** Location is `encounter.location_id`, or `visit.location_id` when
    that is null, rolled up to the facility root. For deaths, it is the location of the last
    encounter on or before `death_date`. Periods compare against the event time:
    - `encounter_datetime` for encounters and diagnoses;
    - `obs_datetime` for lab results;
    - `date_activated` for orders;
    - `death_date` for deaths.
13. **"Each person once" at central.** ADR 0005 links records and never merges them, so person
    X has two patient records at central. Person-level counts use the primary CPI in
    `openmrs_identity`. Two rows depend on this:
    - MAL-002 Q1 national: denominator 3 by person, 4 by record;
    - NCD-005 Q2 county and national: 1 by person, 2 by record.

    The `alt_*` columns hold the by-record values. Counting by person needs central's ETL or
    report to read `openmrs_identity`. The ETL user's grants in ADR 0010 cover only `openmrs.*`.
14. **EMR-OPS-007.**
    - **Facility numerator:** the records that share name, birthdate and sex, or an
      identifier. That is 2 per pair, per the CSV numerator text; the name suggests counting
      persons.
    - **Central numerator:** CPI groups with more than one record at the same facility.
    - **Denominators:** a stock of patients (facility) or primary CPIs (central). Every
      fixture patient is registered before Q1, so Q1 and Q2 are equal.
    - **Not exercised:** `person_merge_log` merges. Open `match_review` rows are expected to
      be 0.
15. **EMR-OPS-015.** "Two or more visits" counts non-voided visits that start in the period. A
    visit whose only encounter is voided still counts (`C-ANC4`). Central counts per person,
    across that person's records.
16. **EMR-OPS-008.** This counts encounters, not people, so roll-ups are sums. The excluded
    system types are those listed in the CSV; of them, the fixtures use only *Order*. Voided
    encounters (`C-ANC4-1`, `C-FP6-1`, `C-LD4-1`) are out of both the numerator and the
    denominator, per the CSV's `voided=0`. Each row's `reasoning` gives the count as
    encounters in the period, minus Order, minus voided.

## What the test step needs from the other workstreams

- **RPT 11 (reports scaffold)** must provide:
  - the report and design UUID variables (§3.1), and the parameters `startDate`, `endDate` and
    `location` (§3.2);
  - the data set key `indicators`, with columns `<CODE>_NUM`, `<CODE>_DEN` and `<CODE>_PCT`.
    Numerator-only rows expose `_NUM` only;
  - `_PCT` as a percentage (0–100), not a fraction;
  - a failed report for a facility asked about a location outside its clamp.
- **RPT 5 (ETL)** must provide:
  - `mamba_dim_location_hierarchy`, which rolls OPD, Maternity and Laboratory up to the
    facility root and reads a County or District parent when one exists;
  - `mamba_dim_encounter_form`, which must include retired form versions (ANC Initial v1.1);
  - the encounter → visit location fallback;
  - a way to reach `openmrs_identity` at central (a grant or a copied dimension), for ambiguity
    13;
  - variables for the derived form UUIDs that gap 11 lists. The ETL cannot use the `form:`
    shorthand the loader uses.
- **RPT 8 (report definitions)** must:
  - confirm or override each reading in the list above. A changed definition changes the
    matching rows here, in the same PR;
  - record `report_uuid` in the matrix;
  - honour `LIBERIAEMR_INSTANCE_ROLE` and the location clamp.
- **Stacks.** They need MariaDB 10.11 with the ADR 0010 flags, a clean database, and central
  holding both sites' locations (`prepare-central`). The district and county rows also need a
  County and District hierarchy, from the MFL sync or `--admin-hierarchy`.

## How the values were checked

The expected values were counted by hand from the fixture rows, as the `reasoning` column
records. As a cross-check, the fixtures were loaded (`load --site careysburg`, then
`prepare-central --admin-hierarchy` and `load --site barnersville`) into a throwaway
MariaDB 10.11 copy of a 1.0.0 facility database. Content added since 1.0.0 was stubbed, because
the guard lists it as missing. Every facility and national cell was then recomputed with
independent SQL. All 132 compared cells matched, and so did the by-record alternatives and central's own EMR-OPS-015 facility values. The
exceptions are:

- **NUT-009**, whose WHZ values were computed from the WHO LMS tables instead;
- **EMR-OPS-007**, which was counted from the load's own totals.

A second, scripted recount was made straight from the fixture CSVs and the matrix rows, with
voided encounters, obs, diagnoses and orders dropped and the matrix's encounter-type
exclusions applied. It matched all 312 rows it covers, which is every row except the 24
central EMR-OPS-007 and EMR-OPS-015 rows. Those depend on CPI linking, and they were checked by
hand.

This check does not replace running the loader on a stack built from `main`, which the test
step does.
