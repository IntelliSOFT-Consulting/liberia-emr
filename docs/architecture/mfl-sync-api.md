# MFL sync REST API

The contract between the liberiaemr module (LE-321, LE-322), the MFL admin page in
`esm-liberia-sync-status-app` (LE-323) and the API tests (LE-325). The design decisions behind it
are in [ADR 0009](../adr/0009-mfl-facility-locations.md).

TypeScript types:
[`packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts`](../../packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts).
Where the types and this document disagree, this document wins.

## Conventions

- Base path: `/ws/rest/v1/liberiaemr/mfl`. It is a Spring `@Controller`, like
  `SyncConflictController`, not a REST module resource.
- JSON only. Timestamps are **epoch milliseconds**, like the sync conflicts API. Dates without
  a time (`openingDate`, `closedDate`) are `yyyy-mm-dd` strings.
- Every error body is `{"error": "<message>"}`.
- Privileges, created by `content-liberia-national` (LE-320) and granted to the Sync
  Administrator role:
  - **`View MFL Sync`** for every `GET`.
  - **`Manage MFL Sync`** for every `PUT` and `POST`.
- An unauthenticated caller, or one without the privilege, gets **403**, as the existing
  liberiaemr controllers return.
- **No response ever contains the MFL password,** in any field, including errors. LE-325 tests
  this on every endpoint.

### Availability

The sync is **available** when `LIBERIAEMR_MFL_USERNAME` and a password (from the file or the
variable) are both set. Where it is not available:

- `GET /status` still returns **200**, with `"available": false`. The page uses this to hide
  itself.
- `GET /runs` and `GET /runs/{id}` still work and return any history.
- `POST /runs` and `POST /test-connection` return **503**
  `{"error": "MFL credentials are not configured on this instance"}`.
- `PUT /config` works, so settings can be staged before the credentials arrive.

### Allowed MFL hosts

`url` is editable over this API, and the sync sends the MFL credentials to it. So the module
sends them only to a host on an allowlist set in the **deployment environment**, never in a
global property:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIBERIAEMR_MFL_ALLOWED_HOSTS` | `dhis2.moh.gov.lr` | Comma-separated host names the MFL URL may point at. Case-insensitive; an exact host match, not a suffix |
| `LIBERIAEMR_MFL_ALLOW_INSECURE_HTTP` | unset | `true` permits `http://` to an allowed **loopback** host only (`localhost`, `127.0.0.1`), for a stub MFL in development. It never permits `http://` to any other host |

- `PUT /config` rejects a `url` that fails the check with **400** (see below).
- The module checks the URL again before **every** request, so a `liberiaemr.mfl.url` edited
  directly in the database cannot redirect the credentials either. Such a run ends `FAILED`,
  and `POST /test-connection` answers `ok: false`, with the reason in `message`.
- Redirects are never followed. A `3xx` answer from the MFL fails the run instead.
- The MFL is called over TLS with the JVM's truststore. Certificate checks are never disabled.

## Endpoints

| Method | Path | Privilege | Success |
| --- | --- | --- | --- |
| `GET` | `/status` | View MFL Sync | 200 `MflStatus` |
| `PUT` | `/config` | Manage MFL Sync | 200 `MflStatus` |
| `POST` | `/test-connection` | Manage MFL Sync | 200 `MflConnectionTest` |
| `POST` | `/runs` | Manage MFL Sync | 202 `MflRun` |
| `GET` | `/runs` | View MFL Sync | 200 `MflRunPage` |
| `GET` | `/runs/{id}` | View MFL Sync | 200 `MflRun` |
| `GET` | `/runs/{id}/items` | View MFL Sync | 200 `MflRunItemPage` |

LE-319 first sketched `POST /sync`; the contract uses `POST /runs`, because a run is the
resource that call creates.

### `GET /status`

```json
{
  "available": true,
  "config": {
    "enabled": true,
    "url": "https://dhis2.moh.gov.lr/mfl",
    "username": "an-api-user",
    "schedule": { "time": "02:00" }
  },
  "nextRun": 1790560800000,
  "running": null,
  "lastRun": {
    "id": 42,
    "dryRun": false,
    "trigger": "SCHEDULE",
    "status": "SUCCEEDED",
    "startedBy": null,
    "started": 1790474400000,
    "finished": 1790474431000,
    "counts": { "created": 0, "updated": 3, "retired": 0, "unretired": 0, "unchanged": 1107, "failed": 0, "warnings": 11 },
    "message": null
  },
  "lastSuccessfulRun": { "id": 42, "...": "same shape as lastRun" },
  "held": { "counties": 15, "districts": 106, "facilities": 996, "retired": 2 }
}
```

- `config.username` is shown so an administrator can see *which* account is configured; it is
  `null` when unset. There is **no** password field, masked or otherwise.
- `nextRun` is `null` when `enabled` is false.
- `running` is the in-progress `MflRun`, or `null`.
- `lastRun` and `lastSuccessfulRun` are `null` before the first run.
- `held` counts the non-retired MFL-managed locations on this instance (they carry an `MFL UID`
  attribute), plus the retired ones in `retired`.

### `PUT /config`

The request is a **partial** `config`. Omitted fields are unchanged; `username` is not
accepted.

```json
{ "enabled": true, "url": "https://dhis2.moh.gov.lr/mfl", "schedule": { "time": "03:30" } }
```

- **200**: the full `MflStatus` after the change. A schedule change reschedules the task
  immediately.
- **400**: validation errors:
  - `url` is not `https://`, or ends in `/api`. It is the instance root, and the module adds
    `/api`.
  - `url`'s host is not in `LIBERIAEMR_MFL_ALLOWED_HOSTS` (see
    [Allowed MFL hosts](#allowed-mfl-hosts)), or `url` carries a user name or password. The
    message names the allowed hosts, for example
    `{"error": "'mfl.example.org' is not an allowed MFL host. Allowed: [dhis2.moh.gov.lr], set by LIBERIAEMR_MFL_ALLOWED_HOSTS in the deployment environment"}`.
  - `schedule.time` is not `HH:MM` in 24-hour time.
  - `username` or any password-like field is present.

### `POST /test-connection`

No body. The module calls `GET {url}/api/system/info` and counts the level-4 org units
(`pageSize=1`), using the configured credentials.

```json
{ "ok": true, "dhis2Version": "2.40.4.1", "facilities": 996, "message": null }
```

```json
{ "ok": false, "dhis2Version": null, "facilities": null, "message": "401 Unauthorized from the MFL: check the configured account" }
```

A failed connection is still **200** with `ok: false`: the test ran, and the answer is "no".
The response is **503** only when the sync is unavailable. `message` must never echo the
request's credentials or an `Authorization` header.

### `POST /runs`

```json
{ "dryRun": true }
```

- Every run is a **full** pull of the MFL, diffed locally (ADR 0009 §8). There is no mode.
- `dryRun`: default `false`. A dry run fetches from the MFL, computes every change and records
  the items, but writes no location.
- **202**: the new run in status `RUNNING`, with a `Location: /ws/rest/v1/liberiaemr/mfl/runs/{id}`
  header. The run proceeds in the background; the client polls `GET /runs/{id}`.
- **409** `{"error": "A run is already in progress", "runId": 43}`: runs never overlap.
- **503**: the sync is unavailable.

### `GET /runs?startIndex=0&limit=20`

This returns newest first. `limit` defaults to 20, with a maximum of 100.

```json
{ "results": [ { "id": 43, "...": "MflRun" } ], "totalCount": 43 }
```

### `GET /runs/{id}`

```json
{
  "id": 43,
  "dryRun": true,
  "trigger": "MANUAL",
  "status": "SUCCEEDED",
  "startedBy": "admin",
  "started": 1790505989000,
  "finished": 1790506040000,
  "counts": { "created": 12, "updated": 40, "retired": 1, "unretired": 0, "unchanged": 1057, "failed": 0, "warnings": 11 },
  "message": null
}
```

- `status` is one of:
  - `RUNNING`.
  - `SUCCEEDED`: every item applied, or computed on a dry run.
  - `PARTIAL`: the run finished, but either `counts.failed` > 0 or the completeness guard
    skipped retirement (a page failed, or the pull held under 90% of the active MFL
    locations; ADR 0009 §5). `message` says which.
  - `FAILED`: the run stopped. `message` says why: the MFL was unreachable, or
    authentication was refused.
- `trigger`: `SCHEDULE` or `MANUAL`.
- `startedBy` is the username for a manual run, or `null` for a scheduled one.
- On a dry run, `counts` are what *would* happen.
- **404**: no such run.

### `GET /runs/{id}/items?action=UPDATE&startIndex=0&limit=50`

These are the per-location changes, warnings and errors of a run. A location that is unchanged
and has no warning is **not** recorded. `action` is an optional filter; `limit` defaults to 50, with a maximum of 200.

```json
{
  "results": [
    {
      "action": "UPDATE",
      "level": "FACILITY",
      "mflUid": "nY6mPgT0Kc6",
      "mflCode": "LBR-06-0624-06",
      "locationUuid": "7dd5a981-7e3a-59fa-b1fa-e1474e299da8",
      "name": "Jah Clinic",
      "changes": [ { "field": "name", "from": " Jah Clinic", "to": "Jah Clinic" } ],
      "warnings": [],
      "error": null
    },
    {
      "action": "WARNING",
      "level": "FACILITY",
      "mflUid": "…",
      "mflCode": "…",
      "locationUuid": "…",
      "name": "Kesselee Memorial Health Center",
      "changes": [],
      "warnings": [ "Facility Type: in Clinic and Health Center; Health Center wins" ],
      "error": null
    },
    {
      "action": "ERROR",
      "level": "FACILITY",
      "mflUid": "AbCdEfGhIjK",
      "mflCode": null,
      "locationUuid": "…",
      "name": "Careysburg Health Center",
      "changes": [],
      "warnings": [],
      "error": "Not retired: this instance's own facility root. Decide by hand (ADR 0009 §5)"
    }
  ],
  "totalCount": 3
}
```

- `action` is one of `CREATE`, `UPDATE`, `RETIRE`, `UNRETIRE`, `WARNING` or `ERROR`.
  `WARNING` means the location is unchanged but has warnings.
- `warnings` holds every group tie-break, out-of-bounds point and name disambiguation for
  that location (ADR 0009 §3), on any action. `counts.warnings` is the number of items with
  at least one warning.
- `level` is one of `COUNTY`, `DISTRICT` or `FACILITY`.
- `changes[].field` names what changed: `name`, `parent`, `latitude`, `longitude`,
  `stateProvince`, `countyDistrict`, a tag as `tag:<name>`, or an attribute as
  `attribute:<type name>`. `from` and `to` are display strings; `from` is `null` on
  `CREATE`.
- **404**: no such run.
