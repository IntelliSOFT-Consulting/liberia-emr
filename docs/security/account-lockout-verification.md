# Account lockout verification

Updated **2026-10-01** after a second review of OpenMRS core 2.8.8. The 2026-09-29
configuration and existing-install checks below still stand where they are not corrected
here. Live REST authentication has not been run. A6 remains **Partial**.

Scope: lock on the fifth consecutive failed authentication, and a five-minute recovery
that restarts if someone tries again while the account is locked. Session timeout and
RBAC are outside this change. Password-reset activation-key validity is recorded here
only because an earlier draft of this change treated `security.validTime` as a lockout
setting.

## Properties

| Property | Shipped value | What core 2.8.8 does with it |
| --- | --- | --- |
| `security.allowedFailedLoginsBeforeLockout` | 4, from `var.security.login.allowed-failures-before-lockout` | Failed-login threshold. Lock when the count **exceeds** this value, so 4 locks on failure 5. Fallback if the property is missing or not an integer: 7. |
| `security.unlockAccountWaitingTime` | 5 | Recovery interval in **minutes**. While locked, another attempt resets `lockoutTimestamp` to now and starts this interval again. Fallback: 5 minutes. |
| `security.validTime` | 300000 | Password-reset **activation-key** validity in **milliseconds** (5 minutes). Not lockout duration. Blank or outside 60000–43200000 ms falls back to 600000 ms (10 minutes). |
| `security.loginAttemptsBeforeLockout` | not shipped | Not read by the 2.8.8 lockout mechanism. A historical database row is inert for this control. |

## Configuration and exact-version evidence

The distribution pins OpenMRS core **2.8.8** and Initializer **2.12.0**.

On 2026-10-01, `openmrs-api-2.8.8.jar` from `mavenrepo.openmrs.org` was inspected with
`javap -c -p` and `javap -v`. The same behavior is in the `2.8.8` tag of
`HibernateContextDAO` and `UserServiceImpl`. This was a jar and source inspection, not a
new authentication run.

- `HibernateContextDAO.authenticate` increments the failure count, reads
  `security.allowedFailedLoginsBeforeLockout`, and sets `lockoutTimestamp` only when the
  count exceeds the configured value. **4 therefore locks on failure 5.**
- When `lockoutTimestamp` is already set and `now - lockoutTimestamp` is **not greater
  than** the unlock interval, the method sets `lockoutTimestamp` to `currentTimeMillis`
  and throws `ContextAuthenticationException` ("Invalid number of connection attempts")
  **before it checks the password**. The method is
  `@Transactional(noRollbackFor = ContextAuthenticationException.class)`, so that
  exception commits. The user was loaded in the same session, so the new timestamp is
  kept. Recovery is five minutes after the latest attempt while locked, not five minutes
  after failure 5. A correct password during the lock restarts the interval too. The
  comparison is strict: elapsed time equal to the interval still rejects and restarts it.
- `getUnlockTimeMs` / `convertUnlockAccountWaitingTimeGP` consume
  `security.unlockAccountWaitingTime` in **minutes**. The configured value remains **5**.
- `UserServiceImpl.getValidTime()` reads `security.validTime`
  (`GP_PASSWORD_RESET_VALIDTIME`). `setUserActivationKey` adds that many milliseconds to
  the current time and stores the activation key; `getUserByActivationKey` uses the same
  limit. Units are milliseconds. A blank value, or a value below 60000 or above 43200000,
  becomes 600000. **300000 is inside that range and means 5 minutes.** It is not consulted
  by `authenticate`.
- The Liberia password-reset mail flow does not read `security.validTime`. It expires its
  own `PasswordResetToken` from `liberiaemr.passwordReset.tokenExpiryHours` (default 2
  hours). Restoring `security.validTime` keeps core's activation-key path explicit; it
  does not change that module token.
- Initializer's `GlobalPropertiesLoader.load` calls `saveGlobalProperties`.
  Core's `HibernateAdministrationDAO.saveGlobalProperty` looks up the property by name,
  updates its value and description if present, and saves it if absent.
- Initializer's `BaseFileLoader` loads changed files and writes their checksums. The
  changed XML therefore updates an existing installation, not only a clean database.
  Shipping `security.validTime=300000` is what makes a clean install and an upgraded
  database agree. Omitting it leaves an existing row at 300000 and a clean database on
  core's 600000 ms default.

`security.loginAttemptsBeforeLockout` and `var.security.login.max-attempts` are not read
by this lockout mechanism. They are not shipped. Existing
`security.loginAttemptsBeforeLockout` rows are not deleted and do not need a cleanup
migration for enforcement.

## AUTOMATED

`scripts/validate/validate-content.sh`, section *account lockout configuration (not runtime
authentication)*, checks shipped configuration only. It requires
`security.allowedFailedLoginsBeforeLockout` wired to
`var.security.login.allowed-failures-before-lockout` with every declaration of that
variable equal to `4`, `security.unlockAccountWaitingTime=5`, and
`security.validTime=300000`, each defined once in national `gp-security.xml`. It rejects
`security.loginAttemptsBeforeLockout` and `var.security.login.max-attempts`. These are
**configuration checks, not authentication behavior tests**.

The 2026-09-29 mutation run treated a reintroduced `security.validTime` as a failure.
That expectation was wrong and is withdrawn: core reads the property. The check now
requires the explicit value `300000`.

On 2026-10-01 the same check was run against throwaway copies of the content packages
(the repository itself was not mutated). It passed on the corrected configuration. It
rejected a threshold of `5`, recovery of `10`, `security.validTime=600000`, a missing
`security.validTime`, a reintroduced `security.loginAttemptsBeforeLockout`, and a
site-layer declaration of the threshold variable set to `5`.

National content
`mvn -o -B -f content-packages/content-liberia-national/pom.xml package` succeeded. The
filtered `gp-security.xml` in the package resolves to
`security.allowedFailedLoginsBeforeLockout=4`, `security.unlockAccountWaitingTime=5`,
and `security.validTime=300000`. It does not define
`security.loginAttemptsBeforeLockout`. That is packaging evidence, not a running server.

## RUNTIME VERIFIED

Local review container on 2026-09-29: `liberiaemr-local-backend-1`, OpenMRS 2.8.8 /
Initializer 2.12.0. Read-only queries of the existing database recorded:

| Property | Before restart | After Initializer startup |
| --- | --- | --- |
| `security.allowedFailedLoginsBeforeLockout` | 7 | 4 |
| `security.unlockAccountWaitingTime` | 5 | 5 |

Only the Maven-packaged `gp-security.xml` was copied into the local container's distribution
configuration directory, after saving the original outside the repository. Restarting the
backend let its normal startup copy and Initializer loading apply the change. No SQL update,
REST global-property edit, or checksum deletion was used. This was a focused local upgrade
check, not a rebuilt release image or a full clean-install run.

`security.validTime` was not part of that before/after table. This 2026-10-01 correction
restores it in shipped configuration and the packaged XML contains `300000`. The local
backend container `liberiaemr-local-backend-1` was stopped, so Initializer was not
started again and the database was not queried. Clean-install loading is supported by
the inspected save-if-absent code path and has not been independently runtime-tested.

## NOT YET VERIFIED

No disposable users were created and no authentication attempts were made. The local
container has no explicit administrator credential in its environment; its bootstrap-file
credential does not match the current administrator hash (checked in memory, without
logging either value or attempting authentication). A valid authorized provisioning setup
is needed before testing. Never use an administrator as the lockout subject.

Pending checks through O3's actual `/ws/rest/v1/session` path, using fresh requests without
existing session cookies and two disposable users:

1. Wrong password attempts 1–4 are rejected, with no `lockoutTimestamp` established.
2. Wrong password attempt 5 is rejected and establishes `lockoutTimestamp`.
3. The correct password is rejected while locked; the other user can still sign in.
4. A successful login before five failures resets the consecutive-failure counter.
5. Recovery is **not** "attempt at 4:59, then expect success at 5:01". After failure 5,
   make no further authentication attempts. Success is allowed only once
   `now - lockoutTimestamp` is **greater than** the five-minute interval. An attempt while
   locked, wrong or correct password, sets `lockoutTimestamp` to now; an attempt at 4:59
   leaves the account locked at 5:01. Record the timestamp before and after that attempt
   so the restart is visible. A deterministic clock-controlled core test is preferable to
   a sleeping automated test; neither was run.

Record the counter and lock state via authorized read-only inspection, not HTTP rejection
alone (a wrong password and a locked account can both be rejected). Do not record credentials
or cookies. A6 remains **Partial**, not Enforced.
