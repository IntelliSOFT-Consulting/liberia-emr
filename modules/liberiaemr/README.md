# Liberia EMR Module

## Description
This module provides backend APIs and services to support custom functionality for the Liberia EMR instance. It is designed to run on top of OpenMRS.

## Key Features

### Conditional Forms Visibility
The module introduces a generic rules-based architecture for conditionally displaying or hiding forms in the OpenMRS 3 frontend dashboard. It acts as the backend for the O3 `customFormsUrl` configuration property.

#### API Endpoint
**GET** `/ws/rest/v1/liberiaemr/forms`

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `patientUuid` | String | Yes | The UUID of the patient to evaluate form visibility against. |

#### Rules Framework
The endpoint fetches all published forms and evaluates them against an extensible list of `FormVisibilityRule` components. For example, the `FormsGenderRule` checks the patient's registered sex/gender and completely hides all female-only forms (such as ANC, PNC, and Labor & Delivery forms) if the patient is male.

### National Sync Status
Backs the national sync status page (`packages/esm-liberia-sync-status-app`): which
facilities are sending, and what is waiting at central.

**GET** `/ws/rest/v1/liberiaemr/syncstatus`

Needs an authenticated session **and** the `View Sync Status` privilege (declared in
`content-common` `privileges-common.csv`); otherwise `403`. Unlike the password-reset
endpoints, it is under `/ws/rest` so the REST authentication filter applies.

It does not read central's sync database — dbsync records no sender on a queued or failed
record. It asks central's Prometheus instead, reusing what monitoring already scrapes from
the broker, the receiver and the certificate exporter (the silent-facility query is the
`SyncFacilitySilent` expression from `distribution/monitoring/rules-central.yml`).

| Variable | Meaning |
|---|---|
| `LIBERIAEMR_SYNC_MONITORING_URL` | Prometheus base URL. Central's compose defaults it to `http://prometheus:9090`; facility stacks leave it unset, which turns the feature off in the same image. Falls back to the `liberiaemr.sync.monitoringUrl` global property. |

The response is never an error for a monitoring failure: `enabled: false` when no address is
set, `available: false` when monitoring cannot be reached (4-second timeout), otherwise
`facilities[]` (`code`, `recordsReceived`, `receivedLastDay`, `silent`, `certificateExpires`),
`central` (`recordsWaiting`, `recordsRetrying`, `conflicts`, `deadLetters`, `receiverUp`,
`brokerUp`) and the firing `alerts`.

### Password Reset Flow
The module introduces a secure, automated password reset flow for users. It integrates with an external SMTP server (e.g., Gmail) to send time-limited password reset tokens to registered users.

#### Configuration
The relay is **deployment state, not content**. It is configured from the environment —
`distribution/env/facility.env` (gitignored; copy `facility.env.example`), passed through to
the backend by `distribution/compose/facility/docker-compose.yml`:

| Variable | Meaning |
|---|---|
| `LIBERIAEMR_SMTP_HOST` | SMTP server host. Unset means no reset mail is delivered. |
| `LIBERIAEMR_SMTP_PORT` | SMTP port. `587` uses STARTTLS, `465` uses SSL. |
| `LIBERIAEMR_SMTP_USER` | SMTP username. Leave empty for an unauthenticated local relay. |
| `LIBERIAEMR_SMTP_PASSWORD_FILE` | **Preferred.** Path to a file read verbatim, so no character of the secret is interpreted by a substitution tool. Same shape as the alert webhook's `url_file`. |
| `LIBERIAEMR_SMTP_PASSWORD` | Simpler fallback for a dev box. |
| `LIBERIAEMR_SMTP_FROM` | The "From" address shown to the recipient. |
| `LIBERIAEMR_FRONTEND_URL` | Base URL of the SPA the reset link points at. No trailing slash (one is stripped anyway). |

Each falls back to a global property of the same name (`liberiaemr.email.host`, …) when its
variable is unset, which is there for a developer changing a value on a running instance.
`liberiaemr.passwordReset.tokenExpiryHours` (default `2`) is a global property only.

**The SMTP password is never seeded from versioned content.** An earlier revision shipped
`globalproperties-email.xml` carrying the literal `YOUR_APP_PASSWORD` into the database via
Initializer. That made a versioned file the obvious place to "fix" a broken relay — leaking a
live credential into git history the first time anyone did — and, because Initializer
reapplies its files on every boot, it would also have overwritten a real password at each
restart. The file is gone; do not reintroduce one.

#### How a user is matched

By the **core `users.email` column**, via `UserService.getUserByUsernameOrEmail`. Set it on
the user in the admin UI; an account with no email cannot be reset through this flow.

That method matches either username *or* email, so the module re-checks the returned user's
`getEmail()` against the requested address: posting a bare username finds nothing, and cannot
be used to discover that the username exists. Retired users are never matched.

Earlier revisions matched an `Email` **Person Attribute** instead. No such attribute type
exists in this distribution's content, so that lookup matched nobody — the flow was a no-op
for every real user. Do not reintroduce it without also shipping the attribute type.

#### REST Endpoints
The module exposes the following endpoints (bypassing standard OpenMRS REST authentication, but protecting against enumeration/abuse):

1. **Request Password Reset Link**
   - **URL:** `POST /ws/liberiaemr/passwordReset/request`
   - **Payload:** `{"email": "user@example.com"}`
   - **Response:** `200 OK` (Always returns success to prevent enumeration if payload is valid).
2. **Confirm Password Reset**
   - **URL:** `POST /ws/liberiaemr/passwordReset/confirm`
   - **Payload:** `{"token": "uuid-token", "newPassword": "NewStrongPassword1!"}`
   - **Response:** `200 OK` on success, or `400 Bad Request` if token is invalid/expired or if the password fails complexity rules.

#### Security Considerations
The password reset implementation adheres strictly to security best practices:

1. **User Enumeration Prevention:** 
   If a password reset is requested for an email address that does not exist in the database, the API will silently log the attempt and return a successful `200 OK` response to the frontend. This ensures that malicious actors cannot use the password reset endpoint to enumerate or guess which email addresses are registered in the system. The frontend will uniformly state: *"If an account exists with that email, a reset link has been sent."*
2. **Anonymous Access & Privilege Escalation:**
   The password reset API endpoints (`/ws/liberiaemr/passwordReset/*`) are exposed to anonymous users. To securely query the database and update passwords without a logged-in session, the `LiberiaEMRServiceImpl` briefly elevates privileges using `Context.addProxyPrivilege()`:
   - Requesting a link requires `Get Users` and `Get Global Properties`.
   - Confirming a reset requires `Edit Users`, `Edit User Passwords`, and `Get Global Properties` (needed to validate OpenMRS password complexity regex rules).
   All elevated privileges are strictly removed in `finally` blocks to prevent privilege leaking.
3. **Audit Logging — and what is deliberately NOT logged:**
   Password reset attempts (successful, failed, or "email not found") carry an `AUDIT:` prefix in the OpenMRS logs, for monitoring and compliance.

   **The raw token is never written to a log.** It is a bearer secret: whoever holds it can set that account's password until it expires, with no access to the mailbox it was sent to. Audit logs are retained for at least three months under the MOH ICT SOP and are shipped to the SIEM, so a token written there would outlive the token itself in a store readable by far more people than the victim's inbox — anyone with log or SIEM read access could replay a still-valid one against `/confirm` and take the account over. The three audit lines of a confirmation instead carry a truncated SHA-256 **fingerprint**, which correlates them to one attempt and cannot be presented to the endpoint.

   For the same reason `/confirm` returns a fixed message on every failure rather than the exception text, so an anonymous caller cannot tell "no such token" from "expired" from a persistence-layer stack trace.
4. **Token Invalidation:**
   Reset tokens are stored in the database and are strictly single-use. They are voided immediately upon a successful password change, or if a user requests a new token, voiding all previous pending tokens for that user.

## Building from source

Java 8 target, Maven 3.x. `mvn clean package` in this directory produces
`omod/target/liberiaemr-<version>.omod`. CI builds and tests it in its own `backend-module`
job, and again in `.github/workflows/modules.yml`.

## Versions and publishing

The pom carries `1.0.0-SNAPSHOT` — the **development stream**. Three things consume it, and
they take three different versions on purpose:

| Where | Version | When |
|---|---|---|
| Repsy, snapshot | `1.0.0-SNAPSHOT` | every merge to `main` that touches `modules/**`, re-deployed over itself |
| Repsy, release | the release tag, e.g. `1.2.0` | a published GitHub release **whose tag matches the pom's base version**; `versions:set` stamps it |
| The backend image | the distribution version being built | every image build; `distribution/backend/Dockerfile` stamps it |

The image stamp is what keeps a release image from shipping a `-SNAPSHOT` omod, which
IMPLEMENTATION.md §6/§11 forbids — and it makes the omod traceable to the distribution
release that carries it. `build-distribution.sh` refuses a SNAPSHOT or `latest` `--version`,
so a release build always has a concrete one to stamp with. A bare `docker build` with no
`--build-arg` keeps the pom's own version, which is right for a local experiment.

Publishing goes to <https://repsy.io/intellisoftdev/liberiaemr> (Maven endpoint
`https://repo.repsy.io/mvn/intellisoftdev/liberiaemr`). It needs `REPSY_USERNAME` and
`REPSY_PASSWORD` in the `repsy-publish` GitHub environment. Publishing is deliberately kept
out of `ci.yml`: that workflow carries the required **CI gate** status check, and a publish
that fails on a credential or a registry outage must never be able to block a PR merge.

Each publish uploads the module under `org.openmrs.module:liberiaemr-omod` **twice**, as a
`.jar` and as a `.omod`. They are the same archive; which one a consumer wants depends on how
it pins:

| Pinned as | Resolves | Example |
|---|---|---|
| `omod.liberiaemr=<version>` | the `.jar`, which the OpenMRS SDK renames to `.omod` | the ecosystem default — what most of `distro.properties` uses |
| `omod.liberiaemr.type=omod` | the `.omod` directly | the `serialization.xstream` pin in `distro.properties` |

Only the `.jar` is a normal Maven artifact. `maven-openmrs-plugin` writes the `.omod` as a
side file in `target/` and never attaches it, so `deploy` would ship the jar alone;
`omod/pom.xml` attaches it explicitly with `build-helper-maven-plugin`. Nothing else in the
build depends on that attachment, so a reordered plugin or a changed `finalName` would
quietly go back to publishing one artifact — hence the `Check the .omod was published` step
in `modules.yml`, which fails the publish if no `.omod` was uploaded.

### Releasing the module is opt-in

A distribution release is cut far more often than this module changes, so a release does
**not** publish it by default. The opt-in signal is the pom's own version:

> **Before cutting release `x.y.z`, set the pom to `x.y.z-SNAPSHOT` on `main` if the module
> should ship with it.**

The `decide` job in `modules.yml` compares the pom's base version — the `<version>` minus
`-SNAPSHOT` — against the tag. They match, it publishes; they do not, the `publish` job is
skipped and release `x.y.z` simply carries whichever module version was published before it.
Either way the run summary says which way it went and why, so a skipped publish is never
silent.

**The bump has to be in the commit the tag points at.** A release build checks out the tag,
not `main`, so bumping the pom after the tag exists does nothing for that release — you
would have to move the tag onto the bumped commit and publish the release again. Unless the
module genuinely has to ship under that exact number, it is usually cleaner to leave the tag
alone and let the module go out with the next release.

This is a **pre-release** act. It used to be a post-release one — "after a release, bump to
the next `-SNAPSHOT`" — and the difference matters, because bumping afterwards now means the
release you just cut published nothing.

Nothing in this repository is blocked by a skipped publish: the backend image builds the
module from source (`distribution/backend/Dockerfile` copies `modules/liberiaemr` in), so
Repsy only serves consumers outside this repository.

The publish job also refuses to deploy a non-SNAPSHOT version from `main`, so a released
version cannot be silently re-deployed over by a later merge.

## How it reaches production

**A hand-built `.omod` is never dropped into a running container.** IMPLEMENTATION.md §8 is
explicit that a mutable checkout does not reach production: the deployable unit is the
immutable, versioned backend image.

A stage of `distribution/backend/Dockerfile` builds this module from the source in the commit
being built and copies the resulting `.omod` into `/openmrs/distribution/openmrs_modules/`,
beside the OMODs `scripts/build/resolve-modules.sh` resolves from `distro.properties`. So:

```
scripts/build/build-distribution.sh --version x.y.z   # module is built and shipped inside
```

The module is deliberately **not** pinned in `distro.properties` — it has never been
published to `mavenrepo.openmrs.org`, and building from the tag's own source leaves no
coordinate that can drift. `distro.properties` records that decision at the end of the file.

Because this module carries a liquibase changeset and its own global properties, `modules/`
is part of the path filter that keeps CI's clean-database gate (`.github/workflows/ci.yml`).

### For local development only

An OpenMRS SDK server (`mvn openmrs-sdk:run`) or a dev container picks the module up from
`~/.OpenMRS/modules`. That path is for development boxes, never for a facility or central
instance.
