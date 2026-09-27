# esm-liberia-epartograph-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

A WHO-aligned electronic partograph for intrapartum monitoring. There is **no community
equivalent** — this is greenfield, not a modification of an upstream component, and there
is no upstream PR to track. If a community partograph later appears, superseding this
module is an ADR-level decision, not a quiet swap.

## What it is and is not

- It **is** a normal O3 frontend module: versioned on its own cadence, built to a JS
  bundle, and **pinned in `distribution/distro.properties`** like every other ESM.
- It is **not** part of a content package. Nothing here ships inside
  `content-packages/**`. The MCH content package supplies its *configuration*; the module
  itself is a distribution concern.

## Configuration

Concept UUIDs, encounter types, forms and the alert/action line geometry are runtime
configuration under the key `@liberiaemr/esm-liberia-epartograph-app`. Production values come
from `content-liberia-mch/configuration/frontend_configuration/config-mch.json`, which
resolves `${var.*}` from `variables.properties` and sets every key below. A concept
correction then ships as a config change instead of a frontend release — which matters when
the fix has to reach a facility over an intermittent link.

| Key | Default | |
| --- | --- | --- |
| `encounterTypeUuid` | a UUID | Encounter type of each serial partograph observation |
| `deliveryEncounterTypeUuid` | a UUID | Delivery outcome / summary encounter type |
| `formUuid` | a UUID | Partograph AMPATH form opened by **Add** |
| `thirdStageFormUuid` | a UUID | Stage 3 / delivery of infant and placenta form |
| `firstAndSecondStageFormUuid` | a UUID | Stage 1 and 2 admission form |
| `concepts.*` | a UUID each, except the five `*DipstickUuid` keys (`''`) | Dilatation, descent, contractions, FHR, moulding, liquor, maternal vitals, oxytocin, drugs/IV fluids, urine |
| `alertLine.startDilationCm` | `4` | Where the alert line starts; also the T₀ threshold |
| `alertLine.cmPerHour` | `1` | Alert line slope |
| `alertLine.actionLineOffsetHours` | `4` | Action line offset to the right of the alert line |

**The defaults are not empty.** The comment at the top of `src/config-schema.ts` says they are
deliberately empty so that an unset concept fails validation; in the code, every key except
the dipstick concepts has a concrete UUID default. Until that is resolved, a missing entry in
`config-mch.json` falls back silently to the compiled-in UUID rather than failing.

## Where it is mounted

| Extension | Slot | |
| --- | --- | --- |
| `partograph-dashboard-link` | `patient-chart-dashboard-slot` | **Partograph** in the chart's left nav; opens dashboard path `partograph` |
| `partograph-chart` | `patient-chart-partograph-dashboard-slot` | The table/graph view and CDS alerts |

No pages. Backend dependencies (`routes.json`): `webservices.rest >=2.47.0`, `fhir2 >=2.0.0`.

## Clinical Architecture & Stage Tracking

Labour and Delivery in the Liberian National EMR spans four distinct clinical stages. Each stage has a specialized clinical scope and distinct forms:

| Stage / Form | Encounter Type | Role in Labour Workflow | Handled by Partograph Module? |
| :--- | :--- | :--- | :--- |
| **`1. First and Second Stage`** | `Labor & Delivery` / `Labour Admission` | Admission examination, history, baseline vitals, membrane status. | **Initial anchor ($T_0$):** If cervical dilation is $\ge 4\text{ cm}$ on admission, it anchors $T_0$. Otherwise excluded from serial intrapartum table. |
| **`2. Partograph`** (`partograph-national.json`) | `Labor & Delivery` / `Partograph Observation` | Serial intrapartum monitoring (every 30m–4h): cervical dilatation, fetal head descent, contractions, fetal heart rate, moulding, amniotic fluid. | **Yes (Core):** Plotted against the WHO Alert and Action Lines. |
| **`3. Third Stage`** / Delivery Summary | `Labor & Delivery` / `Delivery` | Delivery time, APGAR scores, AMTSL (oxytocin), placenta delivery, estimated blood loss. | **Yes (Delivery Concluded):** Triggers automatic completion of active labour and suppresses intrapartum alerts. |
| **`4. Fourth Stage Monitoring`** | `Labor & Delivery` | Immediate postpartum monitoring (1–2h): uterine tone, lochia, maternal postpartum vitals. | **No:** Postpartum recovery monitoring; excluded from intrapartum table. |

### Why Third & Fourth Stage Forms Are Not Displayed in the Partograph Table
A Partograph is strictly an intrapartum monitoring tool for active labour. Once the infant and placenta are delivered in Stage 3, active labour is over. Displaying Third and Fourth stage encounters in the partograph table would display empty columns (`--`) for Cervical Dilatation and Contractions, which is clinically misleading.

### Clinical Decision Support (CDS) & Automatic Delivery Suppression
The CDS alert engine (`usePartographAlerts`) monitors real-time patient progress against WHO intrapartum guidelines:
1. **`action` (Red):** Cervical dilatation has crossed the Action Line. Immediate clinical review required.
2. **`alert` (Yellow):** Cervical dilatation has crossed the Alert Line. Labour requires review.
3. **`due` (Blue):** The next labour assessment interval (30 min) has elapsed without a recorded entry.
4. **`normal` (Green):** Labour is progressing on or to the left of the Alert Line.
5. **`delivered` (Success):** Delivery has been documented (Stage 3 or Delivery encounter exists). Active labour is complete, and all intrapartum alerts (`due`, `alert`, `action`) are **automatically suppressed**.

### Subsequent Pregnancies & Multi-Labour Lifecycle
A patient often delivers multiple children across years at the same facility. A historical Stage 3 encounter from an earlier pregnancy must never block alerts for a future pregnancy.

The module resolves this via chronological **Episode-of-Care boundaries**:
1. Delivery marks a labour as completed **only if** the delivery occurred *at or after* the latest Partograph observation.
2. When the patient returns pregnant in the future, the first Partograph entry recorded **after** that historical delivery automatically marks the start of a **new labour episode**.
3. For this new episode, `isDelivered` automatically resets to `false`, the chart scopes strictly to the new pregnancy's intrapartum observations, and all CDS alerts (**"Partograph Update Due"**, **"Alert Line"**, **"Action Line"**) reactivate.
4. When the new infant is delivered (new Stage 3 recorded), that new delivery marks the conclusion of episode #2.

### UI Notification System (`PersistentNotification`)
CDS alerts are rendered through `PersistentNotification`, anchored via a React Portal to the OpenMRS snackbar position (`bottom: 1.5rem; left: 1.5rem; width: 22rem; z-index: 9001`). Unlike transient standard OpenMRS snackbars which disappear after 4 seconds, these alerts **persist** until addressed by the clinician or dismissed via the close (`x`) button.

## Development

```bash
yarn install
yarn start        # openmrs develop, default backend
yarn typescript
yarn build
```

`start:dev` and `start:local` (port 8083, backend `localhost:8085`) pass
`../../distribution/frontend/config/config-national.json` and `config-mch.json`; that
directory does not exist. The files are under
`content-packages/content-liberia-{national,mch}/configuration/frontend_configuration/`.

There are no tests yet: `yarn test` points at a `jest.config.js` that is not in the package,
and `yarn lint` / `yarn verify` call `eslint` and `turbo`, which are not dependencies.

The tooling (`@openmrs/esm-framework`, `openmrs`) must stay on `10.0.0` to match
`spa.core=10.0.0`: per `distro.properties`, 10.0.1-pre and newer inject a Module Federation
runtime guard the 10.0.0 app shell cannot satisfy, and the module refuses to start.

## Build and publish

- **CI gate** (`ci.yml`, job `frontend`): nothing runs yet — the step is an
  `echo "TODO: …"`.
- **`packages.yml`**: `tsc` and build on changes to `packages/**` (no lint); publishes
  `1.0.0-pre.<run>` to npm tag `next` on a merge to `main`, and the release tag to `latest`
  on a GitHub release. See [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin**: `spa.frontendModules.@liberiaemr/esm-liberia-epartograph-app=1.0.0-pre.53` in
  `distribution/distro.properties`, the build verified against `spa.core=10.0.0`. Re-pin
  deliberately after each publish — never `next` (IMPLEMENTATION.md §6).

The module is published as `@liberiaemr/esm-liberia-epartograph-app` and consumed through
the pinned import map — never mounted into a running container from a git checkout.
