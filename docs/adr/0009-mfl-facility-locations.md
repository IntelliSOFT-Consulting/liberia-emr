# 0009: The Master Facility List is the source of truth for facility locations

**Status:** Proposed
**Date:** 27 September 2026 · **Ticket:** LE-319 (parent LE-317)

## Context

The MOH keeps its Master Facility List (MFL) in a DHIS2 instance at
`https://dhis2.moh.gov.lr/mfl`. The **central instance** needs every facility on that list as an
OpenMRS `Location`, so that staff there can switch from one facility to the next. Today it has
only what one site package seeds: central is built with a single `SITE_PACKAGE` (default
Careysburg, `distribution/backend/Dockerfile`). So central holds one facility root and none of
the other ~995.

The MFL was probed read-only on 27 September 2026 (LE-317):

- DHIS2 **2.40.4.1**. Four org unit levels: Country (1), County (2, 15 units),
  District (3, 106 units) and Facility (4, 996 units).
- A facility carries a DHIS2 UID (`id`, 11 characters), an MOH `code` (`LBR-06-0624-06`), a
  `name` (some with leading whitespace), `openingDate`, `lastUpdated`, `path`, `parent` and
  point `geometry` in `[longitude, latitude]` order.
- `/api/attributes` is **empty**. Facility type, ownership, EmONC level and services are
  expressed only as **org unit group sets and groups**: Hospital / Health Center / Clinic;
  Public / Private / Faith Based / Concession; BemONC / CEmONC; about 40 "Facilities Rendering X
  Services" groups.

Three existing rules constrain the design:

1. **Metadata is not synced** ([entity coverage](../architecture/sync-entity-coverage.md) §3).
   Facility and central must already hold every referenced location under the **same UUID**. A
   location UUID that a facility references and central lacks is a sync failure at the receiver.
2. **Central is read-only for clinical data** ([sync-eip.md](../architecture/sync-eip.md) §1.8c).
   Its database is written by the dbsync receiver and by nothing else clinical. Locations are
   metadata, so a job writing them does not break this rule. It must still never touch a row the
   receiver applies.
3. **Initializer reapplies its files on every boot** (see `EmailService.resolveSecret`). A
   global property that an operator is expected to edit must therefore not be seeded from
   content, or each restart silently reverts the edit.

Some facts are still being established by the exploration subtask (LE-318). They are marked
**pending LE-318** below; each has a default that holds until LE-318 reports.

## Decision

### 1. Location UUIDs are derived from the DHIS2 UID

Each MFL org unit's location UUID is a **name-based UUID, version 5** (RFC 4122 §4.3):

```
namespace = e0b0fbf7-045c-437a-8e7c-4504984c5e1a   # LiberiaEMR MFL namespace, fixed forever
name      = the DHIS2 UID, exactly as DHIS2 returns it (UTF-8, case-sensitive, no prefix)
uuid      = UUIDv5(namespace, name)
```

Worked examples for the unit tests:

| DHIS2 UID | Level | UUID |
| --- | --- | --- |
| `nY6mPgT0Kc6` | Facility (Jah Clinic) | `7dd5a981-7e3a-59fa-b1fa-e1474e299da8` |
| `TSrmxt9mnrS` | District (Kpaai) | `44a79c82-0b97-5487-8057-19ad9616f10e` |
| `LHNiyIWuLdc` | Country (not created) | `2e40b99d-8da4-50c7-a678-ab5702058bd7` |

Every instance that syncs the MFL computes the same UUID independently. No location row ever has
to travel over sync, which rule 1 forbids.

The namespace is declared once, as a constant in the liberiaemr module. It is **not** a global
property: changing it would re-key every facility in the country.

The only exception is a **UUID override** for a facility whose root location already exists in
a live database under another UUID (decision 2). Overrides live in the national layer, so every
instance applies the same ones.

### 2. Site roots take the derived UUID; existing live roots are adopted by override

A site package's facility root **is** that facility's MFL location. It is never a second row
beside it.

- Each site package declares its MFL UID as `var.site.mfl-uid`. It sets
  `var.location.facility-root.uuid` to `UUIDv5(namespace, var.site.mfl-uid)`, written out as a
  literal because Initializer cannot compute it. The root row in the site's location CSV carries
  the `MFL UID` attribute (decision 4).
- `scripts/validate/validate-content.sh` checks that, for every site package, the root UUID
  equals the v5 derivation of its MFL UID. A mistyped literal then fails CI instead of creating
  a facility that central cannot match.
- **Careysburg and Barnersville are not live** (the go-live checklist is open), so their root
  UUIDs change now, while IMPLEMENTATION.md §9's append-only rule does not yet bind them. Their
  MFL UIDs are **pending LE-318**. Existing dev and demo databases get a second root row after
  the change and must be rebuilt rather than migrated.
- **A facility adopted from a pre-existing production database** (IMPLEMENTATION.md §7) keeps
  its live root UUID. The national global property `liberiaemr.mfl.uuidOverrides` maps its MFL
  UID to that UUID, as a JSON object `{"<DHIS2 UID>": "<existing location UUID>"}`. It is
  empty today and seeded from `content-liberia-national`. This one global property **is**
  content-owned, so reapplying it on every boot is exactly what we want.

The sync then finds the root by UUID. It updates only the fields the MFL owns (decision 4) and
never changes the UUID. Facility-scoped identifiers issued against the root (MOH HRN,
uniqueness `LOCATION`) keep pointing at the same row. Their location is unchanged; only its
parent and MFL fields are filled in.

Rejected alternatives:

- **Keep the site UUIDs and adopt by an `MFL UID` attribute lookup.** This works where the site
  package is loaded. Central is built with one site package, though, so for every other facility
  it would create the derived UUID while the facility uses the site UUID. That is exactly the
  rule 1 failure.
- **Load every site package at central.** This solves roots but not the other ~990 facilities,
  and it makes central's build depend on the list of facilities that have gone live.

### 3. Central always runs the sync; a facility runs it only if given credentials

The same module code runs everywhere. It is **available** only where MFL credentials are
configured (decision 7), and **enabled** by a global property that the admin UI edits. The
admin UI hides itself where it is unavailable, as the sync status page already does at a
facility.

- **Central:** credentials are set in `central.env`, and the sync is enabled at first
  deployment (runbook, LE-325).
- **Facility:** no credentials by default, so the sync is off. The facility has its own root
  (decision 2) and needs nothing else to operate. If it later needs other facilities (referral
  or transfer destinations), it is given credentials. Decision 1 then yields the same UUIDs
  central holds.

A consequence: at a facility that does not sync, the root has **no parent**. At central, the
same row sits under its MFL district. This difference in location metadata is harmless, because
location rows never travel over sync.

### 4. Ownership: the MFL owns a fixed set of fields; everything else is local

The sync writes only these fields, and only on rows that carry an `MFL UID` attribute or match a
derived or overridden UUID:

| MFL source | OpenMRS target | Notes |
| --- | --- | --- |
| `id` | attribute **`MFL UID`** | the match key; UUID seed |
| `code` | attribute **`MFL Code`** | |
| `name` | `Location.name` | trimmed; the MFL wins at central. The site CSV root name must equal the MFL name, or Initializer and the sync overwrite each other |
| `parent` | `Location.parentLocation` | counties are top-level; the Country level is **not** created |
| `level` | tag **`County`** / **`District`** / **`Health Facility`** | existing national tags; the sync only **adds** tags, never removes them |
| `geometry` (Point) | `Location.latitude` / `longitude` | swap from `[lon, lat]` |
| county and district names | `stateProvince` / `countyDistrict`, `country = Liberia` | address fields; `address1` and `cityVillage` stay local |
| group set Hospital / Health Center / Clinic | attribute **`Facility Type`** | exclusivity **pending LE-318**; default: first match in that order, conflict logged |
| group set Public / Private / Faith Based / Concession | attribute **`Facility Ownership`** | same default |
| BemONC / CEmONC | attribute **`EmONC Level`** | `CEmONC` wins over `BemONC` |
| `openingDate` | attribute **`MFL Opening Date`** | |
| `closedDate` | attribute **`MFL Closed Date`** + retire | decision 5 |
| `lastUpdated` | attribute **`MFL Last Updated`** | drives incremental sync |

The "Facilities Rendering X" service groups are **out of scope for v1**. No consumer needs them
yet, and 40 multi-valued attributes are cheap to add later but expensive to remove.

The following are **local** and never written by the sync: `description`, `address1`,
`cityVillage`, every other tag (Login, Visit, Queue and so on), every non-MFL attribute, and all
child locations (wards, OPD, laboratory, …). The receiver never writes location rows, so this
job and the receiver cannot conflict.

**Name uniqueness is pending LE-318.** The default keeps the MFL name as is. Two facilities with
the same name in different districts are told apart in the switcher by code and district
(decision 6), not by renaming.

### 5. Closure and disappearance retire; nothing is purged

- **`closedDate` set:** retire with reason `MFL: closed <yyyy-mm-dd>`.
- **Missing from a full pull:** retire with reason `MFL: not in the MFL since <run date>`. This
  happens only on a **full** run, never on an incremental one. Whether DHIS2 gives a deletion
  signal is **pending LE-318**; the default is to diff by absence.
- **Mass-retirement guard:** if a full pull returns fewer than 90% of the MFL locations the
  instance currently holds, the run makes **no** retirements and ends `FAILED`. That shape is a
  permissions or paging fault, not the MOH closing a tenth of the country.
- **Reopening:** a facility that returns is un-retired only if its retire reason starts with
  `MFL:`. A human retirement is never reversed by the sync.
- **A facility root that this instance logs in to is never retired automatically.** The sync
  records an item error instead, and a person decides. Retiring the root would stop the
  facility's own users from choosing a login location.

Purging is never done: encounters, identifiers and audit history reference these rows.

### 6. Tags: the switcher at central filters on `Health Facility`

MFL facilities get `Health Facility`, the existing national tag. They do **not** get
`Login Location`. At a facility that runs the sync, `Login Location` would bury the facility's
own departments under 996 other facilities.

The login app's location picker hard-codes `_tag=Login Location`
(`esm-liberia-login-app/src/location-picker/location-picker.resource.ts`). LE-324 replaces the
boolean `chooseLocation.useLoginLocationTag` with a string, `chooseLocation.locationTag`
(default `Login Location`). Central's frontend config sets it to `Health Facility`. Facilities
change nothing. The switcher shows the MFL code and district next to each name.

No new tag is introduced. The `MFL UID` attribute already marks a location as MFL-managed.

### 7. Credentials come from the environment, never from a global property

The username and password are **deployment secrets**. They follow the SMTP relay pattern
(`EmailService`), with one deliberate difference: there is **no** global property fallback,
because global properties are readable over REST by anyone with Get Global Properties.

| Setting | Source | Editable in the UI |
| --- | --- | --- |
| Username | env `LIBERIAEMR_MFL_USERNAME` | no; the UI shows it |
| Password | env `LIBERIAEMR_MFL_PASSWORD_FILE` (a path, read verbatim, preferred), else `LIBERIAEMR_MFL_PASSWORD` | no; never returned by any endpoint, never logged |
| Base URL | GP `liberiaemr.mfl.url`, module default `https://dhis2.moh.gov.lr/mfl` | yes |
| Enabled, schedule | GPs, decision 8 | yes |

These are distinct from the existing `DHIS2_*` variables. Those belong to the `dhis2-export`
service and the national HMIS instance, not to the MFL.

The distribution passes them the same way it passes the SMTP relay. In
`distribution/compose/{central,facility}/docker-compose.yml`, under `backend.environment`:

```yaml
      # MFL sync (liberiaemr module, ADR 0009). Credentials are deployment secrets:
      # mount the password file and leave the plain variable empty. Unset = MFL sync
      # unavailable on this instance, and the admin page hides itself.
      LIBERIAEMR_MFL_USERNAME: ${LIBERIAEMR_MFL_USERNAME:-}
      LIBERIAEMR_MFL_PASSWORD: ${LIBERIAEMR_MFL_PASSWORD:-}
      LIBERIAEMR_MFL_PASSWORD_FILE: ${LIBERIAEMR_MFL_PASSWORD_FILE:-}
```

The matching placeholders go in `distribution/env/*.env.example`, left empty the way the SMTP
ones are.

`scripts/validate/no-secrets.sh` looks for a secret-shaped value (12 or more characters from
`[A-Za-z0-9/+_-]`) after a `password` key. A short password, or one with punctuation, passes
it. The scanner is a backstop and cannot be relied on to catch a committed MFL password.

The module-default and UI-edited global properties (`liberiaemr.mfl.url`, `.enabled`,
`.schedule.*`) are declared in the module's `config.xml` and **not** seeded by Initializer
(rule 3). Only `liberiaemr.mfl.uuidOverrides`, which is content-owned, is seeded.

### 8. Incremental daily, full weekly, first run full

| Global property | Default | Meaning |
| --- | --- | --- |
| `liberiaemr.mfl.enabled` | `false` | the schedule runs only when true; manual runs are allowed whenever the sync is available |
| `liberiaemr.mfl.schedule.time` | `02:00` | local time (`Africa/Monrovia`) of the daily run |
| `liberiaemr.mfl.schedule.fullEveryDays` | `7` | every Nth scheduled run is full; `1` means always full |

- **Incremental:** org units with `lastUpdated` later than the start of the last successful run,
  minus one hour of overlap. It creates and updates; it retires only on `closedDate`.
- **Full:** every org unit at levels 2–4. It also retires by absence (decision 5).
- The **first run on an instance is always full**, whatever is requested.
- Whether a change in **group membership** bumps an org unit's `lastUpdated` is **pending
  LE-318**. If it does not, type and ownership changes wait for the weekly full run, which is
  acceptable for metadata that changes this rarely.
- There is one scheduler task, `LiberiaEMR MFL Sync`, registered like the identity task
  (`IdentitySchedule`). A global property listener reschedules it when the schedule changes.
  Runs never overlap: a second request while one is running is refused, not queued.

The level/group filters that LE-319 floated are **not** offered. Central must hold the whole
list, and a partial list at one instance is the start of the UUID drift this ADR exists to
prevent.

### 9. The admin UI is a route in `esm-liberia-sync-status-app`

The route is `mfl-sync`, with its own app menu item and a link from the sync status page. The
page serves the same audience as the other pages in that app: MOH staff administering sync at
central. It shows no clinical data, and it already follows the hide-when-unavailable pattern
a new page needs. A separate package would mean another build, another CI job, another distro
entry and another translation file for one page.

The route must **not** declare a `liberiaemr` `backendDependency`: CI stamps the module
`0.0.0-ci`, and a pinned floor fails E2E with an alert toast.

### 10. The REST contract

The contract is [`docs/architecture/mfl-sync-api.md`](../architecture/mfl-sync-api.md). The
TypeScript types for it are at
[`packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts`](../../packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts),
where the admin UI (LE-323) imports them and QA (LE-325) can copy them for stubs. The backend
(LE-321, LE-322) implements the document. **Where the document and the types disagree, the
document wins,** and the types are fixed.

## Consequences

- Central gets every MFL facility without depending on which site packages it was built with.
  This closes the gap in which central held one facility root and no others.
- **This does not close the gap for child locations.** A Barnersville encounter at
  "Barnersville OPD" still references a location that central, built with the Careysburg site
  package, does not hold. The MFL has no departments. This ADR fixes facility roots only;
  department parity needs its own decision (for example, loading every site's location CSV at
  central).
- Site packages gain one variable (`var.site.mfl-uid`) and one validator rule. Their root UUIDs
  change once, before go-live. Dev databases are rebuilt.
- The MFL becomes a runtime dependency of central's location metadata. If the MFL is
  unreachable, runs fail and the cached list stays as it is. Nothing clinical depends on a
  successful run.
- A DHIS2 UID is permanent in our data. If the MOH deletes a facility and re-creates it, it
  gets a new UID. We then hold a retired row and a new one, and records stay on the old one.
- The MFL's ~1,100 locations make location queries at central larger. LE-324 checks the
  switcher's performance, and LE-325 checks that the other location-driven apps (queues,
  appointments, wards) are unaffected, because none of them filters on `Health Facility`.

## To confirm before LE-320 to LE-325 start

1. Rekeying the Careysburg and Barnersville roots to derived UUIDs before go-live (decision 2).
2. Facilities do not run the sync by default (decision 3).
3. The switcher at central filters on `Health Facility`, with no `Login Location` on MFL rows
   (decision 6).
4. Credentials come from env and password file only, with no global property fallback
   (decision 7).
5. The admin UI lives in `esm-liberia-sync-status-app` (decision 9).
6. The service groups are out of scope for v1 (decision 4).
