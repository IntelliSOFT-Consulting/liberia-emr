#!/usr/bin/env bash
# Generates the O3 assemble config from the PINNED versions in distro.properties.
#
#   scripts/build/generate-import-map.sh --out distribution/frontend/spa-assemble-config.json
#
# The output is generated, never hand-edited: distro.properties is the single source of
# truth for which frontend modules exist and at which version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DISTRO="$ROOT/distribution/distro.properties"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" ]] || { echo "--out <file> is required" >&2; exit 2; }

core="$(grep -E '^spa\.core=' "$DISTRO" | cut -d= -f2)"
[[ -n "$core" ]] || { echo "spa.core is not pinned in distro.properties" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
{
  echo '{'
  printf '  "coreVersion": "%s",\n' "$core"
  echo '  "frontendModules": {'
  grep -E '^spa\.frontendModules\.' "$DISTRO" \
    | sed -E 's/^spa\.frontendModules\.//' \
    | awk -F= '{ printf "    \"%s\": \"%s\",\n", $1, $2 }' \
    | sed '$ s/,$//'
  echo '  }'
  echo '}'
} > "$OUT"

python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$OUT" \
  || { echo "generated an invalid import map: $OUT" >&2; exit 1; }

echo "wrote ${OUT#$ROOT/} (core $core, $(grep -c '^spa\.frontendModules\.' "$DISTRO") modules)"
