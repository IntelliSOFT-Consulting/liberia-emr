# Pipeline definitions

The executable pipelines live in [`.github/workflows/`](../../.github/workflows/):

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push to any branch, PR to `main` or `develop` | Stages 1–5 of the §8 pipeline: validate → build content → Initializer on a clean DB → metadata tests → E2E |
| `release.yml` | version tag | Full pipeline through the upgrade test, publish, staging and the production approval gate |

`ci.yml` fires on a push to **any** branch, not just the ones it can publish from, so a
branch gets feedback before anyone opens a PR. A branch that already has one therefore
matches both triggers; a `concurrency` group keyed on the branch collapses the two into a
single run, and cancels the run still in flight when a new commit lands. Pushes to `main`
are exempt from that cancellation — `publish-latest`, `deploy-dev`, `smoke-test`,
`rollback-dev` and `dast` only run there, and half-applying a deploy is worse than paying
for a superseded build.

This directory holds anything the pipeline needs that is not a workflow file — runner
configuration, deployment descriptors for a non-GitHub CI, or environment definitions the
MOH ICT Unit maintains.

## Which jobs may be skipped, and which may never be

`gate` is the single status check to point branch protection at. It fails if any job it
needs failed, was cancelled, **or was skipped** — a skip almost always means a dependency
failed, and that has to block a merge.

The one deliberate exception is `initializer-clean-db` (and `e2e`, which follows it). That
job loads every concept into an empty database and is the longest in the pipeline by a wide
margin — around 18 minutes, of which 15 are the CIEL import. It earns that on a commit that
touches a CSV and earns nothing on one that touches a runbook, so the `changes` job decides:
it diffs the commit against the branch point and runs the gate only when the commit touches
`content-packages/`, `distribution/`, `qa/upgrade/`, `scripts/build/`, `pom.xml` or `ci.yml`
itself.

Two rules keep that from becoming a hole. The detection **fails open** — no usable base
commit, a branch's first push, or a manual dispatch all run the gate rather than assume it
is unnecessary. And `changes` is itself required by `gate`, so a fault in the detection
fails the build instead of quietly excusing the job it was meant to schedule.

Widen the path list rather than narrow it. A gate that runs when it need not costs 18
minutes; one that skips when it should have run ships metadata that never loaded.

## Why the upgrade stage is separate and mandatory

`release.yml` will not publish until `upgrade-test` passes. A clean install runs against an
empty database, where nothing can collide; the upgrade test is the only stage that runs the
new metadata against a database that already contains patients. See
[`qa/upgrade/README.md`](../../qa/upgrade/README.md).
