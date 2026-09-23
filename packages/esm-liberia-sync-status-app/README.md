# esm-liberia-sync-status-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

The national **sync status** page: which facilities are sending records to central, and
what is waiting at central — without a terminal. Nothing clinical: counts, facility codes and
dates only. The operator's view of it is
[`docs/runbooks/sync-operations.md` §13](../../docs/runbooks/sync-operations.md).

## What it shows

It reads `GET /ws/rest/v1/liberiaemr/syncstatus` (`SyncStatusController` in
`modules/liberiaemr`) and refreshes every 60 seconds.

- **Central tiles**: records waiting to be applied, retrying, conflicts, records set aside
  (dead letters), and whether the receiver and broker are running.
- **Facilities table**: code, sending state (`Sending`, `Nothing in the last day`, or
  `Nothing for 3 days` when the backend marks it silent), records in the last day, total
  received, certificate expiry.
- **Banners**: firing sync alerts; a warning when central's monitoring cannot be reached
  (`available: false`), which says nothing about sync itself.

Retries and conflicts are national totals: dbsync records no sender on a queued record, so
central cannot attribute one to a facility.

The same bundle ships to facilities. Where the backend answers `enabled: false`, or any
error, the page says the view is available only at central and the menu item renders
nothing. A `403` gets its own message: the user needs the **View Sync Status** privilege
(`content-common` `privileges-common.csv`).

## Where it is mounted

| | Name | Where |
| --- | --- | --- |
| Page | `root` | route `sync-status` |
| Extension | `sync-status-app-menu-item` | `app-menu-slot`, online only |

Backend dependencies (`routes.json`): `webservices.rest >=2.47.0`, `liberiaemr >=1.0.0`.

## Configuration

None. The module defines no config schema; the feature switch is the backend's `enabled`.

## Development

```bash
yarn install
yarn start:local  # openmrs develop on port 8084 against localhost:8085
yarn test         # jest + @openmrs/esm-framework/mock
yarn verify       # yarn typescript && yarn test
yarn build
```

The tests (`src/sync-status/sync-status.test.tsx`) cover the facility list and silent
marking, the facility-server message, the `403` message, the monitoring-unreachable warning
and firing alerts. `qa/sync/verify-sync-status.sh` exercises the backend endpoint.

`yarn lint` calls `eslint`, which is not a dependency of this package.

## Build and publish

- **CI gate** (`ci.yml`, job `frontend`): `yarn install --frozen-lockfile`,
  `yarn typescript`, `yarn test`, `yarn build` on every PR.
- **`packages.yml`**: `tsc` and build on changes to `packages/**` (no lint); publishes
  `1.0.0-pre.<run>` to npm tag `next` on a merge to `main`, and the release tag to `latest`
  on a GitHub release. See [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin: none yet.** `distribution/distro.properties` has no
  `spa.frontendModules.@liberiaemr/esm-liberia-sync-status-app` line, so the page is **not**
  in the frontend image until one is added.
