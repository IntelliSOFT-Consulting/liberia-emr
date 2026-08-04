# Upgrade harness

**The most important test in the pipeline.**

Every release must pass both:

1. **Clean install** — empty database → Initializer loads all metadata → O3 launches.
2. **Upgrade** — restore the previous release's database → run the new release →
   migrations run → Initializer updates metadata → **existing patient data stays valid**.

## Why a clean install is not enough

A clean install loads metadata into a database with nothing in it. Everything succeeds
because there is nothing to conflict with. The upgrade test is the only one that surfaces:

- **UUID collisions** — a new concept reusing a UUID that already means something else
- **Changed concept datatypes** — numeric → coded, against observations already recorded as
  numeric
- **Removed coded answers** still referenced by existing observations
- **Retired metadata** that patient data depends on
- **Deleted program states** referenced by `patient_state` rows
- **Altered encounter semantics** that silently change what historical data means

These are precisely the failures that IMPLEMENTATION.md §9 forbids — and the only automated
place they get caught before a facility does.

## Scripts

| Script | |
| --- | --- |
| `run-clean-install.sh` | Empty DB → up → assert Initializer completed with no error and no unresolved `${var.*}`, then start O3 |
| `run-upgrade.sh` | Restore previous-release DB → up at the new release → assert data integrity |
| `fixtures/` | Anonymised or synthetic previous-release database dumps |

Both scripts start images; neither builds one. Build first with
[`scripts/build/build-distribution.sh`](../../scripts/build/build-distribution.sh) at the
same `--version`, or the stack tries to pull a tag that may not be published.

`run-clean-install.sh --no-frontend` skips the last step. Every assertion it makes is about
the backend — the frontend is only brought up, never waited on — so CI pairs it with
`build-distribution.sh --no-frontend` and avoids assembling the SPA to prove a CSV loads.

## The fixture database

⚠ **Never a copy of production.** A production dump in a CI runner is a PHI breach.

Build the fixture from the demo content package plus synthetic patients covering the
scenarios that matter: patients enrolled in each MCH programme, patients in each workflow
state, encounters against every encounter type, and observations on every concept whose
datatype might change.

The fixture is regenerated at each release and tagged with the release it represents, so
"upgrade from previous" always means the version actually in the field.

## Assertions after an upgrade

- Every pre-existing patient is still retrievable
- Observation counts per patient are unchanged
- No observation has been orphaned from its concept
- Programme enrolments and workflow states survive
- Encounters still resolve to an encounter type and a form
- No `${var.` placeholder appears in any loaded metadata
- Initializer reported zero errors — it runs with `continue_on_error=false`, so a boot that
  completed is itself part of the assertion

## Status

⚠ Scripts not yet written. This harness is a definition-of-done item for the base scaffold
and a go-live gate.
