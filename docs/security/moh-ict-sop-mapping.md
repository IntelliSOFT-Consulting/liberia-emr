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
| B3 | Audit logs readable only by ICT Unit | `ICT Auditor` role — **no clinical privileges attached** | Enforced |
| B4 | Named accounts, no shared logins | — | **Open** — operational policy, not configuration; belongs in the go-live runbook and training |

B3 is easy to get wrong by granting the auditor "read everything" for convenience. Reading
audit logs and reading patient records are different permissions, and the SOP grants the
first, not the second.

---

## Audit

| # | Control | Baseline | Where | Status |
| --- | --- | --- | --- | --- |
| C1 | Audit logging enabled | all clinical + admin actions | `gp-audit.csv` | Enforced |
| C2 | Retention | ≥ 3 months | `gp-audit.csv` + backup policy | **Partial** — retention depends on the backup schedule in `docs/runbooks/backup-restore.md` |
| C3 | No PHI in application logs | — | `integration/` ground rules | **Open** — needs a log review before go-live |

---

## Transport and storage

| # | Control | Baseline | Where | Status |
| --- | --- | --- | --- | --- |
| D1 | TLS for facility↔cloud sync | TLS 1.2+ | `distribution/gateway/nginx.conf` | Enforced |
| D2 | Mutual TLS on sync | — | `sync-receiver` in the central compose | **Partial** — certificate lifecycle is the MOH ICT Unit's |
| D3 | Encrypted backups | — | `docs/runbooks/backup-restore.md` | **Open** |
| D4 | No secrets in the repository | — | Only `.env.example` templates committed; enforced by `scripts/validate/no-secrets.sh` in CI | Enforced |
| D5 | Legacy admin UI disabled | — | `OMRS_CONFIG_MODULE_WEB_ADMIN=false` and blocked at the gateway | Enforced |
| D6 | Per-facility broker authorisation: send-only, own address only | — | Artemis broker at central; see [sync architecture](../architecture/sync-eip.md) §7.3 | **Open** |
| D7 | Full-disk encryption on facility servers | — | Facility host build | **Open**; not previously in this register |
| D8 | Facility certificate revocation enforced at central | — | Broker CRL/OCSP; [sync architecture](../architecture/sync-eip.md) §7.2 | **Open** |

### D3: the copies that are easy to miss

Backup encryption is usually scoped to the OpenMRS database. The sync layer creates four
further copies of clinical data at rest: the **binary log** (up to six months of every
change), the sender's **management database** (retry payloads), the **broker journal** at
central, and the sync queue volume. All are in scope for D3. See
[sync architecture](../architecture/sync-eip.md) §7.4.

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
5. **D3**: backup encryption implemented and a restore rehearsed, covering all five copies
   of clinical data at rest, not only the OpenMRS database.
6. **D6 / D8**: broker authorisation and certificate revocation, each proven by a negative
   test rather than by configuration review.
7. **D7**: facility disk encryption accepted as a control and an owner named.

Nothing on this list is closed by editing a CSV.
