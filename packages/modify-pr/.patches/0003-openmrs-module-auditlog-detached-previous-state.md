# 0003 openmrs-module-auditlog: keep the temporary session open for a detached entity's previous state

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-auditlog` |
| Upstream PR | **TODO — not opened yet.** Open it against `master` with the patch below; until it exists this patch breaks [the rule](../README.md#the-rule) |
| Component version patched | commit `ba96ba5471ccf6e91db0d11b5c7d416ffd4a7460` (`source.auditlog.commit` in `distribution/distro.properties`) |
| Why not configuration | The failure is in compiled code: `HibernateAuditLogInterceptor.onFlushDirty()` closes the session its previous-state proxies belong to before comparing them. Excluding the affected types would take `Concept`, and with it most metadata, out of the audit log. |
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
