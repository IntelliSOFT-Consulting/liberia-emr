# Runbook — DAK data dictionary → Initializer configuration

How to turn a row of the Liberia DAK data dictionary into loaded OpenMRS metadata, without
duplicating CIEL, breaking the layer order, or losing the answer to "where does this field
come from?".

> **Partly rehearsed.** Steps 1–4 and 6 have been run against the real DAK once, on
> 2026-07-30, to produce [`../dak/traceability-mch.csv`](../dak/traceability-mch.csv) — that
> pass is what the DAK-specific warnings below come from. Steps 5 and 8 (writing a row,
> loading it) are taken from working content and are accurate, but no new concept has yet
> been carried through this procedure end to end. When you carry the first one, correct what
> is wrong here in the same PR.

Read first, once: [IMPLEMENTATION.md §5](../../IMPLEMENTATION.md) (build order), §7
(variables), §9 (append-only), and [CONTRIBUTING.md](../../CONTRIBUTING.md) (change
classification, layer order).

---

## Before you start

| You need | Where it comes from |
| --- | --- |
| The DAK data dictionary | The **Liberia EMR data dictionary** Google Sheet — cited in full in [docs/dak/](../dak/). Export it as `.xlsx` and read the sheets; a text or Markdown export silently truncates every tab at ~50 rows. |
| A CIEL dictionary you can search | OCL. `scripts/build/fetch-ciel.sh` is unimplemented pending MOH OCL credentials, so **CIEL does not load locally** ([local-development.md §5](local-development.md)). Until it does, look concepts up in the OCL web UI. |
| A running local stack | [local-development.md](local-development.md) §1 |
| The clinical decision-maker's time | Steps 4 and 9. Most of the cost of this job is unanswered clinical questions, not typing. |

**The sheet is live and unversioned.** Metadata is append-only once released
([IMPLEMENTATION.md §9](../../IMPLEMENTATION.md)), so a concept extracted from a snapshot that
later changes cannot simply be corrected — it has to be retired and migrated. Put the date you
read the sheet in the `dak_read_date` column of every traceability row you add or re-read
(§6), and press for a frozen copy before the go-live scope is locked.

**Two structural warnings about this DAK**, both of which will bite step 2:

- **Data element IDs are not unique.** `LBR.EMR.DE.1`–`.19` exist on both the ANC and
  Registration tabs with entirely different meanings. Always record the tab alongside the ID.
- **The ANC tab's values sit one column left of its headers.** The real data type is under
  *Multiple Choice Type*; optionality is under *Validation Condition*. The other MCH tabs are
  aligned. Read ANC by position.

---

## 1. Take one DAK activity at a time

Work an activity (ANC contact, labour admission, FP visit) to completion — through
validation and a load — before starting the next. A half-extracted sheet spread across three
domains is the state in which duplicate concepts get created, because nobody can see what is
already declared.

Within the activity, follow the build order. It is not advisory:

```text
concepts → identifiers/locations/providers → visit & encounter model
        → programmes & workflows → forms → frontend config → reports → integrations
```

## 2. Classify each data element by Initializer domain

Each DAK row becomes a row in exactly one domain directory under
`content-packages/<layer>/configuration/backend_configuration/`:

| What the DAK row describes | Domain directory |
| --- | --- |
| An observation, question, or coded answer | `concepts/` |
| A register or card number | `patientidentifiertypes/` |
| A service delivery point | `locations/`, `locationtags/` |
| A contact/encounter kind | `encountertypes/` |
| A visit episode | `visittypes/` |
| Enrolment, status, or outcome | `programs/`, `programworkflows/` |
| A medicine or dose schedule | `drugs/`, `orderfrequencies/` |
| Who may record it | `roles/`, `privileges/` |
| A questionnaire layout | `ampathforms/` — **last**, see §5 of the build order |

A DAK row that describes a *calculation* (EDD from LMP, gestational age, an alert threshold)
is usually **not** metadata. It is form logic, ESM logic, or a report indicator. Do not
create a concept to hold something the system can derive, unless the DAK requires the
computed value to be stored as an observation — and if you do, note why in the metadata spec.

## 3. Choose the layer

Layers load **common → national → programme → site**, and a layer may not
forward-reference something a later layer declares.

| Layer | Package | What belongs |
| --- | --- | --- |
| common | `content-common` | Anything any programme would use: vitals, yes/no, shared roles, order frequencies |
| national | `content-liberia-national` | MOH-wide: national identifier types, MOH forms, reporting mappings, translations |
| programme | `content-liberia-mch`, `-lab`, `-pharmacy`, `-opd-ipd` | Clinical content for that programme only |
| site | `content-site-careysburg`, `-barnersville` | Physical locations, wards, local roles, branding, formulary overrides |

The test is not "who uses it today" but "who would have to depend on it". If MCH needs a
privilege that national declares, the privilege stays in national and MCH depends on it. If
`common` needs it, it moves down to `common` — it does not get duplicated.

## 4. Look CIEL up before declaring anything

**CIEL first, always.** A local duplicate of a CIEL concept fragments national reporting and
breaks the FHIR and DHIS2 mappings downstream
([ocl/README.md](../../content-packages/content-common/configuration/backend_configuration/ocl/README.md)).

**The DAK proposes a CIEL code itself** — 117 of the 244 MCH elements carry one. Treat it as
a strong lead and a starting point, never as the answer: it is a claim by whoever filled the
sheet, and the first pass already found two that cannot be right (`LBR.LD.DE.81` maps a coded
Warm/Cold element onto numeric Temperature; `EMR.FP.DE10` gives an implausible id). Open the
code in OCL and check the datatype and answer set before you alias it. Where the DAK proposes
nothing, you still have to look — a blank means nobody checked, not that CIEL lacks the term.

Record what the DAK claimed **and** what you implemented, in the separate `dak_ciel` and
`concept_uuid_source` columns. When they diverge, both matter.

Three outcomes, and only three:

1. **CIEL has it, and it fits** — datatype, units and answer set match what the DAK asks
   for. Alias its UUID in `variables.properties` (CIEL UUIDs are
   `<concept_id>` padded with `A`s) and reference the variable. Nothing goes in `concepts/`.
2. **CIEL has something close but wrong** — different datatype, or an answer set that does
   not contain what the DAK requires. Do **not** bend the DAK to CIEL, and do **not** copy
   the CIEL concept locally with edits. Record the mismatch in the metadata spec and raise it
   with the CIEL maintainers.
3. **CIEL has nothing** — declare it locally, with a `Same as mappings` value if any standard
   terminology (LOINC, SNOMED, ICD) covers it, and raise it with CIEL. A concept that exists
   only in Liberia's database cannot be aggregated nationally.

**Never guess a CIEL id.** A wrong mapping is worse than no mapping: it corrupts aggregate
reporting rather than merely omitting it. Leave it blank, mark it ⚠ in the metadata spec, and
say so in the PR.

## 5. Declare the variable, then write the row

Every UUID is declared **once**, in the owning package's `configuration/variables.properties`,
and referenced everywhere else as `${var.*}` ([IMPLEMENTATION.md §7](../../IMPLEMENTATION.md)).
A bare UUID in a CSV, form or frontend JSON is a defect, and CI fails the frontend case.

```bash
uuidgen | tr 'A-Z' 'a-z'      # generate one per new local concept
```

Naming convention: `var.<domain>.<thing>.uuid`, lower-kebab, grouped under the domain heading
in the file. Reuse the grouping already in
[`content-liberia-mch/configuration/variables.properties`](../../content-packages/content-liberia-mch/configuration/variables.properties)
rather than inventing a second scheme.

Then add the CSV row. The concepts header is:

```text
Uuid,Void/Retire,Fully specified name:en,Short name:en,Description:en,Data class,
Data type,Answers,Same as mappings,Absolute low,Absolute high,Units
```

Four things reject a row or corrupt it silently:

- **Multi-value fields separate with `;`, not `,`** — answers, states, mappings. A comma is
  read as a column break.
- **No comment lines.** Initializer parses CSVs row-by-row with no comment syntax; a `#` line
  is read as a malformed record. Explanation goes in the sibling `README.md`.
  `validate-content.sh` fails on this.
- **File names must be unique across layers.** The backend image copies every layer's
  `backend_configuration/` into one tree; two layers with the same relative path means the
  later one *replaces* the earlier, with no error. Name files
  `<domain>-<package>.csv` — `concepts-mch.csv`, not `concepts.csv`.
- **A coded concept's answers must themselves exist** as concepts, referenced by UUID
  variable or mapped to CIEL. Naming an answer does not declare it — this is currently open
  for amniotic fluid character and fetal skull moulding
  ([concepts/README.md](../../content-packages/content-liberia-mch/configuration/backend_configuration/concepts/README.md)).

### Worked example A — reusing CIEL (the common case)

ANC `LBR.EMR.DE.24` *Presentation*, `Coding`, DAK CIEL `160090`. Open 160090 in OCL and
confirm it is coded and that its answers cover the DAK's list (Vertex, Breech, Transverse,
Oblique, Other). If it does, the whole change is one line — no `concepts/` row at all:

```properties
# content-liberia-mch/configuration/variables.properties, under the CIEL concepts heading
var.concept.ciel.fetal-presentation.uuid=160090AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

If the answer set does *not* cover the DAK's list, stop: that is outcome 2 in §4, and it is a
question for the clinical reviewer, not something to patch locally.

### Worked example B — declaring locally

Only when §4 outcome 3 applies. The partograph concepts are the existing example, and they
also show what this runbook is for — they were written before any traceability existed, and
the first pass over the real DAK found **no partograph content in it at all**, so they are
recorded as `no-dak-source` rather than traced:

```properties
var.concept.partograph.cervical-dilation.uuid=1a6c4e80-8a2d-4667-8e5f-4a6c8e0b2d4f
```

One row in `content-liberia-mch/.../concepts/concepts-mch.csv`, on a single physical line.
The `#` comment in the properties snippets above is legitimate — properties files allow
comments, Initializer CSVs do not:

```text
${var.concept.partograph.cervical-dilation.uuid},,Cervical Dilation,Cx Dilation,Cervical dilation in centimetres,Finding,Numeric,,,0,10,cm
```

Then §6 (traceability), §7 (spec), §8 (validate and load). The row is not done until the
DAK reference is recorded — an unattributed concept is the thing this runbook exists to
prevent.

## 6. Record the traceability row

Traceability lives in one table per programme, `docs/dak/traceability-<programme>.csv`, sharing
the columns documented in [docs/dak/](../dak/). Only
[`traceability-mch.csv`](../dak/traceability-mch.csv) exists so far; a new programme starts a
new file with the same header rather than extending MCH.

That table already holds a row for every data element on the four MCH tabs, extracted from the
sheet. For most of them the job is not to append a row but to **complete one**: fill
`decision`, `layer`, `domain`, `liberiaemr_variable`, `concept_uuid_source` and move `status`
off `pending`. If you re-read the sheet to complete a row, update its `dak_read_date` to the
date you read it — the row's DAK-side fields are only a claim about the sheet on that date.

Append only when the DAK gains an element, or when you implement something the DAK does not
source — those get a row with `dak_data_element_id` blank and `status` `no-dak-source`, so
that "the DAK does not require this" and "we never got to it" stay distinguishable. Even those
carry a `dak_read_date`: "the DAK has no partograph" is a statement about a particular read.

This is what answers the first review question, and the first MOH question after handover.
Do it as you go: reconstructing it later means re-reading the DAK.

## 7. Update the metadata spec

The per-programme spec in [docs/metadata-specs/](../metadata-specs/) is the clinical
specification, and it is written **before** forms. Keep it in step:

- New concept, encounter type, programme or state → add it to the relevant section.
- Anything unresolved → mark it ⚠ **and add it to the Open items summary**. That list is what
  the go-live checklist reads.
- Closing an open item → remove it from the summary in the same PR that closes it.

## 8. Validate, then load

From the repository root:

```bash
./scripts/validate/validate-content.sh    # CSV comments, name collisions, undeclared ${var.*}
mvn -B -q -DskipTests package             # resolves ${var.*} into */target/configuration
```

Then rebuild the backend image and restart it ([local-development.md §2](local-development.md)).
Initializer is idempotent, so a restart re-applies changed metadata against the existing
database in about two minutes.

**Read the log; do not trust the health check.** Metadata errors currently do not fail the
boot:

```bash
cd distribution/compose/facility   # --env-file below is relative to this directory
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file ../../env/demo.env logs backend | grep -iE 'ERROR|Exception' | head -40
```

`Concept Source is required` on a CIEL-mapped concept is expected locally — CIEL is not
loaded. Everything else is yours.

## 9. When the DAK is ambiguous

You will hit rows where the DAK gives a label but not a datatype, an answer list without
codes, or a threshold with no units. **Do not resolve it by inference.**

1. Leave the field unset rather than guessing.
2. Add it to the Open items summary in the metadata spec, phrased as the question you need
   answered, not as "TBD".
3. Put it in the PR description so it reaches the clinical reviewer.
4. Where this repository and the DAK disagree, [the DAK wins and the metadata is wrong](../dak/)
   — fix the metadata, do not annotate the disagreement and move on.

A blocked element does not block the sheet: finish every element that is not blocked, and
name the ones you left.

## Definition of done, per data element

- [ ] Classified to one Initializer domain and one layer, with no forward reference
- [ ] CIEL checked, and the outcome recorded (reused / mismatch / none exists)
- [ ] UUID declared once in `variables.properties`; no bare UUID anywhere
- [ ] CSV row written; `;` separators; package-specific file name; coded answers declared
- [ ] Traceability row completed or appended in the programme's `docs/dak/traceability-*.csv`,
      with `dak_read_date` set
- [ ] Metadata spec updated, open questions listed in its Open items summary
- [ ] `validate-content.sh` passes and the element loads without an error in the backend log
- [ ] Nothing already released was modified in place (retire → add → migrate)
