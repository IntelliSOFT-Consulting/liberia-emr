#!/usr/bin/env bash
# Fetches an OCL collection export into content-common's gitignored ocl/ directory.
#
#   OCL_API_TOKEN=... scripts/build/fetch-ciel.sh
#   OCL_API_TOKEN=... scripts/build/fetch-ciel.sh --version 2026-08-13
#   OCL_API_TOKEN=... OCL_COLLECTION=lab scripts/build/fetch-ciel.sh --no-smoke-test
#
# Normally you do not run this by hand: scripts/build/build-distribution.sh calls it for each
# collection in distro.properties (ocl.collections) at the version pinned there
# (ocl.collection.version), which is what keeps two builds of one tag identical. Run it
# directly to get a dictionary into a local checkout — see docs/runbooks/local-development.md.
#
# The caller should pin a released collection version with --version (or OCL_COLLECTION_VERSION)
# for repeatable builds. HEAD remains the default to keep local smoke-testing simple.
#
# Environment: OCL_API_TOKEN (required), OCL_ORG (default LIB), OCL_COLLECTION (default mch),
# OCL_API_URL, OCL_COLLECTION_VERSION, OCL_EXPORT_POLL_SECONDS, OCL_EXPORT_POLL_ATTEMPTS.
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DST_DIR="$ROOT/content-packages/content-common/configuration/backend_configuration/ocl"
readonly OCL_API_URL="${OCL_API_URL:-https://api.openconceptlab.org}"
readonly OCL_ORG="${OCL_ORG:-LIB}"
# One collection per run. The ocl/ README plans three — MCH first, then Laboratory and
# Pharmacy — so this is overridable rather than fixed; build-distribution.sh fetches each
# name in OCL_COLLECTIONS. The smoke test below only knows MCH concepts, so a non-MCH
# collection needs --no-smoke-test until this grows per-collection expectations.
readonly OCL_COLLECTION="${OCL_COLLECTION:-mch}"
readonly DEFAULT_VERSION="${OCL_COLLECTION_VERSION:-HEAD}"
readonly DEFAULT_POLL_SECONDS="${OCL_EXPORT_POLL_SECONDS:-15}"
readonly DEFAULT_POLL_ATTEMPTS="${OCL_EXPORT_POLL_ATTEMPTS:-40}"
readonly VAR_FILES=(
  "$ROOT/content-packages/content-common/configuration/variables.properties"
  "$ROOT/content-packages/content-liberia-mch/configuration/variables.properties"
)
readonly SMOKE_TEST_KEYS=(
  "var.concept.ciel.weight.uuid"
  "var.concept.ciel.yes.uuid"
  "var.concept.ciel.lmp.uuid"
  "var.concept.ciel.gravida.uuid"
  "var.concept.ciel.birth-weight.uuid"
)

token="${OCL_API_TOKEN:-}"
version="$DEFAULT_VERSION"
poll_seconds="$DEFAULT_POLL_SECONDS"
poll_attempts="$DEFAULT_POLL_ATTEMPTS"
skip_smoke_test="false"

usage() {
  cat <<'EOF'
Usage:
  OCL_API_TOKEN=... scripts/build/fetch-ciel.sh [--version <collection-version>] [--no-smoke-test]

Options:
  --token <token>              OCL API token. Defaults to OCL_API_TOKEN.
  --version <version>          Collection version to export. Defaults to OCL_COLLECTION_VERSION or HEAD.
  --poll-seconds <seconds>     Poll interval while waiting for OCL to build the export.
  --poll-attempts <count>      Maximum polling attempts before failing.
  --no-smoke-test              Skip the post-download concept presence checks. Required for
                               any collection other than mch — the checks look for MCH
                               concepts and would fail on a lab or pharmacy export.
  -h, --help                   Show this help text.

Environment:
  OCL_ORG                      OCL organisation. Defaults to LIB.
  OCL_COLLECTION               Collection to export. Defaults to mch.

build-distribution.sh drives this from distro.properties (ocl.org, ocl.collections,
ocl.collection.version); prefer changing it there over calling this script by hand.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      [[ $# -ge 2 ]] || { echo "FAIL: --token needs a value" >&2; exit 2; }
      token="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || { echo "FAIL: --version needs a value" >&2; exit 2; }
      version="$2"
      shift 2
      ;;
    --poll-seconds)
      [[ $# -ge 2 ]] || { echo "FAIL: --poll-seconds needs a value" >&2; exit 2; }
      poll_seconds="$2"
      shift 2
      ;;
    --poll-attempts)
      [[ $# -ge 2 ]] || { echo "FAIL: --poll-attempts needs a value" >&2; exit 2; }
      poll_attempts="$2"
      shift 2
      ;;
    --no-smoke-test)
      skip_smoke_test="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "FAIL: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$token" ]] || {
  echo "FAIL: set OCL_API_TOKEN or pass --token." >&2
  exit 2
}

[[ "$poll_seconds" =~ ^[0-9]+$ && "$poll_seconds" -gt 0 ]] || {
  echo "FAIL: --poll-seconds must be a positive integer." >&2
  exit 2
}

[[ "$poll_attempts" =~ ^[0-9]+$ && "$poll_attempts" -gt 0 ]] || {
  echo "FAIL: --poll-attempts must be a positive integer." >&2
  exit 2
}

[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "FAIL: --version must contain only letters, digits, '.', '_', or '-' (got: ${version})." >&2
  exit 2
}

sanitize_version() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's#[^a-z0-9._-]#-#g'
}

export_url() {
  printf '%s/orgs/%s/collections/%s/%s/export/' \
    "${OCL_API_URL%/}" "$OCL_ORG" "$OCL_COLLECTION" "$version"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
headers="$work/headers.txt"
body="$work/body.bin"

request_export() {
  local method="$1"
  curl --silent --show-error --location \
    --request "$method" \
    --header "Authorization: Token $token" \
    --header 'Accept: application/zip, application/json, */*' \
    --dump-header "$headers" \
    --output "$body" \
    --write-out '%{http_code}' \
    "$(export_url)"
}

# The name of the ZIP OCL is currently serving, e.g.
#   LIB_mch_vHEAD_autoexpand-HEAD.2026-07-18_184701.zip
# taken from the 302 Location that request_export follows. It carries the timestamp of the
# build, so it is what distinguishes a freshly generated export from the cached one — a bare
# 200 does not, because OCL keeps serving the old ZIP while the new one is still building.
export_object_name() {
  [[ -s "$headers" ]] || return 0
  tr -d '\r' < "$headers" \
    | sed -n 's#^[Ll]ocation:.*/\([^/?]*\.zip\).*#\1#p' \
    | tail -1
}

show_error_body() {
  if [[ -s "$body" ]]; then
    echo "----- response body -----" >&2
    python3 - "$body" <<'PY' >&2
import pathlib
import sys

body = pathlib.Path(sys.argv[1]).read_bytes()
print(body.decode("utf-8", "replace")[:2000])
PY
    echo "-------------------------" >&2
  fi
}

extract_ciel_id() {
  local key="$1"
  local file line value
  for file in "${VAR_FILES[@]}"; do
    [[ -f "$file" ]] || continue
    line="$(grep -E "^${key}=" "$file" | head -n 1 || true)"
    [[ -n "$line" ]] || continue
    value="${line#*=}"
    if [[ "$value" =~ ^([0-9]+)A+$ ]]; then
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done
  return 1
}

zip_contains_concept() {
  local zip_path="$1"
  local concept_id="$2"
  python3 - "$zip_path" "$concept_id" <<'PY'
import re
import sys
import zipfile

zip_path, concept_id = sys.argv[1], sys.argv[2]
patterns = [
    re.compile(rf'CIEL:{re.escape(concept_id)}\b'),
    re.compile(rf'(?:"mnemonic"|"id")\s*:\s*"?{re.escape(concept_id)}"?'),
    re.compile(rf'/concepts/{re.escape(concept_id)}/'),
]

with zipfile.ZipFile(zip_path) as archive:
    for name in archive.namelist():
        if name.endswith('/'):
            continue
        try:
            text = archive.read(name).decode('utf-8', 'ignore')
        except Exception:
            continue
        if any(pattern.search(text) for pattern in patterns):
            print(name)
            sys.exit(0)

sys.exit(1)
PY
}

mkdir -p "$DST_DIR"

if [[ "$version" == "HEAD" ]]; then
  echo "WARNING: exporting collection version HEAD. Pass --version to pin a released version." >&2
fi

echo "== requesting OCL export for ${OCL_ORG}/${OCL_COLLECTION} version ${version} =="

# A released version is immutable, so its cached export is always correct and reusing it is
# the whole point. HEAD is not: it moves every time anyone edits the collection, and OCL
# keeps serving the export ZIP built the last time someone asked. Accepting that cache meant
# adding five concepts to LIB/mch and then building against a snapshot from three weeks
# earlier — the fetch reported success, the export was 785 concepts, and the five were
# absent. Nothing downstream could tell the difference between that and a collection that
# had never been updated.
#
# So for HEAD, discard the cached export and build a new one.
#
# POST alone does not do it: while a cached export exists OCL answers POST with 303 See
# Other — "there is already one, use that" — and never rebuilds. The cached artifact has to
# be deleted first. That is safe: it is a generated ZIP, not collection data, and the POST
# immediately below regenerates it from the live collection.
stale_object=""
if [[ "$version" == "HEAD" ]]; then
  echo "== HEAD is mutable; rebuilding the export rather than reusing the cached one =="
  # Remember which ZIP is being served now, so the poll below can tell the new export from
  # this one. Without it, a GET that still returns the OLD ZIP would break the poll
  # immediately — reintroducing exactly the staleness this avoids.
  request_export GET >/dev/null || true
  stale_object="$(export_object_name)"
  [[ -n "$stale_object" ]] && echo "   discarding cached export: ${stale_object}"

  delete_status="$(request_export DELETE)"
  case "$delete_status" in
    # 204 deleted, 404 there was nothing cached. Either way there is now no export to reuse.
    204|404) ;;
    *)
      echo "FAIL: could not discard the cached HEAD export (HTTP ${delete_status})." >&2
      echo "  Without discarding it, OCL answers POST with 303 and keeps serving the old" >&2
      echo "  ZIP, so the build would silently use a stale dictionary." >&2
      show_error_body
      exit 1
      ;;
  esac

  queue_status="$(request_export POST)"
  case "$queue_status" in
    # 409 means one is already building — that is fine, the poll below waits for it.
    202|204|409)
      status=208
      ;;
    303)
      echo "FAIL: OCL still reports a cached export after it was deleted (HTTP 303)." >&2
      echo "  Retry; if it persists the export may have been rebuilt concurrently." >&2
      exit 1
      ;;
    *)
      echo "FAIL: could not queue export (HTTP ${queue_status})." >&2
      show_error_body
      exit 1
      ;;
  esac
else
  status="$(request_export GET)"
fi

case "$status" in
  200)
    ;;
  204)
    echo "== no cached export found; queueing a new export =="
    queue_status="$(request_export POST)"
    case "$queue_status" in
      202|204|409)
        status=208
        ;;
      *)
        echo "FAIL: could not queue export (HTTP ${queue_status})." >&2
        show_error_body
        exit 1
        ;;
    esac
    ;;
  208)
    ;;
  *)
    echo "FAIL: unexpected export status ${status} from $(export_url)" >&2
    show_error_body
    exit 1
    ;;
esac

if [[ "$status" == "208" ]]; then
  echo "== waiting for OCL to finish building the export =="
  for (( attempt=1; attempt<=poll_attempts; attempt++ )); do
    sleep "$poll_seconds"
    status="$(request_export GET)"
    case "$status" in
      200)
        # A 200 alone is not "ready": while the new export builds, OCL keeps serving the
        # previous ZIP. Only accept it once the object name has actually changed.
        current_object="$(export_object_name)"
        if [[ -n "$stale_object" && "$current_object" == "$stale_object" ]]; then
          echo "  attempt ${attempt}/${poll_attempts}: still serving the cached export (${current_object})"
        else
          [[ -n "$current_object" ]] && echo "   new export ready: ${current_object}"
          break
        fi
        ;;
      204|208)
        echo "  attempt ${attempt}/${poll_attempts}: export not ready yet"
        ;;
      *)
        echo "FAIL: export polling returned HTTP ${status}." >&2
        show_error_body
        exit 1
        ;;
    esac
  done
fi

[[ "$status" == "200" ]] || {
  echo "FAIL: export was not ready after ${poll_attempts} attempts (${poll_seconds}s each)." >&2
  exit 1
}

if ! unzip -tqq "$body" >/dev/null 2>&1; then
  echo "FAIL: OCL export did not download as a valid zip archive." >&2
  show_error_body
  exit 1
fi

# The collection is part of the name so several collections can sit side by side, and the
# sweep below is scoped to this one — it must never delete another collection's export.
dest_name="lib-$(sanitize_version "$OCL_COLLECTION")-ciel-$(sanitize_version "$version").zip"
dest_path="$DST_DIR/$dest_name"
find "$DST_DIR" -maxdepth 1 -type f \
  -name "lib-$(sanitize_version "$OCL_COLLECTION")-ciel-*.zip" ! -name "$dest_name" -delete
mv "$body" "$dest_path"

if [[ "$skip_smoke_test" != "true" ]]; then
  echo "== smoke-testing a few CIEL concepts declared in variables.properties =="
  tested=0
  for key in "${SMOKE_TEST_KEYS[@]}"; do
    if concept_id="$(extract_ciel_id "$key")"; then
      match_file="$(zip_contains_concept "$dest_path" "$concept_id" || true)"
      if [[ -z "$match_file" ]]; then
        echo "FAIL: expected ${key} (CIEL:${concept_id}) to be present in $(basename "$dest_path")." >&2
        exit 1
      fi
      echo "  ok: ${key} -> CIEL:${concept_id} (${match_file})"
      tested=$((tested + 1))
    fi
  done
  [[ "$tested" -gt 0 ]] || {
    echo "FAIL: no smoke-test concept ids could be read from variables.properties." >&2
    exit 1
  }
fi

echo
echo "saved OCL export to ${dest_path#$ROOT/}"
