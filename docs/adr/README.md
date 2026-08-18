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
| [0005](0005-cross-facility-identity-reconciliation.md) | Cross-facility identity reconciliation: link, never merge | **Proposed** |
| [0006](0006-pin-o3-refapp-3.7.1.md) | Rebase the distribution on O3 RefApp 3.7.1 | Accepted |
| [0007](0007-pulled-record-scope.md) | Cross-facility pulled-record scope: demographics + enumerated summary | **Proposed** |
| [0008](0008-adopt-openmrs-dbsync.md) | Adopt openmrs-eip + openmrs-dbsync over ActiveMQ Artemis | **Proposed** |

0004 is open and blocks go-live: it is a contractual security control with no platform
implementation.

0005 and 0007 are drafted and **Proposed**, not Accepted; each names the specific questions
the MOH must answer to close it (identity scheme and review-queue ownership for 0005;
sensitive-category exclusions and lawful basis for 0007). Both are due for MOH ICT sign-off
by 21 August 2026 and both block the sync layer: 0005 is a clinical safety decision the
push cannot be built without, 0007 a legal one that cross-facility query cannot.

0008 selects the sync technology and is **conditional**: it holds as written only if the
Debezium/MariaDB spike succeeds, and otherwise stands with MySQL 8.0 substituted. Unlike 0005
and 0007 it needs no MOH decision, only a test.

Background for all three: [Sync & EIP architecture](../architecture/sync-eip.md), the
[module evaluation](../architecture/sync-module-evaluation.md) and
[entity coverage](../architecture/sync-entity-coverage.md).
