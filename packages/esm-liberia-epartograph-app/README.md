# esm-liberia-epartograph-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

A WHO-aligned electronic partograph for intrapartum monitoring. There is **no community
equivalent** — this is greenfield, not a modification of an upstream component, and there
is no upstream PR to track. If a community partograph later appears, superseding this
module is an ADR-level decision, not a quiet swap.

## What it is and is not

- It **is** a normal O3 frontend module: versioned on its own cadence, built to a JS
  bundle, and **pinned in `distribution/distro.properties`** like every other ESM.
- It is **not** part of a content package. Nothing here ships inside
  `content-packages/**`. The MCH content package supplies its *configuration*; the module
  itself is a distribution concern.

## Why the concepts are not compiled in

Every concept UUID and the alert/action line geometry come from runtime configuration
(`content-liberia-mch/configuration/frontend_configuration/config-mch.json`, which itself
resolves `${var.*}` from `variables.properties`). A concept correction then ships as a
config change instead of a frontend release — which matters when the fix has to reach a
facility over an intermittent link.

Config defaults are deliberately **empty strings**, not "a UUID that works on the test
server". An unset concept must fail visibly in config validation rather than silently
write observations against the wrong concept.

## Status

Scaffold and stub only. `src/partograph/` is not implemented.

This is the **highest clinical risk** component in the project: a partograph that plots
the alert line wrongly, or drops an observation recorded during a connectivity gap, causes
harm rather than merely annoying a user. Before implementing:

1. Complete [docs/metadata-specs/mch.md](../../docs/metadata-specs/mch.md) and close the
   open items in the MCH concepts README.
2. Confirm the alert/action line geometry against the DAK in [docs/dak/](../../docs/dak/).
3. Agree the offline behaviour. The module declares `"offline": true` in `routes.json`,
   which is a promise it must actually keep — facility instances are offline-first, and
   labour does not pause for the network.
4. Write the Cypress coverage in `qa/e2e/` **with** the implementation, not after.

## Development

```bash
yarn install
yarn start --backend https://dev.liberiaemr.moh.gov.lr
```

The module is published as `@liberiaemr/esm-liberia-epartograph-app` and consumed through
the pinned import map — never mounted into a running container from a git checkout.
