# Patch sidecar — esm-service-queues-app serve redirect per service

| Field | Value |
| --- | --- |
| Upstream repo | `openmrs/openmrs-esm-patient-management` (`packages/esm-service-queues-app`) |
| Upstream PR | **TODO — open it and replace this line with the link** |
| Component version patched | `11.1.0` (pinned in `distribution/distro.properties`). The hard-coded redirect is unchanged in `12.1.1`. |
| Why not configuration | `call-queue-entry.modal.tsx` calls `navigate({ to: '${openmrsSpaBase}/patient/<uuid>/chart' })` with no config lookup. `customPatientChartUrl` only drives the patient-name link in the queue table, and is not per service. |
| Removal condition | Bump `@openmrs/esm-service-queues-app` to the upstream release that ships the config key, delete this file and `distribution/frontend/patch-service-queues-serve-redirect.cjs`, and remove its `COPY` + `RUN` lines from `distribution/frontend/Dockerfile`. Keep `servePatientChartUrls` in `config-national.json` if upstream keeps the name. |
| Owner | **TODO — name the person chasing the upstream PR** |

## What the patch does

LE-121 item 3: after Serve, open the chart page for the queue's service.

1. Adds a config key to the schema chunk (anchor `customPatientChartUrl:{_type:i.Type.String,`):

   ```ts
   servePatientChartUrls: {
     _type: Type.Array,
     _default: [],
     _elements: { _type: Type.Object, serviceConceptUuid: { _type: Type.UUID }, url: { _type: Type.String } },
   }
   ```

2. Replaces the Serve handler's navigate (anchor
   `(0,r.navigate)({to:"${openmrsSpaBase}/patient/".concat(y.patientUuid,"/chart")})`) with a lookup of
   `y.queue.service.uuid` in `servePatientChartUrls`. A match navigates to its `url`, else to the chart as
   before, with `templateParams: { patientUuid }`.

With the default `[]` the behaviour is unchanged, which is the shape the upstream PR should take.

## Build safety

- Fails if `openmrs-esm-service-queues-app-11.1.0-liberia1` is missing: the version drifted, or the
  location patch (0001) did not run first.
- Each anchor must occur exactly once across the module's chunks.
- The lock string `__liberiaEmrServiceQueuesServeRedirect` makes a second run throw before any write.
- Renames the module directory to `-liberia2` and rewrites its single import-map entry, so browsers
  fetch the patched chunks.
