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
| `run-upgrade.sh --to <version> [--from-image <registry>/liberia-emr-backend:<tag>] [--project-name P]` | Install the FROM image on an empty DB → write synthetic patient data → recreate the backend at `--to` on the same DB → assert. FROM defaults to the newest backend image published from `main` at or before where this tree merges into `main` |
| `seed-upgrade-data.py` | The synthetic patient data `run-upgrade.sh` writes over REST, from a throwaway container on the stack's network |
| `fixtures/` | Reserved for previous-release database dumps; none exists (see Status) |

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

`run-upgrade.sh` fails when any of these does not hold:

- The upgraded backend starts and answers `/health/started`, and no OCL import is left running.
- Initializer saved every row it read on the upgrade boot. The compose files run it with
  `continue_on_error`, so a boot that completes proves nothing by itself; a rejected row is the
  signal, read from the recreated backend's log.
- No `${var.` placeholder appears in that log.
- The counts of patients, visits, encounters, observations, enrolments and states are
  unchanged.
- Every concept an observation asks about keeps its datatype, and nothing the data references
  is newly retired: an observation's question or coded answer, an encounter type, form, visit
  type, location, programme or workflow state.

## Status

`run-clean-install.sh` is implemented and runs in CI as above.

`run-upgrade.sh` is implemented (LE-400) and runs in CI in the `upgrade-from-main` job, on the
same trigger as the clean install. It upgrades **from `main`**, not from a release:

- For a pull request, FROM is the `main` side of the merge commit: what merging does to a
  database built from current `main`. On a push to `main`, it is the previous `main` commit.
  Main's CI publishes `liberia-emr-backend:<sha>` for every green commit
  (`publish-latest`), and the script walks back to the nearest commit whose image exists.
  That is what the dev servers run and what any database built from `main` carries.
- It installs FROM with `run-clean-install.sh --keep-stack`, then writes synthetic data
  (`seed-upgrade-data.py`): observations on every Numeric, Coded, Text, Boolean and Date
  concept in FROM's concept CSVs, an encounter of every encounter type, and an enrolment in
  every programme with a state per workflow. Rejected writes are reported, not fatal; at least
  one observation must land.
- It snapshots the data counts and every piece of metadata the data references (an obs
  question's datatype, and the retired flag of every concept, encounter type, form, visit
  type, location, programme and state in use), recreates the backend at `--to`, and fails on:
  any row Initializer rejects on that boot (read from the recreated container's own log, since
  `initializer.log` is not rewritten on a restart), an unresolved `${var.*}`, or any change to
  the snapshot.

**Running it on an arm64 machine** (an Apple silicon Mac): main's images are amd64 and run
emulated, so the FROM install takes hours; the script warns. Build FROM natively instead, at
the same main commit in a worktree (`scripts/build/build-distribution.sh --version <tag>
--no-frontend --no-sync`), and pass `--from-image intellisoftdev/liberia-emr-backend:<tag>`.

**Not done: upgrading from a release.** No distribution release exists yet: `release.yml` has
never run, its `upgrade-test` stage still calls this script without arguments, and
`RELEASE_TESTS_READY` still blocks publishing. The `liberiaemr-1.0.0` tag is a Maven release of
the content packages, not a distribution release, and it can no longer be built: it pins
`tasks-omod 2.1.0` and `labonfhir 1.2.0`, which the OpenMRS Maven repository has dropped
(LE-380). The `:1.0.0` images on the registries predate that tag. Once a real release is
published, its upgrade stage should pass `--from-image` naming the previous release's backend,
and a fixture with its own synthetic data can replace the fresh install.
