#!/usr/bin/env bash
# Validates content packages before they reach a build.
#
#   scripts/validate/validate-content.sh
#
# Checks structure and the project's own rules; `mvn verify` then runs the OpenMRS
# packager plugin's schema validation on top.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="$ROOT/content-packages"
fail=0

err() { echo "FAIL: $*" >&2; fail=$((fail+1)); }

# Every scan below reads SOURCE only. target/ holds Maven output — a filtered
# content.properties there carries the resolved exact version and would be reported as a
# breach of the range rule that produced it.
find_src() { find "$PKG_DIR" -path '*/target' -prune -o "$@" -print; }
grep_src() { grep --exclude-dir=target "$@"; }

# Sections report ok only if nothing failed inside them; `section <name>` opens one.
section_start=0
section() { echo "== $* =="; section_start=$fail; }
ok() { [[ $fail -eq $section_start ]] && echo "  ok: $*"; return 0; }

section "JSON syntax"
while IFS= read -r f; do
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null \
    || err "invalid JSON: ${f#$ROOT/}"
done < <(find_src -name '*.json')
ok "JSON parsed"

section "CSV comment lines"
# Initializer parses CSVs row-by-row with no comment syntax: a '#' line is read as a
# malformed record. Explanation belongs in a sibling README.md.
while IFS= read -r f; do
  grep -q '^#' "$f" && err "comment line in CSV (move it to a README): ${f#$ROOT/}"
done < <(find_src -name '*.csv')
ok "no comment lines in CSVs"

section "version discipline"
# content.properties declares ranges; distro.properties pins exact versions.
# The value is everything after the FIRST '=' — matching on the last one would read the
# '=' inside '>=' as the separator and mistake every correct range for an exact pin.
while IFS= read -r f; do
  hits="$(grep -nE '^[a-zA-Z][^=]*=[[:space:]]*[0-9]' "$f" || true)"
  if [[ -n "$hits" ]]; then
    err "exact version in content.properties (use a >= range): ${f#$ROOT/}"
    echo "$hits" | sed 's/^/       /' >&2
  fi
done < <(find_src -name 'content.properties')

distro="$ROOT/distribution/distro.properties"
# -SNAPSHOT is legitimate during development, so it is NOT rejected here — the release
# guard in .github/workflows/release.yml refuses it at tag time, which is the point at
# which it actually matters.
hits="$(grep -nE '^[a-zA-Z][^=]*=[[:space:]]*(latest|LATEST)' "$distro" || true)"
if [[ -n "$hits" ]]; then
  err "dynamic or latest version in distro.properties"
  echo "$hits" | sed 's/^/       /' >&2
fi
hits="$(grep -nE '^[a-zA-Z][^=]*=[[:space:]]*[><~^]' "$distro" || true)"
if [[ -n "$hits" ]]; then
  err "version range in distro.properties (pin exactly)"
  echo "$hits" | sed 's/^/       /' >&2
fi
ok "version discipline"

section "file name collisions between layers"
# The backend image copies every layer's backend_configuration/ into ONE tree, in layer
# order. Two layers with the same relative path means the later one REPLACES the earlier —
# not merges with it — and nothing errors: content-liberia-national/locationtags.csv once
# silently deleted content-common's five tags, and every location tagged with them failed
# to load. Give each file a package-specific name.
# README.md is excluded here for the same reason it is excluded from the package: it is
# documentation for editors, never loaded, and never in the resolved image.
#
# addresshierarchy/addressConfiguration.xml is excluded because it CANNOT be renamed:
# AddressConfigurationLoader (addresshierarchy 2.21.0) hardcodes that name, and a server has
# exactly one address format anyway — the file wipes and replaces the hierarchy it finds. One
# layer winning is the only possible outcome, so the rule above has nothing to protect here.
# Which layer wins is decided in distribution/backend/Dockerfile, where the demo layer's
# addresshierarchy/ is dropped so it cannot bury the national one.
dupes="$(for pkg in "$PKG_DIR"/*/configuration/backend_configuration; do
           [[ -d "$pkg" ]] || continue
           name="${pkg#$PKG_DIR/}"; name="${name%%/*}"
           find "$pkg" -type f ! -name '.gitkeep' ! -name 'README.md' \
                ! -path '*/addresshierarchy/addressConfiguration.xml' | sed "s|^$pkg/|$name |"
         done | awk '{ print $2, $1 }' | sort | awk '
           { if ($1 == prev) { if (!shown) print prev ": " prevpkg; print prev ": " $2; shown=1 }
             else shown=0
             prev=$1; prevpkg=$2 }')"
if [[ -n "$dupes" ]]; then
  err "the same file name in more than one layer — the later layer replaces the earlier:"
  echo "$dupes" | sort -u | sed 's/^/       /' >&2
fi
ok "no file name collisions between layers"

section "hard-coded UUIDs in frontend config"
# Frontend JSON must reference ${var.*}, never a bare UUID (IMPLEMENTATION.md §7).
while IFS= read -r f; do
  hits="$(grep -nE '"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-' "$f" || true)"
  if [[ -n "$hits" ]]; then
    err "hard-coded UUID (use \${var.*}): ${f#$ROOT/}"
    echo "$hits" | sed 's/^/       /' >&2
  fi
done < <(find_src -path '*/frontend_configuration/*' -name '*.json')
ok "no hard-coded UUIDs in frontend config"

section "role identity collisions"
# The role table is keyed by role NAME, so two rows resolving to the same name are one role,
# and the second silently overwrites the first — or fails the load outright when they carry
# different UUIDs. Initializer also maps rows onto the header POSITIONALLY, so a block pasted
# from a file with a different column order lands every value one column off without any row
# being malformed. Both happened at once here: RefApp rows written for
# 'Uuid,Role name,Description,Inherited roles,Privileges' were pasted into roles-common.csv
# under 'Uuid,Void/Retire,Role name,Description,Privileges,Inherited roles', so
# 'Organizational: Nurse' was read as a Void/Retire flag and the role was created as plain
# 'Nurse' — colliding with the clinical Nurse role. A misalignment that produces a duplicate
# name is caught here; the roles domain is the one worth guarding because it is name-keyed.
#
# Variables are resolved per package before comparing, because the same role legitimately
# reaches this check as a literal UUID in one layer and a ${var.*} token in another.
python3 - "$PKG_DIR" <<'PY' || err "role identity collisions (see above)"
import csv, glob, os, re, sys

pkg_dir = sys.argv[1]
seen = {}   # role name -> (uuid, origin)
by_uuid = {}
bad = []

for f in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/roles/*.csv")):
    if f"{os.sep}target{os.sep}" in f:
        continue
    pkg = f[len(pkg_dir) + 1:].split(os.sep)[0]
    variables = {}
    vf = os.path.join(pkg_dir, pkg, "configuration", "variables.properties")
    if os.path.exists(vf):
        for line in open(vf):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                variables[k.strip()] = v.strip()

    def resolve(value):
        return re.sub(r"\$\{([^}]+)\}", lambda m: variables.get(m.group(1), m.group(0)), value)

    rows = list(csv.reader(open(f, newline="")))
    if not rows:
        continue
    hdr = [h.strip() for h in rows[0]]
    if "Role name" not in hdr or "Uuid" not in hdr:
        continue
    ni, ui = hdr.index("Role name"), hdr.index("Uuid")
    for n, r in enumerate(rows[1:], start=2):
        if len(r) <= max(ni, ui) or not r[ni].strip():
            continue
        name, uuid = r[ni].strip(), resolve(r[ui].strip())
        origin = f"{f[len(pkg_dir) - len('content-packages'):]}:{n}"
        if name in seen and seen[name][0] != uuid:
            bad.append(f"role '{name}' declared with two UUIDs: {seen[name][1]} and {origin}")
        elif uuid in by_uuid and by_uuid[uuid][0] != name:
            bad.append(f"UUID {uuid} used by two roles: {by_uuid[uuid][1]} and {origin}")
        seen[name] = (uuid, origin)
        by_uuid[uuid] = (name, origin)

for b in bad:
    print(f"       {b}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY
ok "no role identity collisions"

section "conflicting variable declarations"
# variables.properties is read as a Java properties file: a key declared twice keeps the LAST
# value with no warning. Two roles both claiming var.role.nurse.uuid meant the clinical Nurse
# role silently inherited the RefApp Organizational Nurse UUID.
# Only WITHIN one file — two site packages legitimately declare the same key, because a build
# resolves exactly one of them.
while IFS= read -r f; do
  # Split on the FIRST '=' only: a value may contain one. An exact re-declaration of the
  # same value is harmless duplication, so only a differing value is reported.
  hits="$(awk '
    /^var\./ {
      i = index($0, "=")
      if (i == 0) next
      k = substr($0, 1, i - 1); v = substr($0, i + 1)
      if (k in seen) { if (seen[k] != v) print k }
      else seen[k] = v
    }' "$f")"
  if [[ -n "$hits" ]]; then
    err "the same variable declared twice with different values (the last one silently wins): ${f#$ROOT/}"
    echo "$hits" | sed 's/^/       /' >&2
  fi
done < <(find_src -name 'variables.properties')
ok "no conflicting variable declarations"

section "unresolved variables"
# Every ${var.x} referenced anywhere must be declared in some variables.properties.
# Keys are written WITH the var. prefix, because the file is consumed as a Maven resource
# filter and the filter key has to match the ${var.x} token in the content verbatim
# (content-packages/pom.xml, execution filter-configuration). Strip it to compare.
declared="$(cat "$PKG_DIR"/*/configuration/variables.properties 2>/dev/null \
  | grep -oE '^var\.[a-z0-9.\-]+' | sed 's/^var\.//' | sort -u)"
referenced="$(grep_src -rhoE '\$\{var\.[a-z0-9.\-]+\}' "$PKG_DIR" \
  | sed -E 's/^\$\{var\.//; s/\}$//' | sort -u)"
#missing="$(comm -13 <(echo "$declared") <(echo "$referenced"))"
missing="$(
  awk '
    NR==FNR { declared[$0]=1; next }
    !($0 in declared)
  ' \
  <(printf '%s\n' "$declared") \
  <(printf '%s\n' "$referenced")
)"
if [[ -n "$missing" ]]; then
  err "referenced but never declared in any variables.properties:"
  echo "$missing" | sed 's/^/       ${var./; s/$/}/' >&2
fi
ok "variable references"

section "concept names"
# Two ways a concept CSV silently becomes unloadable, both of which cost a week of red
# builds on main in August 2026.
#
# 1. No 'Fully specified name' column. Initializer's ConceptNameLineProcessor VOIDS every
#    name the concept already has and re-adds only the ones the header names, so a
#    name-less header does not mean "leave the names alone" — it means "remove them".
#    Every row then fails ConceptValidator with "At least one non-empty name is required",
#    including rows whose only purpose was to attach a 'Same as mappings' value to a
#    concept the OCL dictionary had already loaded correctly.
#
# 2. Two DIFFERENT UUIDs claiming the same fully specified name in the same locale.
#    concept_name is unique per locale for fully specified names, so the second row loses
#    with DuplicateConceptNameException. Collisions against the CIEL exports cannot be seen
#    from here (the exports are gitignored); scripts/build/build-distribution.sh checks
#    those once they have been fetched. This catches the in-repo half.
#
# Variables are resolved per package first — the same CIEL concept legitimately arrives as
# a literal UUID in one layer and a ${var.*} token in another — and demo content is compared
# only against demo content, because a distribution ships the demo layer or the production
# layers, never both (see build-distribution.sh and no-demo-in-release.sh).
python3 - "$PKG_DIR" <<'PY' || err "concept name problems (see above)"
import csv, glob, os, re, sys

pkg_dir = sys.argv[1]
problems = []
by_name = {}   # (group, locale, casefolded name) -> (uuid, origin)

# The same filter chain content-packages/pom.xml applies (filter-configuration): the shared
# layers in order, then the package's own, so a later layer overrides an earlier one's UUID.
FILTER_ORDER = ["content-common", "content-liberia-national", "content-liberia-mch",
                "content-liberia-lab", "content-liberia-pharmacy", "content-liberia-opd-ipd"]

def load_vars(pkg, into):
    vf = os.path.join(pkg_dir, pkg, "configuration", "variables.properties")
    if not os.path.exists(vf):
        return into
    for line in open(vf, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            into[k.strip()] = v.strip()
    return into

def variables_for(pkg):
    variables = {}
    for layer in FILTER_ORDER:
        load_vars(layer, variables)
    return load_vars(pkg, variables)

for f in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/concepts/*.csv")):
    if f"{os.sep}target{os.sep}" in f:
        continue
    pkg = f[len(pkg_dir) + 1:].split(os.sep)[0]
    group = "demo" if pkg == "content-demo" else "production"
    variables = variables_for(pkg)
    rel = f[len(pkg_dir) - len("content-packages"):]

    def resolve(value):
        return re.sub(r"\$\{([^}]+)\}", lambda m: variables.get(m.group(1), m.group(0)), value)

    with open(f, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    fsn_cols = [c for c in (rows[0].keys() if rows else [])
                if c and c.strip().lower().startswith("fully specified name")]
    if not fsn_cols:
        problems.append(f"{rel} has no 'Fully specified name' column — Initializer would "
                        f"void the names of all {len(rows)} concepts it lists")
        continue
    for n, row in enumerate(rows, start=2):
        uuid = resolve((row.get("Uuid") or "").strip())
        if not uuid:
            continue
        for col in fsn_cols:
            locale = col.split(":", 1)[1].strip() if ":" in col else "en"
            name = (row.get(col) or "").strip()
            if not name:
                continue
            key = (group, locale, name.casefold())
            owner = by_name.setdefault(key, (uuid, f"{rel}:{n}"))
            if owner[0] != uuid:
                problems.append(f"'{name}' is the fully specified name in locale '{locale}' "
                                f"of two concepts: {owner[0]} ({owner[1]}) and "
                                f"{uuid} ({rel}:{n})")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "every concept CSV names its concepts, once"

section "CSV blank lines"
# Initializer parses CSVs row-by-row with no tolerance for blank lines: an empty line is
# read as a single-element row and throws ArrayIndexOutOfBoundsException when a line
# processor accesses column 2.
while IFS= read -r f; do
  hits="$(grep -nE '^[[:space:]]*$' "$f" || true)"
  if [[ -n "$hits" ]]; then
    err "blank line in CSV: ${f#$ROOT/}"
    echo "$hits" | sed 's/^/       /' >&2
  fi
done < <(find_src -name '*.csv')
ok "no blank lines in CSVs"

section "location tags"
# Two failures live here, and both cost a full install cycle to find the hard way.
#
# A missing tag: LocationLineProcessor resolves every Tag|<Name> header with
# getLocationTagByName and THROWS when it returns null, so an unknown tag rejects the whole
# location row — and with it the parent reference of every location beneath it.
#
# A duplicate tag: location_tag.name is unique, so two packages declaring the same name
# under different UUIDs do not merge — the second one fails with a
# ConstraintViolationException. Tags owned by a module must therefore NOT be declared in
# content at all; the module creates them at startup, before Initializer runs.
python3 - "$PKG_DIR" <<'PY' || err "location tag problems (see above)"
import csv, glob, os, sys

pkg_dir = sys.argv[1]

# Tags created by modules at startup. Content must not redeclare these.
MODULE_OWNED = {
    "Queue Location": "queue module",
    "Appointment Location": "appointments module",
}

defined = {}
for f in glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/locationtags/*.csv"):
    package = f.split("/")[-5]
    with open(f, newline="") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("Name") or "").strip()
            if name:
                defined.setdefault(name, []).append(package)

problems = []
for name, packages in sorted(defined.items()):
    if len(packages) > 1:
        problems.append(f"'{name}' declared by {len(packages)} packages: {', '.join(packages)}")
    if name in MODULE_OWNED:
        problems.append(f"'{name}' is created by the {MODULE_OWNED[name]}; declaring it in "
                        f"{packages[0]} collides on the unique name")

for f in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/locations/*.csv")):
    with open(f, newline="") as fh:
        header = next(csv.reader(fh), [])
    for column in header:
        if not column.startswith("Tag|"):
            continue
        tag = column[4:].strip()
        if tag not in defined and tag not in MODULE_OWNED:
            problems.append(f"{os.path.basename(f)} references Tag|{tag}, "
                            f"which no package declares and no module creates")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "location tags resolve and are declared once"

echo
if [[ $fail -ne 0 ]]; then
  echo "content validation FAILED" >&2
  exit 1
fi
echo "content validation passed"
