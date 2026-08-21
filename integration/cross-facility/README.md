# Cross-facility patient query

**Status: Sprint 4. Not in the first go-live.**

Lets a clinician at one facility retrieve a patient's record from another. A **read** path:
it does not introduce a second write direction into the sync topology.

## Why it comes after facility → central push

It depends on identity reconciliation being solved. Querying across facilities is only
useful if you can tell that the Careysburg record and the Barnersville record describe the
same person — and only *safe* if you can tell when they do not. See the identity discussion
in [`../eip/routes/README.md`](../eip/routes/README.md).

## Design constraints

- **Query, do not replicate.** The querying facility renders the remote record; it does not
  copy it into its local database. Two authoritative copies of one patient is the problem
  this feature is supposed to relieve.
- **Offline degrades cleanly.** No link means no remote results, with a clear message —
  never a spinner and never a silently empty record that reads as "no history".
- **Every access is audited.** Reading another facility's patient record is exactly the
  access pattern the MOH ICT SOPs expect to see logged.
- **Consent and access policy are the MOH's to set**, and must be agreed before build.

## Design

Identity resolution at central assigns a **Central Person Identifier (CPI)** and maintains a
link table; this read path resolves a local patient to a CPI and returns the linked view. The
CPI is never written into a facility database and never typed by a clinician; see
[sync-eip.md](../../docs/architecture/sync-eip.md) §2.5 for how it is generated, stored and
attached.

The query flow, and what a query is allowed to return, are designed in
[`docs/architecture/sync-eip.md`](../../docs/architecture/sync-eip.md) §6 and §3. The scope
decision is [ADR 0007](../../docs/adr/0007-pulled-record-scope.md) (demographics plus an
enumerated clinical summary, never full history), and the identity resolution it depends on
is [ADR 0005](../../docs/adr/0005-cross-facility-identity-reconciliation.md). Both are
**Proposed** and need MOH sign-off before this is built.
