# content-demo — NEVER SHIP THIS TO PRODUCTION

Training and test environments only. Sample locations, queues, appointment services,
starter concepts, diagnoses, drugs, test forms and training roles.

It is **metadata, not patients**. Demo patients in the reference application come from the
`referencedemodata` module, which `distro.properties` deliberately does not pin — a
training instance starts empty and staff create their own practice records. Anything they
create is synthetic by construction, and the demo stack cannot sync it anywhere.

## Where this content comes from

Everything under `configuration/` is **lifted verbatim** from the community demo content
package — we do not author demo data:

| | |
| --- | --- |
| Upstream | [openmrs/openmrs-content-referenceapplication-demo](https://github.com/openmrs/openmrs-content-referenceapplication-demo) |
| Tag | `1.9.2` |
| Commit | `199711118da1b6ebab46252f1533bab48d318241` |
| Lifted by | `scripts/build/lift-demo-content.sh` |

It is vendored rather than resolved as a Maven dependency (`content.referenceapplication-demo`)
so that a training stack builds from this repository alone — offline, with no dependency on
GitHub being reachable from a classroom in Monrovia.

```bash
scripts/build/lift-demo-content.sh              # re-lift the whole tree
scripts/build/lift-demo-content.sh --ocl-only   # fetch just the gitignored OCL ZIPs
scripts/build/lift-demo-content.sh --check      # fail if the tree has drifted
```

The tag is pinned in that script and the commit it resolves to is verified, so two builds
of the same LiberiaEMR tag get the same demo metadata. To move to a newer upstream release,
change `UPSTREAM_TAG` and `UPSTREAM_COMMIT` together and re-lift — never hand-edit the tree.

Two files inside `configuration/` are ours and survive a re-lift: `variables.properties`
(the layout every content package follows) and `backend_configuration/ocl/README.md`.
Upstream's `frontend_configuration/config.json` is renamed to `config-demo.json` on the way
in, because `scripts/build/collect-frontend-config.sh` collects `config-*.json` and would
otherwise skip it silently.

### What is not committed

The 21 OCL collection exports under `backend_configuration/ocl/` (~6 MB) are excluded by
`.gitignore`, like every other package's OCL ZIPs. Run `--ocl-only` before building a demo
image. `backend_configuration/metadatasharing/emrapi.Metadata_Source-1-core_demo.zip` is
committed but inert: the RefApp 3.7.1 baseline ships no `metadatasharing` module, so
`distro.properties` pins none and Initializer has no loader for that domain. It is kept so
the tree stays a faithful copy of upstream.

### It layers on top of Liberia content, and wins

Demo loads last (`common → national → programme → site → demo`), so where upstream demo
metadata collides with ours — visit types, encounter types, locations, roles, identifier
types — the demo values are what a training instance shows. That is the point of a training
stack, but it also means **the demo stack is not a rehearsal of production configuration**.
Verify site behaviour on a non-demo build.

One exception: `backend_configuration/addresshierarchy/` is dropped from this layer by
`distribution/backend/Dockerfile`, so a training instance registers patients against the
Liberia address hierarchy rather than upstream's Cambodian one. It has to be dropped at
build time because `addressConfiguration.xml` has a name the addresshierarchy module
hardcodes — it cannot be renamed out of the way — and the files stay here because this tree
is lifted verbatim and is not ours to delete from.

## Running a training stack on it

`docs/runbooks/demo-stack.md` — build with `--demo`, run both facility compose files, and
reset with `down -v` between sessions.

## How it is kept out of production

Three independent guards, because one is not enough:

1. **Not in `distro.properties`.** `distribution/distro.properties` has no
   `content.liberiaemr-demo` entry. A production distribution build cannot resolve it.
2. **Not in the backend image.** `distribution/backend/Dockerfile` unpacks an explicit
   list of packages; the demo package is added only when `DEMO_PACKAGE` is passed, which
   `scripts/build/build-distribution.sh` sets only under `--demo`. The build also fails if
   a `demo` tree appears in the resolved config.
3. **Separate image and compose overlay.** Training stacks use
   `distribution/compose/facility/docker-compose.demo.yml`, which pulls
   `liberia-emr-backend-demo` and disables the sync service so fabricated patients can
   never reach the central instance.

`scripts/validate/no-demo-in-release.sh` re-checks 1 and 2 in CI on every release build.

## What must never appear in another package

No demo patients, test users or sample observations in `content-common`,
`content-liberia-*` or `content-site-*` — not "just for testing", not temporarily. The
demo layer exists precisely so that the boundary stays a build-time decision rather than a
judgement call in a code review (IMPLEMENTATION.md §2, §11).

## What must never appear in *this* package

Real patient data. A demo dataset built by copying production records is a PHI breach with
extra steps. Demo patients are synthetic.

Liberia metadata, too. Anything Liberia-specific belongs in a `content-liberia-*` package —
a local edit here is overwritten by the next re-lift, and `--check` will flag it first.
