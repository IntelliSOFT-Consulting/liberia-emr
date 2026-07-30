# Pipeline definitions

The executable pipelines live in [`.github/workflows/`](../../.github/workflows/):

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push / PR to `main` | Stages 1–5 of the §8 pipeline: validate → build content → Initializer on a clean DB → metadata tests → E2E |
| `release.yml` | version tag | Full pipeline through the upgrade test, publish, staging and the production approval gate |

This directory holds anything the pipeline needs that is not a workflow file — runner
configuration, deployment descriptors for a non-GitHub CI, or environment definitions the
MOH ICT Unit maintains.

## Why the upgrade stage is separate and mandatory

`release.yml` will not publish until `upgrade-test` passes. A clean install runs against an
empty database, where nothing can collide; the upgrade test is the only stage that runs the
new metadata against a database that already contains patients. See
[`qa/upgrade/README.md`](../../qa/upgrade/README.md).
