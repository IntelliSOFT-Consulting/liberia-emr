#!/usr/bin/env bash
# Guards the one rule with no acceptable exception: content-demo never ships to production.
#
#   scripts/validate/no-demo-in-release.sh
#
# Runs in CI on every release build. See content-packages/content-demo/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail=0

if grep -qE '^[[:space:]]*content\.liberiaemr-demo[[:space:]]*=' "$ROOT/distribution/distro.properties"; then
  echo "FAIL: content.liberiaemr-demo is listed in distro.properties" >&2
  fail=1
fi

# Demo metadata must not have leaked into any production package.
while IFS= read -r f; do
  echo "FAIL: demo content outside content-demo: ${f#$ROOT/}" >&2
  fail=1
done < <(grep -rl --include='*.csv' --include='*.json' -iE 'demo patient|test user|training data' \
           "$ROOT/content-packages" 2>/dev/null | grep -v '/content-demo/' || true)

[[ $fail -eq 0 ]] && echo "no demo content in the release" || exit 1
