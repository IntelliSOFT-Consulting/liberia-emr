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

There are no tests: `yarn test` only echoes. `yarn lint` and `yarn verify` call `eslint` and
`turbo`, neither of which is a dependency of this package.

## Build and publish

- **CI gate** (`ci.yml`): not built or tested.
- **`packages.yml`**: `tsc` and build on changes to `packages/**` (no lint — `eslint` is not
  a dependency); publishes `1.0.1-pre.<run>` to npm tag `next` on a merge to `main`, and the
  release tag to `latest` on a GitHub release. See
  [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin**: `spa.frontendModules.@liberiaemr/esm-liberia-patient-chart-extension=1.0.1-pre.53`
  in `distribution/distro.properties`. Publishing does not change it.
