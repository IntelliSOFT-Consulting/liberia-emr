#!/usr/bin/env bash
# Collects frontend runtime configuration from the content packages, in LAYER ORDER.
#
#   scripts/build/collect-frontend-config.sh --site careysburg --demo false --out <dir>
#   scripts/build/collect-frontend-config.sh --site central --out <dir>
#
# --site central puts content-central where a facility build has its site layer, so central
# gets its own last layer and no facility's (docs/adr/0011-central-composition.md).
#
# Order matters twice over: the files are copied here, and the SAME order must appear in
# SPA_CONFIG_URLS in the compose file. A config listed out of order overrides the wrong
# layer and nothing errors. See IMPLEMENTATION.md §7.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="careysburg"
DEMO="false"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --demo) DEMO="$2"; shift 2 ;;
    --out)  OUT="$2";  shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" ]] || { echo "--out <dir> is required" >&2; exit 2; }

if [[ "$SITE" == "central" ]]; then
  [[ "$DEMO" == "false" ]] || { echo "there is no demo build of central" >&2; exit 2; }
  last_layer="content-central"
else
  last_layer="content-site-${SITE}"
fi

layers=(
  content-common
  content-liberia-national
  content-liberia-mch
  content-liberia-lab
  content-liberia-pharmacy
  content-liberia-opd-ipd
  "$last_layer"
)
[[ "$DEMO" == "true" ]] && layers+=(content-demo)

rm -rf "$OUT"; mkdir -p "$OUT"
order=()
for layer in "${layers[@]}"; do
  # target/, not the source tree: ${var.*} is resolved by the filter-configuration
  # execution in content-packages/pom.xml. Collecting from source would ship a config file
  # with literal ${var.x} in it, which O3 reads as a UUID and silently fails to match.
  src="$ROOT/content-packages/$layer/target/configuration/frontend_configuration"
  if [[ ! -d "$src" ]]; then
    [[ -d "$ROOT/content-packages/$layer/configuration" ]] \
      || { echo "no such layer: $layer" >&2; exit 1; }
    echo "FAIL: $layer has not been built — run 'mvn package' first (${src#$ROOT/})" >&2
    exit 1
  fi
  while IFS= read -r f; do
    cp "$f" "$OUT/"
    order+=("/openmrs/spa/config/$(basename "$f")")
  done < <(find "$src" -maxdepth 1 -name 'config-*.json' | sort)
done

# Emitted so the compose SPA_CONFIG_URLS can be diffed against what was actually built.
printf '%s\n' "${order[@]}" > "$OUT/.config-urls"

echo "collected ${#order[@]} config files in layer order:"
printf '  %s\n' "${order[@]}"
