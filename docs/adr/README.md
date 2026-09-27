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
| [0007](0007-pulled-record-scope.md) | Cross-facility pulled-record scope: demographics + enumerated summary | **Proposed** |
| [0008](0008-adopt-openmrs-dbsync.md) | Adopt openmrs-eip + openmrs-dbsync over ActiveMQ Artemis | **Proposed** |
| [0009](0009-mfl-facility-locations.md) | The Master Facility List is the source of truth for facility locations | Accepted |

0004 is open and blocks go-live: it is a contractual security control with no platform
implementation. The number is reserved and has no file until the decision is written; the
options are set out in [the SOP mapping](../security/moh-ict-sop-mapping.md) (A4/A5).

0005 is Accepted by MOH ICT (LE-22) and is being built as the CPI service in the liberiaemr
module: minting and the National ID rule are in (LE-35); scoring, the review queue and the
queue's MOH owner follow. 0007 is drafted and **Proposed**, not Accepted; it names the
questions the MOH must answer to close it (sensitive-category exclusions and lawful basis).
It was due for MOH ICT sign-off by 21 August 2026 and blocks cross-facility query, which is a
legal decision rather than a technical one.

0008 selects the sync technology and is **conditional**: it holds as written only if the
Debezium/MariaDB spike succeeds, and otherwise stands with MySQL 8.0 substituted. Unlike 0007
it needs no MOH decision, only a test. That test passed on 2 September 2026
([sync-eip.md](../architecture/sync-eip.md) §1.8a) and the sync layer is now built on it
([`distribution/sync/`](../../distribution/sync/README.md)). The ADR itself was not updated:
its status line still reads Proposed, and its Context and Decision still say nothing is built
or pinned. Read those as the state when it was written, pending an Accepted status (or a
superseding ADR) from its owner.

0009 makes the MOH Master Facility List (a DHIS2 instance) the source of facility locations,
cached at central by a scheduled sync in the liberiaemr module (LE-317). Accepted on 27 September
2026. Two site-root matches still await MOH or site confirmation.

Background for 0005, 0007 and 0008: [Sync & EIP architecture](../architecture/sync-eip.md), the
[module evaluation](../architecture/sync-module-evaluation.md) and
[entity coverage](../architecture/sync-entity-coverage.md).
