#!/usr/bin/env bash
# Builds every content package to a versioned Maven ZIP.
#
#   scripts/build/build-content.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"$ROOT/scripts/validate/validate-content.sh"

# `verify` (not `package`) so the packager plugin's validate-content-package and
# validate-configurations goals run.
mvn -B -f "$ROOT/pom.xml" clean verify

echo
echo "built:"
find "$ROOT/content-packages" -path '*/target/*.zip' -exec basename {} \;
