# MCH program workflows

A workflow is defined by a **coded concept whose answers are the states**. Both the
workflow concept and its state concepts are declared in
[`../concepts/concepts-mch.csv`](../concepts/concepts-mch.csv) and aliased in
`variables.properties`, so `programworkflows-mch.csv` only wires them to a program.

## Verify the CSV header before the first load

The `programworkflows` domain has changed shape across Initializer releases. Before the
first load, reconcile the header in `programworkflows-mch.csv` against the Initializer
version pinned in [`distribution/distro.properties`](../../../../../distribution/distro.properties):

<https://github.com/mekomsolutions/openmrs-module-initializer/blob/main/readme/prog.md>

```
mvn -pl content-packages/content-liberia-mch -am verify
```

runs the packager plugin's `validate-configurations` goal over this directory and will
reject a header the pinned Initializer does not understand.

## Do not delete a state that patient data references

Program states are referenced by `patient_state` rows. Once a patient has been in a state,
that state is permanent — retire it, do not remove it (IMPLEMENTATION.md §9).
