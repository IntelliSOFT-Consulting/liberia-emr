# 0004 openmrs-module-auditlog: treat an unmapped class as "no metadata"

| Field | |
| --- | --- |
| Upstream repo | `openmrs/openmrs-module-auditlog` |
| Upstream PR | [openmrs/openmrs-module-auditlog#32](https://github.com/openmrs/openmrs-module-auditlog/pull/32) (ticket [AUDIT-66](https://openmrs.atlassian.net/browse/AUDIT-66)) |
| Component version patched | commit `ba96ba5471ccf6e91db0d11b5c7d416ffd4a7460` (`source.auditlog.commit` in `distribution/distro.properties`) |
| Why not configuration | The failure is in compiled code: `DAOUtils` relies on `SessionFactory.getClassMetadata()` returning null for an unmapped class, which Hibernate 5 no longer does. The only configuration that avoids the code path is the `ALL` strategy with no exceptions, which would put password hashes back into the audit log (see `gp-audit.xml`). |
| Removal condition | An upstream commit or release containing the fix; then bump `source.auditlog.*`, and delete the patch body and this sidecar |
| Owner | LE-353 assignee |

The patch body lives at
[`distribution/backend/patches/auditlog/0003-unmapped-class-metadata.patch`](../../../distribution/backend/patches/auditlog/0003-unmapped-class-metadata.patch),
applied by the backend image's auditlog stage after `0001` and `0002`.

What it fixes: with `ALL_EXCEPT` and a non-empty `auditlog.exceptions`, the first save that
needs the module's implicitly-audited type set throws `MappingException: Unknown entity:
java.lang.String` from `DAOUtils.getAssociationTypesToAuditInternal()`, and that save fails.
On a clean install this was the OCL importer starting the first dictionary zip. The failure
happened in a daemon thread whose exception openmrs-core swallows, so the only trace was
Initializer's "OCL import did not start successfully". CI's clean-install job then lost the
whole LIB/mch zip (3838 concepts instead of 4516) and rejected 73 CSV rows that referenced
its concepts.
