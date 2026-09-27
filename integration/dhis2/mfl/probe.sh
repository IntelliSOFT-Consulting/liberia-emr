#!/usr/bin/env bash
# Read-only probe of the MOH Master Facility List (DHIS2). Reproduces the figures in
# README.md: API version, org units per level, pull size and time, incremental filtering,
# deletion-signal access, and the data-quality profile.
#
#   MFL_BASE_URL=https://dhis2.moh.gov.lr/mfl MFL_USERNAME=... MFL_PASSWORD=... ./probe.sh
#
# Credentials come only from the environment. They are handed to curl on stdin (-K -), so
# they never appear in argv, in `ps`, or in this script's output. GET requests only.
set -euo pipefail

: "${MFL_BASE_URL:?set MFL_BASE_URL, e.g. https://dhis2.moh.gov.lr/mfl}"
: "${MFL_USERNAME:?set MFL_USERNAME}"
: "${MFL_PASSWORD:?set MFL_PASSWORD}"
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

API="${MFL_BASE_URL%/}/api"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# curl config on stdin: escape backslashes and double quotes for curl's quoted-string syntax.
esc() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }
CURL_AUTH="user = \"$(esc "$MFL_USERNAME"):$(esc "$MFL_PASSWORD")\""

# get <name> <path?query>  — saves $OUT/<name>.json, prints status, bytes and seconds.
# -g stops curl globbing the [ ] in DHIS2 field selectors (without it curl exits 3).
get() {
  printf '  %-12s ' "$1"
  printf '%s\n' "$CURL_AUTH" | curl -K - -g -sS -m 300 -o "$OUT/$1.json" \
    -w "HTTP %{http_code}  %{size_download} bytes  %{time_total}s\n" "$API/$2"
}

FAC_FIELDS='id,code,name,shortName,level,path,parent[id],openingDate,closedDate,lastUpdated,geometry,organisationUnitGroups[id]'
ADMIN_FIELDS='id,code,name,shortName,level,path,parent[id],openingDate,closedDate,lastUpdated'
# The README's incremental figure (64 units) is for this fixed date; override with MFL_SINCE.
SINCE="${MFL_SINCE:-2026-06-01}"

echo "== requests"
get system       "system/info.json?fields=version,revision,serverDate"
get me           "me.json?fields=username,userRoles[name],organisationUnits[id,name,level]"
get levels       "organisationUnitLevels.json?fields=level,name&paging=false"
get all_geo      "organisationUnits.json?fields=$FAC_FIELDS&paging=false"
get facilities   "organisationUnits.json?fields=$FAC_FIELDS&filter=level:eq:4&paging=false"
get admin        "organisationUnits.json?fields=$ADMIN_FIELDS&filter=level:le:3&paging=false"
get groups       "organisationUnitGroups.json?fields=id,name,code,groupSets[id]&paging=false"
get groupsets    "organisationUnitGroupSets.json?fields=id,name,compulsory,organisationUnitGroups[id,name]&paging=false"
get incremental  "organisationUnits.json?fields=id,lastUpdated&filter=lastUpdated:ge:$SINCE&paging=false"
get closed       "organisationUnits.json?fields=id,name,closedDate&filter=closedDate:!null&paging=false"
get deleted      "deletedObjects.json?klass=OrganisationUnit&pageSize=50"
get page_default "organisationUnits.json?fields=id"
get page_500     "organisationUnits.json?fields=id&pageSize=500"
get page_5000    "organisationUnits.json?fields=id&pageSize=5000"

OUT="$OUT" SINCE="$SINCE" python3 - <<'PY'
import collections, json, os, re
d = os.environ['OUT']
def load(n):
    try: return json.load(open(f'{d}/{n}.json'))
    except Exception: return None
sysinfo, me = load('system'), load('me')
print('\n== server'); print(f"  DHIS2 {sysinfo.get('version')} ({sysinfo.get('revision')}), user roles: {[r['name'] for r in (me or {}).get('userRoles', [])]}")
ous = load('admin')['organisationUnits'] + load('facilities')['organisationUnits']
byid = {o['id']: o for o in ous}
groups = {g['id']: g['name'].strip() for g in load('groups')['organisationUnitGroups']}
fac = [o for o in ous if o['level'] == 4]
print('\n== org units per level'); lv = {l['level']: l['name'] for l in load('levels')['organisationUnitLevels']}
for k, v in sorted(collections.Counter(o['level'] for o in ous).items()): print(f'  {k} {lv.get(k, "?"):10} {v}')
print('\n== paging (pager metadata)')
for name in ('page_default', 'page_500', 'page_5000'):
    r = load(name) or {}
    p = r.get('pager', {})
    print(f"  {name:12} pageSize={p.get('pageSize')} pageCount={p.get('pageCount')} total={p.get('total')} rows={len(r.get('organisationUnits', []))}")
inc = load('incremental')
print(f"\n== incremental: {len(inc['organisationUnits'])} units with lastUpdated >= {os.environ['SINCE']}")
print(f"== closed: {[(o['name'], o['closedDate'][:10]) for o in load('closed')['organisationUnits']]}")
dele = load('deleted') or {}
print(f"== deletedObjects: {'HTTP ' + str(dele.get('httpStatusCode')) + ' ' + dele.get('message', '') if 'httpStatusCode' in dele else str(len(dele.get('deletedObjects', []))) + ' visible'}")
print('\n== data quality (facilities, level 4)')
n = lambda o: o['name']
kids = collections.Counter(o['parent']['id'] for o in fac)
rows = [
    ('name has leading/trailing whitespace', [n(o) for o in fac if n(o) != n(o).strip()]),
    ('name has a double space', [n(o) for o in fac if '  ' in n(o)]),
    ('no code', [n(o) for o in fac if not o.get('code')]),
    ('code has leading/trailing whitespace', [n(o) for o in fac if o.get('code') and o['code'] != o['code'].strip()]),
    ('code not LBR-CC-DDDD-NN', [o['code'] for o in fac if o.get('code') and not re.fullmatch(r'LBR-\d\d-\d{4}-\d\d', o['code'].strip())]),
    ('no geometry', [n(o) for o in fac if not o.get('geometry')]),
    ('point outside Liberia bbox', [n(o) for o in fac if o.get('geometry', {}).get('type') == 'Point' and not (-11.7 <= o['geometry']['coordinates'][0] <= -7.3 and 4.3 <= o['geometry']['coordinates'][1] <= 8.6)]),
    ('closedDate set', [n(o) for o in fac if o.get('closedDate')]),
    ('openingDate is a 2000-* placeholder', [n(o) for o in fac if o.get('openingDate', '').startswith('2000-')]),
    ('level-3 unit with no facilities', [n(o) for o in ous if o['level'] == 3 and not kids.get(o['id'])]),
    ('non-level-4 unit in a group', [n(o) for o in load('all_geo')['organisationUnits'] if o['level'] != 4 and o.get('organisationUnitGroups')]),
]
for label, items in rows: print(f'  {len(items):4d}  {label}  {items[:4]}')
key = lambda o: re.sub(r'\s+', ' ', n(o)).strip().lower()
def dup(k):
    c = collections.defaultdict(list)
    for o in fac: c[k(o)].append(o)
    return [v for v in c.values() if len(v) > 1]
print(f"  {len(dup(lambda o: (o['parent']['id'], key(o)))):4d}  duplicate names within a district")
print(f"  {len(dup(key)):4d}  duplicate names nationally  {[key(v[0]) for v in dup(key)]}")
print(f"  {len(dup(lambda o: (o.get('code') or o['id']).strip())):4d}  codes that collide once trimmed")
print('\n== group combinations per facility (exclusivity)')
dims = {'type': ['Hospital', 'Health Center', 'Clinic'],
        'ownership': ['Public Facilities', 'Private Facilities', 'Faith Based Facilities', 'Concession Facilities'],
        'EmONC': ['BemONC Facilities', 'CEmONC Facilities'],
        'setting': ['Rural Facilities', 'Urban Facilities']}
for label, members in dims.items():
    c = collections.Counter(tuple(sorted({groups[g['id']] for g in o['organisationUnitGroups']} & set(members))) for o in fac)
    print(f'  {label}: ' + ', '.join(f"{'+'.join(k) or '(none)'}={v}" for k, v in c.most_common()))
print('\n== group sets (members)')
for s in load('groupsets')['organisationUnitGroupSets']:
    print(f"  {s['name']}: {[g['name'] for g in s['organisationUnitGroups']]}")
PY
