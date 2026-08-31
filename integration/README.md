# Integration — External build class

**Build class: External** (IMPLEMENTATION.md §3).

Everything here talks to a system outside O3. **No integration logic belongs in a content
package** — a content package describes metadata, and mixing a DHIS2 push or a sync route
into one makes both impossible to version or roll back independently.

| Directory | Scope | Status |
| --- | --- | --- |
| [`eip/`](eip/) | Facility → central unidirectional push | **Core MOH scope, highest engineering risk**; designed, not yet built |
| [`dhis2/`](dhis2/) | Aggregate export + data-element mappings | Blocked on MOH mapping delivery |
| [`cross-facility/`](cross-facility/) | Cross-facility patient query | Sprint 4 |
| [`msupply/`](msupply/) | Stock integration | Deferred to the support period — spec only |
| [`fhir/`](fhir/) | FHIR profiles and HL7 resources | Underpins the others |

## Design documents

The sync layer is designed in `docs/`; this directory holds the implementation contract.

| Document | Covers |
| --- | --- |
| [Sync & EIP architecture](../docs/architecture/sync-eip.md) | Topology, change capture, transport, identity/CPI, offline & retry, security, cross-facility query |
| [Module evaluation](../docs/architecture/sync-module-evaluation.md) | Why `openmrs-dbsync`; options rejected; versions; compatibility gaps; plan and risks |
| [Entity coverage and sync order](../docs/architecture/sync-entity-coverage.md) | The 34 synced entities; dependency chain; what needs custom work |
| [ADR 0008](../docs/adr/0008-adopt-openmrs-dbsync.md) | The module decision |

**Current state:** no sync code exists. `distribution/` builds `backend`, `frontend` and
`gateway` only; the `sync` and `sync-receiver` images named in the compose files are not
produced by anything in this repository. The compose entries are an intended topology, not a
deployment.

## Why the sync layer carries the most risk

The topology is offline-first and decentralised: each facility runs a complete EMR and
synchronises to a central instance. That means every failure mode of distributed systems
applies, on links that genuinely go down, with clinical data:

- A facility can be offline for days. The queue must survive a restart and drain in order.
- Two facilities can register the same person independently. Identity reconciliation is a
  clinical safety question, not a data-quality nicety.
- A push that half-succeeds must be safe to retry. Idempotency is a requirement, not an
  optimisation.
- Sync must never block care. If the link is down, the facility keeps working.

Direction is **facility → central only** for the first release. Cross-facility query comes
later and is a read path, not a second write path.

## Ground rules

- Central never writes back into a facility database in this release.
- No PHI in logs, ever — the ICT Unit reads audit logs, and audit logs are not a place to
  find patient names.
- TLS with mutual authentication on every facility↔central hop.
- The demo stack has sync disabled; fabricated patients must never reach central.
