# National global properties — coverage of the MOH ICT SOP controls

`gp-security.csv` and `gp-audit.csv` carry the controls that OpenMRS core exposes as
global properties. **Not every contractual control is a global property**, and pretending
otherwise by inventing property names that the platform ignores would produce a
configuration that looks compliant and enforces nothing.

The table below is the honest mapping. Anything marked **NOT a GP** is tracked in
[docs/security/moh-ict-sop-mapping.md](../../../../../docs/security/moh-ict-sop-mapping.md)
and must be closed before go-live sign-off.

| SOP control | Baseline | Where it is enforced |
| --- | --- | --- |
| Password minimum length | 13 chars | `gp-security.csv` → `security.passwordMinimumLength` |
| Password complexity | upper+lower+digit+non-digit | `gp-security.csv` |
| Lockout after failed attempts | 5 attempts | `gp-security.csv` → `security.loginAttemptsBeforeLockout` |
| Audit logging enabled | all clinical + admin actions | `gp-audit.csv` (auditlog module) |
| Audit log retention | ≥ 3 months | `gp-audit.csv` + backup policy in `docs/runbooks/` |
| Audit logs readable only by ICT Unit | — | `ICT Auditor` role in `content-common/…/roles.csv`; no clinical privileges attached |
| **Password expiry — 90 days** | 90 days | **NOT a GP.** Requires an authentication-module policy or an external IdP. See ADR 0004. |
| **No reuse of last 3 passwords** | history = 3 | **NOT a GP.** Same as above. |
| **Session timeout — 10 minutes** | 10 min | **NOT a core GP.** Enforced in the O3 runtime config (`config-national.json`) *and* at the gateway; both are required, since the frontend timer alone does not invalidate a stolen session server-side. |
| TLS for facility↔cloud sync | TLS 1.2+ | `distribution/gateway/nginx.conf` |
| Encrypted backups | — | `docs/runbooks/backup-restore.md` |

Do not "resolve" a **NOT a GP** row by adding a plausible-looking property name to a CSV.
Initializer will load it, OpenMRS will ignore it, and the control will silently not exist.
