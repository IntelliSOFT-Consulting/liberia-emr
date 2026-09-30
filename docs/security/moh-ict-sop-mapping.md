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
| A6 | Lockout after failed attempts | 5 attempts | `gp-security.csv` → `security.loginAttemptsBeforeLockout` | Enforced |
| A7 | Session timeout | 10 minutes | `config-national.json` (client) | **Partial** |

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

### A7 — session timeout

`logoutIdleTimeoutMinutes` in the O3 runtime config ends the user's session **in the
browser**. It does not invalidate the session server-side, so a stolen session cookie
survives it. The matching server-side timeout must be configured in the backend image;
until both are in place this control is partial, not enforced.

---

## Authorisation

| # | Control | Where | Status |
| --- | --- | --- | --- |
| B1 | Role-based access control | `content-common/…/roles.csv`, `content-liberia-national/…/roles.csv` | Enforced |
| B2 | Least privilege by job function | Roles map to actual facility job functions | Enforced |
| B3 | Audit logs readable only by ICT Unit | `ICT Auditor` role — **no clinical privileges attached**; holds `View Audit Log`, the auditlog module's `Get Audit Logs`, and `Get People`, without which O3 will not sign anyone in (see below). Read in the **Audit log** page (`packages/esm-liberia-audit-log-app`) over `/ws/rest/v1/liberiaemr/auditlog` (`modules/liberiaemr`) | Implemented — see the note below |
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
- **`Get People` is the one read privilege it holds, and only because O3 needs it.** O3's
  navigation sends a signed-in user back to the login page unless their session includes
  their own person record, which the server includes only for holders of `Get People`
  (seen on a demo stack: an ICT Auditor without it could not get past login). It lets the
  role read person records over REST, which for a patient means their name, sex, birth date
  and address, the same demographics the audit log already shows. It does not reach
  patients, visits, encounters, observations or orders (`Get Patients` and the rest, which
  the role does not hold; `AuditLog.cy.ts` checks it gets `403` reading patients). **Review
  this grant at sign-off**: the alternative is a separate, non-O3 way to read the log.
- **Credential material is never shown**, whatever `auditlog.exceptions` says: rows of
  `LoginCredential` and of liberiaemr's `PasswordResetToken` are left out of every read, and a
  password, salt, token or key, or any value of a global property named like one, is shown
  as redacted.
- **Without the auditlog module** the page and API say the log is not recorded (`503`) and
  the rest of the system runs: liberiaemr is only aware of auditlog, it does not require it.

Whoever reads the log sees more than metadata. An entry records the old and new value of
every changed property, for example a patient's previous and corrected name. Treat the audit
log as PHI.

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

The default is `false` in three independent places — the gateway image (`ENV
LEGACY_ADMIN_UI=false`), the facility compose file (`${LEGACY_ADMIN_UI:-false}`) and the
env template — so an environment that never mentions the variable is blocked. Central is
stronger still: it hard-codes `false` and has no opt-out at all.

Only two places set it to `true`, both non-production and both setting it on the deploy
command rather than in a server's persistent `facility.env`, so it cannot travel with a
copied env file into a facility:

- `deploy-dev` in `.github/workflows/ci.yml` (dev host, `main` pushes only)
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
2. **A7**: server-side session timeout to match the client timer.
3. **B4**: named-account policy in the runbook and training material.
4. **C3**: log review confirming no PHI reaches application logs.
5. **D3**: backup encryption implemented and a restore rehearsed, covering all six copies
   of clinical data at rest enumerated in [sync architecture](../architecture/sync-eip.md)
   §7.4, not only the OpenMRS database.
6. **D2 / D6 / D8**: mutual TLS, broker authorisation and certificate revocation, each
   proven by a negative test rather than by configuration review.
7. **D7**: facility disk encryption accepted as a control and an owner named.

Nothing on this list is closed by editing a CSV.
