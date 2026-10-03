# 0005 openmrs-module-bedmanagement: ending a visit with no bed needs no bed write privilege

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-bedmanagement` |
| Upstream PR | [openmrs/openmrs-module-bedmanagement#119](https://github.com/openmrs/openmrs-module-bedmanagement/pull/119) (ticket [BED-40](https://openmrs.atlassian.net/browse/BED-40)) |
| Component version patched | tag `7.2.0`, commit `c346b7b97a662027459d51247f50fdd6ee0d5ab4` (`source.bedmanagement.commit` in `distribution/distro.properties`), built as `7.2.0.1-c346b7b` |
| Why not configuration | The privilege check is compiled in: `VisitWithBedPatientAssignmentSaveHandler` calls `unAssignBedsInEndedVisit()`, which is `@Authorized` with `Assign Beds` and `Edit Admission Locations`, on every save of an ended visit. The only configuration answer is to grant both to every role that ends visits, which is bed write access for the whole front desk; that is not least privilege, and an MOH decision rather than ours. |
| Removal condition | An upstream release containing the fix: move back to an `omod.bedmanagement` pin at that release, then delete the `source.bedmanagement.*` lines, the Dockerfile stage, the patch body and this sidecar |
| Owner | LE-396 assignee |

The patch body lives at
[`distribution/backend/patches/bedmanagement/0001-end-visit-without-bed-write-privileges.patch`](../../../distribution/backend/patches/bedmanagement/0001-end-visit-without-bed-write-privileges.patch),
because it is a build input of the backend image's bedmanagement stage, which applies every
patch in that directory and fails the build if one no longer applies.

What it fixes, seen on a facility stack on core 2.8.8 with released 7.2.0: every login role
but the administrator could check a patient in and queue them (LE-395), but **ending the
visit answered `403 Assign Beds`**, for a patient who never had a bed.

- Root cause: `VisitWithBedPatientAssignmentSaveHandler.java:47-49` calls
  `unAssignBedsInEndedVisit()` for every visit with a stop time;
  `BedManagementService.java:121` requires both bed write privileges for it, and the
  authorization advice checks them before the method looks for an assignment.
- Fix: ask `getBedPatientAssignmentByVisit(uuid, false)` first and call
  `unAssignBedsInEndedVisit()` only when it returns an assignment. That read needs `Get Beds`
  and `Get Admission Locations`, which every visit save already needs (the module's visit
  validator makes the same call), so no role needs a new privilege. Ending a visit that does
  hold a bed still requires both write privileges.

The version is `7.2.0.1-c346b7b`, not `7.2.0-<sha>`: openmrs-core 2.8.8's
`ModuleUtil.compareVersion` sorts a qualified version below its unqualified twin, so
`7.2.0-<sha>` would lose to the released `7.2.0` on a server that still holds it. The fourth
number makes it sort above 7.2.0 and below 7.2.1; the O3 frontend reads it as `7.2.0`. The
Dockerfile stage refuses a stamped version that does not sort above the commit's own.

Proposed upstream ticket (project BED on openmrs.atlassian.net): "Ending a visit requires
Assign Beds and Edit Admission Locations even when the patient has no bed". The branch and the
PR description are prepared locally; nothing is published.
