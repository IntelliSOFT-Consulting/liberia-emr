# esm-liberia-remote-search-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

**Remote Search** in the patient search: when a clinician cannot find a patient at their
facility, they switch on Remote Search, find the patient on the central server, and import them
with **Import & Open**. The import copies the patient and their visits, encounters and
observations to the facility; the central server is only ever read.

The backend is `RemoteSearchController` / `RemoteSearchService` in `modules/liberiaemr`.

## What it shows

- **Remote Search section** below the local results: in the header search dropdown, on the full
  `/search` page, and in the "Add patient to…" workspaces (queue, appointment). Matches use the
  same patient banner as local results, each with an **Import & Open** button. Inside a
  workspace, importing hands the patient to that workflow instead of opening the chart.
- **Toggle**: in the Refine Search sidebar, in the tablet/phone "Add additional search criteria"
  dialog, and inline in the dropdown and workspaces. Off by default; see the configuration below.
- **Summary** above the `/search` results (`N local · M from remote search`).
- **States**: searching, too few characters, no matches, all matches already at this facility,
  central unreachable, and offline.

The whole UI stays hidden when the app is disabled in config, when the backend reports no central
server configured (`enabled: false`), or when the user lacks the privilege.

## Where it is mounted

The patient-search app (11.1.0) has no slot for this, so
`distribution/frontend/patch-patient-search-remote.cjs` adds three extension slots to its compiled
bundle at image build. This app fills them:

| Extension | Component | Slot |
| --- | --- | --- |
| `liberia-remote-search-toggle` | `remoteSearchToggle` | `patient-search-remote-toggle-slot` |
| `liberia-remote-search-results` | `remoteSearchResults` | `patient-search-remote-results-slot` |
| `liberia-remote-search-summary` | `remoteSearchSummary` | `patient-search-remote-summary-slot` |

The patch asserts that every anchor occurs exactly once, so an upstream bump of the
patient-search app fails the image build instead of shipping without the feature. When
`spa.core` or the patient-search version changes, re-derive the anchors in the patch.

## Backend

| Call | Needs | Purpose |
| --- | --- | --- |
| `GET /ws/rest/v1/liberiaemr/remotesearch/status` | Get Patients | whether central is configured |
| `GET /ws/rest/v1/liberiaemr/remotesearch?q=` | Get Patients | search central; a patient already here is flagged `alreadyLocal: true` and offered as Open. An older backend leaves those out and returns `alreadyLocalCount`, which the UI reports instead |
| `POST /ws/rest/v1/liberiaemr/importpatient` `{ "remoteUuid", "reason" }` | Add Patients, Import Remote Patient | create the patient shell and fetch their history from other facilities; the reason for access is logged with the fetch |
| `GET /ws/rest/v1/liberiaemr/remotesearch?q=` | Get Patients | search central; a patient already here is flagged `alreadyLocal: true` and offered as Open |
| `GET /ws/rest/v1/liberiaemr/remotesearch/ping` | Import Remote Patient | import step 1: central answers and accepts this facility's credentials |
| `POST /ws/rest/v1/liberiaemr/importpatient` `{ "remoteUuid", "reason", "deferHistory": true }` | Add Patients, Import Remote Patient | import step 2: create the patient shell; the import is logged with its reason |
| `POST /ws/rest/v1/liberiaemr/remotehistory/local/{uuid}/refresh` `{ "reason" }` | View Remote History or Import Remote Patient | import step 3: copy the history from other facilities into the local store; returns `history` and `facilityCount` |

Import & Open shows only to a user with both privileges; anyone else sees "Ask a Records Officer
to import this patient." Before anything is sent, a modal asks for the reason for access
(ADR 0007 condition 3): Visiting patient, Referral in, Emergency, or Other with a description.
A progress dialog then follows the three import calls above, and the chart opens with a success
notification ("Records from N other facilities are in External records.") or, when the history
could not be copied, a warning that it will be retrieved later.

The central URL and service account are **backend** settings, not this app's: `LIBERIAEMR_REMOTE_URL`
(https only), `LIBERIAEMR_REMOTE_USER` and `LIBERIAEMR_REMOTE_PASSWORD` (or
`LIBERIAEMR_REMOTE_PASSWORD_FILE`), set in the deployment environment. See
`distribution/env/facility.env.example`. With none set, Remote Search is off and the toggle hides.

## Configuration

`@liberiaemr/esm-liberia-remote-search-app` in the frontend config (`config-schema.ts`):

| Key | Default | |
| --- | --- | --- |
| `enabled` | `true` | Master switch for all Remote Search UI. |
| `remoteSearchLabel` | `Remote Search` | The section and toggle name. |
| `emptyStateHint` | `Can't find the patient…` | Hint shown beside the off toggle. |
| `importButtonLabel` | `Import & Open` | |
| `defaultToggleOn` | `false` | Whether the toggle starts on. |
| `rememberToggleState` | `false` | Keep the toggle position across page loads (`localStorage`). |
| `resetToggleOnClose` | `true` | Return the toggle to `defaultToggleOn` when the search is closed. |
| `minimumQueryLength` | `2` | Characters before central is searched; never below 2. |

Messages shown to clinicians. Empty uses the built-in translated text; set one to replace it
(`{{query}}`, `{{count}}` are filled in where noted in `config-schema.ts`):
`searchingMessage`, `noResultsMessage`, `alreadyLocalMessage`, `minCharactersMessage`,
`unavailableTitle`, `unavailableMessage`, `offlineMessage`, `importSuccessMessage`.

## Development

```bash
yarn install
yarn start        # openmrs develop
yarn start:dev    # against the dev server, port 8085
yarn typescript
yarn build
```

The package has no unit tests yet. `yarn lint` calls `eslint`, which is not a dependency of
this package, so CI skips it.

## Build and publish

- **`packages.yml`**: `yarn install --frozen-lockfile`, `tsc` and build on changes to `packages/**`;
  publishes `1.0.0-pre.<run>` to npm tag `next` on a merge to `main`, and the release tag to
  `latest` on a GitHub release. See [`packages/README.md`](../README.md#ci-and-publishing). The
  lockfile is Yarn 1, as CI's.
- **Pin:** `spa.frontendModules.@liberiaemr/esm-liberia-remote-search-app` in
  `distribution/distro.properties`. It is **not pinned yet**: a new package has no published
  version before its first merge, and a pin to one that is not on npm fails `openmrs assemble`.
  The follow-up PR uncomments it with the published pre-release. Until then the patch's slots stay
  empty and Remote Search does not appear in the image.
