# esm-liberia-audit-log-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

The ICT Unit's **audit log viewer**, MOH ICT SOP control B3: every record created, changed or
deleted on this server, who did it and when, with the previous and new values, and a CSV
download. The operator's guide is [`docs/runbooks/audit-log.md`](../../docs/runbooks/audit-log.md).

Why it exists: the auditlog module records the log (control C1), but its only viewer is a
legacy UI page that returns 404 on core 2.8.8, and it has no REST resource
(`docs/security/moh-ict-sop-mapping.md`, B3).

## Backend calls

All to `modules/liberiaemr`'s `AuditLogController`
([contract](../../modules/liberiaemr/README.md#audit-log-viewer)); every call needs
**Get Audit Logs**:

| Call | Used for |
| --- | --- |
| `GET /ws/rest/v1/liberiaemr/auditlog?from&to&user&type&action&topLevelOnly&startIndex&limit` | the table, paged on the server |
| `GET /ws/rest/v1/liberiaemr/auditlog/{uuid}` | the detail panel |
| `GET /ws/rest/v1/liberiaemr/auditlog/types` | the Type filter's options |
| `GET /ws/rest/v1/liberiaemr/auditlog/export?…&limit` | Download CSV: a plain link, so the browser streams the file to disk |

## What it shows

- **Filters**: from and to date (whole days, server time), user (username or system ID),
  type (from the types the log holds), action, and whether to hide entries saved as part of
  another (a patient's name saved with the patient). Applied with **Apply filters**, which
  returns to page 1.
- **Table**: date, action, type, identifier (the record's database id; a global property's
  name), user (`System` when none was logged in). Paged by the server, 50 per page by default.
- **Detail panel**: who, when, the full class name and entry UUID, then an update's changed
  properties with previous and new values, or a deleted item's last state, and the entries
  saved with it. A value the server withheld shows as **Redacted**.
- **Download CSV**: the applied filters, newest first, up to `exportRowLimit` rows (the server
  caps it at 50,000).
- **Notices**: `403` says to ask for the ICT Auditor role; `503` says the auditlog module is
  not running on this server.

## Where it is mounted

| | Name | Where |
| --- | --- | --- |
| Page | `root` | route `audit-log` |
| Extension | `audit-log-app-menu-item` | `app-menu-slot`, online only, privilege `View Audit Log` |

Two privileges, both held by the national **ICT Auditor** role and no other:
`View Audit Log` (content-liberia-national) shows the menu entry; `Get Audit Logs` (the
auditlog module's) is what the server checks on every call. The page reached by its URL
without the second shows the `403` notice and no data.

**Backend dependencies** (`routes.json`): `webservices.rest >=2.47.0`. `liberiaemr` is
**deliberately not declared**: it is built in-tree and stamped `0.0.0-ci` in CI, so a version
floor raises the "unresolved backend dependencies" alert that fails Cypress. Neither is
`auditlog`, which is built from a pinned commit (`source.auditlog.*`); without it the page
shows the `503` notice.

## Configuration

| Key | Default | |
| --- | --- | --- |
| `pageSize` | `50` | Entries per page when the page opens |
| `pageSizes` | `[25, 50, 100, 200]` | Page sizes offered; the server serves at most 200 |
| `exportRowLimit` | `50000` | Rows per CSV download; the server caps it at 50,000 |

No configuration is needed; the defaults are what the runbook describes.

## Development

```bash
yarn install
yarn start:local  # openmrs develop on port 8084 against localhost:8085
yarn lint         # eslint with @openmrs/eslint-config
yarn typescript
yarn test         # jest + @openmrs/esm-framework/mock
yarn verify       # yarn lint && yarn typescript && yarn test
yarn build
```

The tests (`src/audit-log/audit-log.test.tsx`) cover the menu entry's privilege gating, the
list and its total, filters and paging sent to the server, the CSV link, an update's values,
a redacted value, a deleted item's last state with its child entries, and the `403` and
`503` notices.

**End-to-end:** `qa/e2e/cypress/e2e/AuditLog.cy.ts`. Until this package is pinned in
`distribution/distro.properties`, the served SPA does not include it, so the spec loads this
checkout's `dist/` into the page (see the spec's header); CI's E2E job builds it first.

## Build and publish

- **CI gate** (`ci.yml`, job `frontend`): `yarn install --frozen-lockfile`, `yarn lint`,
  `yarn typescript`, `yarn test`, `yarn build` on every PR.
- **`packages.yml`**: lint, `tsc` and build on changes to `packages/**`; publishes
  `1.0.0-pre.<run>` to npm tag `next` on a merge to `main`, and the release tag to `latest`
  on a GitHub release. See [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin:** `spa.frontendModules.@liberiaemr/esm-liberia-audit-log-app` in
  `distribution/distro.properties`, **not yet set**: a new package has no published version
  until its first merge. The pin is a follow-up PR naming the exact pre-release that merge
  published, as the reports app did (#197, then #199).
