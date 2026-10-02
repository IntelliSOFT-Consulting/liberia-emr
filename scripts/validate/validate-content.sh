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

# In-tree module sources that carry ${var.*} tokens (ADR 0010 decision 7): the liberiaemr api's
# resources (liberiaemr-uuids.properties), the reports module's resources and the ETL module's
# SQL and configs. A module that does not exist yet contributes nothing. The UUID-literal check
# further down globs the same directories, plus the reports module's Java; keep the two lists
# in step.
module_token_dirs() {
  local d
  for d in "$ROOT"/modules/liberiaemr/api/src/main/resources \
           "$ROOT"/modules/liberiaemrreports/*/src/main/resources \
           "$ROOT"/modules/mambaetl/*/src/main/mamba; do
    [[ -d "$d" ]] && echo "$d"
  done
  return 0
}

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
# This check is WITHIN one file. "variables across layers" below compares files.
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

# The shared filter chain, read from content-packages/pom.xml (execution filter-configuration)
# so the two checks below cannot drift from the build: every <filter> except the package's
# own file, in order. Every other package is a TERMINAL layer (a site, central or demo),
# which the build applies last, alone, on top of the chain.
FILTER_CHAIN="$(python3 - "$PKG_DIR/pom.xml" <<'PY'
import re, sys
chain = re.findall(r"<filter>\$\{project\.basedir\}/\.\./([^/]+)/configuration/variables\.properties</filter>",
                   open(sys.argv[1], encoding="utf-8").read())
print(" ".join(chain))
PY
)"
[[ -n "$FILTER_CHAIN" ]] || err "could not read the variable filter chain from content-packages/pom.xml"

section "variables across layers"
# A key declared in two SHARED layers with different values is one name for two things. Every
# package filters its own variables.properties last, so each layer's own rows resolve to its
# own value, but everything that resolves through the chain (a later layer, a site package, the
# ETL, the QA fixtures) gets the LAST shared layer's value. The reports module, filtered from
# content-liberia-national alone, gets national's. That is how var.encountertype.family-planning
# meant national 'Family Planning' in one build and MCH 'Family Planning Visit' in another
# (LE-343).
#
# A terminal layer overriding a shared key is the intended mechanism (ADR 0003, IMPLEMENTATION.md
# §7): it is how a site maps onto pre-existing production metadata. Two terminal layers
# disagreeing is expected too, because a build applies exactly one site. Neither is reported.
#
# A package that is neither in the chain nor a terminal layer is a new programme layer missing
# from pom.xml's filter list: its variables would resolve nowhere else, so that fails too.
#
# ALLOWED holds a shared-layer disagreement that is deliberate, with the reason. Keep it empty
# unless one is.
python3 - "$PKG_DIR" "$FILTER_CHAIN" <<'PY' || err "variables resolve differently across layers (see above)"
import glob, os, sys

pkg_dir, chain = sys.argv[1], sys.argv[2].split()
ALLOWED = {}   # "var.key" -> "why the shared layers legitimately disagree"
TERMINAL = lambda p: p.startswith("content-site-") or p in ("content-central", "content-demo")

def declared(pkg):
    out = {}
    vf = os.path.join(pkg_dir, pkg, "configuration", "variables.properties")
    if os.path.exists(vf):
        for n, line in enumerate(open(vf, encoding="utf-8"), start=1):
            s = line.strip()
            if s.startswith("var.") and "=" in s:
                k, _, v = s.partition("=")
                out[k.strip()] = (v.strip(), n)
    return out

problems = []
for vf in sorted(glob.glob(f"{pkg_dir}/*/configuration/variables.properties")):
    pkg = vf[len(pkg_dir) + 1:].split(os.sep)[0]
    if pkg not in chain and not TERMINAL(pkg):
        problems.append(f"{pkg} is not in the filter chain in content-packages/pom.xml and is not "
                        f"a site, central or demo layer")

by_key = {}
for pkg in chain:
    for k, (v, n) in declared(pkg).items():
        by_key.setdefault(k, []).append((pkg, v, n))
for k, decls in sorted(by_key.items()):
    if len({v for _, v, _ in decls}) > 1 and k not in ALLOWED:
        where = "; ".join(f"{p}:{n}={v}" for p, v, n in decls)
        problems.append(f"{k} has different values in shared layers: {where}")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "every shared variable has one value; only terminal layers override"

section "UUID identity across packages"
# One UUID must name one thing. Initializer loads rows by UUID, so two rows of the same domain
# (encounter types, forms, concepts, roles, locations...) resolving to one UUID under different
# names are ONE entity. The later layer silently renames it, and every earlier layer's encounters,
# reports and labels then point at the other name.
#
# Rows are resolved exactly as the build resolves them: the shared chain, then the package's own
# file. Each composition a distribution can install is compared as a whole: the chain plus one
# site, the same with the demo layer on top, and the chain plus central. Sites are never
# compared with each other, because no distribution holds two.
#
# A row counts when its header has a Uuid column and a name column (Name, Fully specified
# name:en, Role name, Privilege name, Service name, Label). Domains without a name (concept sets,
# workflows, mappings...) are identified by other columns and have nothing to compare. An AMPATH
# form counts by the UUID Initializer derives from its name and version, since the JSON uuid
# field is ignored at load.
#
# ALLOWED holds a known rename that is not ours to fix, with the reason. Keep it to rows in
# content-demo, which is vendored from upstream at a pinned tag and must not be edited here
# (scripts/build/lift-demo-content.sh --check fails any drift).
python3 - "$PKG_DIR" "$FILTER_CHAIN" <<'PY' || err "UUIDs declared under different names (see above)"
import csv, glob, hashlib, json, os, re, sys, uuid as uuidlib

pkg_dir, chain = sys.argv[1], sys.argv[2].split()
# Each entry is exact: the two names, and one of them must come from content-demo. Any other
# name for the same UUID still fails.
ALLOWED = {  # (domain, uuid, {name, name}) -> why the rename is accepted
    ("conceptreferencerange", "13a9cfe1-b3ea-49d0-b97a-db99d9cbcb80",
     frozenset({"Temp Celsius >=3mos", "Temp Celsius >3mos"})):
        "upstream demo 1.9.2 labels the >= 3 months temperature range 'Temp Celsius >3mos'; "
        "national's '>=3mos' matches the criterion. Label only: limits and criterion agree.",
}
AMPATH_FORMS_UUID = "794c4598-ab82-47ca-8d18-483a8abe6f4f"

def form_uuid(name, version):
    # What Initializer's AmpathFormsLoader gives the form (the JSON uuid field is ignored): the
    # same derivation as the "AMPATH form UUID consistency" section below.
    b = bytearray(hashlib.md5(f"{AMPATH_FORMS_UUID}_{name}_{version}".encode("utf-8")).digest())
    b[6] = (b[6] & 0x0f) | 0x30
    b[8] = (b[8] & 0x3f) | 0x80
    return str(uuidlib.UUID(bytes=bytes(b)))
NAME_COLS = ("name", "fully specified name:en", "role name", "privilege name", "service name", "label")
rel = lambda path: os.path.relpath(path, os.path.dirname(pkg_dir))

compositions = {}
for site in sorted(os.path.basename(p) for p in glob.glob(f"{pkg_dir}/content-site-*")):
    compositions[site] = chain + [site]
    if os.path.isdir(f"{pkg_dir}/content-demo"):
        compositions[f"{site} + demo"] = chain + [site, "content-demo"]
if os.path.isdir(f"{pkg_dir}/content-central"):
    compositions["content-central"] = chain + ["content-central"]

def load_vars(pkg, into):
    vf = os.path.join(pkg_dir, pkg, "configuration", "variables.properties")
    if os.path.exists(vf):
        for line in open(vf, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, _, v = s.partition("=")
                into[k.strip()] = v.strip()
    return into

def rows_for(pkg):
    variables = {}
    for layer in chain:
        load_vars(layer, variables)
    load_vars(pkg, variables)
    resolve = lambda s: re.sub(r"\$\{([^}]+)\}", lambda m: variables.get(m.group(1), m.group(0)), s)
    base = os.path.join(pkg_dir, pkg, "configuration", "backend_configuration")
    out = []
    for f in sorted(glob.glob(f"{base}/*/*.csv")):
        with open(f, newline="", encoding="utf-8") as fh:
            rows = list(csv.reader(fh))
        if not rows:
            continue
        hdr = [h.strip().lower() for h in rows[0]]
        ni = next((hdr.index(c) for c in NAME_COLS if c in hdr), None)
        if "uuid" not in hdr or ni is None:
            continue
        ui = hdr.index("uuid")
        domain = os.path.basename(os.path.dirname(f))
        for n, r in enumerate(rows[1:], start=2):
            if len(r) <= max(ui, ni):
                continue   # the short-row check reports it
            uuid, name = resolve(r[ui].strip()).lower(), resolve(r[ni].strip())
            if uuid and name and "${" not in uuid:   # an unresolved token is reported above
                out.append((domain, uuid, name, f"{rel(f)}:{n}"))
    for f in sorted(glob.glob(f"{base}/ampathforms/*.json")):
        try:
            schema = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue   # the JSON syntax check reports it
        if not isinstance(schema, dict):
            continue
        name, version = schema.get("name"), schema.get("version")
        if name:
            out.append(("ampathforms", form_uuid(name, version), str(name), rel(f)))
    return out

def allowed(domain, uuid, a, b):
    demo = "content-packages/content-demo/"
    return ((domain, uuid, frozenset({a[0], b[0]})) in ALLOWED
            and (a[1].startswith(demo) or b[1].startswith(demo)))

cache, found = {}, {}
for comp, layers in compositions.items():
    first = {}
    for pkg in layers:
        if pkg not in cache:
            cache[pkg] = rows_for(pkg)
        for domain, uuid, name, origin in cache[pkg]:
            owner = first.setdefault((domain, uuid), (name, origin))
            if owner[0] != name and not allowed(domain, uuid, owner, (name, origin)):
                found.setdefault((domain, uuid, owner, (name, origin)), []).append(comp)

for (domain, uuid, (n1, o1), (n2, o2)), comps in found.items():
    print(f"       {domain}: {uuid} is '{n1}' ({o1}) and '{n2}' ({o2}) in {', '.join(comps)}",
          file=sys.stderr)
sys.exit(1 if found else 0)
PY
ok "every UUID has one name per domain in every composition"

section "unresolved variables"
# Every ${var.x} referenced anywhere must be declared in some variables.properties.
# Keys are written WITH the var. prefix, because the file is consumed as a Maven resource
# filter and the filter key has to match the ${var.x} token in the content verbatim
# (content-packages/pom.xml, execution filter-configuration). Strip it to compare.
declared="$(cat "$PKG_DIR"/*/configuration/variables.properties 2>/dev/null \
  | grep -oE '^var\.[a-z0-9.\-]+' | sed 's/^var\.//' | sort -u)"
# The in-tree modules' tokens are resolved from the same files (ADR 0010 decision 7), so they
# are held to the same rule.
referenced="$( { grep_src -rhoE '\$\{var\.[a-z0-9.\-]+\}' "$PKG_DIR" || true
                 while IFS= read -r d; do
                   grep -rhoE '\$\{var\.[a-z0-9.\-]+\}' "$d" || true
                 done < <(module_token_dirs); } \
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

section "hard-coded UUIDs in ETL and report sources"
# ADR 0010 decision 7. Report Java, report resources and the ETL's SQL and configs hold no UUID
# of their own: each one is a ${var.*} token resolved at build time, so it is declared once and
# follows a site's override. Two shapes are caught, because the frontend check above sees only
# the first: the RFC 4122 dashed form, and the 36-character CIEL form, digits then A's
# (5088AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA). Test sources are not scanned: fixtures are data.
python3 - "$ROOT" <<'PY' || err "hard-coded UUIDs in module sources (see above)"
import glob, os, re, sys

root = sys.argv[1]
# module_token_dirs above, plus the reports module's Java.
dirs = sorted(glob.glob(f"{root}/modules/liberiaemr/api/src/main/resources")
              + glob.glob(f"{root}/modules/liberiaemrreports/*/src/main/resources")
              + glob.glob(f"{root}/modules/mambaetl/*/src/main/mamba")
              + glob.glob(f"{root}/modules/liberiaemrreports/*/src/main/java"))
dashed = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9A-Za-z])")
ciel = re.compile(r"(?<![0-9A-Za-z])[0-9]+A+(?![0-9A-Za-z])")
problems = []
for d in dirs:
    for base, subdirs, files in os.walk(d):
        subdirs[:] = [s for s in subdirs if s != "target"]
        for name in sorted(files):
            path = os.path.join(base, name)
            try:
                lines = open(path, encoding="utf-8").read().splitlines()
            except (UnicodeDecodeError, OSError):
                continue  # binary resources carry no source text
            for n, line in enumerate(lines, start=1):
                hits = dashed.findall(line) + [m for m in ciel.findall(line) if len(m) == 36]
                for hit in hits:
                    problems.append(f"{os.path.relpath(path, root)}:{n}: {hit}")
for p in problems:
    print(f"       {p} (declare it in variables.properties and use ${{var.*}})", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "no UUID literals in module sources"

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

section "CSV short rows"
# The blank line above is only the extreme case of a more general one: a row with FEWER
# cells than the header has columns. Initializer addresses cells by header position, so a
# row that stops early throws ArrayIndexOutOfBoundsException the moment a line processor
# reads past its end — and when the row is a concept, every other concept naming it as an
# answer fails too, with a much less obvious "could not be found in database". That is how
# 54 of the 126 rows in concepts-mch.csv were rejected while this script stayed green:
# csv.DictReader pads a short row with None, so none of the checks above could see it.
#
# Only SHORT rows are an error. A row with extra trailing cells is tolerated by Initializer
# (the surplus is past the last named column and never read) and several of the concept
# exports vendored from upstream have them; failing on those would fail files we do not own.
#
# Columns whose name begins with '_' are Initializer directives ('_order:1000',
# '_version:1') rather than data, and how far a row must reach past them is NOT uniform
# across domains — so this asks each domain the question it actually answers to.
#
# In concepts/, rows must reach the FULL header, directives included. Every concept export
# that carries directives pads through them, and the one attempt to add '_order:1800' to
# concepts-national.csv without widening its rows rejected all 142 of them with
# "Index 9 out of bounds for length 9" — the concept line processors address cells across
# the whole header. Excluding directives here would have called that change clean.
#
# Everywhere else a row may stop before trailing directives: privileges_stockmanagement-
# common.csv declares '_order:1000' as a 4th column and its 3-cell rows load correctly,
# because nothing in that domain reads that far.
python3 - "$PKG_DIR" <<'PY' || err "short CSV rows (see above)"
import csv, glob, os, sys

pkg_dir = sys.argv[1]
problems = []

for f in sorted(glob.glob(f"{pkg_dir}/**/*.csv", recursive=True)):
    if f"{os.sep}target{os.sep}" in f:
        continue
    rel = f[len(pkg_dir) - len("content-packages"):]
    with open(f, newline="", encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        continue
    in_concepts = f"{os.sep}concepts{os.sep}" in f
    if in_concepts:
        width, what = len(rows[0]), "header has"
    else:
        width = len([c for c in rows[0] if not c.strip().startswith("_")])
        what = "header names"
    for n, row in enumerate(rows[1:], start=2):
        if len(row) < width:
            problems.append(f"{rel}:{n} has {len(row)} cells, {what} {width} columns")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "no CSV row stops before its header does"

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

section "CSV row column counts"
# Initializer's CsvLine.get(header) accesses line[columnIndex] directly.
# If a row has fewer columns than the non-metadata headers, it throws ArrayIndexOutOfBoundsException.
python3 - "$PKG_DIR" <<'PY' || err "CSV row has fewer columns than non-metadata headers"
import csv, glob, os, sys

pkg_dir = sys.argv[1]
problems = []
for f in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/**/*.csv", recursive=True)):
    with open(f, newline="", encoding="utf-8", errors="replace") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            continue
        data_headers = [h for h in header if not h.startswith("_")]
        for line_num, row in enumerate(reader, start=2):
            if len(row) < len(data_headers):
                problems.append(f"{f[len(pkg_dir)+1:]}:{line_num}: row has {len(row)} columns, expected at least {len(data_headers)}")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "all CSV rows match or exceed data header column count"

section "concept answer dependencies"
# Initializer processes concept CSV rows sequentially top-to-bottom. If an answer concept is declared
# in the same CSV file AFTER the question concept referencing it in Answers, Initializer fails to find
# the answer in the database and throws IllegalArgumentException.
python3 - "$PKG_DIR" <<'PY' || err "concept references answer declared later in CSV"
import csv, glob, os, sys

pkg_dir = sys.argv[1]
problems = []
for f in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/concepts/*.csv")):
    with open(f, newline="", encoding="utf-8", errors="replace") as fh:
        reader = list(csv.reader(fh))
    if not reader:
        continue
    header = reader[0]
    if "Answers" not in header:
        continue
    ans_col = header.index("Answers")
    uuid_col = header.index("Uuid") if "Uuid" in header else 0
    name_col = header.index("Fully specified name:en") if "Fully specified name:en" in header else 2

    file_concepts = set()
    for row in reader[1:]:
        if len(row) > uuid_col and row[uuid_col].strip():
            file_concepts.add(row[uuid_col].strip())
        if len(row) > name_col and row[name_col].strip():
            file_concepts.add(row[name_col].strip())

    seen = set()
    for line_num, row in enumerate(reader[1:], start=2):
        if len(row) > ans_col and row[ans_col].strip():
            for a in row[ans_col].split(";"):
                a = a.strip()
                if a in file_concepts and a not in seen:
                    problems.append(f"{f[len(pkg_dir)+1:]}:{line_num}: forward reference to answer '{a}' before its declaration")
        if len(row) > uuid_col and row[uuid_col].strip():
            seen.add(row[uuid_col].strip())
        if len(row) > name_col and row[name_col].strip():
            seen.add(row[name_col].strip())

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "all intra-file concept answer dependencies are declared before use"

section "AMPATH form UUID consistency"
# Initializer's AmpathFormsLoader (2.12.0) IGNORES a form JSON's "uuid" field. It derives the
# Form UUID from the form's name and version:
#   Utils.generateUuidFromObjects("794c4598-ab82-47ca-8d18-483a8abe6f4f", formName, formVersion)
#   = UUID.nameUUIDFromBytes("794c4598-…_<name>_<version>".getBytes())
# so a version bump is a NEW form. A var.form.*.uuid is the repository alias for that runtime
# UUID, and the frontend, the ETL, the reports and qa/ key on it. Two rules, checked in every
# package (site packages included, since one may override a variable):
#   1. A form whose "uuid" is ${var.X}: every declaration of var.X equals the form's derivation.
#   2. Every var.form.*.uuid declaration equals the derivation of SOME form in the packages.
#      This catches a variable that holds a form JSON's ignored literal (how the OPD and Triage
#      variables were first written), and one left behind by a version bump. A variable
#      declared ahead of its form goes in PENDING_FORMS below; remove it once the form exists.
python3 - "$PKG_DIR" <<'PY' || err "form UUID variable mismatch (see above)"
import collections, glob, hashlib, json, os, re, sys, uuid

pkg_dir = sys.argv[1]
AMPATH_FORMS_UUID = "794c4598-ab82-47ca-8d18-483a8abe6f4f"
PENDING_FORMS = {
    # Delivery Summary is "not written" (content-liberia-mch ampathforms/README.md).
    "var.form.delivery-summary.uuid",
}

def java_uuid(seed):
    """java.util.UUID.nameUUIDFromBytes: MD5, then version 3 and the IETF variant."""
    b = bytearray(hashlib.md5(seed.encode("utf-8")).digest())
    b[6] = (b[6] & 0x0f) | 0x30
    b[8] = (b[8] & 0x3f) | 0x80
    return str(uuid.UUID(bytes=bytes(b)))

def rel(path):
    return os.path.relpath(path, os.path.dirname(pkg_dir))

# Every declaration, not a merged map: a layer that re-declares a variable wrongly must not
# hide behind another layer's correct value, or the other way round.
declared = collections.defaultdict(list)          # var name -> [(value, "file:line")]
for vf in sorted(glob.glob(f"{pkg_dir}/*/configuration/variables.properties")):
    for n, line in enumerate(open(vf, encoding="utf-8"), start=1):
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k, v = s.split("=", 1)
            declared[k.strip()].append((v.strip(), f"{rel(vf)}:{n}"))

problems = []
derived = {}                                      # derived uuid -> form label
for jf in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/ampathforms/*.json")):
    try:
        d = json.load(open(jf, encoding="utf-8"))
    except Exception as e:
        problems.append(f"{rel(jf)}: could not be read ({e})")
        continue
    if not isinstance(d, dict):
        continue
    name, version, uuid_ref = d.get("name"), d.get("version"), d.get("uuid")
    if not name or version is None:
        continue
    # Jackson hands the loader a String, Integer or Double; each prints as Python's str() does.
    computed = java_uuid(f"{AMPATH_FORMS_UUID}_{name}_{version}")
    label = f"{rel(jf)} ('{name}' v{version})"
    derived[computed] = label
    m = re.fullmatch(r"\$\{([^}]+)\}", uuid_ref if isinstance(uuid_ref, str) else "")
    if not m:
        continue
    var_name = m.group(1)
    if var_name not in declared:
        problems.append(f"{label}: references undefined variable ${{{var_name}}}")
    for value, where in declared.get(var_name, []):
        if value != computed:
            problems.append(f"{where}: {var_name}={value}, but {label} derives {computed}")

for var_name, decls in sorted(declared.items()):
    if not re.fullmatch(r"var\.form\..+\.uuid", var_name) or var_name in PENDING_FORMS:
        continue
    for value, where in decls:
        if value not in derived:
            problems.append(f"{where}: {var_name}={value} is not the derived UUID of any form "
                            f"(the runtime UUID comes from name + version, not the JSON uuid literal)")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "every var.form.*.uuid is the UUID Initializer derives from its form's name and version"

section "obsGroup group concepts"
# An obsGroup's concept is the form engine's ONLY handle on a saved group: it maps a stored
# obsGroup Obs back to a schema node by that concept UUID. Two sibling obsGroups sharing one
# concept are therefore indistinguishable on reopen — a saved encounter populates at most one
# of them and the rest render blank or cross-wired, silently, with the data still sitting in
# the database. It costs nothing to write and is invisible until a clinician edits an encounter.
#
# That is how the seven General Examination findings in opd_consultation_form.json (jaundice,
# pallor, cyanosis, lymphadenopathy, dehydration, finger clubbing, edema) were first written:
# one shared "Exam Finding Construct" for all seven. Each needs its own construct concept, the
# way the systemic-exam groups in the same form already do.
#
# Scoped per form, not globally: two DIFFERENT forms may legitimately reuse one construct,
# because a saved group is only ever resolved against the schema of the form it belongs to.
python3 - "$PKG_DIR" <<'PYGRP' || err "obsGroup concept collisions (see above)"
import collections, glob, json, os, sys

pkg_dir = sys.argv[1]
problems = []

def walk(questions, groups):
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        if q.get("type") == "obsGroup":
            concept = (q.get("questionOptions") or {}).get("concept")
            if concept:
                groups[concept].append(q.get("id") or "(no id)")
        walk(q.get("questions"), groups)

for jf in sorted(glob.glob(f"{pkg_dir}/*/configuration/backend_configuration/ampathforms/*.json")):
    if f"{os.sep}target{os.sep}" in jf:
        continue
    rel = jf[len(pkg_dir) - len("content-packages"):]
    try:
        schema = json.load(open(jf, encoding="utf-8"))
    except Exception as e:
        problems.append(f"{rel}: could not be read ({e})")
        continue
    if not isinstance(schema, dict):
        continue
    groups = collections.defaultdict(list)
    for page in schema.get("pages") or []:
        for sec in (page or {}).get("sections") or []:
            walk((sec or {}).get("questions"), groups)
    for concept, ids in sorted(groups.items()):
        if len(ids) > 1:
            problems.append(f"{rel}: {len(ids)} obsGroups share the group concept {concept} "
                            f"({', '.join(ids)}) — give each one its own construct")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PYGRP
ok "every obsGroup in a form has its own group concept"

section "session inactivity timeout"
# MOH ICT SOP A7. The contractual maximum is 10 minutes of human inactivity.
# The login app clamps at runtime. The backend image sets Tomcat's default
# session timeout to 10 minutes and fails if OpenMRS defines its own.
python3 - "$ROOT" <<'PY' || err "session inactivity timeout (see above)"
import json, os, re, sys

root = sys.argv[1]
problems = []

def rel(path):
    return os.path.relpath(path, root)

national_vars = os.path.join(
    root, "content-packages/content-liberia-national/configuration/variables.properties")
declared = []
for dirpath, dirnames, filenames in os.walk(os.path.join(root, "content-packages")):
    if "target" in dirpath.split(os.sep):
        continue
    if "variables.properties" not in filenames:
        continue
    path = os.path.join(dirpath, "variables.properties")
    for n, line in enumerate(open(path, encoding="utf-8"), start=1):
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, value = s.split("=", 1)
        if key.strip() != "var.security.session.timeout-minutes":
            continue
        value = value.strip()
        where = f"{rel(path)}:{n}"
        declared.append(where)
        try:
            minutes = float(value)
        except ValueError:
            problems.append(f"{where}: timeout {value!r} is not a number of minutes")
            continue
        if not minutes > 0 or minutes > 10:
            problems.append(f"{where}: timeout {value} must be greater than 0 and at most 10 minutes")
if not any(item.startswith("content-packages/content-liberia-national/") for item in declared):
    problems.append("content-liberia-national does not declare var.security.session.timeout-minutes")

frontend_dir = os.path.join(root, "content-packages")
for dirpath, dirnames, filenames in os.walk(frontend_dir):
    if "target" in dirpath.split(os.sep):
        continue
    for name in filenames:
        if not name.endswith(".json") or "frontend_configuration" not in dirpath:
            continue
        path = os.path.join(dirpath, name)
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception as exc:
            problems.append(f"{rel(path)}: {exc}")
            continue
        def has_key(value, key):
            if isinstance(value, dict):
                if key in value:
                    return True
                return any(has_key(item, key) for item in value.values())
            if isinstance(value, list):
                return any(has_key(item, key) for item in value)
            return False

        if has_key(data, "logoutIdleTimeoutMinutes"):
            problems.append(f"{rel(path)}: logoutIdleTimeoutMinutes is not read by primary-navigation")
        nav = data.get("@openmrs/esm-primary-navigation-app")
        if has_key(nav, "idleTimeoutMinutes") or has_key(nav, "logoutIdleTimeoutMinutes"):
            problems.append(f"{rel(path)}: session timeout must not be configured on primary-navigation")

national_cfg = os.path.join(
    root,
    "content-packages/content-liberia-national/configuration/frontend_configuration/config-national.json",
)
national = json.load(open(national_cfg, encoding="utf-8"))
login = national.get("@liberiaemr/esm-liberia-login-app")
got = None if not isinstance(login, dict) else login.get("session", {}).get("idleTimeoutMinutes")
if got != "${var.security.session.timeout-minutes}":
    problems.append(
        "config-national.json must set @liberiaemr/esm-liberia-login-app"
        ".session.idleTimeoutMinutes to ${var.security.session.timeout-minutes}"
        f" (found {got!r})"
    )

gp_root = os.path.join(root, "content-packages")
for dirpath, dirnames, filenames in os.walk(gp_root):
    if "target" in dirpath.split(os.sep) or "globalproperties" not in dirpath:
        continue
    for name in filenames:
        if not name.endswith((".xml", ".csv")):
            continue
        path = os.path.join(dirpath, name)
        for prop in re.findall(r"<property>\s*([^<]+?)\s*</property>", open(path, encoding="utf-8").read()):
            if re.search(r"(session[-_.]?timeout|idle[-_.]?timeout|servlet\.session|web\.session)", prop, re.I):
                problems.append(f"{rel(path)}: {prop} looks like a session-timeout global property; do not invent one")

dockerfile = open(os.path.join(root, "distribution/backend/Dockerfile"), encoding="utf-8").read()
if "/usr/local/tomcat/conf/web.xml" not in dockerfile \
        or "<session-timeout>30</session-timeout>" not in dockerfile \
        or "<session-timeout>10</session-timeout>" not in dockerfile:
    problems.append("backend Dockerfile must change Tomcat conf/web.xml session-timeout from 30 to 10")
if "jar xf" not in dockerfile or "WEB-INF/web.xml" not in dockerfile \
        or "defines session-timeout" not in dockerfile:
    problems.append("backend Dockerfile must fail the build when OpenMRS WEB-INF/web.xml defines session-timeout")

for p in problems:
    print(f"       {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
ok "10-minute human-idle config and Tomcat session timeout"

# ADR 0013 / LE-384: the facility's cache of other facilities' history must never reach central.
# eip.watchedTables is an allow-list of what dbsync sends, so a remote history table in it is a
# leak of another facility's records back to central under their UUIDs.
section "remote history tables stay out of sync"
for f in "$ROOT"/distribution/sync/*.template "$ROOT"/distribution/sync/*.properties; do
  [[ -f "$f" ]] || continue
  if grep -iE '^[[:space:]]*eip\.watchedTables[[:space:]]*=' "$f" | grep -iqE 'liberiaemr_remote_history'; then
    err "${f#$ROOT/}: eip.watchedTables names a liberiaemr_remote_history table; the remote history cache must never sync"
  fi
done
ok "no liberiaemr_remote_history table in eip.watchedTables"

echo
if [[ $fail -ne 0 ]]; then
  echo "content validation FAILED" >&2
  exit 1
fi
echo "content validation passed"
