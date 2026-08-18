# 0007: Cross-facility pulled-record scope: demographics plus an enumerated clinical summary

**Status:** Proposed, awaiting MOH ICT and MOH legal agreement (LE-22, target 21 August 2026)

## Context

Cross-facility query (Sprint 4) lets a clinician at one facility retrieve a patient's record
from another, once [ADR 0005](0005-cross-facility-identity-reconciliation.md) has
established that the two records describe the same person.

How much of the record should cross that boundary is a legal and proportionality question
under the draft Data Protection Act as much as a clinical one, and it has to be settled
before the read path is built. A boundary filter designed in is cheap, and retrofitted is
not, because by then facilities have already seen what the wider scope showed them.

Three options were considered:

- **A, demographics only.** Confirms identity and changes no clinical decision. Low value
  for the operational cost of building the path at all.
- **B, demographics plus a defined clinical summary.** Covers the decisions actually made
  in the first minutes with an unknown patient.
- **C, full clinical history.** Marginally more than B in clinical terms, more to read
  rather than more to act on, and it exposes every historical observation to every facility.

The distinction that decides it is not really volume. It is that B is an *enumerated list*
and C is a *category*. An enumerated list can be audited: someone can check whether the
system returns what the policy says it returns. "Clinical history" cannot be checked
against anything, which makes it unenforceable however it is worded in a policy document.

## Decision

**Option B.** Cross-facility query returns demographics plus this list, and nothing else:

- Active problems / conditions
- Allergies and intolerances
- Current medications
- Immunisations
- MCH programme enrolments and current state (ANC, Labour & Delivery, PNC, Family Planning)
- Last ANC contact summary: gestational age, key risk flags, next scheduled contact
- Encounter **index**: date, type, facility, **without** the observations within

The encounter index is deliberate. It tells a clinician that care happened elsewhere and
lets them pursue it through an existing human channel, without shipping every observation
by default.

Conditions, all binding:

1. **Query, never replicate.** The querying facility renders the remote record; it never
   copies it into its local database. A scope that can be copied is a scope that is no
   longer controlled, and two authoritative copies of one patient is the problem this
   feature exists to relieve.
2. **Patient-scoped, never bulk.** Valid only against a single resolved patient in an
   active clinical interaction. No export, no list, no "all patients at Barnersville".
3. **Reason for access captured** at query time and stored with the audit record. One extra
   interaction for the clinician; the difference between an audit log that shows *that* a
   record was read and one that shows *why*.
4. **Every access audited**: user, facility, patient, timestamp, reason, fields returned,
   including accesses that return nothing. Readable by the `ICT Auditor` role only
   (control B3).
5. **Read-only and clearly attributed** in the UI, with source facility and retrieval time.
6. **Middle-band identity candidates are never returned as the patient's record** (ADR
   0005): only as a statement that a possible match is under review.

The scope is delivered as FHIR resources (`Patient`, `Condition`, `AllergyIntolerance`,
`MedicationRequest`, `Immunization`, `Encounter`, `Observation` for the ANC summary) with
profiles in `integration/fhir/` binding to CIEL concepts via `${var.*}`.

Two items must be settled by the MOH for this ADR to move to Accepted: **any sensitive
category to be excluded** from cross-facility visibility (HIV status being the obvious
candidate), and the **lawful basis**, including whether patient consent is captured at
query time or covered by the care relationship. An exclusion is a filter at the boundary
*and* a concept-set decision in the content packages, so it must be named before build.
Final scope is to be re-checked against the Data Protection Act as enacted; this ADR does
not assume its final text.

## Consequences

- The boundary filter is enumerated in one place and testable. `qa/api/` asserts that a
  cross-facility response contains the listed resources and **nothing outside them**: a
  scope violation fails the build rather than surfacing in a facility.
- A clinician will sometimes see that an encounter happened without seeing what was
  recorded in it, and will occasionally need to phone the other facility. Accepted: it is
  the visible cost of a defensible default, and the alternative is exposing everything to
  avoid an occasional phone call.
- Widening the scope later is a new ADR and a fresh legal review, not a configuration
  change. Narrowing it is cheap. This asymmetry is intentional.
- Sensitive-category exclusion needs a concept set in the content packages, so a late
  answer to that question delays Sprint 4 rather than being absorbed by it.
- Audit volume grows with every cross-facility access, and the retention window (control
  C2, ≥3 months) is likely to be longer here than for ordinary access. This lands on the
  backup schedule in `docs/runbooks/backup-restore.md`.
- Because nothing is replicated, revoking a facility's access removes its future visibility
  completely. Under Option C there would be local copies that revocation could not reach.

Design detail and the query flow: [Sync & EIP architecture](../architecture/sync-eip.md)
§3 and §6.
