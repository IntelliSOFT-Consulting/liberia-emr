# MCH concepts

`concepts-mch.csv` holds **only** the concepts with no usable CIEL term. Everything CIEL
already defines — LMP, EDD, gravida, parity, gestational age, fundal height, fetal heart
rate, delivery mode, birth outcome, FP method — is consumed from the OCL dictionary via
[`../ocl/`](../ocl/) and referenced through `${var.*}` aliases declared in
[`../../../variables.properties`](../../../variables.properties).

Adding a local duplicate of a CIEL concept fragments reporting and silently breaks the
DHIS2 and FHIR mappings. **Check CIEL before adding a row.**

> Initializer CSVs are parsed row-by-row with no comment syntax — a `#` line would be read
> as a malformed record. Keep explanation here, keep the CSV pure data.

## Append-only once released

Per [IMPLEMENTATION.md §9](../../../../../IMPLEMENTATION.md): never change a UUID, never
switch a numeric concept to coded or text, never remove a coded answer without a migration
analysis, never repurpose a retired concept. Retire the wrong concept, add a corrected one,
migrate the data.

## Open items before the MCH go-live

These are known gaps in the first cut, tracked in
[docs/metadata-specs/mch.md](../../../../../docs/metadata-specs/mch.md):

1. **Coded answers are named, not declared.** The `Answers` column for *Amniotic Fluid
   Character* and *Fetal Skull Moulding* references concepts by name (`Clear Liquor`,
   `Moulding Grade 1`, …). Those answer concepts must either be mapped to CIEL terms or
   added as rows here before this file will load. Prefer the CIEL mapping.
2. **`Same as mappings` is empty on every partograph concept.** Each one needs its CIEL
   equivalent looked up and recorded, or an explicit note in the metadata spec saying no
   CIEL term exists. Do not guess a CIEL id — a wrong mapping is worse than none, because
   it corrupts aggregate reporting rather than merely omitting it.
3. **Programme outcome concepts are unset.** `programs-mch.csv` leaves the
   `Outcomes concept` column blank pending the clinical decision on permitted exit
   outcomes per programme.
