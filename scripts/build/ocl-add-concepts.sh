#!/usr/bin/env bash
# Adds CIEL concept references to one of the MOH's OCL collections.
#
#   OCL_API_TOKEN=... scripts/build/ocl-add-concepts.sh 160090 160428
#   OCL_API_TOKEN=... scripts/build/ocl-add-concepts.sh --apply 160090 160428
#
# This WRITES TO THE MOH'S OCL ORGANISATION. It is not part of any build: nothing in
# scripts/build/build-distribution.sh calls it, and it must never be wired into CI. It exists
# so that "raise it with the collection maintainers" (see the ocl/ README) has a reviewable,
# repeatable procedure behind it instead of a hand-rolled curl in someone's shell history.
#
# It is DRY RUN by default. Without --apply it verifies every concept against CIEL, prints
# the exact request body it would send, and changes nothing.
#
# Adding a reference is not the end of the job. The build pins a RELEASED collection version
# (distro.properties -> ocl.collection.version), and references land on HEAD. Until the MOH
# cuts a new released version and that pin is bumped, this changes nothing downstream — the
# script says so at the end rather than leaving it implied.
#
# Environment: OCL_API_TOKEN (required), OCL_ORG (default LIB), OCL_COLLECTION (default mch),
# OCL_API_URL, OCL_CASCADE.
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly OCL_API_URL="${OCL_API_URL:-https://api.openconceptlab.org}"
readonly OCL_ORG="${OCL_ORG:-LIB}"
readonly OCL_COLLECTION="${OCL_COLLECTION:-mch}"
readonly CIEL_SOURCE="/orgs/CIEL/sources/CIEL"

# A coded question is useless without its answers, and a reference to the question alone does
# NOT bring them: OCL only follows concept-to-concept links when asked to cascade. CIEL 160090
# Presentation is exactly this case — imported bare it arrives as a coded question with an
# empty answer list, which fails differently from (and more confusingly than) not being there
# at all. sourcetoconcepts with include_mappings pulls the answer set and the mappings that
# make national aggregation work.
readonly OCL_CASCADE="${OCL_CASCADE:-sourcetoconcepts}"

token="${OCL_API_TOKEN:-}"
apply="false"
ids=()

usage() {
  cat <<'EOF'
Usage:
  OCL_API_TOKEN=... scripts/build/ocl-add-concepts.sh [--apply] <ciel-id> [<ciel-id> ...]

Options:
  --token <token>   OCL API token. Defaults to OCL_API_TOKEN. Needs WRITE access to the org.
  --apply           Actually add the references. Without it the script only verifies and
                    prints what it would send.
  --no-cascade      Add the bare concept without its answers or mappings. Only correct for a
                    concept that has neither.
  -h, --help        Show this help text.

Environment:
  OCL_ORG           OCL organisation. Defaults to LIB.
  OCL_COLLECTION    Collection to add to. Defaults to mch.

After a successful --apply the MOH must cut a new RELEASED collection version and
distribution/distro.properties (ocl.collection.version) must be bumped to it. Until then the
build keeps fetching the pinned version and will not see these concepts.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      [[ $# -ge 2 ]] || { echo "FAIL: --token needs a value" >&2; exit 2; }
      token="$2"; shift 2 ;;
    --apply) apply="true"; shift ;;
    --no-cascade) cascade=""; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "FAIL: unknown argument: $1" >&2; usage >&2; exit 2 ;;
    *) ids+=("$1"); shift ;;
  esac
done

cascade="${cascade-$OCL_CASCADE}"

[[ ${#ids[@]} -gt 0 ]] || { echo "FAIL: give at least one CIEL concept id." >&2; usage >&2; exit 2; }
[[ -n "$token" ]] || { echo "FAIL: set OCL_API_TOKEN or pass --token." >&2; exit 2; }

for id in "${ids[@]}"; do
  [[ "$id" =~ ^[0-9]+$ ]] || { echo "FAIL: '$id' is not a CIEL concept id." >&2; exit 2; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(--silent --show-error --location --request "$method"
              --header "Authorization: Token $token"
              --header 'Content-Type: application/json'
              --header 'Accept: application/json'
              --write-out '\n%{http_code}')
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}" "${OCL_API_URL%/}${path}"
}

http_code() { tail -n 1 <<<"$1"; }
http_body() { sed '$d' <<<"$1"; }

# ---------------------------------------------------------------------------
# Verify against CIEL before touching the collection.
#
# A typo here is expensive and quiet: OCL accepts a reference to a concept that does not
# exist, stores it as an unresolved expression, and the export simply comes back without it —
# which looks exactly like the problem this script was run to fix.
# ---------------------------------------------------------------------------
echo "== verifying ${#ids[@]} concept(s) against CIEL =="
expressions=()
for id in "${ids[@]}"; do
  response="$(api GET "${CIEL_SOURCE}/concepts/${id}/")"
  code="$(http_code "$response")"
  case "$code" in
    200) ;;
    401|403)
      echo "FAIL: CIEL rejected the token (HTTP ${code}). Anonymous OCL access is disabled," >&2
      echo "  so a token with at least read access is needed even to verify a concept." >&2
      exit 1 ;;
    404)
      echo "FAIL: CIEL:${id} does not exist. Nothing was added." >&2
      exit 1 ;;
    *)
      echo "FAIL: unexpected HTTP ${code} verifying CIEL:${id}." >&2
      http_body "$response" | head -c 500 >&2; echo >&2
      exit 1 ;;
  esac

  # The body goes to a file rather than down a pipe: `python3 -` takes its PROGRAM from
  # stdin, so a heredoc and piped data cannot coexist — the heredoc wins and json.load sees
  # nothing. Same reason fetch-ciel.sh passes a path.
  http_body "$response" > "$work/concept.json"

  # `|| rc=$?` rather than a bare call: under `set -e` a non-zero exit would end the script
  # before the retired case could be reported.
  rc=0
  python3 - "$work/concept.json" "$id" <<'PY' || rc=$?
import json, sys
concept = json.load(open(sys.argv[1], encoding="utf-8"))
cid = sys.argv[2]
name = concept.get("display_name")
retired = concept.get("retired")
print(f"  ok: CIEL:{cid}  {name}  [{concept.get('concept_class')}/{concept.get('datatype')}]"
      + ("  ** RETIRED **" if retired else ""))
# A retired concept still resolves, so this has to be checked rather than assumed. Importing
# one gives content a term that CIEL has already withdrawn.
if retired:
    sys.exit(3)
PY
  if [[ $rc -eq 3 ]]; then
    echo "FAIL: CIEL:${id} is retired upstream. Pick the replacement term instead." >&2
    exit 1
  fi
  expressions+=("${CIEL_SOURCE}/concepts/${id}/")
done

payload="$(python3 - "$cascade" "${expressions[@]}" <<'PY'
import json, sys
cascade, expressions = sys.argv[1], sys.argv[2:]
data = {"expressions": expressions}
if cascade:
    data["cascade"] = cascade
print(json.dumps({"data": data}, indent=2))
PY
)"

target="/orgs/${OCL_ORG}/collections/${OCL_COLLECTION}/references/"

echo
echo "== target: ${OCL_API_URL%/}${target} =="
echo "$payload"

if [[ "$apply" != "true" ]]; then
  echo
  echo "DRY RUN — nothing was sent. Re-run with --apply to add these references."
  exit 0
fi

echo
echo "== adding references to ${OCL_ORG}/${OCL_COLLECTION} =="
response="$(api PUT "$target" "$payload")"
code="$(http_code "$response")"
case "$code" in
  200|201|202)
    http_body "$response" | head -c 4000
    echo ;;
  401|403)
    echo "FAIL: the token lacks WRITE access to ${OCL_ORG}/${OCL_COLLECTION} (HTTP ${code})." >&2
    exit 1 ;;
  *)
    echo "FAIL: adding references returned HTTP ${code}." >&2
    http_body "$response" | head -c 1000 >&2; echo >&2
    exit 1 ;;
esac

echo
echo "== confirming the concepts are now in the collection HEAD =="
missing=0
for id in "${ids[@]}"; do
  response="$(api GET "/orgs/${OCL_ORG}/collections/${OCL_COLLECTION}/concepts/${id}/")"
  if [[ "$(http_code "$response")" == "200" ]]; then
    echo "  ok: CIEL:${id} present"
  else
    echo "  MISSING: CIEL:${id} did not land" >&2
    missing=$((missing + 1))
  fi
done
[[ "$missing" -eq 0 ]] || { echo "FAIL: ${missing} concept(s) did not land." >&2; exit 1; }

pinned="$(grep -E '^ocl\.collection\.version=' "$ROOT/distribution/distro.properties" | cut -d= -f2- || true)"
cat <<EOF

Added to ${OCL_ORG}/${OCL_COLLECTION} HEAD. TWO STEPS REMAIN, and without them nothing changes
for any build:

  1. Cut a new RELEASED collection version in OCL. References land on HEAD; the build fetches
     a released version.
  2. Bump ocl.collection.version in distribution/distro.properties (currently: ${pinned:-<empty>})
     to that new version, then re-run scripts/build/fetch-ciel.sh and confirm the concepts are
     in the export.
EOF
