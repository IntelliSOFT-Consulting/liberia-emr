# MCH forms

**Forms come last.** The build order in [IMPLEMENTATION.md §5](../../../../../IMPLEMENTATION.md)
is deliberate: concepts → identifiers/locations/providers → visit & encounter model →
programmes & workflows → *then* forms. Starting with forms is how implementations end up
with duplicated concepts and encounters that do not aggregate.

Everything above forms in that chain is already in this package. The status of the six forms below
is recorded against the existing concepts, using the variables — never a bare UUID — from [`../../variables.properties`](../../variables.properties).

| Form | Variable | Encounter type | Status |
| --- | --- | --- | --- |
| ANC Initial Visit | `${var.form.anc-initial.uuid}` | ANC Initial Visit | released (`anc-initial.json`, v1.2) |
| ANC Follow-up Visit | `${var.form.anc-followup.uuid}` | ANC Follow-up Visit | released (`anc-followup.json`) |
| Delivery Summary | `${var.form.delivery-summary.uuid}` | Delivery | not written |
| Mother PNC | `${var.form.pnc-visit.uuid}` | Postnatal Visit | released (`pnc-visit.json`, v1.0) |
| Newborn PNC | `${var.form.newborn-pnc.uuid}` | Postnatal Visit | released (`newborn-pnc.json`, v1.0) |
| 3. Family Planning | `${var.form.family-planning.uuid}` | Family Planning Visit | released (`family_planning.json`, v2.0) |

The `Variable` column is the repository alias for each form's **runtime Form UUID**.
`AmpathFormsLoader` ignores the JSON `uuid` field when deriving Form identity. Runtime
Form UUID is deterministically derived from name + version (see [Versioning](#versioning)).
Repository `var.form.*.uuid` values **must** therefore be set to that loader-derived UUID
so frontend configuration, reports, or other metadata can address the actual Form row.
The variable is not an independent source of identity; it mirrors the loader-derived
runtime identity.

## Labour & Delivery Workflow and the e-Partograph

Labour and Delivery in Liberia EMR follows the 4 clinical stages:

1. **Stage 1 (Labour Admission / Latent phase):** `1. First and Second Stage of Labor and Delivery`. Records admission examination, baseline history, and initial vaginal examination. When cervical dilatation reaches $\ge 4\text{ cm}$, active labour begins.
2. **Active Labour Monitoring (Partograph):** Serial observations are recorded on the Partograph form (`partograph-national.json` / `2. Partograph`) and visualised by `packages/esm-liberia-epartograph-app` plotted against WHO Alert and Action lines.
3. **Stage 3 (Delivery):** `3. Third Stage of Labor and Delivery` or `Delivery Summary`. Captures delivery of infant and placenta, APGAR, AMTSL, and blood loss. **Clinically concludes the Partograph.** When a Stage 3 or Delivery encounter is recorded, the Partograph CDS engine automatically suppresses intrapartum alerts ("Update Due", "Action Line").
4. **Stage 4 (Immediate Postpartum):** `4. Fourth Stage Monitoring for Woman and Baby`. Monitors maternal recovery, uterine tone, lochia, and newborn feeding for the first 1–2 hours post-delivery. These are kept distinct from the intrapartum partograph table.

## Layout

Released forms use a single published schema containing the form UUID, version, encounter,
publication status, and pages. The ANC schemas, illustrative — this directory also holds the
labour & delivery forms and is not listed in full here:

```
ampathforms/
├── anc-initial.json          # published O3 form-engine schema and metadata
└── anc-followup.json         # published O3 form-engine schema and metadata
```

## Versioning

Do **not** mutate a released form in ways that change clinical meaning
([IMPLEMENTATION.md §9](../../../../../IMPLEMENTATION.md)). Meaning-changing form
changes need a new version and migration analysis.

Initializer 2.12.0 `AmpathFormsLoader` ignores the JSON `uuid` field. Form UUID is
derived from namespace + name + version:

`Utils.generateUuidFromObjects("794c4598-ab82-47ca-8d18-483a8abe6f4f", formName, formVersion)`

**Same name + same version** derives the same UUID. The existing Form is found by
that UUID and the existing Form/FormResource is updated in place. That path is
appropriate only for **non-semantic corrections** (validators, min/max bounds,
whole-number enforcement, validation messages) that keep the same concepts, question
meaning, encounter semantics, and workflow, and where retaining the same form
identity/version is intentional.

**Same name + bumped version** derives a **new** Form UUID and creates a new Form
row/version. Initializer's replacement path retires the prior same-name active form.
The previous Form/FormResource remains available for historical encounters. A version
bump is therefore the correct mechanism for preserving historical schemas when
clinical meaning changes.

**Meaning-changing changes** (different concept semantics, repurposed questions,
altered encounter meaning, a materially different workflow or data interpretation)
require a new version, migration/reporting analysis, and preservation of historical
rendering/data semantics per §9.

## Before writing any of these

Complete [docs/metadata-specs/mch.md](../../../../../docs/metadata-specs/mch.md) and
close the open items in [`../concepts/README.md`](../concepts/README.md). A form written
against unmapped concepts has to be rewritten once the CIEL mappings land.
