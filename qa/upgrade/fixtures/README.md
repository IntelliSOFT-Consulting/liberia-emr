# Upgrade-test fixtures

Database dumps representing each released version, named `<version>.sql.gz`.

## Never a copy of production

A production dump in a CI runner is a PHI breach. Fixtures are built from the
`content-demo` package plus **synthetic** patients.

`.gitignore` excludes `*.sql` and `*.sql.gz` here so a dump cannot be committed by accident.
Fixtures are published as release artefacts instead, alongside the images they correspond to.

## Coverage

A fixture is only useful if it contains the data shapes an upgrade can break:

- patients enrolled in each MCH programme
- patients in each workflow state, including terminal ones
- encounters of every encounter type
- observations on every concept whose datatype might plausibly change
- retired metadata that patient data still references

## Regeneration

Regenerate at each release and tag it with the release it represents, so "upgrade from
previous" always means the version actually running in the field.
