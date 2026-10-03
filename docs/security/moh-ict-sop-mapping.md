# Security control mapping — MOH ICT SOPs and the National Cybersecurity Strategy

Controls from the **MOH ICT SOPs (Feb 2023, v1.1.0)** and the **National Cybersecurity
Strategy 2025–2029**, mapped to where each is actually enforced.

These are **contractual minimums**. A site package may make a control stricter; loosening
one is a contract breach. Never scaffold a looser default (IMPLEMENTATION.md §10).

## Status legend

**Enforced** — configured, and the platform honours it.
**Partial** — configured somewhere, but the control is not fully closed.
**Open** — no implementation. Blocks go-live sign-off.

---

## Authentication and session

| # | Control | Baseline | Where | Status |
| --- | --- | --- | --- | --- |
| A1 | Password minimum length | 13 characters | `gp-security.csv` → `security.passwordMinimumLength` | Enforced |
| A2 | Password complexity | upper + lower + digit + non-digit | `gp-security.csv` | Enforced |
| A3 | Password must not match username | — | `gp-security.csv` | Enforced |
| A4 | Password expiry | 90 days | — | **Open** |
| A5 | No reuse of last 3 passwords | history = 3 | — | **Open** |
| A6 | Lockout after failed attempts | 5 attempts | `gp-security.xml` → `security.allowedFailedLoginsBeforeLockout=4` (locks on failure 5); `security.unlockAccountWaitingTime=5` minutes | **Partial** — existing-install configuration update verified; REST authentication checks pending ([evidence](account-lockout-verification.md)) |
| A7 | Session timeout | 10 minutes of human inactivity | Login-app idle watcher and Tomcat `conf/web.xml` `session-timeout` — see below | **Partial** |

### A4 / A5 — password expiry and history

OpenMRS core has **no global property** for either. Adding a plausible-looking property to
a CSV would load cleanly, be ignored by the platform, and leave the control non-existent
while appearing satisfied — the worst of both outcomes.

Two real options, to be decided in **ADR 0004** before go-live:

1. An authentication module that implements expiry and history.
2. An external identity provider (the MOH ICT Unit may already operate one), with OpenMRS
   delegating authentication to it.

Option 2 is likely better for the MOH long-term but adds an availability dependency that an
offline-first facility instance cannot tolerate unless the IdP is local. That trade-off is
the substance of the ADR.

### A6 — lockout after failed attempts

OpenMRS 2.8.8 locks when the failure count exceeds
`security.allowedFailedLoginsBeforeLockout`. The shipped value **4** locks on the fifth
consecutive failure; **5** would lock on the sixth. `security.unlockAccountWaitingTime`
is **5 minutes** after the latest authentication attempt while the account is still
locked. The account opens only when the elapsed time is greater than that interval.
Trying again earlier, including at the five-minute mark and including with the correct
password, sets `lockoutTimestamp` to now and starts the five minutes over. Waiting, without
another attempt, is what lets the account open. That is core behavior, not a defect to
"fix" by shortening the wait. The ICT note is in
[deploy.md](../runbooks/deploy.md). REST checks are still pending, so this row stays
**Partial**.

### A7 — session timeout

The contractual maximum is **10 minutes of human inactivity**. Two layers implement it.
Neither is an OpenMRS global property. The gateway does not enforce this control:
`ssl_session_timeout` is TLS session caching, and `proxy_read_timeout` is how long the
proxy waits on an HTTP response.

**Client.** `packages/esm-liberia-login-app` mounts an invisible watcher on
`top-nav-info-slot`, which stays mounted during authenticated O3 use. The login route
does not. The watcher records pointer, keyboard, touch and scroll activity. It does not
treat `fetch`, XHR or background polling as activity. A timestamp — nothing else — is
stored in `localStorage` under `liberiaemr.lastHumanActivityAt`, so activity in any tab
refreshes the same clock and one idle tab does not log out a tab that is in use. When
every tab has been idle for the configured period, the watcher calls the existing logout
path: `DELETE /ws/rest/v1/session`, which invalidates the OpenMRS `HttpSession`, then
returns to the login page. A background tab whose timers were throttled compares that
timestamp when it becomes visible and logs out immediately if the period has already
elapsed.

The period is `session.idleTimeoutMinutes` on `@liberiaemr/esm-liberia-login-app`,
filled from `${var.security.session.timeout-minutes}`. The unit is minutes. Maven
filtering leaves the built value as a JSON string such as `"10"`. A missing, invalid or
greater-than-10 value becomes 10. A shorter positive value is honored, so a site can be
stricter and cannot loosen the maximum. `@openmrs/esm-primary-navigation-app`'s
`logoutIdleTimeoutMinutes` is not this control; that app does not read the key.

The distribution still pins `@liberiaemr/esm-liberia-login-app=10.0.0-pre.143`, which
does not contain the watcher. `packages.yml` publishes `10.0.0-pre.<run>` only after
this change is on `main`. The pin has to move to that exact version in a follow-up.
Until then a frontend image built from `distro.properties` does not run the watcher.

**Server.** OpenMRS 2.8.8 does not set `session-timeout`, so Tomcat uses the default in
`/usr/local/tomcat/conf/web.xml`. The backend image changes that value from 30 minutes to
10. `startup.sh` recopies the WAR and does not replace `conf/`. An application-level
`<session-timeout>` in the OpenMRS `WEB-INF/web.xml` would override this default, so the
image build fails if one appears. The OpenMRS descriptor itself is not modified.

**Why both.** A frontend-only timer leaves the server session alive when the browser
never runs the watcher, including a stolen cookie sitting unused. A server-only timer
is reset by the application's own background polling, so a person can be idle at the
keyboard while the servlet session stays fresh. The client watches the person. The
server is the backstop for a session that is not being called.

**Unsaved work.** Idle logout, like the Logout button, does not warn that a form has
unsaved changes. A countdown is out of scope.

**Not yet shown at runtime.** The source and the image build are in place. Login, idle
logout, rejection of the old `JSESSIONID`, partograph polling, and multi-tab behavior
have not been exercised on a running stack. Status stays **Partial** until the login
app pin includes the watcher and both layers have been runtime-verified.

---

## Authorisation

| # | Control | Where | Status |
| --- | --- | --- | --- |
| B1 | Role-based access control | `content-common/…/roles.csv`, `content-liberia-national/…/roles.csv` | Enforced |
| B2 | Least privilege by job function | Roles map to actual facility job functions; see [the login roles](#the-login-roles) | Enforced |
| B3 | Audit logs readable only by ICT Unit | `ICT Auditor` role — **no clinical privileges attached**; holds `View Audit Log` and the auditlog module's `Get Audit Logs`, and no person or patient read (see below). Read in the **Audit log** page (`packages/esm-liberia-audit-log-app`) over `/ws/rest/v1/liberiaemr/auditlog` (`modules/liberiaemr`) | Implemented — see the note below |
| B4 | Named accounts, no shared logins | — | **Open** — operational policy, not configuration; belongs in the go-live runbook and training |

B3 is easy to get wrong by granting the auditor "read everything" for convenience. Reading
audit logs and reading patient records are different permissions, and the SOP grants the
first, not the second.

**The viewer.** The module's own viewer is a legacy UI page,
`/openmrs/module/auditlog/viewAuditLog.form`, which returns 404 on core 2.8.8 (the omod ships
no `webModuleApplicationContext.xml`), and the module has no REST resource. So since LE-371 the
ICT Unit reads the log in the O3 **Audit log** page, served by a read-only REST resource in
`modules/liberiaemr`: filter by date, user, type and action, page on the server, see an
update's previous and new values and a deleted item's last state, and export CSV (at most
50,000 rows per file). How to use it: [audit-log.md](../runbooks/audit-log.md).

- **Who can read it.** Every call needs `Get Audit Logs`, checked on the server and failing
  closed; the menu entry needs `View Audit Log`. The `ICT Auditor` role holds both and no
  clinical privilege; it deliberately does not hold `Get Items`, which resolves ANY object by
  class and id, and the viewer does not need it. `qa/e2e/cypress/e2e/AuditLog.cy.ts` checks on
  every CI run that a user without the role sees no menu entry and gets `403`.
- **It holds no person read.** Until LE-392 it held `Get People` only because O3 would not
  keep it signed in without it; the session now carries the officer's own person without that
  privilege (see [Signing in to O3](#signing-in-to-o3)), so the grant was removed. It reaches no
  person, patient, visit, encounter, observation or order (`AuditLog.cy.ts` checks it gets
  `403` reading patients, and `RoleSignIn.cy.ts` that it gets `403` reading persons). The
  audit log itself still shows a changed person's old and new values, so the log is PHI.
- **Credential material is never shown**, whatever `auditlog.exceptions` says: rows of
  `LoginCredential` and of liberiaemr's `PasswordResetToken` are left out of every read, and a
  password, salt, token or key, or any value of a global property named like one, is shown
  as redacted.
- **Without the auditlog module** the page and API say the log is not recorded (`503`) and
  the rest of the system runs: liberiaemr is only aware of auditlog, it does not require it.

Whoever reads the log sees more than metadata. An entry records the old and new value of
every changed property, for example a patient's previous and corrected name. Treat the audit
log as PHI.


### The login roles

Every role a person signs in with, and what it may read. Privileges are in
`content-common` `roles-common.csv` and `content-liberia-national` `roles-national.csv`.
`RoleSignIn.cy.ts` signs a user holding each role alone in to O3 on every CI run.

| Role | Package | Job | Landing page (`/home` opens) | Person records (`Get People`) | Why |
| --- | --- | --- | --- | --- | --- |
| Records Officer | common | Registration and medical records | Service queues (`/home/service-queues`) | Yes (LE-392) | Registers and finds patients; REST leaves a patient's name, sex and age out without it |
| Nurse | common | Triage and vitals | Service queues | Yes (LE-392) | The patient banner and chart show the person |
| Clinician | common | Consultation and ordering | Service queues | Yes, from Nurse | As Nurse |
| Midwife | common | Maternal care | Service queues | Yes, from Nurse | As Nurse |
| Pharmacist | common | Dispensing | Service queues | Yes (LE-392) | Dispenses to a named patient |
| Lab Technician | common | Order fulfilment | Service queues | Yes (LE-392) | Matches a sample to a named patient |
| National Reporting Officer | national | MOH indicator reports | Indicator reports (`/home/indicator-reports`, LE-397) | **No** | Aggregate figures only; `403` on persons and patients |
| Sync Administrator | national | Sync queue and MFL sync | Sync status (`/home/sync-status`, LE-397) | **No** | Operates queues and the facility list, not records; `403` on persons and patients |
| ICT Auditor | national | Reads the audit log (B3) | Audit log (`/home/audit-log`, LE-397) | **No** (removed in LE-392) | See B3 above |
| Sync Conflict Reviewer | national | Resolves sync conflicts at central | Sync conflicts (`/home/sync-conflicts`, LE-397) | Yes | Reads the patient record a conflict holds |

Sync Sender and Sync Receiver are service accounts, not people, and are not in this table.

#### Landing pages and the app menu (LE-397)

esm-home-app opens the dashboard that `defaultDashboardPerRole` names for one of the user's
roles, else `service-queues`, else the first dashboard left in `homepage-dashboard-slot`. The six
facility roles are not named and land on the service queues. Each LiberiaEMR app registers its
page as a home dashboard too, gated in its `routes.json` by the privilege the page needs, and
`config-national.json` names it for the national role that works there:

| Dashboard | App | Shown to holders of | Default for |
| --- | --- | --- | --- |
| `indicator-reports` | `esm-liberia-reports-app` | `Export National Report` | National Reporting Officer |
| `sync-status` | `esm-liberia-sync-status-app` | `View Sync Status` | Sync Administrator |
| `sync-conflicts` | `esm-liberia-sync-status-app` | `Resolve Sync Conflicts` | Sync Conflict Reviewer |
| `audit-log` | `esm-liberia-audit-log-app` | `View Audit Log` | ICT Auditor |

The National Reporting Officer also holds `Get Users` (LE-397). The reporting module loads a
report definition with the user who created it, and core refuses that load without `Get Users`,
so until then every `reportingrest/reportDefinition` call answered `403` for the role and its
report page could not list a report. `Get Users` reads user accounts (staff names and usernames),
not patients; the role still gets `403` on persons and patients.

A role may hold more than one: the Sync Conflict Reviewer also sees the sync status dashboard in
the side navigation. A user holding several national roles lands on the first of them in the
order the session lists the roles. At a facility the two sync pages say they are shown at
central, which is their page working, not an error.

The app menu shows an entry only to a user who may use it. The RefApp's own entries carry no
privilege, so `config-national.json` gates them in `app-menu-slot`: System Administration by
`View Administration Functions`, the queue screen by the service queues dashboard's queue
privileges, Dispensing by `Get Medication Dispense`. LiberiaEMR's entries are gated in their
`routes.json` by the privilege their endpoint checks: Sync status by `View Sync Status`, Master
Facility List sync by `View MFL Sync` (before LE-397 both asked the server for every user who
opened the menu, and a Sync Conflict Reviewer got a `403` from `mfl/status`), Indicator reports by
`Export National Report`, Audit log by `View Audit Log`.

#### The service queue (LE-395)

Every login role lands on `/home`, which opens the service queues dashboard. Until LE-395 no
login role but the administrator could read a queue, so every one of them saw "Error loading
queue entries" there. The patient-flow roles now hold what each queue operation needs, and the
privileges are the ones the queue module (`omod.queue` 3.0.0) and core actually check:

| Privilege | What needs it | Records Officer | Nurse (and Clinician, Midwife) | Pharmacist, Lab Technician |
| --- | --- | --- | --- | --- |
| `Get Queues` | the queue list and the dashboard's filters | Yes | Yes | Yes |
| `Get Queue Entries` | the queue table and its counts | Yes | Yes | Yes |
| `Manage Queue Entries` | add a patient to a queue, move (transition) them, end their queue entry | Yes | Yes | Yes |
| `Get Visits` | the "checked in patients" count and each entry's visit | had it | had it | Yes |
| `Get Locations` | the queue location filter and picker | had it | Yes | Yes |
| `Get Visit Types`, `Get Visit Attribute Types` | the start-visit form that checks a patient in | Yes | Yes | No |
| `Get Beds`, `Get Admission Locations` | saving any visit: the bed management module validates every visit save against the patient's bed assignments, checked as the user | Yes | Yes | No |
| `Edit Visits` | the queue number: the queue module stores it as a visit attribute and saves the existing visit, which core allows only with `Edit Visits` (without it the call answered `500`, a `ContextAuthenticationException`) | Yes | Yes | No (they do not check in) |
| `Get Encounters` | the same save of the visit answers `403` without it | Yes | had it | No |

Why each role:

- **Records Officer** registers and checks patients in: starts the visit and puts the patient in
  the first queue. It still reads no observation, order or programme.
- **Nurse, Clinician, Midwife** see who is waiting for them, call the next patient, move them to
  the next service and end their entry. Nurses also start visits (they already held
  `Add Visits`), which needs the same visit-form and bed reads as the Records Officer.
- **Pharmacist and Lab Technician**: each facility has TB Screening, ANC and General Consultation
  queues at its Pharmacy and Laboratory (the site `queues/` CSV), so patients are sent to them
  through the queue. They see their queue, serve the patient and end or move the entry. They do
  not check patients in, so they get no visit-type, visit-attribute or bed privilege.
- **National Reporting Officer, Sync Administrator, Sync Conflict Reviewer, ICT Auditor** get no
  queue or visit privilege: their work is aggregate reports, the sync and the audit log, not
  patient flow. Instead `config-national.json` shows each home dashboard only to users holding
  every privilege its data needs (O3's extension `Display conditions`), so no clinical dashboard
  is shown to them. From LE-395 until LE-397 that left them the home app's "dashboard does not
  exist" tile; they now land on their own app's dashboard (see
  [Landing pages and the app menu](#landing-pages-and-the-app-menu-le-397)). They see no error
  notification and make no failing call.

What no role got, and none needs: `Assign Beds` and `Edit Admission Locations`, the bed write
privileges. Until LE-396 **ending a visit** failed for every login role (`403 Assign Beds`),
because the released bed management module (7.2.0, `VisitWithBedPatientAssignmentSaveHandler`)
un-assigned beds on every visit that got a stop time and demanded both privileges for it, even
when the patient had no bed. That is an upstream defect, not a grant to make: the distribution
now builds bedmanagement from the 7.2.0 source with a Modify + PR patch
(`distribution/backend/patches/bedmanagement/`, tracked in
`packages/modify-pr/.patches/0005-openmrs-module-bedmanagement-end-visit-without-bed-write.md`)
that frees beds only when the visit holds one. So:

- ending the visit of a patient **with no bed** needs only what the check-in roles already hold
  (`Edit Visits`, and the bed reads `Get Beds` and `Get Admission Locations` that every visit
  save already needs, in the table above);
- ending the visit of a patient who **is in a bed** still needs both bed write privileges, which
  no login role holds, so only the administrator can end it, as before. Whether ward roles
  should get them is an MOH decision for when inpatient care is configured.

No login role holds bed write access, and none was added.

`RoleSignIn.cy.ts` checks on every CI run that each role lands on the page in the table above,
that the landing page makes no failing call and shows no error, that the Sync Conflict Reviewer's
app menu lists no entry it cannot use and makes no failing call, and that the six facility roles
read queues, queue entries and visits while the four national roles do not. `Queue.cy.ts` checks
that a Records Officer adds a patient to a queue, and checks a patient in, queues them and ends
the visit.

`Get People` reads every person's name, sex, birth date and address over REST. The four
facility roles that gained it in LE-392 already read patients (`Get Patients`), and a patient's
demographics are its person, so for patients the grant adds no data they could not already
see, it only lets REST return it. It also reaches persons who are not patients, such as staff
accounts' names; that is the exposure accepted for these four roles.

### Signing in to O3

O3 sends a user back to the login page unless `/ws/rest/v1/session` includes the user's own
person record, which the REST module renders only for holders of `Get People`. Until LE-392 no
login role but the ICT Auditor held it, so none of the others could sign in; every E2E spec
signed in as admin and none noticed.

Rather than give every role `Get People`, `modules/liberiaemr` adds the signed-in user's
**own** person, as `{uuid, display}` and nothing else, to the session response when the REST
module left it out (`OwnPersonSessionAdvice`, a response advice on the REST module's session
controller only). It grants no privilege: `/person/{that uuid}` and every other person read
still answer `403`. Its unit tests check that it never touches another user, a rendered
person, or an anonymous session; `RoleSignIn.cy.ts` checks on a running stack that every login
role signs in and that a role without `Get People` still cannot read persons.

If a REST module upgrade renamed the session controller, the advice would stop applying and
the non-clinical roles would again be sent back to login; `RoleSignIn.cy.ts` fails on that.
The fallback is to grant those roles `Get People`, with the exposure above recorded here.

How to check a new role: [local-development.md §2.1](../runbooks/local-development.md#21-a-new-or-changed-login-role-check-that-it-can-sign-in).

---

## Audit

| # | Control | Baseline | Where | Status |
| --- | --- | --- | --- | --- |
| C1 | Audit logging enabled | all clinical + admin actions | `gp-audit.xml` configures the auditlog module, which `distribution/backend/Dockerfile` builds from the commit pinned in `distro.properties` (`source.auditlog.*`) | Enforced — see the note below |
| C2 | Retention | ≥ 3 months | `auditlog_audit_log` is never purged by the module + backup policy | **Partial** — retention depends on the backup schedule in `docs/runbooks/backup-restore.md` |
| C3 | No PHI in application logs | — | `integration/` ground rules; the sync receiver's retry route and complex obs processor, which log payloads at INFO, run at WARN (`distribution/sync/receiver-application.properties.template`). Known residue: dbsync's JSON mapping errors quote part of the payload, and `SYNC_LOG_LEVEL=DEBUG` logs whole payloads | **Open** — needs a log review before go-live |

### C1 — what the audit log does and does not cover

Before LE-353 the global properties were configured but the module was not in the image, so
this row claimed a control that did not exist. The module is a Hibernate interceptor: it
writes one row per created, updated or deleted entity to `auditlog_audit_log`, with the
user, the time and the changed values. Strategy `ALL_EXCEPT`, excluding the OCL importer's
bookkeeping and `LoginCredential`, whose rows would otherwise carry every password hash and
salt; so a password change is not audited.

- **Not covered:** writes that bypass Hibernate (direct SQL, Liquibase, the reporting ETL,
  and at central the sync receiver, which writes through its own JPA layer), and reads —
  who viewed a chart is not recorded. Logins appear only indirectly, as an update to the
  user's `lastLoginTimestamp` property; a failed login to an existing account, as its
  `loginAttempts` going up. A failed login with an unknown username leaves nothing.
- **Stays local.** `auditlog_audit_log` is not in `eip.watchedTables`, which CI pins to an
  exact list, so a facility's audit log is not synced; central's log covers central users
  only. It is in the facility binlog like any `openmrs` table, which the binlog disk sizing
  must allow for.
- **Volume:** grows without bound; nothing purges it, and no retention decision exists to
  purge by (C2). A first boot that imported the concept dictionary wrote about 114,000 rows
  (30 MB); day-to-day volume follows clinical activity. liberiaemr adds indexes on the date,
  type and parent columns so the viewer stays usable as it grows.
- **Reading it:** the **Audit log** page (B3), [audit-log.md](../runbooks/audit-log.md),
  which also lists what an empty result does and does not prove.

---

## Transport and storage

| # | Control | Baseline | Where | Status |
| --- | --- | --- | --- | --- |
| D1 | TLS for facility↔cloud sync | TLS 1.2+ | Web traffic: `distribution/gateway/default.conf.template`. Sync push: `distribution/broker/` (TLS 1.2/1.3 only, no plain listener) | Enforced for web traffic. **Partial** for the sync push: built and proven by `qa/sync/verify-hardening.sh`, not yet deployed with MOH-issued certificates |
| D2 | Mutual TLS on sync | — | `distribution/broker/`: per-facility client certificate required, identity from the certificate subject, no passwords; see [sync architecture](../architecture/sync-eip.md) §1.4 and §7.8 | **Partial**: built and proven by refusal tests. Open items: MOH ICT Unit certificate lifecycle, and the §7.2 check that a payload's facility code matches the sending certificate |
| D3 | Encrypted backups | — | `docs/runbooks/backup-restore.md` | **Open** |
| D4 | No secrets in the repository | — | Only `.env.example` templates committed; enforced by `scripts/validate/no-secrets.sh` in CI | Enforced |
| D5 | Legacy admin UI disabled | production only | `LEGACY_ADMIN_UI` drives both `OMRS_CONFIG_MODULE_WEB_ADMIN` and the gateway `/openmrs/admin/` block | Enforced in production — see the note below |
| D6 | Per-facility broker authorisation: send-only, own address only | — | `scripts/security/render-broker-config.sh`; see [sync architecture](../architecture/sync-eip.md) §7.3 | **Partial**: built and proven by refusal tests (other addresses, topic, subscriptions); not yet deployed |
| D7 | Full-disk encryption on facility servers | — | Facility host build | **Open**; not previously in this register |
| D8 | Facility certificate revocation enforced at central | — | Broker CRL, reloaded when replaced; `distribution/broker/README.md` | **Partial**: built and proven by refusal tests; the MOH ICT Unit must publish and refresh the CRL |

---

### D5 — the dev/staging exception

The legacy admin UI is off by default and on only where it is deliberately switched on.
A single variable, `LEGACY_ADMIN_UI`, drives both layers, so neither can be flipped
without the other:

| | Value | Gateway `/openmrs/admin/` | Backend `module.allow_web_admin` |
| --- | --- | --- | --- |
| Facility / central production | unset → `false` | 404 at the edge | `false` |
| Dev, staging, local | `true` | proxied to the backend | `true` |

The default is `false` in four independent places — the gateway image (`ENV
LEGACY_ADMIN_UI=false`), the facility and central compose files (`${LEGACY_ADMIN_UI:-false}`)
and the env template — so an environment that never mentions the variable is blocked.
Central used to hard-code `false` with no opt-out; LE-376 gave it the same switch once a
central dev server existed (LE-368).

Only three places set it to `true`, all non-production and all setting it on the deploy
command rather than in a server's persistent env file, so it cannot travel with a copied
env file into a facility or central production server:

- `deploy-dev` in `.github/workflows/ci.yml` (dev host, `main` pushes only)
- `deploy-central-dev` in `.github/workflows/ci.yml` (central dev host, `main` pushes only)
- `deploy-staging` in `.github/workflows/release.yml` (documented; the job is still a stub)

A production deploy follows `docs/runbooks/deploy.md` and sets nothing, which is what
keeps this control enforced where it is contractual.

**Implementation caveat.** `OMRS_CONFIG_MODULE_WEB_ADMIN` is consumed by the OpenMRS
install wizard, so on an instance that is already installed the persisted
`openmrs-runtime.properties` wins and the variable has no effect. On such an instance the
backend layer must be flipped once by hand (see
[local-development.md](../runbooks/local-development.md) §6); a clean install honours the
variable directly. Note what this means for the control as previously written: on an
existing production instance the enforcement has effectively been the gateway block plus
the wizard's original `false`, not the environment variable. Both layers still have to be
deliberately flipped to expose the UI, so the control holds — but it holds for a slightly
different reason than the old wording implied.

**Residual risk accepted:** dev and staging expose an interface that production does not,
so they are not byte-identical rehearsals of the production surface, and the ZAP baseline
scan in `dast` now scans a host with that interface reachable. Neither instance holds
patient data. Revisit when O3 grows equivalents for Manage Modules and the legacy
scheduler, at which point the exception can be dropped entirely.

### D3: the copies that are easy to miss

Backup encryption is usually scoped to the OpenMRS database. The sync layer and the reporting
ETL create further copies of clinical data at rest. The authoritative list is the six-row table
in [sync architecture](../architecture/sync-eip.md) §7.4; D3 is closed only when every row of
that table is covered. The reporting ETL schema, `liberiaemr_etl`, is a full flattened copy of
the clinical record at every facility and at central (ADR 0010). The `sync-queue` volume is
not a further store: it is the physical backing of the sender's management database and
Debezium offset (§1.5), and is covered by that row.

### D6: why a broker permission is a national-scale control

Facilities share one broker. A permission granting a facility read access to anything other
than its own address lets it read other facilities' clinical data. It is one line of
configuration and it fails silently, so it is verified by a **negative test**, a facility
credential proving it *cannot* read another facility's address, not by config review.

### D7: facility servers are not in a data centre

They sit in health centres, physically reachable and unattended overnight. A stolen server
yields the clinical database, six months of binary log, and the facility's client
certificate. Disk encryption is what makes theft a hardware loss rather than a breach.

---

## Open items blocking go-live sign-off

1. **A4 / A5**: password expiry and history (ADR 0004).
2. **A7**: re-pin `@liberiaemr/esm-liberia-login-app` to the pre-release that contains the human-idle watcher, and runtime-verify that watcher together with the 10-minute servlet `session-timeout`. Both mechanisms are in source; neither has been shown on a running stack.
3. **B4**: named-account policy in the runbook and training material.
4. **C3**: log review confirming no PHI reaches application logs.
5. **D3**: backup encryption implemented and a restore rehearsed, covering all six copies
   of clinical data at rest enumerated in [sync architecture](../architecture/sync-eip.md)
   §7.4, not only the OpenMRS database.
6. **D2 / D6 / D8**: mutual TLS, broker authorisation and certificate revocation, each
   proven by a negative test rather than by configuration review.
7. **D7**: facility disk encryption accepted as a control and an owner named.

Nothing on this list is closed by editing a CSV.
