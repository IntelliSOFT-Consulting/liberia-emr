# Account lockout verification — 2026-09-29

Scope: lock on the fifth consecutive failed authentication; retain five-minute recovery.
Session timeout and RBAC are outside this change.

## Configuration and exact-version evidence

The distribution pins OpenMRS core **2.8.8** and Initializer **2.12.0**.
The running local backend's `openmrs-api-2.8.8.jar` was inspected with `javap -c -p`:

- `HibernateContextDAO.authenticate` increments the failure count, reads
  `security.allowedFailedLoginsBeforeLockout`, and sets `lockoutTimestamp` only when
  the count exceeds the configured value. **4 therefore locks on failure 5.**
- `getUnlockTimeMs` / `convertUnlockAccountWaitingTimeGP` consume
  `security.unlockAccountWaitingTime` in **minutes**. The configured value remains **5**.
- Initializer's `GlobalPropertiesLoader.load` calls `saveGlobalProperties`.
  Core's `HibernateAdministrationDAO.saveGlobalProperty` looks up the property by name,
  updates its value and description if present, and saves it if absent.
- Initializer's `BaseFileLoader` loads changed files and writes their checksums. The
  changed XML therefore updates an existing installation, not only a clean database.

Repository-wide searches found `security.loginAttemptsBeforeLockout`, `security.validTime`
and `var.security.login.max-attempts` only in the old national configuration and its docs;
no Liberia module or frontend consumed them. The obsolete definitions are removed from
the shipped configuration. Existing database rows are not deleted and are not consumed
by this core lockout mechanism; no database cleanup migration is needed for enforcement.

## AUTOMATED

`python3 scripts/validate/tests/account-lockout.test.py`: **4 tests passed**. This runs
inside `scripts/validate/validate-content.sh` and checks the supported property/variable
wiring, the threshold, recovery value, duplicate definitions across content layers,
obsolete keys, and conflicting threshold overrides. These are **configuration regression
tests, not authentication behavior tests**. A temporary mutation from threshold `4` to `5`
was rejected by the boundary test; no mutation was left in the repository.

National content `mvn -o -B -f content-packages/content-liberia-national/pom.xml package`
passed; the packaged XML resolves the threshold to `4` and recovery to `5`.
Content validation, no-secrets, no-demo-in-release, demo upstream consistency and
`git diff --check` passed.

`mvn ... verify` could not run configuration validation: the packager's bundled JNA
does not support this Apple Silicon host. This is the limitation documented in
`docs/runbooks/local-development.md` §5. Full Maven configuration validation remains
pending on a supported CI host; the package build and repository validators passed.

## RUNTIME VERIFIED

Local review container: `liberiaemr-local-backend-1`, OpenMRS 2.8.8 / Initializer 2.12.0.
Read-only queries of the existing database recorded:

| Property | Before restart | After Initializer startup |
| --- | --- | --- |
| `security.allowedFailedLoginsBeforeLockout` | 7 | 4 |
| `security.unlockAccountWaitingTime` | 5 | 5 |

Only the Maven-packaged `gp-security.xml` was copied into the local container's distribution
configuration directory, after saving the original outside the repository. Restarting the
backend let its normal startup copy and Initializer loading apply the change. No SQL update,
REST global-property edit, or checksum deletion was used. This was a focused local upgrade
check, not a rebuilt release image or a full clean-install run.

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
5. Recovery permits authentication after the configured five-minute interval. A deterministic
   clock-controlled core test is preferable to a sleeping automated test; neither was run.

Record the counter and lock state via authorized read-only inspection, not HTTP rejection
alone (a wrong password and a locked account can both be rejected). Do not record credentials
or cookies. Clean-install loading is supported by the inspected save-if-absent code path,
but has not been independently runtime-tested here. A6 remains **Partial**, not Enforced.
