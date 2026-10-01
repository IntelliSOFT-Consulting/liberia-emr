# National global properties — coverage of the MOH ICT SOP controls

`gp-security.xml` and `gp-audit.xml` carry the controls that OpenMRS core exposes as
global properties. **Not every contractual control is a global property**, and pretending
otherwise by inventing property names that the platform ignores would produce a
configuration that looks compliant and enforces nothing.

The table below is the honest mapping. Anything marked **NOT a GP** is tracked in
[docs/security/moh-ict-sop-mapping.md](../../../../../docs/security/moh-ict-sop-mapping.md)
and must be closed before go-live sign-off.

| SOP control | Baseline | Where it is enforced |
| --- | --- | --- |
| Password minimum length | 13 chars | `gp-security.xml` → `security.passwordMinimumLength` |
| Password complexity | upper+lower+digit+non-digit | `gp-security.xml` |
| Lockout after failed attempts | 5 attempts | `gp-security.xml` → `security.loginAttemptsBeforeLockout` |
| Audit logging enabled | all clinical + admin actions | `gp-audit.xml`, read by the auditlog module that `distribution/backend/Dockerfile` builds from the commit pinned in `distro.properties` |
| Audit log retention | ≥ 3 months | The module never purges `auditlog_audit_log`; backup policy in `docs/runbooks/` |
| Audit logs readable only by ICT Unit | — | `ICT Auditor` role in `roles/roles-national.csv`; no clinical privileges attached (`Get People` only so O3 signs the user in). Read in the **Audit log** page, `docs/runbooks/audit-log.md` |
| **Password expiry — 90 days** | 90 days | **NOT a GP.** Requires an authentication-module policy or an external IdP. See ADR 0004. |
| **No reuse of last 3 passwords** | history = 3 | **NOT a GP.** Same as above. |
| **Session timeout — 10 minutes** | 10 min of human inactivity | **NOT a core GP.** Do not add one. Client: the human-idle watcher in `@liberiaemr/esm-liberia-login-app` (`session.idleTimeoutMinutes`, from `var.security.session.timeout-minutes`). Server: `<session-timeout>10</session-timeout>` in the OpenMRS WAR `WEB-INF/web.xml`, applied by the backend image before deploy. Both are required. The watcher never runs if the browser does not execute it, and servlet inactivity is reset by background polling while a person is idle. The gateway does not enforce this. See `docs/security/moh-ict-sop-mapping.md`. |
| TLS for facility↔cloud sync | TLS 1.2+ | `distribution/gateway/default.conf.template` |
| Encrypted backups | — | `docs/runbooks/backup-restore.md` |

Do not "resolve" a **NOT a GP** row by adding a plausible-looking property name to a CSV.
Initializer will load it, OpenMRS will ignore it, and the control will silently not exist.
