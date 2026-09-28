# Master Facility List (MFL) — API exploration and location mapping

The MOH Master Facility List runs in a DHIS2 instance of its own, separate from the
reporting DHIS2 in [`../mappings/`](../mappings/README.md). LiberiaEMR caches it as OpenMRS
`Location`s. This page records how the API behaves, what the data looks like, and the field
mapping this exploration proposed for the sync. [ADR 0009](../../../docs/adr/0009-mfl-facility-locations.md)
decides the mapping, and LE-321 implements it. Where this page and the ADR differ, the ADR
wins. Every figure below comes from a read-only probe on
**2026-09-27**. Re-run it with [`probe.sh`](probe.sh):

```bash
MFL_BASE_URL=https://dhis2.moh.gov.lr/mfl MFL_USERNAME=… MFL_PASSWORD=… ./probe.sh
```

The script takes the credentials from the environment and passes them to curl on stdin, so
they never reach argv or the script's output. It makes GET requests only. The credentials are
a deployment secret: they belong nowhere in this repository.

## The instance

| | |
| --- | --- |
| Base URL | `https://dhis2.moh.gov.lr/mfl/api` |
| Version | DHIS2 **2.40.4.1** (revision `a1aa81b`) |
| Account | role *Integration API Reader*, scoped to the root org unit `Liberia` (`LHNiyIWuLdc`), so it sees the whole tree |
| Auth | HTTP basic |
| Custom attributes | **none**: `/api/attributes` is empty, and every org unit's `attributeValues` is `[]` |

| Level | Name | Count |
| --- | --- | --- |
| 1 | Country | 1 (`Liberia`) |
| 2 | County | 15 |
| 3 | District | 106, of which **8 are not districts** (see below) |
| 4 | Facility | 996 |

Every facility's parent is a level-3 unit, and every level-3 unit's parent is a county. The
tree is regular.

## Endpoints the sync uses

All GET. Pass `-g` to curl, or URL-encode `[` `]`: without it curl treats the field
selector `parent[id]` as a glob and exits with status 3 before sending anything.

```text
# Administrative levels (country, counties, districts), without polygons
/api/organisationUnits.json?filter=level:le:3&paging=false
    &fields=id,code,name,shortName,level,path,parent[id],openingDate,closedDate,lastUpdated

# Facilities, with their point and their group memberships
/api/organisationUnits.json?filter=level:eq:4&paging=false
    &fields=id,code,name,shortName,level,path,parent[id],openingDate,closedDate,lastUpdated,geometry,organisationUnitGroups[id]

# Groups (type, ownership, EmONC, setting are groups, not attributes)
/api/organisationUnitGroups.json?fields=id,name,code,groupSets[id]&paging=false
/api/organisationUnitGroupSets.json?fields=id,name,organisationUnitGroups[id,name]&paging=false

# Incremental (see below for why the sync should not rely on it)
/api/organisationUnits.json?filter=lastUpdated:ge:2026-06-01&fields=id,lastUpdated&paging=false
```

### Size, paging and timing

| Request | Bytes | Time |
| --- | --- | --- |
| All 1,118 units **with** geometry | 1.34 MB | 3.8 s |
| Levels 1–3, no geometry | 31 KB | 1.5 s |
| Level 4 with point geometry and groups | 744 KB | 2.9 s |
| Groups | 5 KB | 1.2 s |

A full pull is two requests of about 775 KB in total, in about 5 s. County and district
geometries are polygons and make up most of the 1.34 MB, so leave `geometry` out below
level 4.

The default page size is 50. `paging=false` works for the whole tree, and so does
`pageSize=5000`. The sync should still page, at `pageSize=500` (for example), so a much larger
MFL does not arrive as one response. Every paged response carries `pager.pageCount`.

### Incremental pulls

`filter=lastUpdated:ge:<date>` works: it returned 64 units since 2026-06-01 and none since
2026-09-01. It cannot be the only mechanism, for two reasons:

- It cannot see deletions (see the next section).
- Group membership is stored on the group. Whether adding a facility to *Hospital* bumps the
  facility's own `lastUpdated` was **not verified**, because we are read-only.

A full pull costs about 5 s and 775 KB, so **pull everything on every run** and diff
locally. Keep `lastUpdated` for reporting what changed, not for choosing what to fetch.

### Deletion signal: none, diff by absence

`/api/deletedObjects?klass=OrganisationUnit` returns **HTTP 403 Access is denied** for this
account. The sync therefore has to diff by absence: a unit we hold that is missing from a
complete pull is gone. We retire it, never purge it, because encounters and identifiers
reference it. Retiring on absence is safe only when the pull is known to be complete. So
abort the retire step if any page failed, or if the count drops sharply against the last run
(for example, below 90% of it).

Closures are visible: `closedDate` is returned and filterable (`filter=closedDate:!null`).
Exactly one facility is closed: *Jamaica Rd Clinic* in Bushrod District (`ucTzZhF5okn`),
closed 2026-04-01. A clinic with the same name opened on 2026-01-01 in Somalia Drive District
(`ZktsAIReh6z`), with a new UID and a new code. **The MFL records a move as close + new, not
as a reparent.**

## Data-quality profile (facilities, level 4)

| Finding | Count | Consequence for the sync |
| --- | --- | --- |
| Name has leading or trailing whitespace | 10 | trim |
| Name has a double space | 18 | collapse runs of whitespace |
| Duplicate name **within** a district (after normalising, case-insensitive) | **0** | |
| Duplicate name **nationally** | **6** names (12 units; 11 active) | OpenMRS rejects them (see below) |
| No `code` | 7, including *John F. Kennedy Medical Center* and *JJ Dossen Hospital* | code cannot be required |
| Code has leading or trailing whitespace | 17 | trim |
| Codes that collide once trimmed | **5 pairs** (e.g. `LBR-06-0602-02` is *Haindi Clinic*, `LBR-06-0602-02␠` is *Degei Clinic*) | **code is not a key** |
| Code not in the form `LBR-CC-DDDD-NN` | 41 (3-digit district parts, `LBR-39--3930-0`, one code that is literally `Lukasu Clinic`) | store as is; never parse |
| No geometry | 111 | leave lat/long empty |
| Point outside Liberia's bounding box | 1 (*Nekeborzu clinic*, lat 9.05) | store, warn in the run log |
| `closedDate` set | 1 | retire |
| `openingDate` is a `2000-*` placeholder | 914 of 996 | not worth storing |
| `shortName` differs from `name` | 15, all truncations | ignore `shortName` |
| Longest name | 65 chars | fits `location.name` (255) |

County codes (`03` Bomi … `42` River Gee) match the `CC` part of every well-formed facility
code.

**Level-3 units that are not districts:** six County Health Team units (`CHT - Bong`,
`CHT - Grand Cape Mount`, `CHT - Grand Gedeh`, `CHT - Lofa`, `CHT - Nimba`, `CHT - River Gee`),
plus `Medicine Stores` and `Pharmacy` under Montserrado. None of the eight has a facility.
Nine level-3 units have no `code`: those eight non-districts and one real district, *Bushrod
District*. One district,
*Tarsue District*, belongs to a service group. Groups are only meaningful at level 4.

### Name uniqueness: OpenMRS rejects the national duplicates

In openmrs-api 2.6.9 (the platform `modules/liberiaemr` builds against), `LocationValidator`
calls `LocationService.getLocation(name)` and rejects a location with
`location.duplicate.name` when another **non-retired** location already has that name. The
lookup is by name alone, not by parent, and the MySQL collation makes it case-insensitive.
Six MFL names occur twice nationally:

| Name | Where |
| --- | --- |
| Agape Clinic | Suakoko (Bong), Gar-Bain District (Nimba) |
| Fredai Medical Clinic / FREDAI Medical Clinic | Careysburg District, Somalia Drive District |
| Jamaica Rd Clinic | Bushrod District (closed), Somalia Drive District |
| Juduken Clinic | Barrobo Whojah District, Barclayville District |
| Newaken Clinic / Newaken␠␠Clinic | Barrobo Whojah District (Maryland), Trehn District (Grand Kru); a duplicate only once whitespace is collapsed |
| Tubmanville Clinic | Buchanan District, Kpanyan District |

Five of these pairs have both units active, so the sync needs a disambiguation rule. None of
today's MFL names collides with a location name in any content package.

## Group sets and groups

Facility type, ownership, EmONC level and setting are **org unit groups**. There are no
attributes. The group sets do not model them as dimensions: every set holds exactly one group
(only *Facilities Rendering ANC Services* holds two, itself and *BemONC Facilities*). So "one
group per set" says nothing about exclusivity. The data does:

| Dimension (groups) | Facilities per combination | Exclusive? |
| --- | --- | --- |
| Type: Hospital / Health Center / Clinic | Clinic 701, none 165, Health Center 83, Hospital 41, **Clinic+Health Center 6** | no: 6 in two |
| Ownership: Public / Private / Faith Based / Concession Facilities | Public 494, Private 260, none 163, Faith Based 61, Concession 15, **Private+Public 1, Private+Faith Based 1, Private+Concession 1** | no: 3 in two, always Private plus a more specific one |
| EmONC: BemONC / CEmONC Facilities | BemONC 648, none 311, CEmONC 37 | yes |
| Setting: Rural / Urban Facilities | Rural 489, Urban 344, none 162, **both 1** | no: 1 in both |

The facilities in two type groups are *Cavalla Rubber Plantation Medical Center*,
*JAHMALE Medical Solutions*, *Kesselee Memorial Health Center*,
*Patience Frist Medical Center*, *Soniwen Health Center* and *THT Health Center*.

Group sets (13, none compulsory): BemONC Facilities, CEmONC Facilities, Clinic, Concession
Facilities, Facilities Rendering ANC Services, Faith Based Facilities, Health Center, Hospital,
Private Facilities, Public Clinics, Public Facilities, Public Health Centers, Public Hospitals.

Groups (61). The counts are facilities in each group; 48 groups sit in no set.

- **Type:** Hospital 41, Health Center 89, Clinic 707.
- **Ownership:** Public Facilities 495, Private Facilities 263, Faith Based Facilities 62,
  Concession Facilities 16.
- **Ownership × type:** Public / Private / Faith Based / Concession × Hospitals / Health
  Centers / Clinics. These repeat the two dimensions above.
- **EmONC:** BemONC Facilities 648, CEmONC Facilities 37.
- **Setting:** Rural Facilities 490, Urban Facilities 345 (the name has a trailing space).
- **Programme lists:** List of CRDF Facilities 475, # EPI OSDV Facility Visited 41.
- **Services:** 36 *Facilities Rendering …* groups (counting *Facliities Immunization
  Services*), from ANC (981) to OPD (61). Five have no members. Several names carry trailing spaces or typos (*Facliities Immunization Services*,
  *Facilities' Rendering PMTCT Services*).

Map groups **by UID, never by name**: the names carry trailing spaces and typos. Treat the
UIDs in the mapping table below as configuration, not code.

## Seeded site roots and their MFL match

The two site packages seed a facility root that facility-scoped identifiers point at. Their
likely MFL counterparts are listed below. Both matches **need confirmation from the MOH or
the site team** before the sync adopts them.

Adoption never changes a root's UUID: facility-scoped identifiers, child locations and synced
records all point at it. Each site package declares its root's MFL UID in an
`Attribute|MFL UID` column of its locations CSV (LE-320), and the sync matches existing
locations on that attribute, never on the UUID ([ADR 0009](../../../docs/adr/0009-mfl-facility-locations.md) §1).

| Site package root | Likely MFL unit | Note |
| --- | --- | --- |
| Barnersville Health Center | `kueVlXwUXiI` *Barnersville HC*, `LBR-30-3014-03`, Somalia Drive District, Montserrado | name is an abbreviation |
| Careysburg Health Center | `jbGSiLCEFKJ` *Careysburg Clinic*, `LBR-30-3002-05`, Careysburg District, Montserrado | the MFL types it **Clinic** (Public). The only health centre in the district is *Kesselee Memorial Health Center* (Private), so this is the likelier match |

## Field mapping

`MFL UID` is the only reliable key. Codes are missing, duplicated and malformed, and names
repeat nationally.

| MFL field | OpenMRS | Datatype / cardinality | Rule |
| --- | --- | --- | --- |
| `id` (UID) | attribute **MFL UID** | FreeText, 1..1 on every MFL-managed location | The join key: existing locations are matched on it, never on UUID, and keep their UUIDs. Only a location the sync **creates** gets a UUID derived from it (ADR 0009 §1) |
| `code` | attribute **MFL Code** | FreeText, 0..1 | Trimmed. For display and search only; never a key and never parsed |
| `name` | `Location.name` | | Collapse whitespace and trim. If the name collides with another active location, suffix ` (<district name>)`. ADR 0009 §3 gives the exact rule |
| `shortName` | not mapped | | Only differs by truncation |
| `level` 1 | not created | | Counties are top-level (ADR 0009 §3) |
| `level` 2 | tag **County** | exists in `content-liberia-national` | |
| `level` 3 | tag **District** | exists | Skip level-3 units with no facilities: the 6 CHTs, *Medicine Stores* and *Pharmacy* |
| `level` 4 | tag **Health Facility** | exists | |
| `parent.id` | `Location.parentLocation` | | Reparent when it changes |
| `geometry` (Point, `[lon, lat]`) | `Location.longitude`, `Location.latitude` | built-in | Mind the order. Level 4 only; empty when missing; warn when outside the bounding box |
| groups Hospital `oj9yiq3uMLI`, Health Center `EltS2EPR5gR`, Clinic `cLPxlR1Brv9` | attribute **Facility Type** | SpecifiedTextOptions `Hospital,Health Center,Clinic`, 0..1 | When a facility is in two groups, the higher level wins (Hospital > Health Center > Clinic) and the run log warns. Empty when in none (165) |
| groups Public `xSUk0MvIAUh`, Private `lIYtHp5tvaG`, Faith Based `h4oGe3jDqml`, Concession `r4GnS2GDzJO` Facilities | attribute **Facility Ownership** | SpecifiedTextOptions `Public,Private,Faith Based,Concession`, 0..1 | When Private is paired with another group, the other one wins (all 3 conflicts are that shape). Empty when in none (163) |
| groups BemONC `lAnbydCDQwW` / CEmONC `M8CdHRhgkwW` Facilities | attribute **EmONC Level** | SpecifiedTextOptions `BEmONC,CEmONC`, 0..1 | Exclusive in the data. If both ever appear, CEmONC wins |
| groups Rural `W1RG9PaTxzr` / Urban `L7IimdCGSjT` Facilities | attribute **Facility Setting** | SpecifiedTextOptions `Rural,Urban`, 0..1 | Left empty when a facility is in both (1), with a warning |
| ownership × type groups | not mapped | | Repeat the two attributes above |
| *Facilities Rendering …*, CRDF, EPI OSDV | **out of scope for v1** | | Programme and reporting flags. If needed later: one attribute **MFL Service**, FreeText, 0..n |
| `openingDate` | not mapped | | 914 of 996 are `2000-*` placeholders |
| `closedDate` | `Location.retired` + `retireReason`, and attribute **MFL Closed Date** | Date, 0..1 | Retire reason as in ADR 0009 §5. A later reopen un-retires |
| absent from a complete pull | `Location.retired` + `retireReason` | | `No longer in the MFL`, subject to the completeness guard above |
| `lastUpdated` | attribute **MFL Last Updated** | FreeText (ISO-8601), 0..1 | Diagnostics and "unchanged" reporting, not fetch selection |
| `created`, `path`, `attributeValues` | not mapped | | `path` is derivable; `attributeValues` is always empty |

The UIDs in the table are group UIDs, not group-set UIDs. Every other group's UID is in [`fixtures/organisationUnitGroups.json`](fixtures/organisationUnitGroups.json)
and in the live `/api/organisationUnitGroups`.

## Fixture

[`fixtures/`](fixtures) holds real, unmodified MFL records in the shape the API returns them,
so a stub server can serve them as they are. MFL data is the public facility registry: it
contains no patient data and no credentials.

- `organisationUnits.json`: the country root, 2 counties (Montserrado, Bong), 6 level-3 units,
  and 16 facilities. County and district polygons are replaced by a placeholder string; the
  sync never fetches geometry above level 4.
- `organisationUnitGroups.json`: the 47 groups those facilities belong to.
- `organisationUnitGroupSets.json`: the group sets that reference them.

| Edge case | Unit(s) |
| --- | --- |
| Leading / trailing whitespace in name | ` Jah Clinic` (Kpaai), `Liberia Center for Infectious Disease ` (Bushrod) |
| Closed facility | *Jamaica Rd Clinic* `ucTzZhF5okn` (Bushrod) |
| Same name, other district, active (a move recorded as close + new) | *Jamaica Rd Clinic* `ZktsAIReh6z` (Somalia Drive) |
| National duplicate name, differing case | *Fredai Medical Clinic* (Careysburg) / *FREDAI Medical Clinic* (Somalia Drive) |
| No code | *City Lab Clinic* (Bushrod) |
| Codes that collide once trimmed | *Degei Clinic* / *Haindi Clinic* (Fuamah) |
| No geometry | *Come & See Clinic* (Careysburg) |
| In both Clinic and Health Center | *Kesselee Memorial Health Center*, *JAHMALE Medical Solutions* |
| Hospital | *Bensonville Hospital* |
| Many service groups | *A Refuge Place int'l,* (the trailing comma is in the MFL) |
| Level-3 unit that is not a district | *CHT - Bong* |
| Site-root candidates | *Barnersville HC*, *Careysburg Clinic* |

**Not covered.** No fixture facility is in the Faith Based (`h4oGe3jDqml`) or Concession
(`r4GnS2GDzJO`) ownership groups, and neither group record is in `organisationUnitGroups.json`.
The LE-321 mapper unit tests cover Faith Based with synthetic units. Concession has no test
yet. The fixture is left as it is, because the QA stub (LE-325) and the backend tests assert its
counts.
