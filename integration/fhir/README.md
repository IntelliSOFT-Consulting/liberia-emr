# FHIR profiles and resources

FHIR is the interoperability substrate for the External build class: the DHIS2 export,
cross-facility query and any future national exchange all lean on it, so the profiles live
here rather than being restated in each integration.

**FHIR is not used for the facility→central push.** That path uses `openmrs-dbsync`'s native
serialisation, because it is same-product replication where fidelity beats legibility, and
because `patient_program`/`patient_state`, which carries MCH programme enrolment, has no
honest FHIR mapping. FHIR is adopted for every **read** path, where it crosses a product
boundary and earns its cost. The reasoning is in
[ADR 0008](../../docs/adr/0008-adopt-openmrs-dbsync.md) and the
[module evaluation](../../docs/architecture/sync-module-evaluation.md) §2.5.

## Contents (to build)

```
fhir/
├── profiles/        # StructureDefinitions constraining resources for Liberia
├── valuesets/       # ValueSets bound to CIEL concepts
├── examples/        # Worked instances used as fixtures in qa/api/
└── ig/              # Implementation-guide sources, if the MOH requires one
```

## Alignment

Align to WHO SMART Guidelines and the Liberia DAK where they specify a profile, and to
OpenMRS FHIR2 defaults everywhere else. Do not profile something purely because a field
looks unconstrained — every added constraint is a compatibility promise that has to hold
for the life of the deployment.

## Terminology

Bind ValueSets to CIEL concepts referenced through `${var.*}` from the content packages.
A profile that hard-codes a concept UUID reintroduces exactly the coupling
`variables.properties` exists to remove (IMPLEMENTATION.md §7).

## Validation

Profiles are validated in CI and their examples are used as fixtures by the API tests in
`qa/api/`, so a profile change that breaks the contract fails the build rather than
surfacing during a facility push.
