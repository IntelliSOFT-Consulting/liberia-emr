#!/usr/bin/env bash
# Fetches the LIB/mch OCL collection export into content-common's gitignored ocl/ directory.
#
#   OCL_API_TOKEN=... scripts/build/fetch-ciel.sh
#   OCL_API_TOKEN=... scripts/build/fetch-ciel.sh --version 2026-08-13
#
# The caller should pin a released collection version with --version (or OCL_COLLECTION_VERSION)
# for repeatable builds. HEAD remains the default to keep local smoke-testing simple.
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DST_DIR="$ROOT/content-packages/content-common/configuration/backend_configuration/ocl"
readonly OCL_API_URL="${OCL_API_URL:-https://api.openconceptlab.org}"
readonly OCL_ORG="LIB"
readonly OCL_COLLECTION="mch"
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
  --no-smoke-test              Skip the post-download concept presence checks.
  -h, --help                   Show this help text.
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
status="$(request_export GET)"

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
        break
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

dest_name="lib-mch-ciel-$(sanitize_version "$version").zip"
dest_path="$DST_DIR/$dest_name"
find "$DST_DIR" -maxdepth 1 -type f -name 'lib-mch-ciel-*.zip' ! -name "$dest_name" -delete
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
