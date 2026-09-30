# Runbook: reading the audit log

For the MOH ICT Unit: find out who created, changed or deleted a record on a LiberiaEMR
server, and when, and what the values were before and after. This is MOH ICT SOP control B3
("audit logs readable only by ICT Unit"); what the log records is control C1. Both are in
[moh-ict-sop-mapping.md](../security/moh-ict-sop-mapping.md).

**Rehearsal status:** sections 1 to 4 were run on a local throwaway facility demo stack
(LE-371): a global property and a location edited over REST, found in the viewer with their
old and new values, exported as CSV, and refused to a user without the role.
`qa/e2e/cypress/e2e/AuditLog.cy.ts` repeats that on every CI run. Not yet rehearsed on a live
facility or on the central server, or against a log of production size (section 6).

## Where things are

| What | Where |
| --- | --- |
| The log itself | table `auditlog_audit_log` in each server's `openmrs` database, written by the auditlog module |
| What is recorded | global properties in `content-liberia-national` `gp-audit.xml`: every entity type except `LoginCredential` and the OCL importer's bookkeeping; a deleted item's last state is kept |
| The viewer | **Audit log** in the app menu, `/openmrs/spa/audit-log` (`packages/esm-liberia-audit-log-app`) |
| Its API | `/ws/rest/v1/liberiaemr/auditlog` ([contract](../../modules/liberiaemr/README.md#audit-log-viewer)) |
| Who may read it | the **ICT Auditor** role (`content-liberia-national` `roles-national.csv`): `View Audit Log` shows the menu entry, `Get Audit Logs` is what the server checks, `Get People` lets O3 sign the officer in. No clinical privileges |

**Each server has its own log.** A facility's log is not synced to central
(`auditlog_audit_log` is not in `eip.watchedTables`), and central's log covers only what was
done on central. To investigate a change made at a facility, read that facility's log.

**Treat the log as PHI.** An entry holds the old and new value of every changed property, a
patient's previous name for one. Keep exported files on MOH devices only, and delete them
when the investigation closes.

## 1. Give someone access

1. Give the ICT officer's own named account the **ICT Auditor** role, never a shared account
   (control B4). Where the legacy admin UI is off (production, control D5), a system
   administrator does it over REST. The `roles` list **replaces** the account's roles, so
   include the ones it already has:

   ```bash
   # the account's current roles
   curl -su "$ADMIN" "https://<server>/openmrs/ws/rest/v1/user?q=<username>&v=custom:(uuid,roles:(uuid,display))"
   # every role and its uuid (the role resource has no search by name)
   curl -su "$ADMIN" "https://<server>/openmrs/ws/rest/v1/role?v=custom:(uuid,display)&limit=100"
   curl -su "$ADMIN" -H 'Content-Type: application/json' -X POST \
     -d '{"roles":["<existing role uuid>","<ICT Auditor uuid>"]}' \
     "https://<server>/openmrs/ws/rest/v1/user/<user uuid>"
   ```

   `$ADMIN` is `username:password` of an administrator, typed at the prompt with
   `read -s`, never saved in a script.
2. Do not add the role to a clinical account, and do not give an auditor a clinical role to
   "see more": reading the audit log and reading patient records are separate permissions.
3. The officer logs out and in again. **Audit log** appears in the app menu. The home page
   may show "Error loading queue entries … 403": the role cannot read the patient queue, by
   design. Close it.

Someone who opens `/openmrs/spa/audit-log` without the role sees "You cannot read the audit
log", and the API answers `403`.

## 2. Find an entry

Open **Audit log** from the app menu. The newest entries are first, 50 to a page.

| Filter | Use it for |
| --- | --- |
| **From / To** | Whole days, in the server's time (Africa/Monrovia). Both ends are included |
| **User** | Username or system ID of the account that made the change. `System` in the table means no user was logged in: a scheduled task, the MFL sync, the first boot's content load |
| **Type** | What kind of record: *Patient*, *Person Name*, *Obs*, *Global Property*, *Location*, *User*, *Role* … Only types the log holds are offered |
| **Action** | Created, Updated or Deleted |
| **Hide entries saved as part of another** | A patient saved with a new name is one *Patient* entry with a *Person Name* entry under it; ticking this lists only the first |

Choose the filters, then **Apply filters**. The count above the table is how many entries
match.

**Identifier** is the record's database id, or a global property's name. To match it to a
record, note the id and look the record up in the application, or ask a database
administrator for the row with that id in the matching table.

## 3. Read an entry

Select a row. The panel beside the table shows:

- who made the change, when, and the full class name;
- for **Updated**: each changed property with its **Previous value** and **New value**. A
  value shown as *(none)* was empty;
- for **Deleted**: the item's **last state before deletion**, every property as it was;
- for **Created**: nothing more. A creation records who and when; the values are the
  record's current ones;
- **Saved with it**: entries saved in the same change, such as a person's names and
  addresses, each with its own values. From one of those, **Open the entry this was saved
  with** goes to the parent.

A value shown as **Redacted** is withheld by the server, whoever asks: a password, salt,
token or key, or any value of a global property named like one (the SMTP password, for
example). Changes to *password policy* settings such as `security.passwordMinimumLength` are
shown.

## 4. Export to CSV

**Download CSV** saves the entries matching the **applied** filters, newest first, up to
50,000 rows. One line per entry; the `values` column lists `property: previous -> new` for
an update and `property = value` for a deleted item's last state. A cell that a spreadsheet
would run as a formula starts with `'`.

For more than 50,000 entries, narrow the dates and export in parts. The response headers
`X-Total-Count` and `X-Truncated` say whether a file stopped short; the page's count says the
same before you download.

## 5. What the log does not show

Know these before you conclude from an empty result:

- **Logins.** There is no login entry. A sign-in shows only as an **Updated** *User* entry,
  with no user (nobody was signed in yet), whose `userProperties` change
  `lastLoginTimestamp`. A failed sign-in to an existing account shows the same way with
  `loginAttempts` going up; one with an unknown username leaves nothing.
- **Reads.** Who *viewed* a chart is not recorded. Only creates, updates and deletes are.
- **Passwords.** A password change leaves no entry: `LoginCredential` is excluded, because its
  rows would hold password hashes.
- **Writes that bypass OpenMRS's data layer**: direct SQL, Liquibase migrations, the reporting
  ETL, and at central the sync receiver, which writes records arriving from facilities
  through its own layer. A record that came from a facility was logged, if at all, at that
  facility.
- **Creation values.** A *Created* entry has no values; see the record itself.

## 6. Size and retention

The log is never purged: the module has no retention setting, and nothing in LiberiaEMR
deletes from it. A first boot that loads the concept dictionary writes about 114,000 entries
(30 MB); after that it grows with clinical activity. It is in every database backup and, at a
facility, in the binary log, which the disk sizing must allow for.

The viewer pages and filters on the server, using indexes the liberiaemr module adds on date,
type and parent entry, so a large log stays browsable; a count over a very wide filter can
still take seconds. Do not delete rows to save space: retention (control C2) is at least three
months, and an audit log with gaps is not evidence. Archive and purge only under a written MOH
retention decision, which does not exist yet.

## 7. When the page says the log is not recorded

"The audit log is not recorded on this server" (API `503`) means the auditlog module is not
running. Check **System Administration → Manage Modules** for *Audit Log*; its absence means
the backend image was built without it (`distribution/backend/Dockerfile`, stage 2b), and
nothing has been recorded since. Escalate: control C1 is failing on that server, not only the
viewer.
