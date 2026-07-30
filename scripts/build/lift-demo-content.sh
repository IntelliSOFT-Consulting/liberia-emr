#!/usr/bin/env bash
# Lifts content-packages/content-demo/configuration/ from the OpenMRS reference
# application demo content package.
#
#   scripts/build/lift-demo-content.sh              # re-lift the whole tree
#   scripts/build/lift-demo-content.sh --ocl-only   # fetch just the gitignored OCL ZIPs
#   scripts/build/lift-demo-content.sh --check      # fail if the tree has drifted
#
# content-demo is NOT ours to author. It is the community demo dataset, vendored so that a
# training stack builds from this repository alone — offline, with no dependency on GitHub
# being reachable in a Monrovia classroom. Everything under configuration/ is therefore
# upstream's: edit it there, then re-lift here.
#
# The tag is PINNED. A floating fetch would make two builds of the same LiberiaEMR tag
# produce different demo metadata, which is exactly the drift distro.properties exists to
# prevent (IMPLEMENTATION.md §6).
set -euo pipefail

UPSTREAM_REPO="https://github.com/openmrs/openmrs-content-referenceapplication-demo.git"
UPSTREAM_TAG="1.9.2"
UPSTREAM_COMMIT="199711118da1b6ebab46252f1533bab48d318241"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DST="$ROOT/content-packages/content-demo/configuration"
MODE="full"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ocl-only) MODE="ocl";   shift ;;
    --check)    MODE="check"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== fetching ${UPSTREAM_REPO##*/} at ${UPSTREAM_TAG} =="
# git prints "refs/tags/1.9.2 ... is not a commit!" here — a known shallow-clone quirk with
# an annotated tag, not a failed fetch. The rev-parse below is the real check.
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$UPSTREAM_TAG" \
  "$UPSTREAM_REPO" "$work/upstream"

# A tag can be moved. The commit it pointed at when this content was lifted cannot, so the
# fetch is verified rather than trusted.
got="$(git -C "$work/upstream" rev-parse HEAD)"
if [[ "$got" != "$UPSTREAM_COMMIT" ]]; then
  echo "FAIL: tag ${UPSTREAM_TAG} now points at ${got}, not ${UPSTREAM_COMMIT}" >&2
  echo "      Review the difference before updating UPSTREAM_COMMIT in this script." >&2
  exit 1
fi

SRC="$work/upstream/configuration"

if [[ "$MODE" == "ocl" ]]; then
  mkdir -p "$DST/backend_configuration/ocl"
  cp "$SRC/backend_configuration/ocl/"*.zip "$DST/backend_configuration/ocl/"
  echo "fetched $(ls "$DST/backend_configuration/ocl/"*.zip | wc -l | tr -d ' ') OCL exports"
  exit 0
fi

# Staged first, so a failed lift cannot leave a half-replaced tree in the working copy.
stage="$work/stage"
mkdir -p "$stage"
cp -R "$SRC/." "$stage/"

# Upstream placeholders for directories that are populated here.
find "$stage" -name '.gitkeep' -delete

# Frontend configuration is collected by basename glob 'config-*.json' in layer order
# (scripts/build/collect-frontend-config.sh). Upstream's config.json would be skipped
# silently — collected nothing, failed nothing — so it is renamed on the way in.
if [[ -f "$stage/frontend_configuration/config.json" ]]; then
  mv "$stage/frontend_configuration/config.json" "$stage/frontend_configuration/config-demo.json"
fi

# LiberiaEMR-owned files inside the lifted tree. variables.properties is ours by the layout
# every content package follows; the ocl README explains why the ZIPs beside it are not
# committed. Both survive a re-lift.
cp "$DST/variables.properties" "$stage/variables.properties"
cp "$DST/backend_configuration/ocl/README.md" "$stage/backend_configuration/ocl/README.md"

if [[ "$MODE" == "check" ]]; then
  # Compare against what is committed: the OCL ZIPs are gitignored and may or may not have
  # been fetched into the working copy, so they are not part of the comparison.
  if diff -r -q --exclude='*.zip' "$stage" "$DST" >/dev/null 2>&1; then
    echo "content-demo matches ${UPSTREAM_TAG}"
    exit 0
  fi
  echo "FAIL: content-demo has drifted from ${UPSTREAM_TAG}" >&2
  diff -r --exclude='*.zip' "$stage" "$DST" | head -40 >&2
  echo "      Run scripts/build/lift-demo-content.sh to re-lift, or move the local edit" >&2
  echo "      into a content-liberia-* package where it belongs." >&2
  exit 1
fi

rm -rf "$DST"
cp -R "$stage" "$DST"

echo
echo "lifted $(find "$DST" -type f ! -name '*.zip' | wc -l | tr -d ' ') files from ${UPSTREAM_TAG} (${UPSTREAM_COMMIT:0:12})"
echo "OCL exports are gitignored: they stay in the working copy but are never committed."
