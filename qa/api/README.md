# API tests

Automated tests against the OpenMRS REST and FHIR APIs of a running distribution.

## What to cover

- **Metadata assertions** — every concept, encounter type, visit type, programme, workflow
  and identifier type the content packages declare actually exists after Initializer runs,
  with the expected UUID, datatype and answers. This is the cheapest place to catch a
  content-package regression.
- **Variable resolution** — no `${var.` string survives into loaded metadata. A leftover
  placeholder means a variable was never defined, and it will surface later as a form that
  writes to a concept that does not exist.
- **RBAC** — each role can do what it should and, more importantly, cannot do what it
  should not. Assert the ICT Auditor has no clinical data access.
- **FHIR conformance** — resources validate against the profiles in `integration/fhir/`.

## Fixtures

Use the worked instances in `integration/fhir/examples/` so the profiles and the tests
cannot drift apart. That directory is planned in
[`integration/fhir/README.md`](../../integration/fhir/README.md) but does not exist yet.

## Running

Intended to run against the stack `qa/upgrade/run-clean-install.sh` brings up, on every PR.
That script destroys its stack (`down -v`) on exit, so the tests either run from inside it
or bring up a stack of their own.

## Status

⚠ No tests written yet. Both placeholders are `echo` steps: `API tests` at the end of the
`initializer-clean-db` job in `ci.yml`, and in the `full-stack-tests` job in `release.yml`.
