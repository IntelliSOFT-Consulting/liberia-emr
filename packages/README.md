# packages/

LiberiaEMR's own O3 frontend modules (**Custom Build**, IMPLEMENTATION.md §3) and the
tracking records for patches to community code (**Modify + PR**).

| Directory | npm package | Pinned in `distro.properties` | What it is |
| --- | --- | --- | --- |
| [`esm-liberia-epartograph-app/`](esm-liberia-epartograph-app/) | `@liberiaemr/esm-liberia-epartograph-app` | `1.0.0-pre.53` | WHO-aligned electronic partograph in the patient chart |
| [`esm-liberia-login-app/`](esm-liberia-login-app/) | `@liberiaemr/esm-liberia-login-app` | `10.0.0` | Replaces core `@openmrs/esm-login-app`; adds forgot/reset password |
| [`esm-liberia-patient-chart-extension/`](esm-liberia-patient-chart-extension/) | `@liberiaemr/esm-liberia-patient-chart-extension` | `1.0.1-pre.53` | Configurable obs-by-encounter widget (TB Screening today) |
| [`esm-liberia-sync-status-app/`](esm-liberia-sync-status-app/) | `@liberiaemr/esm-liberia-sync-status-app` | **not pinned** | National sync status page, shown at central only |
| [`modify-pr/`](modify-pr/) | — | — | Sidecars tracking each patch to a community component and its upstream PR |

A module reaches the image only through its pin: `distribution/frontend/Dockerfile` runs
`openmrs assemble` against a config generated from `distribution/distro.properties`, which
downloads each pinned version from npm. Nothing is mounted from a git checkout.

## CI and publishing

Two workflows touch these packages.

**`ci.yml`, job `frontend` (Custom Build ESMs)** — on every PR, part of the required CI gate:

| Package | Runs |
| --- | --- |
| login app | `yarn install --frozen-lockfile`, `yarn test`, `yarn build` |
| sync status app | `yarn install --frozen-lockfile`, `yarn typescript`, `yarn test`, `yarn build` |
| e-partograph | nothing yet — the step is an `echo "TODO: …"` |
| patient chart extension | not listed |

**`packages.yml` (Packages CI / CD)** — on pushes and PRs to `main` that touch `packages/**`,
on a GitHub release, and on manual dispatch. It loops over every `packages/*` whose
`package.json` is not `"private": true`:

1. **Build** (every trigger): `yarn install --frozen-lockfile`, `yarn lint` (only if the
   `package.json` names `"eslint"` — today only the login app), `yarn typescript`,
   `yarn build`. It does **not** run the tests.
2. **Pre-release** (push to `main` only): publishes `<base version>-pre.<run number>` with
   dist-tag `next`. Every package in the loop gets the same run number, so the pre-releases
   of one run line up (`…-pre.53`). A version already on npm is skipped.
3. **Stable** (release created): publishes the release tag, minus any leading `v`, with
   dist-tag `latest` — the **same version for every package**, whatever its `package.json`
   says.

Both publish jobs run in the `npm-publish` environment with `NPM_AUTH_TOKEN`. One package's
failure does not stop the others; the job fails at the end and names them.

**Publishing does not deploy.** The image takes only what `distro.properties` pins. After a
publish, re-pin deliberately to the exact version you verified — never to `next` or
`latest` (IMPLEMENTATION.md §6).
