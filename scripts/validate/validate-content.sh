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

section "unresolved variables"
# Every ${var.x} referenced anywhere must be declared in some variables.properties.
# Keys are written WITH the var. prefix, because the file is consumed as a Maven resource
# filter and the filter key has to match the ${var.x} token in the content verbatim
# (content-packages/pom.xml, execution filter-configuration). Strip it to compare.
declared="$(cat "$PKG_DIR"/*/configuration/variables.properties 2>/dev/null \
  | grep -oE '^var\.[a-z0-9.\-]+' | sed 's/^var\.//' | sort -u)"
referenced="$(grep_src -rhoE '\$\{var\.[a-z0-9.\-]+\}' "$PKG_DIR" \
  | sed -E 's/^\$\{var\.//; s/\}$//' | sort -u)"
missing="$(comm -13 <(echo "$declared") <(echo "$referenced"))"
if [[ -n "$missing" ]]; then
  err "referenced but never declared in any variables.properties:"
  echo "$missing" | sed 's/^/       ${var./; s/$/}/' >&2
fi
ok "variable references"

echo
if [[ $fail -ne 0 ]]; then
  echo "content validation FAILED" >&2
  exit 1
fi
echo "content validation passed"
