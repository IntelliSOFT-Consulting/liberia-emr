# 0009: The Master Facility List is the source of truth for facility locations

**Status:** Accepted (27 September 2026). Decision 1 is the user's reversal of the first
draft; the rest was confirmed as proposed or settled by the MFL exploration.
**Date:** 27 September 2026 · **Ticket:** LE-319 (parent LE-317)

## Context

The MOH keeps its Master Facility List (MFL) in a DHIS2 instance at
`https://dhis2.moh.gov.lr/mfl`. The **central instance** needs every facility on that list as an
OpenMRS `Location`, so that staff there can switch from one facility to the next. Today it has
only what one site package seeds: central is built with a single `SITE_PACKAGE` (default
Careysburg, `distribution/backend/Dockerfile`). So central holds one facility root and none of
the other ~995.

The MFL API and data are profiled in
[`integration/dhis2/mfl/README.md`](../../integration/dhis2/mfl/README.md) (LE-318, read-only
probe on 27 September 2026). The facts this ADR relies on:

- DHIS2 **2.40.4.1**. Four levels: Country (1), County (2, 15 units), District (3, 106 units,
  of which 8 are not districts and hold no facilities) and Facility (4, 996 units).
- There are no DHIS2 attributes. Type, ownership, EmONC level and setting are **org unit
  groups**, and not all of them are exclusive: 6 facilities are both Clinic and Health Center,
  3 pair Private with another ownership, and 1 is both Rural and Urban. Group names carry
  typos and trailing spaces.
- **Only the DHIS2 UID is a reliable key.** Seven facilities have no code, five code pairs
  collide once trimmed, and six names occur twice nationally. OpenMRS 2.6.9 rejects a second
  active location with the same name, case-insensitively and regardless of parent.
- **There is no deletion signal** for this account (`/api/deletedObjects` returns 403). A move
  is recorded as a close plus a new UID, not as a reparent.
- 914 of the 996 `openingDate` values are `2000-*` placeholders.
- A full pull takes about 5 s and 775 KB.

Three existing rules constrain the design:

1. **Metadata is not synced** ([entity coverage](../architecture/sync-entity-coverage.md) §3).
   A location UUID that a facility references must already exist at central.
2. **Central is read-only for clinical data** ([sync-eip.md](../architecture/sync-eip.md) §1.8c).
   Locations are metadata, so a job writing them does not break this rule. It must still
   never touch a row the dbsync receiver applies.
3. **Initializer reapplies its files on every boot** (see `EmailService.resolveSecret`). A
   global property an operator is meant to edit must not be seeded from content.

## Decision

### 1. Location UUIDs are never rewritten; the `MFL UID` attribute is the match key

An existing location keeps its UUID for life. A location's MFL identity is held **only** in its
**`MFL UID`** attribute (decision 4), and the sync matches on that attribute alone. It never
matches on name, code or UUID.

- **Site roots are adopted by attribute.** Each site package declares its root's MFL UID in its
  locations CSV, in an Initializer `Attribute|MFL UID` column. When the sync meets that UID, it
  updates the existing row in place: same UUID, so facility-scoped identifiers (MOH HRN,
  uniqueness `LOCATION`) keep pointing where they did.
- **Matches, both pending MOH/site confirmation:**

  | Site package root | MFL unit | MFL name | Note |
  | --- | --- | --- | --- |
  | Barnersville Health Center | `kueVlXwUXiI` | Barnersville HC (`LBR-30-3014-03`) | |
  | Careysburg Health Center | `jbGSiLCEFKJ` | Careysburg Clinic (`LBR-30-3002-05`) | the MFL types it a **Clinic** (Public) |

- **An adopted root keeps its name and parent.** Content owns both, and the sync never renames
  or reparents an adopted row (decision 3). The site CSV gives each ward its parent **by name**,
  and Initializer reapplies that CSV. A sync rename would orphan the wards, and a sync reparent
  would be undone on the next reload. So *Careysburg Health Center* keeps that name and stays
  top-level. The sync still adds the MFL attributes, the `Health Facility` tag, coordinates and
  the county/district address fields. Until a match is confirmed, the site CSV carries no
  `MFL UID`, and the sync creates a separate row for that facility (see Consequences).
- **A row the sync creates gets `UUIDv5(namespace, MFL UID)`** under the fixed namespace
  `e0b0fbf7-045c-437a-8e7c-4504984c5e1a`. The name is the DHIS2 UID exactly as returned
  (UTF-8, case-sensitive). This is an internal detail, not an identity: nothing matches on it,
  and it is never applied to an existing row. It exists so that central, and any facility that
  runs the sync, create *the same* row for the same facility. Worked examples:
  `nY6mPgT0Kc6` → `7dd5a981-7e3a-59fa-b1fa-e1474e299da8`, `TSrmxt9mnrS` →
  `44a79c82-0b97-5487-8057-19ad9616f10e`. **The user may veto this** (see Consequences), in
  which case created rows take random UUIDs and nothing else in this ADR changes.

The first draft rewrote site-root UUIDs to the derived value, enforced that with a
`validate-content.sh` check, and adopted live roots through a `liberiaemr.mfl.uuidOverrides`
global property. **All three are withdrawn.** They traded a one-time UUID change for
consistency, and the user chose to keep internal UUIDs stable instead.

### 2. Central-only by default

The same module code runs everywhere. It is **available** only where MFL credentials are
configured (decision 6), and **enabled** by `liberiaemr.mfl.enabled`. Central gets the
credentials at deployment; facilities do not, so the sync is off at a facility and its admin
page hides itself. A facility that later needs other facilities as locations (referral or
transfer destinations) is given credentials. It then adopts its own root by `MFL UID` and
creates the rest with the same UUIDs as central.

### 3. What the sync writes, and to which rows

The sync pulls levels 2–4 and writes only to rows that carry an `MFL UID` attribute, or that
it creates. A row it did not create is **adopted**. The sync recognises a row it created because
that row's UUID is `UUIDv5(namespace, MFL UID)` (decision 1). On an adopted row the sync never
writes `name` or `parentLocation`; content owns them (decision 1). Every other rule in the table
applies to both kinds of row.

| MFL source | OpenMRS target | Rule |
| --- | --- | --- |
| `id` | attribute **MFL UID** | the match key |
| `code` | attribute **MFL Code** | trimmed; display and search only; never a key, never parsed; empty when missing |
| `name` | `Location.name` | created rows only; collapse runs of whitespace and trim; disambiguate as described below |
| `parent` | `Location.parentLocation` | created rows only; **counties are top-level**, and no Country location is created; reparent when it changes |
| `level` | tag **County** / **District** / **Health Facility** | existing national tags; the sync only adds tags, never removes one |
| level 3 with no facilities | not created | the 6 `CHT - …` units, *Medicine Stores* and *Pharmacy* |
| `geometry` Point `[lon, lat]` | `Location.longitude` / `latitude` | level 4 only; empty when missing; the run log warns when a point is outside Liberia |
| county and district names | `stateProvince` / `countyDistrict`, `country = Liberia` | `address1` and `cityVillage` stay local |
| type groups | attribute **Facility Type** | tie-break below |
| ownership groups | attribute **Facility Ownership** | tie-break below |
| EmONC groups | attribute **EmONC Level** | tie-break below |
| setting groups | attribute **Facility Setting** | tie-break below |
| `closedDate` | attribute **MFL Closed Date** + retire | decision 5 |
| `lastUpdated` | attribute **MFL Last Updated** | diagnostics and change reporting only |
| `openingDate` | **not mapped** | 914 of 996 are placeholders |
| `shortName`, `path`, service/programme groups | **not mapped** | the ~36 *Facilities Rendering …* groups, CRDF and EPI OSDV are out of v1 |

**Name disambiguation.** A name that clashes, case-insensitively, with another *active*
location gets ` (<District name>)` appended. Clashes are counted against the whole pull plus the
instance's non-MFL locations.

- When several MFL units share a name, **every one of them** gets the suffix. That keeps the
  outcome the same on every instance and independent of processing order.
- When an MFL name clashes only with a local location, the MFL row gets the suffix.
- A **closed** unit is suffixed whenever anything else shares its name, open or closed.
  OpenMRS refuses to save even a retired location under an active one's name. So of *Jamaica
  Rd Clinic* (closed, Bushrod) and its reopened namesake (Somalia Drive), only the closed one
  becomes *Jamaica Rd Clinic (Bushrod District)*.
- The suffix goes as soon as the clash does.
- Today five active pairs need it, for example *Agape Clinic (Suakoko)* and *Agape Clinic
  (Gar-Bain District)*. No MFL name collides with a content-package location.

**Groups are mapped by group UID, never by name.** The mapping is configuration in the module;
the UIDs are recorded in the LE-318 mapping table.

| Attribute | Groups (UID) | When a facility is in more than one |
| --- | --- | --- |
| Facility Type | Hospital `oj9yiq3uMLI`, Health Center `EltS2EPR5gR`, Clinic `cLPxlR1Brv9` | Hospital > Health Center > Clinic |
| Facility Ownership | Public `xSUk0MvIAUh`, Private `lIYtHp5tvaG`, Faith Based `h4oGe3jDqml`, Concession `r4GnS2GDzJO` | Private paired with another → the other wins; any other pair → empty, with a warning |
| EmONC Level | BemONC `lAnbydCDQwW` → `BEmONC`, CEmONC `M8CdHRhgkwW` → `CEmONC` | CEmONC > BemONC |
| Facility Setting | Rural `W1RG9PaTxzr`, Urban `L7IimdCGSjT` | left empty, with a warning |

Every conflict, whether resolved or left empty, is **logged as a warning on the run item**
(see the API). An attribute is empty when the facility is in none of its groups.

**Local, never written:** `description`, `address1`, `cityVillage`, every other tag (Login,
Visit, Queue and so on), every non-MFL attribute, and all child locations (wards, OPD,
laboratory, …). The receiver never writes location rows, so this job and the receiver cannot
conflict.

### 4. Location attribute types (canonical)

`content-liberia-national` creates these (LE-320), declared once in `variables.properties`.
The backend (LE-321) looks them up by these UUIDs.

| Name | UUID | Datatype |
| --- | --- | --- |
| MFL UID | `06568ddd-cc3b-4957-ad92-17e7249106c1` | FreeText, 1..1 on MFL rows |
| MFL Code | `3118cabe-9a5d-420c-8a55-86234deb9b1b` | FreeText |
| Facility Type | `98dd0863-47bd-4038-9759-16ebe6c9d51b` | SpecifiedTextOptions: Hospital, Health Center, Clinic |
| Facility Ownership | `a75cb46c-dd20-42eb-abe5-94fed07bc059` | SpecifiedTextOptions: Public, Private, Faith Based, Concession |
| EmONC Level | `827bd8d1-053e-4441-88aa-fb9cac44a60a` | SpecifiedTextOptions: BEmONC, CEmONC |
| Facility Setting | `4880dd80-2b53-4dcf-aba9-5be5bd79c981` | SpecifiedTextOptions: Rural, Urban |
| MFL Closed Date | `7d15cde2-fa20-4b98-acd0-be2dbd3597aa` | Date |
| MFL Last Updated | `a7c23ee9-dabd-4605-b039-325b2303850f` | FreeText (ISO datetime) |

All are max 1 per location. "1..1 on MFL rows" is enforced by the sync, not by the type:
`minOccurs` stays 0, because non-MFL locations (wards, departments) have no MFL UID. The
datatype classes are `FreeTextDatatype`, `SpecifiedTextOptionsDatatype` (config: the
comma-separated options above) and `DateDatatype`. The site packages load after national, so
their `Attribute|MFL UID` column resolves.

### 5. Closure and disappearance retire; nothing is purged

- **`closedDate` set:** set `MFL Closed Date` and retire, with reason
  `MFL: closed <yyyy-mm-dd>`.
- **Absent from the pull:** retire, with reason `MFL: not in the MFL since <run date>`. There is
  no deletion signal, so absence is the only one.
- **Moves.** The MFL records a move as the old unit closing and a new unit, with a new UID and
  code, appearing elsewhere (*Jamaica Rd Clinic*, Bushrod → Somalia Drive). We hold that as a
  retired row plus a new row, and records stay on the old one. We do not try to link the two.
- **Completeness guard.** Retirement by absence is skipped, and the run ends `PARTIAL` with a
  message, when:
  - any page of the pull failed, or
  - the pull holds fewer than 90% of the active MFL locations this instance already has.

  Creates and updates still apply.
- **Reopening:** a unit that returns is un-retired only if its retire reason starts with
  `MFL:`. The sync never reverses a human's retirement.
- **This instance's own root is never retired automatically.** A row that carries an MFL UID
  and is the parent of this instance's login locations gets an item error instead, and a person
  decides.

### 6. Tags: the switcher at central filters on `Health Facility`

Facilities the sync **creates** get `Health Facility` and **not** `Login Location`. An
**adopted** site root keeps the `Login Location` tag its site CSV gives it, because the sync only
adds tags and never removes one (decision 4). The site's own staff log in there, so the tag has
to stay. The central switcher does not depend on `Login Location` either way: it filters on
`Health Facility`, which adopted and created facilities both carry. LE-324 replaces the
login app gains a string setting, `chooseLocation.locationTag`, alongside the existing boolean
`chooseLocation.useLoginLocationTag`. It is empty by default, and when empty the boolean applies
exactly as before, so facilities are unaffected. Central's `config-central.json` (ADR 0011)
sets it to `Health Facility`. The switcher shows the MFL code and district next to each name.
For an adopted root, which has no District parent, the district comes from its `countyDistrict`
address field.

### 7. Credentials come from the environment or a password file only

These follow the SMTP relay pattern, without its global-property fallback, because global
properties are readable over REST.

| Setting | Source | Editable in the UI |
| --- | --- | --- |
| Username | env `LIBERIAEMR_MFL_USERNAME` | no; the UI shows it |
| Password | env `LIBERIAEMR_MFL_PASSWORD_FILE` (a path, read verbatim, preferred), else `LIBERIAEMR_MFL_PASSWORD` | no; never returned by any endpoint, never logged |
| Allowed MFL hosts | env `LIBERIAEMR_MFL_ALLOWED_HOSTS`, default `dhis2.moh.gov.lr` | no. The base URL is editable, so the credentials go only to a host on this list, checked on save and before every request ([API](../architecture/mfl-sync-api.md#allowed-mfl-hosts)) |
| Base URL | GP `liberiaemr.mfl.url`, default `https://dhis2.moh.gov.lr/mfl` | yes |

`distribution/compose/{central,facility}/docker-compose.yml`, under `backend.environment`:

```yaml
      # MFL sync (liberiaemr module, ADR 0009). Credentials are deployment secrets:
      # mount the password file and leave the plain variable empty. Unset = MFL sync
      # unavailable on this instance, and the admin page hides itself.
      LIBERIAEMR_MFL_USERNAME: ${LIBERIAEMR_MFL_USERNAME:-}
      LIBERIAEMR_MFL_PASSWORD: ${LIBERIAEMR_MFL_PASSWORD:-}
      LIBERIAEMR_MFL_PASSWORD_FILE: ${LIBERIAEMR_MFL_PASSWORD_FILE:-}
```

- Empty placeholders go in `distribution/env/*.env.example`.
- These are separate from the `DHIS2_*` variables, which belong to the HMIS export.
- `scripts/validate/no-secrets.sh` only flags a value of 12 or more characters from
  `[A-Za-z0-9/+_-]` after a `password` key. It is a backstop, not a guarantee.

### 8. A full pull on every run, daily

Every run pulls the whole MFL (levels 2–4 and the groups) and diffs locally. There is no
incremental mode. `lastUpdated` filtering exists, but it cannot see deletions or confirm group
changes, and a full pull costs only about 5 s. The sync pages at `pageSize=500`.

| Global property | Default | Meaning |
| --- | --- | --- |
| `liberiaemr.mfl.enabled` | `false` | the schedule runs only when true; manual runs are allowed whenever the sync is available |
| `liberiaemr.mfl.url` | `https://dhis2.moh.gov.lr/mfl` | the instance root, without `/api` |
| `liberiaemr.mfl.schedule.time` | `02:00` | local time (`Africa/Monrovia`) of the daily run |

- These properties are declared in the module's `config.xml` and are **not** seeded by any
  Initializer file (rule 3).
- There is one scheduler task, `LiberiaEMR MFL Sync`, registered and rescheduled the way
  `IdentitySchedule` does it.
- Runs never overlap: a second request is refused, not queued.
- Level and group filters are not offered. Central must hold the whole list.

### 9. The admin UI is a route in `esm-liberia-sync-status-app`

The route is `mfl-sync`, with its own app menu item and a link from the sync status page. It
serves the same audience as that app, shows no clinical data, and reuses its
hide-when-unavailable pattern. It must **not** declare a `liberiaemr` `backendDependency`,
because CI stamps the module `0.0.0-ci`.

### 10. The REST contract

The contract is [`docs/architecture/mfl-sync-api.md`](../architecture/mfl-sync-api.md). The
TypeScript types are in
[`packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts`](../../packages/esm-liberia-sync-status-app/src/mfl-sync/mfl-sync.types.ts).
Where the two disagree, the document wins.

## Consequences

- Central gets every MFL facility without depending on which site packages it was built with.
- **Existing UUIDs are stable.** No site package UUID changes, before or after go-live, and no
  validator or override mechanism is needed.
- **Central must hold each live facility's site root *before* its first MFL sync.** A
  facility's root has a site-package UUID, and records synced from that facility reference it.
  If central is built without that facility's locations CSV:
  - the facility's records reference a UUID central lacks, which is the existing gap in
    [entity coverage](../architecture/sync-entity-coverage.md) §3;
  - the sync creates a *second* row for the same facility, with a v5 UUID.

  So central needs every live site's location rows, children included; the MFL has no
  departments. If a root arrives after the sync already created its row, two rows hold one
  `MFL UID`. The sync must then report an item error, not pick one, and the runbook (LE-325)
  must describe retiring the sync-created row. How central loads every site's locations needs
  its own decision; it is out of scope here.
- **Deriving v5 UUIDs for created rows (decision 1) is open to the user's veto.** With it, central
  and a facility that runs the sync hold the same row for every non-root facility, so a future
  referral or transfer location synced from a facility resolves at central. Without it, those
  rows differ between instances, and any record referencing one fails at central's receiver.
  The derived UUID is also how the sync tells a row it created from an adopted one (decision 3).
  A veto would need another marker for that, such as a sync-owned attribute.
- Adopted site roots keep their local names and stay top-level, so users see no change at the
  login screen. At central, the switcher lists *Careysburg Health Center* under Careysburg
  District through its address field, although the MFL calls it *Careysburg Clinic*. Its MFL
  code is shown next to the name.
- The MFL becomes a runtime dependency of central's location metadata. If the MFL is
  unreachable, runs fail and the cached list stays as it is.
- A facility the MOH deletes and re-creates, or moves, gets a new UID. We keep a retired row
  and a new one.
- The ~1,100 MFL locations enlarge location queries at central. LE-324 checks the switcher's
  performance, and LE-325 checks that queues, appointments and wards are unaffected (none of
  them filters on `Health Facility`).

## Decision record

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | UUIDs kept; `MFL UID` attribute is the match key; site roots adopted by CSV attribute, keeping their name and parent | **Accepted**, reversing the first draft. The v5 UUIDs for created rows are accepted subject to veto |
| 2 | Central-only by default | **Accepted** |
| 3 | Field ownership, name disambiguation, group tie-breaks by UID, no `openingDate`, counties top-level | **Accepted** (from LE-318) |
| 4 | Canonical attribute types | **Accepted** |
| 5 | Retire on close or absence, guard on a failed page or a pull under 90%, moves as close + new | **Accepted** (from LE-318) |
| 6 | Switcher filters on `Health Facility`; rows the sync creates get no `Login Location`, adopted roots keep theirs | **Accepted** |
| 7 | Credentials from env or a password file only | **Accepted** |
| 8 | Full pull on every run; operator settings in `config.xml`, not Initializer | **Accepted** (from LE-318) |
| 9 | Admin route in `esm-liberia-sync-status-app` | **Accepted** |
| – | Service and programme groups | **Out of v1** |

**Still pending:** MOH or site confirmation of the two site-root matches in decision 1.
