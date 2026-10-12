# esm-liberia-patient-chart-extension

**Build class: Custom Build** (IMPLEMENTATION.md §3).

A generic **observations-by-encounter** widget for the patient chart summary. It shows the
patient's encounters of the configured types as rows and the configured concepts as columns
(or as graph series), and its **Add** button opens the configured AMPATH form in the
standard `patient-form-entry-workspace`. It has no programme-specific defaults: every concept,
encounter type and form comes from content-package configuration.

First consumer: **TB Screening**, configured in `content-liberia-national`
(`configuration/frontend_configuration/config-national.json`). Partograph and ANC summaries
are planned consumers (`src/index.ts`).

## Where it is mounted

| Extension | Slot | |
| --- | --- | --- |
| `liberia-obs-widget` | `patient-chart-summary-dashboard-slot` | full width, online only |

Its position on the summary is set by the slot's `order` in `config-national.json`. Data
comes from `/ws/rest/v1/encounter` for the patient.

## Configuration

The config key is **`liberia-obs-widget`** — `startupApp` defines the schema under that
name, not under the package name.

| Key | Default | |
| --- | --- | --- |
| `title` | `Observations` | Header; may be a translation key |
| `formUuid` | `''` | AMPATH form for **Add**; empty hides the button |
| `encounterTypes` | `[]` | Encounter type UUIDs to include |
| `displayMode` | `table` | `table`, `graph` or `switchable` |
| `data` | `[]` | Ordered `{concept, label}`; an empty label shows the raw concept UUID, so always set one |
| `maxEncounters` | `5` | Encounters per page |
| `oldestFirst` | `false` | |
| `showAddButton` | `true` | |

Only one instance is configured today: the schema has a single key, so a second programme
cannot yet be added without a code change.

## External records (LE-386)

`src/external-records/` is the data layer for an imported patient's history from other
facilities. It reads only this facility's copy, never central directly.

- `useExternalRecords(patientUuid)` → `{ isImported, status, asOf, facilities, sections, refresh() }`,
  from `GET /ws/rest/v1/liberiaemr/remotehistory/local/{uuid}`. Nothing is fetched without
  `View Remote History`; `isImported` is false for a patient who never came through Remote Search.
- `status`: `fresh | offline | stale | notRetrieved | unavailableOffline | empty`.
- `refresh()` posts to `…/local/{uuid}/refresh`, re-reads, and shows the outcome snackbar.
- `formatAsOf()`: `02-Oct-2026, 08:14 (2 days ago)`, from the framework's `formatDatetime` and `duration`, so it follows the user's locale.

In the chart (all gated by `View Remote History`, `offline: true`):

| Extension | Slot |
| --- | --- |
| `liberia-external-records-summary` (card) | `patient-chart-summary-dashboard-slot`, first via `config-national.json` |
| `liberia-external-records-banner-tag` | `patient-banner-tags-slot`, hidden in search results and when no facility has records |
| `liberia-external-records-dashboard-link` | `patient-chart-dashboard-slot`, `order: 5.5` (directly below Visits, 5) |

Reusable pieces: `external-records-sections.ts` defines each section's columns once;
`ExternalRecordsTable` renders any section (EXTERNAL / READ ONLY tags, Facility column,
paging); `ExternalRecordsStatusView` is the status bar or empty state. Config:
`externalRecords.summarySections` (at most two, default `["allergies", "conditions"]`) and
`externalRecords.pageSize` (default 5).

## Development

```bash
yarn install
yarn start        # openmrs develop against the facility dev server
yarn typescript
yarn build
```

`start:local` (port 8082, backend `localhost:8085`) passes
`../../distribution/frontend/config/config-national.json`, which does not exist; the file is
`content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json`.

`yarn test` runs the pure-logic tests with Node's test runner (`node --test`, TypeScript
stripped), so they need no install. `yarn lint` and `yarn verify` call `eslint` and `turbo`,
neither of which is a dependency of this package.

## Build and publish

- **CI gate** (`ci.yml`): not built or tested.
- **`packages.yml`**: `tsc` and build on changes to `packages/**` (no lint — `eslint` is not
  a dependency); publishes `1.0.1-pre.<run>` to npm tag `next` on a merge to `main`, and the
  release tag to `latest` on a GitHub release. See
  [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin**: `spa.frontendModules.@liberiaemr/esm-liberia-patient-chart-extension=1.0.1-pre.53`
  in `distribution/distro.properties`. Publishing does not change it.
