# Pipeline definitions

The executable pipelines live in [`.github/workflows/`](../../.github/workflows/):

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push to `main`, PR to `main` or `develop`, manual | Stages 1–5 of the §8 pipeline: validate → build content → Initializer on a clean DB → metadata tests → E2E, plus SBOM, dependency check, image build and scan, the sync hardening suite, the custom ESMs and the `liberiaemr` module. On `main` only, it then publishes `:latest` images and updates dev |
| `release.yml` | `x.y.z` tag push, manual | Release guards, per-site image build, upgrade test, publish, staging and the production approval gate |
| `modules.yml` | `modules/**` on push to `main` or PR to `main`; GitHub release created; manual | Builds and tests `modules/liberiaemr`; publishes the SNAPSHOT to Repsy from `main`, and a release version only when the pom asks for it |
| `packages.yml` | `packages/**` on push to `main` or PR to `main`; GitHub release created; manual | Builds the ESMs in `packages/`; publishes `-pre.<run>` to npm under `next` from `main`, and the release version under `latest` |
| `claude-review.yml` | PR to `main` or `develop` | Advisory guardrail review with the `liberia-review` skill; never blocks a merge |

`ci.yml` fires on a push to `main` only, not to every branch. A branch push that already had
a PR used to start two runs for one commit; the concurrency group cancelled one, and the
cancelled run still published a `CI gate` check that blocked the merge. So a branch gets CI
from its pull request (a draft PR gets the full pipeline), or from a manual run before then.
A `concurrency` group keyed on the branch cancels the run still in flight when a new commit
lands. Pushes to `main` are exempt from that cancellation — `publish-latest`, `deploy-dev`,
`smoke-test`, `rollback-dev` and `dast` only run there, and half-applying a deploy is worse
than paying for a superseded build.

`modules.yml` and `packages.yml` are kept out of `ci.yml` on purpose: a publish that fails on
a credential or a registry outage must never block a merge. `ci.yml` still builds and tests
both in its `backend-module` and `frontend` jobs. Both publish off a GitHub **release**
being created, not a tag push; `release.yml` runs off the tag.

This directory holds anything the pipeline needs that is not a workflow file — runner
configuration, deployment descriptors for a non-GitHub CI, or environment definitions the
MOH ICT Unit maintains.

## Which jobs may be skipped, and which may never be

`gate` (check name **CI gate**) is the required status check for `main`. It fails if any job
it needs failed, was cancelled, **or was skipped** — a skip almost always means a dependency
failed, and that has to block a merge.

Two jobs are deliberate exceptions, each scheduled by the `changes` job, which diffs the
commit against the branch point:

- `initializer-clean-db` loads every concept into an empty database and is the longest job
  in the pipeline by a wide margin — around 18 minutes, of which 15 are the CIEL import. It
  earns that on a commit that touches a CSV and earns nothing on one that touches a runbook,
  so it runs only when the commit touches `content-packages/`, `distribution/`, `modules/`,
  `qa/upgrade/`, `scripts/build/`, `pom.xml` or `ci.yml` itself.
- `sync-hardening` builds the broker, sender, receiver and expiry exporter images and runs
  the broker refusal suite, the compose wiring check, the alert delivery test and the
  promtool rule tests. It runs only when the commit touches `distribution/{sync,broker,
  monitoring,compose,env}/`, `distro.properties`, `scripts/security/`, `scripts/sync/`,
  `qa/sync/` or `ci.yml`.

`e2e` is not one of them: it depends on `build-test` alone and runs whenever that succeeds.

Two rules keep the exceptions from becoming a hole. The detection **fails open** — no usable
base commit or a manual dispatch runs both jobs rather than assume they are unnecessary. And
`changes` is itself required by `gate`, so a fault in the detection fails the build instead
of quietly excusing the jobs it was meant to schedule.

Widen the path lists rather than narrow them. A gate that runs when it need not costs 18
minutes; one that skips when it should have run ships metadata that never loaded.

## Where images go

`ci.yml` builds every image with `scripts/build/build-distribution.sh` and does not push from
a pull request. On `main`, `publish-latest` pushes the backend, frontend and gateway images to
Docker Hub (`intellisoftdev`) as `:<sha>` and `:latest`, and `deploy-dev` pulls them onto the
dev server. `release.yml` sets `REGISTRY=ghcr.io/intellisoft-consulting`.

## What in `release.yml` is still a stub

`full-stack-tests`, the image push in `publish`, and `deploy-staging` only echo a TODO today.
`guard`, the per-site `build` matrix and `upgrade-test` do real work. `approve-production`
waits on the `production` environment's approval, then points at
[docs/runbooks/deploy.md](../../docs/runbooks/deploy.md); production deploys are manual.

## Why the upgrade stage is separate and mandatory

`release.yml` will not publish until `upgrade-test` passes. A clean install runs against an
empty database, where nothing can collide; the upgrade test is the only stage that runs the
new metadata against a database that already contains patients. See
[`qa/upgrade/README.md`](../../qa/upgrade/README.md).
