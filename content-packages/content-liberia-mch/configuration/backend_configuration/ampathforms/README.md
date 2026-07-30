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
| ANC Initial Visit | `${var.form.anc-initial.uuid}` | ANC Initial Visit | not written |
| ANC Follow-up Visit | `${var.form.anc-followup.uuid}` | ANC Follow-up Visit | not written |
| Delivery Summary | `${var.form.delivery-summary.uuid}` | Delivery | not written |
| Postnatal Visit | `${var.form.pnc-visit.uuid}` | Postnatal Visit | not written |
| Family Planning | `${var.form.family-planning.uuid}` | Family Planning Visit | not written |

Intrapartum observations are **not** a form. They are captured by
`packages/esm-liberia-epartograph-app` against the `Partograph Observation` encounter type,
because a serial time-plotted chart is not something the form engine renders.

## Layout

Each form is a pair:

```
ampathforms/
├── anc-initial.json          # O3 form-engine schema
└── anc-initial_form.json     # form metadata: name, version, encounter type, published
```

## Versioning

A released form schema is historical data. To change one, create a **new form version**
with a new UUID and leave the old schema intact — the old encounters must keep rendering
the way they were recorded (IMPLEMENTATION.md §9). Do not edit a published schema in place.

## Before writing any of these

Complete [docs/metadata-specs/mch.md](../../../../../docs/metadata-specs/mch.md) and
close the open items in [`../concepts/README.md`](../concepts/README.md). A form written
against unmapped concepts has to be rewritten once the CIEL mappings land.
