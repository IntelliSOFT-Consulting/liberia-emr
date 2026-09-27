# Runbook: MFL sync

Operating the Master Facility List (MFL) sync: the liberiaemr module job that copies the MOH MFL
(a DHIS2 instance) into the EMR as County, District and Health Facility locations. The design is
[ADR 0009](../adr/0009-mfl-facility-locations.md), the REST contract is
[mfl-sync-api.md](../architecture/mfl-sync-api.md), and the MFL itself is profiled in
[integration/dhis2/mfl/](../../integration/dhis2/mfl/README.md).

**Rehearsal status:** none of this has run against the live MFL. Sections 2 to 7 are exercised
against a stub MFL by `qa/api/mfl/verify-mfl-sync.py` on every CI run
([qa/api/README.md](../../qa/api/README.md)); the check that covers each step is named in it.
Rehearse sections 1 and 2 at central with the MOH-issued account before go-live.

Commands assume the repository is checked out on the host. At central, `central` below stands
for `docker compose -f distribution/compose/central/docker-compose.yml --env-file distribution/env/central.env`.
After changing an env file, apply it with `central up -d backend`; `restart` keeps the old values.

The admin page is **Master Facility List sync** in the app menu (`/openmrs/spa/mfl-sync`). It
needs **View MFL Sync** to open and **Manage MFL Sync** to change settings or start a run; the
**Sync Administrator** role holds both.

## Where things are

| What | Where | Who changes it |
| --- | --- | --- |
| MFL account (username) | env `LIBERIAEMR_MFL_USERNAME` in the central env file | ICT, as a deployment secret |
| MFL password | a file named by `LIBERIAEMR_MFL_PASSWORD_FILE`, mounted into the backend; `LIBERIAEMR_MFL_PASSWORD` only where a file is impossible | ICT, as a deployment secret |
| Hosts the sync may contact | env `LIBERIAEMR_MFL_ALLOWED_HOSTS`, comma-separated; default `dhis2.moh.gov.lr` | ICT, with the credentials |
| MFL address | global property `liberiaemr.mfl.url` (default `https://dhis2.moh.gov.lr/mfl`) | the admin page |
| Daily run time, on/off | `liberiaemr.mfl.schedule.time` (`02:00`, Monrovia), `liberiaemr.mfl.enabled` (`false`) | the admin page |
| Run history and per-location changes | the admin page, *Run history* → *View* | read-only |

The credentials are never in a global property, a content package, Jira or Git. No page or
endpoint returns the password, masked or otherwise. The admin page shows only the username.

## 1. Provision the credentials

The MOH issues a read-only DHIS2 account on the MFL (role *Integration API Reader*, scoped to
`Liberia`). Only central gets one (ADR 0009 §2). A facility without it shows *The MFL sync is not
set up on this server*, and that is the intended state.

1. Write the password to a file on the host, readable by the backend container only:

   ```bash
   sudo install -d -m 0750 /etc/liberiaemr/secrets
   sudo sh -c 'umask 077; cat > /etc/liberiaemr/secrets/mfl-password'   # paste, then Ctrl-D
   ```

   A trailing newline is ignored; any other whitespace is part of the password.
2. Mount it into the backend at the path the central compose file reads the secret from (the
   same pattern as the SMTP password), and name it in the central env file:

   ```bash
   LIBERIAEMR_MFL_USERNAME=<the MOH-issued account>
   LIBERIAEMR_MFL_PASSWORD_FILE=/run/secrets/mfl-password
   LIBERIAEMR_MFL_PASSWORD=
   # LIBERIAEMR_MFL_ALLOWED_HOSTS=dhis2.moh.gov.lr   (the default; see section 1a)
   ```

   Leave `LIBERIAEMR_MFL_PASSWORD` empty. A value there sits in the env file and in
   `docker inspect`; the file does not.
3. `central up -d backend`, then open the admin page. It should show the account under
   *MFL account* and no warning that the sync is not set up.
4. Press **Test connection**. Expect *Connected to the MFL: DHIS2 2.40.4.1, 996 facilities.*
   (the version and count as of September 2026).

### 1a. The host allowlist

The backend sends the MFL credentials **only** to a host in `LIBERIAEMR_MFL_ALLOWED_HOSTS`, and
only over `https://`. This closes a path where anyone able to edit the MFL address could point
it at their own server and collect the password:

- Saving an MFL address with `http://`, a host not on the list, or credentials in the URL is
  refused with an error, and the old address stays.
- The sync does not follow a redirect to another host with the credentials attached. A
  redirected run fails; the run's message says so.

Change the list only when the MOH moves the MFL to a new host: add the new host, save the new
address on the admin page, run **Test connection**, then remove the old host. Never add a host
the MOH did not name.

## 2. The first sync at central

**Before the first sync, central must already hold the root location of every live facility**,
with the root's MFL UID declared in its site package (`Attribute|MFL UID` in the site's
locations CSV, `var.site.mfl-uid`). Otherwise the sync creates a *second* row for that
facility, and the facility's records, which reference its own root, still have no match at
central. How central loads every site's locations is open in **LE-339**; until it is decided,
check each live facility by hand:

```bash
# At central: every live facility's root UUID must answer, and carry its MFL UID.
curl -sk -u "$ADMIN" "https://localhost/openmrs/ws/rest/v1/location/<site root uuid>?v=full" \
  | python3 -c 'import json,sys; l=json.load(sys.stdin); print(l["name"], [a["display"] for a in l["attributes"]])'
```

Then:

1. On the admin page, press **Dry run**. It changes nothing. When it finishes, open it with
   **View** and read what a sync would do. Expect about 1,100 *Created* items, and one *Updated*
   item per site root the sync adopts. The number of warnings is expected (see section 4).
   There must be no *Error* items.
2. Press **Sync now**. It takes under a minute. The run should end *Succeeded*, with the same
   counts as the dry run.
3. Turn **Scheduled sync** on and save. The sync then runs daily at the set time.

A site root the sync adopts keeps its own name and parent: content owns both (ADR 0009 §1 and
§3). *Careysburg Health Center* stays *Careysburg Health Center*, top-level, although the MFL
calls it *Careysburg Clinic*. The sync adds its MFL attributes, the `Health Facility` tag,
coordinates and county/district address, so the central switcher places it in its district.
Both matches are **pending MOH or site confirmation** (ADR 0009 §1). Until a match is
confirmed, the site package must not declare the MFL UID, and the sync creates a separate row
for that facility.

## 3. Reading a run

| Result | Meaning | What to do |
| --- | --- | --- |
| *Succeeded* | Every change applied (or, for a dry run, computed) | Nothing |
| *Partial* | The run finished, but some location failed, or the completeness guard skipped retirement (section 5) | Read the run's message, then its *Error* items |
| *Failed* | The run stopped: the MFL was unreachable, refused the account, or redirected elsewhere | Section 6 |

**View** lists the run's items: *Created*, *Updated*, *Retired*, *Restored*, *Unchanged, with
warnings* and *Error*. An unchanged location without a warning is not recorded. *What changed*
shows each field as `from → to`; tags are `tag:<name>` and attributes `attribute:<type>`.

## 4. Warnings

A warning never stops a run. It records a choice the sync made about data the MFL holds
ambiguously (ADR 0009 §3):

- **Facility Type:** a facility in two type groups gets the higher one (Hospital > Health Center
  > Clinic).
- **Facility Ownership:** Private paired with another group gives the other group. Any other
  pair leaves the attribute empty.
- **Facility Setting:** in both Rural and Urban leaves it empty.
- **Name:** a name that clashes with another active location gets ` (<District>)` appended.
- **Point outside Liberia:** stored as the MFL has it.

Report persistent warnings to the MOH MFL team; the fix belongs in the MFL.

## 5. Retirement and the completeness guard

The MFL gives no signal when a facility is deleted, so the sync retires a facility it holds
that is **missing from a complete pull**, with reason `MFL: not in the MFL since <date>`. A
facility the MFL marks closed is retired with `MFL: closed <date>`. Nothing is ever purged:
records keep pointing at the retired location.

The sync skips retirement, and ends the run *Partial*, when the pull is not trustworthy:

- a page of the pull failed, or
- the pull holds fewer than 90% of the active MFL locations this instance has.

Creates and updates still apply. A *Partial* run with that message is **not** the MOH closing
facilities. Run **Test connection**, then **Sync now**. If the pull is still short, ask the MOH
whether the account's scope or the MFL changed before anything else.

Other rules:

- A facility that comes back is restored, but only if the sync retired it (the reason starts
  `MFL:`). **The sync never undoes a person's retirement.** To bring such a location back,
  un-retire it by hand.
- **This instance's own root is never retired automatically.** If it disappears from the MFL,
  the run records an *Error* item for it, and a person decides.
- A facility the MOH *moves* appears as a close plus a new unit with a new UID: one retired
  location and one new one. Records stay on the old one; nothing links the two.

## 6. The MFL is unreachable, or refuses the account

The cached locations stay as they are; nothing is removed because a run failed.

1. Read the failed run's message on the admin page.
2. **Test connection.**
   - *401* or *refused*: the account is locked, expired or its password changed. Section 7.
   - Timeout or unreachable: check central's outbound HTTPS with
     `central exec backend curl -sS -o /dev/null -w '%{http_code}\n' https://dhis2.moh.gov.lr/mfl/api/system/info`.
     Expect `401`, which means the host was reached. Anything else is a network or DNS problem
     for ICT.
   - *Redirect*: the MFL moved. Confirm the new address with the MOH, then follow section 1a.
3. Once the test passes, press **Sync now**. There is nothing to replay; every run is a full
   pull.

## 7. Rotate the credentials

1. The MOH sets the new password, or issues a new account.
2. Replace the file: `sudo sh -c 'umask 077; cat > /etc/liberiaemr/secrets/mfl-password'`. If the
   account changed, update `LIBERIAEMR_MFL_USERNAME` too.
3. `central up -d backend`. The backend reads the file at start-up.
4. **Test connection**, then **Sync now**.
5. Ask the MOH to disable the old password or account.

Never paste the password into Jira, chat, the admin page or a global property. If it has been
exposed, rotate it.

## 8. Two rows hold one MFL UID

The run records an *Error* item for that UID and ends *Partial*. It does not choose between the
rows. This happens when a site root arrives at central after the sync already created a row for
the same facility (section 2).

1. Keep the site root: it is the row the facility's records reference.
2. Retire the other row, the one whose UUID the sync derived, with reason
   `Duplicate of the site root <uuid>`. Then void its `MFL UID` attribute.
3. **Sync now.** The *Error* item is gone and the site root is updated from the MFL.
