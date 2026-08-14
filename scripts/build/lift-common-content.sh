#!/usr/bin/env bash
# Fetches the gitignored OCL ZIPs for content-common from the pinned upstream
# reference-application demo tag.
#
#   scripts/build/lift-common-content.sh
#
# content-common needs the same clinical concept dictionaries as the demo
# (CIEL drugs, labs, diagnoses, billing, SOAP, etc.), but NOT the demo-only
# concept sets that have no place in a production facility:
#
#   DemoQueueConcepts  — queue status/priority concepts only valid in demo
#   DemoPrograms       — demo training programme concepts
#   GenericDemoForm    — demo form placeholder concepts
#
# Every ZIP is renamed to end in -common.zip so that validate-content.sh's
# layer file-name uniqueness check never sees the same bare name in both
# content-common and content-demo.
#
# The source tag is pinned to the same commit as lift-demo-content.sh so that
# two builds of the same LiberiaEMR version get identical concept dictionaries.
set -euo pipefail

UPSTREAM_REPO="https://github.com/openmrs/openmrs-content-referenceapplication-demo.git"
UPSTREAM_TAG="1.9.2"
UPSTREAM_COMMIT="199711118da1b6ebab46252f1533bab48d318241"

# OCL package name fragments that are demo-only and must NOT land in content-common.
DEMO_ONLY_PATTERNS=(
  "DemoQueueConcepts"
  "DemoPrograms"
  "GenericDemoForm"
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DST="$ROOT/content-packages/content-common/configuration/backend_configuration/ocl"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== fetching ${UPSTREAM_REPO##*/} at ${UPSTREAM_TAG} =="
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$UPSTREAM_TAG" \
  "$UPSTREAM_REPO" "$work/upstream"

# Verify the pinned commit — a tag can be moved, the commit cannot.
got="$(git -C "$work/upstream" rev-parse HEAD)"
if [[ "$got" != "$UPSTREAM_COMMIT" ]]; then
  echo "FAIL: tag ${UPSTREAM_TAG} now points at ${got}, not ${UPSTREAM_COMMIT}" >&2
  echo "      Review the difference before updating UPSTREAM_COMMIT in this script." >&2
  exit 1
fi

SRC="$work/upstream/configuration/backend_configuration/ocl"
mkdir -p "$DST"

copied=0
skipped=0

for zip in "$SRC"/*.zip; do
  [[ -f "$zip" ]] || continue
  name="$(basename "$zip" .zip)"

  # Skip demo-only concept sets.
  skip=false
  for pattern in "${DEMO_ONLY_PATTERNS[@]}"; do
    if [[ "$name" == *"$pattern"* ]]; then
      echo "  skip (demo-only): $(basename "$zip")"
      skip=true
      (( skipped++ )) || true
      break
    fi
  done
  $skip && continue

  # Rename to -common.zip so the validate-content.sh layer uniqueness check
  # never collides with the identically-named file in content-demo/ocl/.
  dest="$DST/${name}-common.zip"
  cp "$zip" "$dest"
  echo "  fetched: $(basename "$dest")"
  (( copied++ )) || true
done

echo
echo "fetched ${copied} OCL exports into content-common (skipped ${skipped} demo-only)"
echo "OCL exports are gitignored — they are present in the working copy but never committed."
