#!/usr/bin/env bash
# Checks a central backend image's resolved content (LE-339, docs/adr/0012-central-site-locations.md).
#
#   scripts/validate/central-backend-content.sh <image>
#
# Central must hold every facility's locations, because records from any facility reference
# them and location rows are not synced. It must hold NOTHING ELSE from a site package: no ID
# sequences, cash points, queues or facility global properties, which describe one facility
# and would make central act as it. Both sets are derived from content-packages/content-site-*,
# so a new site package is covered without editing this script.
set -euo pipefail

image="${1:?image}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG=/openmrs/distribution/openmrs_config

shipped="$(docker run --rm --entrypoint find "$image" "$CONFIG" -type f | sed "s#^$CONFIG/##" | sort)"
[[ -n "$shipped" ]] || { echo "FAIL: $image has no resolved configuration at $CONFIG" >&2; exit 1; }

fail=0
sites=0
for site in "$ROOT"/content-packages/content-site-*; do
  [[ -d "$site/configuration/backend_configuration" ]] || continue
  sites=$((sites + 1))
  name="$(basename "$site")"
  while IFS= read -r f; do
    rel="${f#"$site/configuration/backend_configuration/"}"
    case "$(basename "$rel")" in .*) continue ;; esac
    domain="${rel%%/*}"
    if [[ "$domain" == "locations" ]]; then
      grep -qxF "$rel" <<<"$shipped" \
        || { echo "FAIL: $name's $rel is missing from $image" >&2; fail=1; }
    elif grep -qxF "$rel" <<<"$shipped"; then
      echo "FAIL: $image ships $name's site-only $rel" >&2
      fail=1
    fi
  done < <(find "$site/configuration/backend_configuration" -type f | sort)
done

(( sites > 0 )) || { echo "FAIL: no content-packages/content-site-* found" >&2; exit 1; }

# OpenMRS rejects a second non-retired location with a name another already has, whatever its
# parent and case-insensitively (ADR 0009 §3). With every site's locations side by side a
# clash between two site packages would only surface when central's Initializer ran, so check
# the names the image actually ships, across every locations CSV in it.
dups="$(docker run --rm --entrypoint sh "$image" -c "cat $CONFIG/locations/*.csv" \
  | python3 -c '
import csv, sys, collections
seen = collections.Counter()
for row in csv.reader(sys.stdin):
    if not row or row[0] == "Uuid":
        continue
    retired = len(row) > 1 and row[1].strip().lower() in ("true", "1", "yes")
    name = row[2].strip().lower() if len(row) > 2 else ""
    if name and not retired:
        seen[name] += 1
print("\n".join(sorted(n for n, c in seen.items() if c > 1)))
')"
if [[ -n "$dups" ]]; then
  echo "FAIL: $image ships locations whose names clash, which Initializer would reject:" >&2
  sed 's/^/  /' <<<"$dups" >&2
  fail=1
fi

# Central issues no facility-scoped identifier: the national MOH HRN auto-generation option
# points at a site's ID source, which central does not load (ADR 0012).
if grep -qxF "autogenerationoptions/autogenerationoptions-national.csv" <<<"$shipped"; then
  echo "FAIL: $image ships the MOH HRN auto-generation option, whose ID source is site-only" >&2
  fail=1
fi
(( fail == 0 )) || exit 1
echo "  ok: $image holds the locations of all $sites site packages and none of their other content"
