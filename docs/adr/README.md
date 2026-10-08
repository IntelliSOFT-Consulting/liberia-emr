# Architecture Decision Records

One file per decision, numbered, never edited after acceptance — superseded by a later ADR
instead. The point is that the MOH inherits the *reasoning*, not just the result: a
decision whose rationale is lost gets re-litigated by whoever maintains this next.

Format: Context → Decision → Consequences → Status.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-artefact-model.md) | Separate distribution and content packages | Accepted |
| [0002](0002-pin-o3-refapp-3.6.md) | Base on O3 RefApp 3.6 + HIS-Lite, pinned exactly | Superseded by [0006](0006-pin-o3-refapp-3.7.1.md) |
| [0003](0003-layered-content-packages.md) | Layer content packages common → programme → site | Accepted |
| 0004 | Password expiry and history enforcement mechanism | **Open** |
| [0005](0005-cross-facility-identity-reconciliation.md) | Cross-facility identity reconciliation: link, never merge | Accepted |
| [0006](0006-pin-o3-refapp-3.7.1.md) | Rebase the distribution on O3 RefApp 3.7.1 | Accepted |
| [0007](0007-pulled-record-scope.md) | Cross-facility pulled-record scope: demographics + enumerated summary | Accepted (amended by [0013](0013-remote-patient-import.md)) |
| [0008](0008-adopt-openmrs-dbsync.md) | Adopt openmrs-eip + openmrs-dbsync over ActiveMQ Artemis | **Proposed** |
| [0009](0009-mfl-facility-locations.md) | The Master Facility List is the source of truth for facility locations | Accepted |
| [0010](0010-indicator-reporting-mamba-etl.md) | Indicator reporting on a per-instance Mamba ETL schema, with an in-tree reports module | **Proposed** (implementation in progress; amended 2026-09) |
| [0011](0011-central-composition.md) | Compose central as its own build, with `content-central` in the site layer's place | Accepted |
| [0012](0012-central-site-locations.md) | Central loads the locations of every site package | Accepted |
| [0013](0013-remote-patient-import.md) | Remote patient import: a local read-only history outside sync, and a shared patient record | Accepted |
| [0014](0014-sync-over-https-path.md) | Facility to central sync over HTTPS on 443, through a path on the central gateway | Accepted |

0004 is open and blocks go-live: it is a contractual security control with no platform
implementation. The number is reserved and has no file until the decision is written; the
options are set out in [the SOP mapping](../security/moh-ict-sop-mapping.md) (A4/A5).

0005 is Accepted by MOH ICT (LE-22) and is being built as the CPI service in the liberiaemr
module: minting and the National ID rule are in (LE-35); scoring, the review queue and the
queue's MOH owner follow. 0007 was Accepted on 3 October 2026, once its two open questions
were answered: nothing is excluded as a sensitive category for now, and the lawful basis is the
care relationship, with no separate consent captured. 0013 amends its condition 1. It had been
due for MOH ICT sign-off by 21 August 2026, and it no longer blocks cross-facility query.

0008 selects the sync technology and is **conditional**: it holds as written only if the
Debezium/MariaDB spike succeeds, and otherwise stands with MySQL 8.0 substituted. Unlike 0007
it needs no MOH decision, only a test. That test passed on 2 September 2026
([sync-eip.md](../architecture/sync-eip.md) §1.8a) and the sync layer is now built on it
([`distribution/sync/`](../../distribution/sync/README.md)). The ADR itself was not updated:
its status line still reads Proposed, and its Context and Decision still say nothing is built
or pinned. Read those as the state when it was written, pending an Accepted status (or a
superseding ADR) from its owner.

0010 is partly built. The ETL module, the reports framework and the report UI package are
merged; the indicator report definitions (LE-334) and the UI's pin in the distribution (LE-335)
are not. Unlike 0008, it was amended in place once the builds had run on real stacks, because
it is still Proposed. It
has a dated "Amendment (2026-09)" section (LE-362), and inline markers point to it from each
decision the builds changed. Its status stays Proposed until its owner accepts it.

0009 makes the MOH Master Facility List (a DHIS2 instance) the source of facility locations,
cached at central by a scheduled sync in the liberiaemr module (LE-317). Accepted on 27 September
2026. Two site-root matches still await MOH or site confirmation.

0013 settles how remote patient search's import may interact with sync. Imported history is a
scoped, read-only cache that sync never watches, and the patient shell shares central's UUIDs.
It amends 0007's "query, never replicate" for offline use and departs from 0005 for imported
patients until an MPI exists. Accepted on 2 October 2026. On 3 October 2026 the cache's
retention period, which acceptance had left open, was set to at most 12 months without access.
No sensitive category is excluded from the cache for now, and its lawful basis is the care
relationship (both 0007, 3 October 2026).

0014 carries sync over HTTPS on 443 at `/sync/broker/` on the central gateway, inside a
WebSocket tunnel at each end, for networks that allow nothing else (LE-372). The facility's
mutual TLS session with the broker travels inside unopened, so 0008's broker and its controls
are unchanged. Accepted on 7 October 2026, once the dev pair synced through the tunnel with
61617 closed.

Background for 0005, 0007, 0008, 0013 and 0014: [Sync & EIP architecture](../architecture/sync-eip.md), the
[module evaluation](../architecture/sync-module-evaluation.md) and
[entity coverage](../architecture/sync-entity-coverage.md).
