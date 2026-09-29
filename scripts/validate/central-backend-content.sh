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
(( fail == 0 )) || exit 1
echo "  ok: $image holds the locations of all $sites site packages and none of their other content"
