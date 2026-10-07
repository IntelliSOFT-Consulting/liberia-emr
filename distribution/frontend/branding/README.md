# Branding assets

MOH and LiberiaEMR branding, copied into the frontend image at `/openmrs/spa/branding/` and
referenced from the runtime configuration as `${openmrsSpaBase}/branding/<file>`.

| File | Referenced from |
| --- | --- |
| `moh-liberia-logo.svg` | `config-core.json` and each site's `config-site.json`, as the `@openmrs/esm-primary-navigation-app` logo |
| `liberiaemr-logo.svg` | `config-core.json`, as the `@openmrs/esm-login-app` logo |
| `moh-liberia-seal.svg` | `config-national.json`, as the `@openmrs/esm-billing-app` printed-invoice logo. The seal raster from `moh-liberia-logo.svg`, unchanged, in an SVG sized to 72px, because the invoice `<img>` has no width of its own and the navbar mark's white lettering disappears on paper |

The login logo is configured under the core `@openmrs/esm-login-app`, which
`distro.properties` no longer ships: `@liberiaemr/esm-liberia-login-app` replaces it and reads
its own `logo` key under its own module name. No favicon is supplied in this directory.

Printed documents (the patient card and encounter forms) are rendered as PDFs on the server and
take their logo from the backend, not from here: see
`content-packages/content-liberia-national/configuration/backend_configuration/branding/`.

## Why branding is runtime config, not source

Changing a logo must not require a frontend rebuild and redeploy to two facilities over an
intermittent link. The asset ships in the image, but which asset is used, and its alt text,
come from the content packages' `frontend_configuration/` — so a site can rebrand without
touching this directory.

Obtain any replacement MOH mark from the Ministry; do not approximate it.
