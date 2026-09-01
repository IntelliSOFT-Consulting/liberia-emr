# MCH forms

**Forms come last.** The build order in [IMPLEMENTATION.md §5](../../../../../IMPLEMENTATION.md)
is deliberate: concepts → identifiers/locations/providers → visit & encounter model →
programmes & workflows → *then* forms. Starting with forms is how implementations end up
with duplicated concepts and encounters that do not aggregate.

Everything above forms in that chain is already in this package. What remains is to write
the five form schemas against the concepts that exist, using the variables — never a bare
UUID — from [`../../variables.properties`](../../variables.properties).

| Form | Variable | Encounter type | Status |
| --- | --- | --- | --- |
| ANC Initial Visit | `${var.form.anc-initial.uuid}` | ANC Initial Visit | released (`anc-initial.json`) |
| ANC Follow-up Visit | `${var.form.anc-followup.uuid}` | ANC Follow-up Visit | released (`anc-followup.json`) |
| Delivery Summary | `${var.form.delivery-summary.uuid}` | Delivery | not written |
| Postnatal Visit | `${var.form.pnc-visit.uuid}` | Postnatal Visit | not written |
| Family Planning | `${var.form.family-planning.uuid}` | Family Planning Visit | not written |

The `Variable` column is configuration metadata and repository convention — it is the `uuid`
each schema carries and keeps content free of bare UUIDs. It is **not** the runtime identity:
`AmpathFormsLoader` does not read the JSON `uuid` at all (see [Versioning](#versioning)).

Intrapartum observations are **not** a form. They are captured by
`packages/esm-liberia-epartograph-app` against the `Partograph Observation` encounter type,
because a serial time-plotted chart is not something the form engine renders.

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

Initializer's AmpathFormsLoader does **not** use the JSON `uuid` as identity. It
derives the Form UUID from **name + version**, and the form loaded through Initializer
**replaces** any previous version of the same name. Keeping multiple JSON schemas
with the same form name does not preserve independently loaded historical versions.

**Non-semantic corrections** (validators, min/max bounds, whole-number enforcement,
validation messages) that keep the same concepts, question meaning, encounter
semantics, and workflow may retain the existing name and version so Initializer
updates the existing FormResource.

**Meaning-changing changes** (different concept semantics, repurposed questions,
altered encounter meaning, a materially different workflow or data interpretation)
require explicit migration/version analysis per §9.

## Before writing any of these

Complete [docs/metadata-specs/mch.md](../../../../../docs/metadata-specs/mch.md) and
close the open items in [`../concepts/README.md`](../concepts/README.md). A form written
against unmapped concepts has to be rewritten once the CIEL mappings land.
