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
| `run-clean-install.sh [--version x.y.z] [--no-frontend] [--project-name name]` | Empty DB → up → assert Initializer finished and applied its metadata with no error and no unresolved `${var.*}` → start the frontend and gateway and assert they serve |
| `run-upgrade.sh [--from x.y.z] [--to x.y.z]` | Restore previous-release DB → up at the new release → assert data integrity. `--from` defaults to the newest `x.y.z` tag, `--to` to `LIBERIAEMR_VERSION` |
| `fixtures/` | Anonymised or synthetic previous-release database dumps |

Both scripts start images; neither builds one. Build first with
[`scripts/build/build-distribution.sh`](../../scripts/build/build-distribution.sh) at the
same `--version`, or the stack tries to pull a tag that may not be published.

`run-clean-install.sh` asserts, in order:

- the backend reports started within `CLEAN_INSTALL_TIMEOUT` seconds (default 5400), and
  Initializer does not log a failure to apply the configuration while it waits
- Initializer finishes within 60 minutes: no OCL import still running, order frequencies loaded
- order frequencies, location tag maps and programmes are each non-empty, and at least one
  of the Program/Workflow/State concept classes exists (one count across the three, not
  each separately)
- `initializer.log` contains no `ERROR`; on failure the whole log is saved to
  `qa/upgrade/initializer-failure.log`
- no `${var.` placeholder in the backend or Initializer logs
- unless `--no-frontend`: the gateway serves `/openmrs/spa/` over TLS within 2 minutes, and
  answers plain HTTP with a 301

The stack is always fresh and is destroyed with `down -v` on exit. `--no-frontend` skips
the last step; everything before it is about the backend, so CI pairs it with
`build-distribution.sh --no-frontend` and avoids assembling the SPA to prove a CSV loads.

CI runs this script in the `initializer-clean-db` job, but **not on every commit**: it costs
around 18 minutes, so it is skipped when nothing in the commit can affect what Initializer
loads. Anything under `content-packages/`, `distribution/`, `modules/`, `qa/upgrade/` or
`scripts/build/`, the root `pom.xml` or `ci.yml` itself keeps it, and an undetermined case
runs it. See
[`distribution/ci/README.md`](../../distribution/ci/README.md). A change that could alter
metadata from somewhere outside those paths needs the path list widened, not the job
weakened.

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

`run-clean-install.sh` is implemented and runs in CI as above.

⚠ `run-upgrade.sh` is a stub. It exits 0 when no `x.y.z` tag exists (the first release
only), fails if `fixtures/<from>.sql.gz` is missing, and otherwise prints the assertions
above and exits 1 — none of them is implemented. `release.yml` runs it in the
`upgrade-test` job, with no `--from`, `--to` or `LIBERIAEMR_VERSION`, after an
`actions/checkout` at its default depth. On a tag-triggered run the pushed tag may be the
only `x.y.z` tag the job can see, so `--from` can resolve to the release under test rather
than taking the first-release exit; the workflow needs fixing before the gate means what
it says. This harness is a
definition-of-done item for the base scaffold and a go-live gate.
