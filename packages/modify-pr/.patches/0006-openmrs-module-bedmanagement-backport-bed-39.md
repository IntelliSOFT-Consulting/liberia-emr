# 0006 openmrs-module-bedmanagement: backport BED-39 to 7.2.0

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-bedmanagement` |
| Upstream PR | [openmrs/openmrs-module-bedmanagement#116](https://github.com/openmrs/openmrs-module-bedmanagement/pull/116) (ticket [BED-39](https://openmrs.atlassian.net/browse/BED-39)), merged 2026-06-15 as `0187cb7`. A backport of an upstream fix; nothing new to upstream. |
| Component version patched | tag `7.2.0`, commit `c346b7b97a662027459d51247f50fdd6ee0d5ab4` (`source.bedmanagement.commit` in `distribution/distro.properties`), built as `7.2.0.2-c346b7b` |
| Why not configuration | Same as [0005](0005-openmrs-module-bedmanagement-end-visit-without-bed-write.md): the privilege check is compiled into `saveBedPatientAssignment()`, which 7.2.0's `EncounterWithBedPatientAssignmentSaveHandler` calls for every non-voided assignment on a visit's encounters, ended ones included. |
| Removal condition | An upstream release containing BED-39 and BED-40: move back to an `omod.bedmanagement` pin at that release, and delete both patches and both sidecars (see 0005) |
| Owner | LE-396 assignee |

The patch body lives at
[`distribution/backend/patches/bedmanagement/0002-backport-bed-39-prevent-premature-flush.patch`](../../../distribution/backend/patches/bedmanagement/0002-backport-bed-39-prevent-premature-flush.patch),
applied after 0001 by the backend image's bedmanagement stage.

Why it is needed: patch 0001 (BED-40) stops `VisitWithBedPatientAssignmentSaveHandler` from
demanding bed write privileges when a visit with no bed ends. But saving a visit also runs its
encounters' save handlers, and on 7.2.0 `EncounterWithBedPatientAssignmentSaveHandler` re-saves
every non-voided bed assignment on those encounters through `saveBedPatientAssignment()`, which
needs `Assign Beds` and `Edit Admission Locations`. So with 0001 alone, ending a visit in which
the patient had a bed that has since been freed still fails for a user without bed write access.

Pointed out in review of #119. Checked on the 7.2.0 tag with the module's own build: with 0001
alone the api tests run 121 with 1 error (`APIAuthenticationException` from
`saveBedPatientAssignment`); with 0002 as well, all 124 pass.
