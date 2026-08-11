# Digital Adaptation Kit (DAK) references

The DAK is the clinical source of truth for the first go-live scope: ANC, Labour &
Delivery, PNC and Family Planning. Where this repository and the DAK disagree, the DAK
wins and the metadata is wrong.

## The source

Not committed here — it is a live ([Google Sheet](https://docs.google.com/spreadsheets/d/16fcIbZfCvjJxzo3Rp4y2gyX3Lh8beElZldfzlRXtQ-c/edit?gid=254891891#gid=254891891)) owned outside this repository, so this is the
citation instead:

| | |
| --- | --- |
| Title | **Liberia EMR data dictionary** |
| Location | Google Sheets, file id `16fcIbZfCvjJxzo3Rp4y2gyX3Lh8beElZldfzlRXtQ-c` |
| Owner | IntelliSOFT Consulting — request access through the sheet's own sharing controls, which hold the current owner list |
| Read for this table | 2026-08-06 (prior full extract 2026-07-30) — recorded per row in `dak_read_date` |
| Shape | 21 tabs; ANC 65, Labour and delivery 107, PNC 42, Family Planning 31 data elements (245 MCH total) |

Workbook changes observed since the 2026-07-30 read (neither mapping is verified):

1. `LBR.LD.DE.21 Intact` was present in the source sheet but skipped in the first extract
   because its row is structurally misaligned (`Intact` sits in the Activity ID column; the
   data-element label cell is empty). It is now recorded as a pending answer under
   `LBR.LD.DE.20 Perineum`.
2. `LBR.EMR.DE.8 Normal (N)` now carries the DAK CIEL claim `1115`. The claim remains
   unverified.

## Traceability

One table per programme, named `traceability-<programme>.csv` and sharing the columns below.
[`traceability-mch.csv`](traceability-mch.csv) is the only one so far; a second programme
starts its own file rather than extending this one.

[`traceability-mch.csv`](traceability-mch.csv) — one row per DAK data element, whether or
not it produced metadata. Every concept in
[`../metadata-specs/mch.md`](../metadata-specs/mch.md) traces back to a DAK data element
here, and any concept that does not carries a recorded reason. Without this, the first
review question — "where does this field come from?" — has no answer.

253 rows: the 245 data elements on the four MCH tabs, plus 8 rows for metadata we hold that
the DAK does not source. The DAK side is extracted mechanically and is complete; the
**decisions are not made** — 223 rows are `pending`, meaning nobody has yet chosen a layer,
a domain, or a concept for them.

| Column | |
| --- | --- |
| `dak_tab`, `dak_section` | Which sheet, and the section heading within it |
| `dak_data_element_id` | The DAK's own identifier — see the caveat below |
| `dak_data_element_name` | As written in the DAK, not as renamed here |
| `dak_answer_of` | For an answer code, the element it is an answer to |
| `dak_data_type` | As the DAK gives it |
| `dak_ciel` | The CIEL code **the DAK asserts** — evidence, not a decision |
| `dak_read_date` | The date the sheet was read for that row. The sheet is live and unversioned, so a row is only a claim about the DAK as it stood on this date |
| `decision` | `reuse-ciel` / `implement-local` / `derived` (computed, not stored) / `deferred` / `not-implemented` / `unassigned` |
| `layer`, `domain` | Which content package and which Initializer directory |
| `liberiaemr_variable` | The `var.*` key, never a bare UUID |
| `concept_uuid_source` | `CIEL <id>` or `local` — what **we** implemented |
| `form_field` | Populated when the forms are written; blank until then |
| `status` | see below |
| `notes` | Why, for anything not a plain `reuse-ciel` |

`dak_ciel` and `concept_uuid_source` are deliberately separate. The DAK's suggestion and our
implementation agreeing is the good case; where they differ, both have to stay visible.

| `status` | Meaning | Count |
| --- | --- | --- |
| `verified` | Implemented and confirmed (usually DAK CIEL matches the alias; see notes when they diverge) | 18 |
| `unverified` | We assert a mapping the DAK does not confirm | 1 |
| `review` | Same CIEL term, different clinical use — needs a human | 1 |
| `conflict` | The DAK's own mapping is wrong or impossible | 2 |
| `pending` | DAK element, no decision taken yet | 223 |
| `no-dak-source` | We hold metadata the DAK does not source | 8 |

A `deferred` or `not-implemented` row is as important as an implemented one: without it,
"the DAK does not require this" and "we never got to it" are indistinguishable.

## What the first pass found

- **The DAK carries a CIEL column.** 118 of the 245 MCH elements arrive with a CIEL code
  already proposed. That is a large part of the concept work done, and it is why
  `dak_ciel` exists as its own column — but a code in the DAK is a claim, not a verified
  mapping. Two of them are already known wrong.
- **The DAK has no partograph.** No cervical dilation, descent, contractions, moulding or
  liquor anywhere in the workbook — no intrapartum monitoring tab at all. The six partograph
  concepts in `content-liberia-mch` therefore have **no DAK source**, and neither does the
  e-partograph itself. This needs a decision: either the DAK gains a partograph section, or
  it is recorded that WHO SMART Guidelines govern the partograph instead.
- **No EDD.** Estimated date of delivery does not appear in the DAK. We declare it. Confirm
  it is meant to be derived from LMP rather than recorded.
- **No birth outcome as a data element.** Live births and fresh/macerated stillbirths exist
  only as aggregate rows on the Reporting tab.
- **Data element IDs are not unique.** `LBR.EMR.DE.1`–`.19` are claimed by *both* the ANC and
  Registration tabs (`LBR.EMR.DE.1` is Gravida on one and Unique identification on the other),
  and the OPD tab reuses 7 of its own IDs (`EMR.OPD.DE1` is both *S/N* and *Client's details*).
  Cite an ID together with its tab, never alone.
- **Five tabs have no IDs at all** — HIV, Mental health, Nutrition, Reporting and TB Testing,
  524 rows between them. Those are unciteable until the DAK assigns identifiers.
- **The ANC tab's columns do not match its own headers.** Values sit one column left of where
  the header says: the real data type is under *Multiple Choice Type*, optionality is under
  *Validation Condition*. The other MCH tabs are aligned. Read ANC by position, not by header.
- **Labor and delivery has at least one structurally misaligned answer row.**
  `LBR.LD.DE.21 Intact` places the label in the Activity ID column and leaves the data-element
  label empty. Traceability records the inference; the source sheet still needs correction.
- **Duplicated elements within a tab.** `LBR.LD.DE.12` Delivery method vs `LBR.LD.DE.95` Type
  of delivery; `LBR.LD.DE.45` Weight vs `LBR.LD.DE.99` Birth weight. Each pair needs resolving
  to one element before implementation.

These are findings about the DAK, not complaints about it — but the ID collisions and the ANC
misalignment have to be fixed at source, because traceability depends on citable identifiers.

## How to populate it

[`../runbooks/dak-to-iniz.md`](../runbooks/dak-to-iniz.md) — the extraction procedure, from a
DAK row to loaded metadata, including where the CIEL decision is made and what to do when
the DAK is ambiguous.

## Known DAK dependencies

| Item | Blocks | Status against the DAK read on 2026-08-06 |
| --- | --- | --- |
| WHO partograph alert/action line geometry | `esm-liberia-epartograph-app` implementation | **Absent** — nothing intrapartum in the DAK |
| ANC contact schedule | ANC follow-up form and lost-to-follow-up interval | Partial — visits enumerated 1st–4th (`LBR.EMR.DE.43`–`.47`), no interval or LTFU definition |
| Permitted programme exit outcomes | Programme outcome concepts | **Absent** — no enrolment or exit model in the DAK |
| FP method list and continuation definitions | FP workflow and indicators | Method list supplied (`EMR.FP.DE22`–`.31`); New/Continue present (`DE13`/`DE14`) but undefined |
