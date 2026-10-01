# esm-liberia-login-app

**Build class: Custom Build** (IMPLEMENTATION.md §3).

LiberiaEMR's login module. It **replaces** the core `@openmrs/esm-login-app` rather than
sitting beside it: in `distribution/distro.properties` the core pin is commented out and
this one takes its place.

```properties
# spa.frontendModules.@openmrs/esm-login-app=10.0.0
spa.frontendModules.@liberiaemr/esm-liberia-login-app=10.0.0
```

It renders the loading page, the login page and the location picker, as the core app does,
and adds a self-service **forgot / reset password** flow backed by `modules/liberiaemr`.

## What it adds over core

| Route | Does |
| --- | --- |
| `login/forgot-password` | Takes an email address, rejects a malformed one locally, and `POST`s `{"email"}` to `/ws/liberiaemr/passwordReset/request`. A successful request always answers "If an account exists with that email, a reset link has been sent."; a failed one shows an error. Reached from the **Forgot password?** link under the login button. |
| `login/reset-password?token=…` | The page the emailed link opens (the backend builds it as `LIBERIAEMR_FRONTEND_URL` + `/login/reset-password?token=…`). `POST`s `{"token", "newPassword"}` to `/ws/liberiaemr/passwordReset/confirm`. With no token, or one the backend rejects, it offers a new link. |
| `login/reset-success` | Confirmation, with a link back to login. |
| `login/mfa` | **Placeholder.** Takes a 6-digit code and always answers "MFA verification is currently a placeholder." It calls no backend. |

Before submitting, the reset page requires the new password to be at least 13 characters with
an upper-case letter, a lower-case letter and a digit, and to match its confirmation. The
backend applies the OpenMRS password rules again on `/confirm`.

Both endpoints are anonymous; SMTP set-up, token lifetime, how a user is matched (the core
`users.email` column) and the anti-enumeration rules are in
[`modules/liberiaemr/README.md`](../../modules/liberiaemr/README.md). Without that module and
a configured relay the pages render but no mail is sent.

## Where it is mounted

Pages (all rendered by one `root` router): `login`, `login/confirm`, `login/location`,
`logout`, `change-password`, `two-factor-auth`, plus the four above.

| Extension | Slot |
| --- | --- |
| `location-picker` | `location-picker` |
| `logout-button` | `user-panel-bottom-slot` |
| `password-changer` | `user-panel-slot` |
| `two-factor-authentication` | `user-panel-slot` (online only) |
| `location-changer` | `top-nav-info-slot` |
| `session-idle-watcher` | `top-nav-info-slot` (no visible UI; human-idle logout) |

Modals: `change-password-modal`, `totp-enrollment-modal`. The two-factor page and modal call
`/ws/rest/v1/auth/totp/enrollment` and `…/enrollment/verify`.

`session-idle-watcher` renders nothing. It stays mounted with the top navigation while the
user is signed in, and after the configured human-idle period it calls `performLogout()`
(`DELETE /ws/rest/v1/session`) and returns to the login page. Fetch and XHR do not reset
it. Activity in any tab updates one `localStorage` timestamp, `liberiaemr.lastHumanActivityAt`.

## Configuration

The config key is **`@liberiaemr/esm-liberia-login-app`**, not `@openmrs/esm-login-app`.
Content packages still configure `@openmrs/esm-login-app` (`content-common` `config-core.json`,
both site `config-site.json` files), which this module does not read.

| Key | Default | |
| --- | --- | --- |
| `provider.type` | `basic` | `basic`, `oauth2` or `custom` |
| `provider.loginUrl` | `${openmrsSpaBase}/login` | Must be changed for `oauth2` / `custom` |
| `chooseLocation.enabled` | `true` | Show the location picker after login |
| `chooseLocation.numberToShow` | `8` | |
| `chooseLocation.locationsPerRequest` | `50` | |
| `chooseLocation.useLoginLocationTag` | `true` | Only `Login Location`-tagged locations |
| `chooseLocation.locationTag` | `''` | Non-empty turns the picker into the **facility switcher** (below) over this tag. Overrides `useLoginLocationTag` |
| `chooseLocation.mflCodeAttributeTypeUuid` | `3118cabe-…-86234deb9b1b` | The `MFL Code` location attribute type (ADR 0009) |
| `links.loginSuccess` | `${openmrsSpaBase}/home` | |
| `logo.src` / `logo.alt` | `''` / `Logo` | Empty `src` uses the OpenMRS logo |
| `footer.additionalLogos` | `[]` | `{src, alt}` entries |
| `showPasswordOnSeparateScreen` | `true` | |
| `session.idleTimeoutMinutes` | `10` | Minutes of human inactivity before logout. Unit: minutes, not milliseconds. Above 10 is clamped to 10. Missing or invalid becomes 10. A shorter positive value is honored. The built config is a string such as `"10"`. |
| `background.image` / `background.color` | `''` / `''` | The image wins if both are set |
| `announcements` | `[]` | `{title, text, kind}` banners above the form |
| `twoFactorAuth.enabled` | `false` | Shows the two-factor link |
| `twoFactorAuth.dashboardTitle` | `{key: twoFactorAuth, value: Two-Factor Authentication}` | |

### Facility switcher (central)

At central, users move between about 1,000 MFL facilities (ADR 0009 decision 6, LE-324). With
`chooseLocation.locationTag` set to `Health Facility`, the picker:

- lists every location with that tag;
- searches the name **or the MFL code**;
- narrows by county, then district;
- shows each facility's district and code, so facilities that share a name can be told apart.

MFL facilities carry no `Login Location` tag, so the stock picker cannot list them.

Neither the REST nor the FHIR location search matches on an attribute. So the switcher fetches
the tagged list once per session and filters it in the browser:
- it uses a slim REST representation (the name, the parent and grandparent names, and the
  attribute values);
- it fetches pages of 100, the REST maximum: the first page asks for `totalCount`, and the
  remaining pages are fetched in parallel;
- the list is sorted by name and cached with SWR.

The list shows at most `locationsPerRequest` rows and asks the user to refine the search to see
more.

It is off by default. With `locationTag` empty, the picker is the framework `LocationPicker`
exactly as before. It belongs only in central's frontend configuration, which now exists: the
`content-central` package and its `config-central.json` (ADR 0011, LE-359), which sets
`"locationTag": "Health Facility"` under `@liberiaemr/esm-liberia-login-app` → `chooseLocation`.

## Development

```bash
yarn install
yarn start        # openmrs develop, default backend
yarn test         # vitest, TZ=UTC
yarn typescript
yarn lint         # eslint src
yarn build
```

`start:dev` and `start:local` (port 8081, backend `localhost:8080`) pass
`../../distribution/frontend/config/config-*.json`, a directory that does not exist; the
config files live under `content-packages/*/configuration/frontend_configuration/`.

Tests live beside the code (`*.test.tsx`). None yet cover the forgot / reset / MFA pages.

## Build and publish

- **CI gate** (`ci.yml`, job `frontend`): `yarn install --frozen-lockfile`, `yarn test`,
  `yarn build` on every PR.
- **`packages.yml`**: lint, `tsc` and build on changes to `packages/**`; publishes
  `10.0.0-pre.<run>` to npm tag `next` on a merge to `main`, and the release tag to `latest`
  on a GitHub release. See [`packages/README.md`](../README.md#ci-and-publishing).
- **Pin**: `spa.frontendModules.@liberiaemr/esm-liberia-login-app` in
  `distribution/distro.properties`. Publishing does not change it. The human-idle watcher
  is not in the pinned `10.0.0-pre.143` build. After `packages.yml` publishes
  `10.0.0-pre.<run>` from `main`, re-pin to that exact version. Do not invent the run number.
