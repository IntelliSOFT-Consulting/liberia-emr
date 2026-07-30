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
| 0005 | Cross-facility identity reconciliation policy | **Open** |
| [0006](0006-pin-o3-refapp-3.7.1.md) | Rebase the distribution on O3 RefApp 3.7.1 | Accepted |

0004 and 0005 are open and both block go-live: 0004 is a contractual security control with
no platform implementation, and 0005 is a clinical safety decision the sync layer cannot be
built without.
