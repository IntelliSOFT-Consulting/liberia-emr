# API tests

Automated tests against the OpenMRS REST and FHIR APIs of a running distribution.

## What to cover

- **Metadata assertions** — every concept, encounter type, visit type, programme, workflow
  and identifier type the content packages declare actually exists after Initializer runs,
  with the expected UUID, datatype and answers. This is the cheapest place to catch a
  content-package regression.
- **Variable resolution** — no `${var.` string survives into loaded metadata. A leftover
  placeholder means a variable was never defined, and it will surface later as a form that
  writes to a concept that does not exist.
- **RBAC** — each role can do what it should and, more importantly, cannot do what it
  should not. Assert the ICT Auditor has no clinical data access.
- **FHIR conformance** — resources validate against the profiles in `integration/fhir/`.

## Fixtures

Use the worked instances in `integration/fhir/examples/` so the profiles and the tests
cannot drift apart. That directory is planned in
[`integration/fhir/README.md`](../../integration/fhir/README.md) but does not exist yet.

## Running

Intended to run against the stack `qa/upgrade/run-clean-install.sh` brings up, on every PR.
That script destroys its stack (`down -v`) on exit, so the tests either run from inside it
or bring up a stack of their own.

## MFL sync (`mfl/`, `mfl-stub/`)

The only API suite so far: the contract tests for the Master Facility List sync (LE-325). The
spec is [mfl-sync-api.md](../../docs/architecture/mfl-sync-api.md) and
[ADR 0009](../../docs/adr/0009-mfl-facility-locations.md). **They never call the live MOH MFL.**
The backend under test syncs from a stub that serves the LE-318 fixture
([integration/dhis2/mfl/fixtures](../../integration/dhis2/mfl/fixtures)).

| File | What it is |
| --- | --- |
| `mfl-stub/mfl_stub.py` | A DHIS2 2.40 stand-in, standard library only. It serves the fixture over TLS with basic auth, and answers `filter=`, `fields=` (nested), paging and `paging=false` as DHIS2 does. An unsupported filter is a 400 naming it, never a silent match. `/__stub/` switches scenarios and returns the request log. The log records whether credentials came and matched, never the credentials themselves |
| `mfl-stub/gen-material.sh <dir>` | Throwaway material: a CA, the stub's certificate (`mfl-stub`, `mfl-stub-elsewhere`, `localhost`), a truststore of the JDK's CAs plus that CA for the backend, and a random stub password containing `&` |
| `mfl-stub/docker-compose.mfl-stub.yml` | QA-only overlay on the facility demo stack. It adds the stub and gives the backend its credentials, from a password file, with `LIBERIAEMR_MFL_ALLOWED_HOSTS=mfl-stub`. It also points `dhis2.moh.gov.lr` at the container itself, so nothing in CI can reach the live MFL |
| `mfl/verify-mfl-sync.py` | The contract tests. It prints PASS/FAIL per check, carries on after a failure, and exits non-zero if any check failed. There is no skip |

Stub scenarios, switched by `POST /__stub/scenario {"name": …}`:

| Scenario | The MFL… | The sync must… |
| --- | --- | --- |
| `normal` | is the fixture | create, adopt and update per ADR 0009 §3 |
| `remove-one` | has lost *Come & See Clinic* | retire it (21 of 22 is above the guard) |
| `remove-site-root` | has lost *Careysburg Clinic*, Careysburg's confirmed root | not retire the instance's own root; record an item error (used when content declares the root's UID, as Careysburg does) |
| `shrink` | returns 4 facilities | skip retirement: PARTIAL |
| `failed-page` | pages by 4 and fails page 2 | skip retirement: PARTIAL |
| `rename-reparent` | renames Kesselee and moves City Lab Clinic | update both in place |
| `with-extra` | adds `QaStubRoot1` | (used to adopt a site root whose content declares no MFL UID) |
| `redirect-cross-host` | redirects every call to `mfl-stub-elsewhere` | not follow it with credentials; the run FAILS |
| `unauthorized` / `down` | answers 401 / 503 | FAIL the run; test-connection answers `ok: false` |

What `verify-mfl-sync.py` asserts, in order:

1. **Setup.** The eight attribute types exist with their ADR UUIDs. The sync is pointed at the
   stub, and the script refuses to go on if the URL is still the live MFL.
2. **`GET /status`.** It has the full shape, `available` is true, the username is shown, and no
   password-like key appears anywhere.
3. **`PUT /config`.**
   - It answers 400, and changes nothing, for each of these: `http://`, `/api`, a host off the
     allowlist, the live MFL, a look-alike host, userinfo in the URL, a bad `schedule.time`,
     `username`, `password`.
   - A partial update works, and `nextRun` follows `enabled`.
4. **Privileges.** Unauthenticated: 403. No privilege: 403 on all seven. View only: GETs 200,
   writes 403. Sync Administrator: holds both privileges.
5. **`POST /test-connection`.**
   - It answers ok, with the version and facility count, and reaches the stub with the right
     credentials.
   - With the stub refusing the account or down, it still answers 200 with `ok: false`.
   - It never follows a cross-host redirect with credentials.
6. **Dry run, then the first sync.**
   - The dry run gives the counts and writes nothing.
   - The first sync gives:
     - rows at UUIDv5(namespace, MFL UID);
     - the site root adopted by its `MFL UID` with its UUID unchanged;
     - no Country row and no *CHT - Bong* row;
     - names normalised and duplicates suffixed;
     - parents, tags (never adding Login Location), address fields and coordinates;
     - every attribute, independently derived from the fixture with the ADR tie-breaks;
     - the closed facility retired;
     - warnings on the type conflicts;
     - held counts.
7. **Listing.** Runs come newest first; `limit` works and is capped; items filter by action;
   an unknown run is a 404.
8. **A second sync** changes nothing and records only warnings.
9. **Overlapping runs.** A second `POST /runs` while one runs answers 409 with its `runId`.
10. **Rename and reparent** apply in place and leave `description`, `address1` and extra tags
    untouched.
11. **Retire and restore.**
    - A facility absent from the pull is retired with an `MFL:` reason, and restored when it
      returns.
    - A person's retirement is never reversed.
12. **The completeness guard.** A pull under 90%, or one with a failed page, ends PARTIAL and
    retires nothing.
13. **Failed runs.** An MFL that is down, refuses the account, or redirects to another host
    FAILS the run.
14. **Two rows with one MFL UID** give an ERROR item and a PARTIAL run, with nothing retired.
15. **The instance's own root** is never retired; its absence is an ERROR item. The root is
    restored afterwards.
16. **The scheduler** holds exactly one `LiberiaEMR MFL Sync` task.
17. **No leaks.** No response and no backend log line contains the stub password or its
    basic-auth token.

`--unavailable` runs a second, short suite against a backend **without** MFL credentials:
`GET /status` answers 200 with `available: false`; `POST /runs` and `POST /test-connection` answer
503 with the contract message; `GET /runs` and `PUT /config` still work.

### In CI

The `e2e` job in `ci.yml` does the following:

1. Generates the material under `$RUNNER_TEMP`.
2. Starts the demo stack with the overlay.
3. Runs `verify-mfl-sync.py` **before** Cypress, on a stack no spec has touched yet.
4. Runs Cypress (also when the API tests failed, so one run shows both results).
5. Recreates the backend without the overlay on the same database, and runs `--unavailable`.

### Locally

```bash
M="$HOME/.cache/liberiaemr-mfl-stub"        # Docker Desktop does not share /tmp on macOS
qa/api/mfl-stub/gen-material.sh "$M"
cat >> my.env <<ENV
QA_MFL_DIR=$M
QA_MFL_STUB_DIR=$PWD/qa/api/mfl-stub
QA_MFL_FIXTURES=$PWD/integration/dhis2/mfl/fixtures
ENV
docker compose -f distribution/compose/facility/docker-compose.yml \
  -f distribution/compose/facility/docker-compose.demo.yml \
  -f qa/api/mfl-stub/docker-compose.mfl-stub.yml --env-file my.env up -d
qa/api/mfl/verify-mfl-sync.py --material-dir "$M" \
  --backend-logs-cmd "docker compose -f … --env-file my.env logs --no-color backend"
```

The script creates users, a role and locations, and runs syncs. It refuses any host but
localhost unless you pass `--allow-host`.

## Status

The MFL sync suite is written against the contract. It fails until the backend (LE-321,
LE-322) is merged. Nothing else is written yet. The `API tests` placeholder at the end of the
`initializer-clean-db` job in `ci.yml`, and the one in `release.yml`'s `full-stack-tests`, are
still `echo` steps.

## Remote history (`remote-history/`)

The contract test for central's remote history endpoint (LE-382, [ADR 0013](../../docs/adr/0013-remote-patient-import.md)).
`verify-remote-history.py` reads one patient's history from a central instance and checks that the
response holds only the ADR 0013 resource types (`RemoteHistoryAssembler.RESOURCE_TYPES`), that
observations appear only as the tagged ANC contact summary, that the requesting facility's own
records are left out, and that an unknown patient is an empty list, not a 404. It only reads, and
refuses any host but localhost unless you pass `--allow-host`. Certificates are always verified; pass
a self-signed test gateway's certificate with `--cacert`. Not yet wired into CI: it needs a
central stack with a patient seeded at two facilities.
