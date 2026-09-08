# 0001 openmrs-dbsync: allow OpenMRS 2.8.x through the version whitelist

| Field | |
| --- | --- |
| Upstream repo | `mekomsolutions/openmrs-dbsync` |
| Upstream PR | [mekomsolutions/openmrs-dbsync#12](https://github.com/mekomsolutions/openmrs-dbsync/pull/12) |
| Component version patched | `4.0.0` (`sync.dbsync` in `distribution/distro.properties`) |
| Why not configuration | The refusal is compiled in: `AppUtils.adjustJpaMappings()` throws for any platform version outside a hard-coded 2.5 to 2.7 whitelist, before any configuration is consulted. |
| Removal condition | The first dbsync release whose whitelist accepts 2.8.x; then bump `sync.dbsync`, delete the patch and this sidecar, and switch `distribution/sync/Dockerfile` to the released `-exe.jar` from Mekom's Nexus. |
| Owner | Paul (LE-35) |

The patch body lives at
[`distribution/sync/patches/0001-allow-openmrs-2.8.patch`](../../../distribution/sync/patches/0001-allow-openmrs-2.8.patch)
rather than beside this sidecar because it is a docker build input: the sync image's build
context is `distribution/sync/` and the Dockerfile applies everything in its `patches/`
directory. This sidecar is the tracking record; the patch header carries the full
justification (2.7 to 2.8 schema analysis) and the end-to-end test evidence.

Safety analysis, in one paragraph: the whitelist guards JPA entity mappings. The
openmrs-core 2.8.x changelog touches one synced table only, `provider`, which gains a
nullable `provider_role_id` column that an unmapped entity never selects. Verified
end to end 2026-09-02 on MariaDB 10.11 and platform 2.8.8 (snapshot, binlog attach,
correct payloads for a live registration). Known fidelity gap until upstream maps it:
provider role assignments are not carried in sync payloads.
