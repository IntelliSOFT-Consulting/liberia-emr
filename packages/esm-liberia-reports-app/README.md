# esm-liberia-reports-app

**Build class: Custom Build** (IMPLEMENTATION.md §3). Jira LE-335.

The **indicator report runner** for the MOH reports built by `modules/liberiaemrreports`:

1. choose a report;
2. choose a month or a quarter, and a location;
3. run it and follow its status;
4. read the figures grouped by indicator and disaggregation;
5. export CSV or Excel.

Aggregates only; nothing patient-level.

Why this is not `@openmrs/esm-reports-app` (which stays pinned for administrators):
[ADR 0010](../../docs/adr/0010-indicator-reporting-mamba-etl.md) decision 8a.

## Backend calls

Every report call is reportingrest 2.0.0, as in
[`docs/reporting/README.md`](../../docs/reporting/README.md) §4. Nothing from §4.3 is used.

| Step | Call |
| --- | --- |
| List reports | `GET reportingrest/reportDefinition?v=full`, filtered to `reportUuids`, in that order |
| Formats | `GET reportingrest/reportDesign?reportDefinitionUuid=…`: CSV and Excel told apart by `rendererType` |
| Run | `POST reportingrest/reportRequest` with the CSV design. A report with no CSV design cannot be run; no other design stands in for it |
| Poll | `GET reportingrest/reportRequest/{uuid}` every `pollIntervalMs`, until `COMPLETED`, `FAILED` or `SAVED` |
| View | `GET reportingrest/reportDataSet/{report}/indicators?startDate&endDate[&location]` |
| Download CSV | `GET reportingrest/downloadReport?reportRequestUuid=…` of the run |
| Download Excel | a second `POST reportRequest` with the Excel design, polled, then `downloadReport` |
| Cancel | `DELETE reportingrest/reportRequest/{uuid}`, also sent for a run or export left unfinished when another report is chosen |

- **Why the view evaluates again.** The CSV renderer writes column *labels*, which lose the
  `<CODE>_<part>` names that the view groups by (§3.3).
- **How `fileContent` is decoded.** `src/reports/report-file.ts` is the one place. It accepts
  base64 (Jackson's encoding of `byte[]`, and what the upstream reports app assumes), a byte
  array, or plain text, until LE-335 confirms the encoding on a real stack.

Instance role, facility location and ETL freshness come from
`GET /ws/rest/v1/liberiaemrreports/context`. This is **a proposal to the reports module; it
does not exist yet** (ADR 0010 decision 8a). The page fails closed:

- if that endpoint does not answer, the page treats the server as a facility;
- it then fixes the location to "This facility" and leaves `location` out of the request;
- the backend defaults and clamps that to the facility.

## What it shows

- **Access.** Only users holding **Export National Report** see the menu item and the page.
  Everyone else sees a notice. The privilege is written once, in `routes.json`: the app shell
  reads it there for the menu item, and `src/privileges.ts` reads it from there for the
  components. It is not a config key, because the app shell cannot read config and the reports
  module enforces the same fixed privilege on the server.
- **Report data freshness.** When the ETL last completed. At central, a second notice says
  that figures lag the facilities' own reports until sync catches up.
- **Location.**
  - At a facility: the facility, fixed.
  - At central: national by default, then a county, a district, or a facility found by name
    or MFL code. The most specific choice is reported on.
  - The central options come from the same `Health Facility`-tagged location list as the login
    facility switcher (LE-324). `src/location/mfl-locations.resource.ts` mirrors that app's
    `facility-picker.resource.ts`; keep the two in step.
- **Not-captured notes.** The selected report's `description` is shown as "What this report
  cannot count". The reports module is expected to write each report's not-captured
  disaggregations there.

## Where it is mounted

| | Name | Where |
| --- | --- | --- |
| Page | `root` | route `indicator-reports` |
| Extension | `indicator-reports-app-menu-item` | `app-menu-slot`, online only, privilege `Export National Report` |

**Backend dependencies** (`routes.json`) are `webservices.rest >=2.47.0` and
`reportingrest >=2.0.0`. Both are real published versions.

`liberiaemrreports` and `mamba-etl-liberiaemr` are **deliberately not declared**. They are
built in-tree and stamped `0.0.0-ci` in CI, so a version floor would raise the "unresolved
backend dependencies" alert that fails Cypress. This is the same reason the sync status app
omits `liberiaemr`.

## Configuration

| Key | Default | |
| --- | --- | --- |
| `reportUuids` | `[]` | The MOH reports, as `${var.report.<sheet>.uuid}` in `config-national.json` once the reports module declares them. Empty: the page says no reports are available |
| `dataSetKey` | `indicators` | The data set shown on screen |
| `facilityLocationTag` | `Health Facility` | The central picker's facility list |
| `mflCodeAttributeTypeUuid` | `''` | Set to `${var.…}` to search by MFL code |
| `maxFacilitiesShown` | `8` | |
| `pollIntervalMs` | `3000` | |
| `monthsOffered` / `quartersOffered` | `12` / `8` | Counting back from the current period, which is marked "in progress". The default is the last complete period |

Once the reports module declares its variables, add this to `config-national.json`:

```json
"@liberiaemr/esm-liberia-reports-app": {
  "reportUuids": [
    "${var.report.rmncah.uuid}", "${var.report.nutrition.uuid}", "${var.report.malaria.uuid}",
    "${var.report.ncd.uuid}", "${var.report.emr-ops.uuid}"
  ]
}
```

## Development

```bash
yarn install
yarn start:local  # openmrs develop on port 8084 against localhost:8085
yarn test         # jest; the backend is src/testing/mock-backend.ts
yarn verify       # yarn typescript && yarn test
yarn build
```

**Unit tests.** Until the reports module exists, the tests run against
`src/testing/mock-backend.ts`. Its shapes are taken from the reportingrest-omod 2.0.0 sources.
They cover:

- periods, column-name parsing and disaggregation wording;
- every `fileContent` shape;
- the §4.1 request body and design selection;
- the role failing closed;
- the full run → poll → view → CSV/Excel flow;
- a report with no CSV design, one Excel export per click burst, a run or export dropped when
  another report is chosen, and an export whose status cannot be read;
- the facility and central location pickers;
- privilege gating.

**End-to-end.** `qa/e2e/cypress/e2e/IndicatorReports.cy.ts` is **pending** (`it.skip`) until
the backend and the pin reach the demo stack.
