# Branding assets

MOH and LiberiaEMR branding, copied into the frontend image at `/openmrs/spa/branding/` and
referenced from the runtime configuration as `${openmrsSpaBase}/branding/<file>`.

| File | Referenced from |
| --- | --- |
| `moh-liberia-logo.svg` | `config-core.json` and each site's `config-site.json`, as the `@openmrs/esm-primary-navigation-app` logo |
| `liberiaemr-logo.svg` | `config-core.json`, as the `@openmrs/esm-login-app` logo |

The login logo is configured under the core `@openmrs/esm-login-app`, which
`distro.properties` no longer ships: `@liberiaemr/esm-liberia-login-app` replaces it and reads
its own `logo` key under its own module name. No favicon is supplied in this directory.

## Why branding is runtime config, not source

Changing a logo must not require a frontend rebuild and redeploy to two facilities over an
intermittent link. The asset ships in the image, but which asset is used, and its alt text,
come from the content packages' `frontend_configuration/` — so a site can rebrand without
touching this directory.

Obtain any replacement MOH mark from the Ministry; do not approximate it.
