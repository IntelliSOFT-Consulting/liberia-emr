#!/usr/bin/env bash
# Checks a compose file's SPA_CONFIG_URLS against the config order a build actually collected.
#
#   scripts/validate/spa-config-urls.sh <compose-file> <collected .config-urls file>
#
# A config file is only loaded if it is BOTH in the frontend image and named in the list the
# image was built with, and the order there is the override order. Nothing fails at runtime
# when the compose file and the build disagree: O3 quietly runs on the wrong configuration.
# build-distribution.sh bakes the collected order into the image; the compose value is what
# an operator reads, so the two are held equal here. Used by build-distribution.sh, and by CI
# for the central build, which CI does not otherwise build.
set -euo pipefail

compose="${1:?compose file}"
collected="${2:?collected .config-urls file}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

declared="$(sed -n '/SPA_CONFIG_URLS/,/^ *[A-Za-z_]*:/p' "$compose" \
  | grep -oE '/openmrs/spa/config/[A-Za-z0-9._-]+\.json')"
if ! diff -u <(echo "$declared") "$collected" \
     --label "SPA_CONFIG_URLS in ${compose#$ROOT/}" --label "collected in layer order"; then
  echo "FAIL: SPA_CONFIG_URLS does not match the collected configuration" >&2
  exit 1
fi
echo "  ok: $(echo "$declared" | wc -l | tr -d ' ') config files, in order (${compose#$ROOT/})"
