# 0002 openmrs-module-auditlog: serialize a lazy association by its proxy's identifier

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-auditlog` |
| Upstream PR | **TODO — not opened yet.** Open it against `master` with the patch below; until it exists this patch breaks [the rule](../README.md#the-rule) |
| Component version patched | commit `ba96ba5471ccf6e91db0d11b5c7d416ffd4a7460` (`source.auditlog.commit` in `distribution/distro.properties`) |
| Why not configuration | The failure is in compiled code: `AuditLogUtil.getEntityIdentifier()` looks up a persister for `obj.getClass()`, which for a Hibernate proxy is not a mapped entity. No global property changes that path, and excluding the affected types would drop `User` and concept changes from the audit log. |
| Removal condition | An upstream commit or release containing the fix; then bump `source.auditlog.*` (or move to an `omod.auditlog` pin if it is a release on mavenrepo.openmrs.org), and delete the patch body and this sidecar |
| Owner | LE-353 assignee |

The patch body lives at
[`distribution/backend/patches/auditlog/0001-serialize-hibernate-proxies.patch`](../../../distribution/backend/patches/auditlog/0001-serialize-hibernate-proxies.patch),
because it is a build input of the backend image's auditlog stage, which applies every patch
in that directory and fails the build if one no longer applies.

What it fixes, seen on a facility stack on core 2.8.8 with the unpatched module:

- 8 OCL concept mapping saves failed on first boot with `Unknown entity:
  org.openmrs.ConceptReferenceTerm$HibernateProxy$…`: the exception escaped the
  interceptor's `onFlushDirty()` and aborted the business write.
- 41 more times `beforeTransactionCompletion()` caught it and logged "An error occured while
  creating audit log(s)", which drops every audit row of that transaction — for example
  changes whose previous value was a lazily loaded `User`.
