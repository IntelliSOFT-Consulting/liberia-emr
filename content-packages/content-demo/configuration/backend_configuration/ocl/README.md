# OCL collection exports (demo)

The reference application demo content subscribes to a set of OpenMRS OCL collections —
basic drugs and lab tests, diagnoses, billing, IPD, SOAP, stock management, and so on. The
ZIPs are part of the lifted upstream tree, but they are **not committed**: `.gitignore`
excludes `*.zip` under any package's `ocl/` directory, for the same reason the CIEL export
is excluded from `content-common` (see that package's `ocl/README.md`).

Fetch them at the pinned upstream tag before building a demo image:

```bash
scripts/build/lift-demo-content.sh --ocl-only
```

The tag is pinned in that script, so two builds of the same LiberiaEMR tag get the same
concepts. A floating fetch would make demo metadata drift between training rooms.

Nothing here is Liberia metadata. Programme concepts belong in `content-liberia-*`.
