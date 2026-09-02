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
| ANC Follow-up Visit | `${var.form.anc-followup.uuid}` | ANC Follow-up Visit | not written |
| Delivery Summary | `${var.form.delivery-summary.uuid}` | Delivery | not written |
| Postnatal Visit | `${var.form.pnc-visit.uuid}` | Postnatal Visit | not written |
| Family Planning | `${var.form.family-planning.uuid}` | Family Planning Visit | not written |

## Labour & Delivery Workflow and the e-Partograph

Labour and Delivery in Liberia EMR follows the 4 clinical stages:

1. **Stage 1 (Labour Admission / Latent phase):** `1. First and Second Stage of Labor and Delivery`. Records admission examination, baseline history, and initial vaginal examination. When cervical dilatation reaches $\ge 4\text{ cm}$, active labour begins.
2. **Active Labour Monitoring (Partograph):** Serial observations are recorded on the Partograph form (`partograph-national.json` / `2. Partograph`) and visualised by `packages/esm-liberia-epartograph-app` plotted against WHO Alert and Action lines.
3. **Stage 3 (Delivery):** `3. Third Stage of Labor and Delivery` or `Delivery Summary`. Captures delivery of infant and placenta, APGAR, AMTSL, and blood loss. **Clinically concludes the Partograph.** When a Stage 3 or Delivery encounter is recorded, the Partograph CDS engine automatically suppresses intrapartum alerts ("Update Due", "Action Line").
4. **Stage 4 (Immediate Postpartum):** `4. Fourth Stage Monitoring for Woman and Baby`. Monitors maternal recovery, uterine tone, lochia, and newborn feeding for the first 1–2 hours post-delivery. These are kept distinct from the intrapartum partograph table.

## Layout

Released forms use a single published schema containing the form UUID, version, encounter,
publication status, and pages:

```
ampathforms/
└── anc-initial.json          # published O3 form-engine schema and metadata
```

## Versioning

A released form schema is historical data. To change one, create a **new form version**
with a new UUID and leave the old schema intact — the old encounters must keep rendering
the way they were recorded (IMPLEMENTATION.md §9). Do not edit a published schema in place.

## Before writing any of these

Complete [docs/metadata-specs/mch.md](../../../../../docs/metadata-specs/mch.md) and
close the open items in [`../concepts/README.md`](../concepts/README.md). A form written
against unmapped concepts has to be rewritten once the CIEL mappings land.
