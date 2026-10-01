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
| Lockout after failed attempts | 5 attempts | `gp-security.xml` → `security.allowedFailedLoginsBeforeLockout=4`; recovery: `security.unlockAccountWaitingTime=5` minutes |
| Audit logging enabled | all clinical + admin actions | `gp-audit.xml`, read by the auditlog module that `distribution/backend/Dockerfile` builds from the commit pinned in `distro.properties` |
| Audit log retention | ≥ 3 months | The module never purges `auditlog_audit_log`; backup policy in `docs/runbooks/` |
| Audit logs readable only by ICT Unit | — | `ICT Auditor` role in `roles/roles-national.csv`; no clinical privileges attached (`Get People` only so O3 signs the user in). Read in the **Audit log** page, `docs/runbooks/audit-log.md` |
| **Password expiry — 90 days** | 90 days | **NOT a GP.** Requires an authentication-module policy or an external IdP. See ADR 0004. |
| **No reuse of last 3 passwords** | history = 3 | **NOT a GP.** Same as above. |
| **Session timeout — 10 minutes** | 10 min | **NOT a core GP.** Enforced in the O3 runtime config (`config-national.json`) *and* at the gateway; both are required, since the frontend timer alone does not invalidate a stolen session server-side. |
| TLS for facility↔cloud sync | TLS 1.2+ | `distribution/gateway/default.conf.template` |
| Encrypted backups | — | `docs/runbooks/backup-restore.md` |

OpenMRS **2.8.8** locks when `attempts > allowedFailedLoginCount`: **4 locks on
failure 5**; changing it to 5 delays lockout until failure 6. The threshold is resolved
from `var.security.login.allowed-failures-before-lockout` during packaging. Recovery is
`security.unlockAccountWaitingTime=5` minutes after the latest authentication attempt
while the account is still locked. A retry before that interval expires sets
`lockoutTimestamp` to now and starts the five minutes again. See
[deploy.md](../../../../../docs/runbooks/deploy.md) and the
[verification record](../../../../../docs/security/account-lockout-verification.md).

`security.loginAttemptsBeforeLockout` is not read by this core lockout mechanism.
Removing it from the shipped XML does not delete a historical database row; that row
stays inert for lockout. `security.validTime` is a different property that core does
read: password-reset activation-key validity in milliseconds
(`UserServiceImpl.getValidTime()`), shipped as `300000` (5 minutes). It is not lockout
duration. Shipping it explicitly keeps a clean install from falling back to core's
600000 ms default while an upgraded database keeps an older row. Initializer 2.12.0
updates an existing property when the XML changes and creates it when it is absent.

Do not "resolve" a **NOT a GP** row by adding a plausible-looking property name to a CSV.
Initializer will load it, OpenMRS will ignore it, and the control will silently not exist.
