# Branding assets

MOH and LiberiaEMR branding, copied into the frontend image and referenced from the runtime
configuration as `${openmrsSpaBase}/branding/<file>`.

| File | Referenced from |
| --- | --- |
| `liberiaemr-logo.svg` | `config-core.json`, site `config-site.json` |
| `moh-liberia-logo.svg` | `config-core.json` (login screen) |
| `favicon.ico` | app shell |

## Why branding is runtime config, not source

Changing a logo must not require a frontend rebuild and redeploy to two facilities over an
intermittent link. The asset ships in the image, but which asset is used, and its alt text,
come from the content packages' `frontend_configuration/` — so a site can rebrand without
touching this directory.

⚠ Assets not yet supplied. Obtain the official MOH mark from the Ministry; do not
approximate it.
