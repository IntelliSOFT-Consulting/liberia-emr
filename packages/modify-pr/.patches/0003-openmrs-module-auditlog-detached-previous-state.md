# 0003 openmrs-module-auditlog: fix the detached-entity path of onFlushDirty()

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-auditlog` |
| Upstream PR | [openmrs/openmrs-module-auditlog#31](https://github.com/openmrs/openmrs-module-auditlog/pull/31) (ticket [AUDIT-65](https://openmrs.atlassian.net/browse/AUDIT-65)) |
| Component version patched | commit `ba96ba5471ccf6e91db0d11b5c7d416ffd4a7460` (`source.auditlog.commit` in `distribution/distro.properties`) |
| Why not configuration | The failures are in compiled code: `HibernateAuditLogInterceptor.onFlushDirty()` closes the session its previous-state proxies belong to before comparing them, and assumes a detached entity always has a stored row. Excluding the affected types would take `Concept`, and with it most metadata, out of the audit log. |
| Removal condition | An upstream commit or release containing the fix; then bump `source.auditlog.*`, and delete the patch body and this sidecar |
| Owner | LE-353 assignee |

The patch body lives at
[`distribution/backend/patches/auditlog/0002-keep-session-open-for-detached-previous-state.patch`](../../../distribution/backend/patches/auditlog/0002-keep-session-open-for-detached-previous-state.patch),
applied by the backend image's auditlog stage after `0001`.

What it fixes, seen on a facility stack on core 2.8.8: with the module installed and only
patch `0001` applied, Initializer failed to load two rows that load without the module, a
program workflow (`could not initialize proxy [org.openmrs.Concept#4017] - no Session`) and an
appointment service type (`… [org.openmrs.module.appointments.model.Speciality#1] - no
Session`). The exception escaped the interceptor and failed Initializer's own save.

With the session kept open, the same path then threw `NullPointerException` where a detached
entity has no stored row yet: creating a patient over REST for an existing person (the
Person is being made a Patient) failed, as did one Initializer appointment service type row.
A missing row now means no previous state, and every current value is recorded as the change.

The same person-to-patient case fails differently when the Person is still in Hibernate's
second-level cache: the temporary session's `get()` throws `WrongClassException` instead of
returning null. This was reproduced in upstream's test harness on core 2.5.0, but not yet
seen in production. That exception also means no previous state now. The patch body is the
main-code diff of the fix prepared for upstream; the upstream PR adds the tests.
