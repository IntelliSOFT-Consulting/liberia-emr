#!/usr/bin/env bash
# Builds the immutable, versioned LiberiaEMR images.
#
#   scripts/build/build-distribution.sh --version 1.0.0 [--site careysburg] [--demo]
#                                       [--no-frontend] [--no-sync]
#
# Images: liberia-emr-backend|-frontend|-gateway|-sync|-sync-receiver|-broker|-cert-expiry :<version>
# A mutable git checkout is never mounted into a production container.
#
# --no-frontend skips ONLY the frontend image, whose assemble stage npm-installs the O3 app
# shell and downloads every pinned ESM — minutes, and the largest single cost here. It is for
# callers that exercise the backend alone, i.e. the clean-install gate in CI; a release must
# never use it, because the three images are versioned as one distribution. Everything the
# frontend image depends on still runs, so the SPA_CONFIG_URLS drift check below keeps its
# value on every build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=""
SITE="careysburg"
DEMO="false"
FRONTEND=true
SYNC=true
REGISTRY="${REGISTRY:-intellisoftdev}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     VERSION="$2"; shift 2 ;;
    --site)        SITE="$2";    shift 2 ;;
    --demo)        DEMO="true";  shift ;;
    --no-frontend) FRONTEND="false"; shift ;;
    --no-sync)     SYNC="false"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$VERSION" ]] || { echo "--version is required" >&2; exit 2; }

case "$VERSION" in
  *SNAPSHOT*|latest)
    echo "refusing to build a release image at version '$VERSION'" >&2
    echo "distro.properties forbids latest/dynamic/-SNAPSHOT outside development." >&2
    exit 2 ;;
esac

"$ROOT/scripts/validate/validate-content.sh"
"$ROOT/scripts/validate/no-secrets.sh"

if [[ "$DEMO" == "false" ]]; then
  "$ROOT/scripts/validate/no-demo-in-release.sh"
  suffix=""
  demo_package=""
  ocl_dir="$ROOT/content-packages/content-common/configuration/backend_configuration/ocl"

  # Two different dictionaries land here and they are NOT interchangeable, so each is guarded
  # by its own file name. A single "any *.zip present" guard made them mutually exclusive:
  # whichever ran first satisfied it and the other never ran at all.
  #
  # 1. The upstream reference-application exports (*-common.zip) — no credentials needed.
  if ! compgen -G "$ocl_dir/*-common.zip" >/dev/null; then
    echo "== fetching the common OCL exports =="
    "$ROOT/scripts/build/lift-common-content.sh"
  fi

  # 2. The MOH's own curated CIEL collections (lib-<collection>-ciel-*.zip). This is the
  # subset the ocl/ README means by "Do not load all of CIEL": a build that skips it still
  # produces images, but every concept mapping to a CIEL source fails to load, so say so
  # rather than let it pass silently.
  ocl_org="$(sed -n 's/^ocl\.org=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"
  ocl_collections="$(sed -n 's/^ocl\.collections=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"
  ocl_version="$(sed -n 's/^ocl\.collection\.version=//p' "$ROOT/distribution/distro.properties" | tr -d '[:space:]')"

  if [[ -z "${OCL_API_TOKEN:-}" ]]; then
    echo "WARNING: OCL_API_TOKEN is not set — skipping the MOH CIEL collections." >&2
    echo "         Concepts that map to a CIEL source will not load in these images." >&2
    echo "         See content-packages/content-common/configuration/backend_configuration/ocl/README.md" >&2
  else
    if [[ -z "$ocl_version" ]]; then
      echo "WARNING: ocl.collection.version is empty in distro.properties — exporting HEAD." >&2
      echo "         A release must pin a published collection version; HEAD is not reproducible." >&2
    fi
    for collection in ${ocl_collections//,/ }; do
      expected_zip="$ocl_dir/lib-${collection}-ciel-${ocl_version:-head}.zip"
      if [[ -f "$expected_zip" ]]; then
        echo "== OCL collection ${collection} already present =="
        continue
      fi
      # Delete stale cached zips for this collection if the version changed
      rm -f "$ocl_dir/lib-${collection}-ciel-"*.zip
      echo "== fetching the OCL collection ${ocl_org}/${collection} =="
      # Only MCH has smoke-test expectations in fetch-ciel.sh.
      smoke=()
      [[ "$collection" == "mch" ]] || smoke=(--no-smoke-test)
      # ${smoke[@]+"${smoke[@]}"}, not "${smoke[@]}": under `set -u` bash 3.2 — which is
      # what macOS still ships — treats expanding an EMPTY array as an unbound variable and
      # aborts. That is precisely the mch case, where smoke stays empty, so the fetch died
      # the first time a token made this branch reachable at all. bash 4.4+ (every CI runner
      # here) is happy either way, so this would have stayed a macOS-only failure.
      OCL_ORG="$ocl_org" OCL_COLLECTION="$collection" \
        "$ROOT/scripts/build/fetch-ciel.sh" \
          ${ocl_version:+--version "$ocl_version"} ${smoke[@]+"${smoke[@]}"}
    done
  fi

  "$ROOT/scripts/build/sanitize-ocl-export.sh" \
    "$ROOT"/content-packages/content-common/configuration/backend_configuration/ocl/*.zip

  # Every ${var.*} holding a CIEL-style UUID must match the external_id the export actually
  # carries. Most CIEL concepts use <id> padded with A to 36 characters, so that convention
  # gets assumed — but it is NOT universal: newer concepts (the 167xxx-169xxx range at least)
  # have random UUIDs. Padding one of those yields a UUID no concept has, and the failure
  # surfaces an hour later as "The object identified by '169401AAAA...' could not be found in
  # database" on whichever row referenced it, naming neither the variable nor the file.
  #
  # Only checkable here: the exports are gitignored, so validate-content.sh cannot see them.
  echo "== checking CIEL variables against the shipped exports =="
  python3 - "$ROOT" <<'PY' || { echo "FAIL: CIEL UUID mismatch (see above)" >&2; exit 1; }
import glob, json, os, re, sys, zipfile

root = sys.argv[1]
ext = {}
for z in glob.glob(f"{root}/content-packages/*/configuration/backend_configuration/ocl/*.zip"):
    try:
        with zipfile.ZipFile(z) as f:
            if "export.json" not in f.namelist():
                continue
            d = json.loads(f.read("export.json"))
    except Exception:
        continue
    for c in d.get("concepts") or []:
        cid, e = str(c.get("id") or ""), str(c.get("external_id") or "")
        if cid and e:
            ext.setdefault(cid, e)

bad = []
for vf in sorted(glob.glob(f"{root}/content-packages/*/configuration/variables.properties")):
    for line in open(vf):
        s = line.strip()
        if s.startswith("#") or "=" not in s:
            continue
        k, v = (p.strip() for p in s.split("=", 1))
        m = re.fullmatch(r"(\d+)A+", v)
        if m and m.group(1) in ext and ext[m.group(1)] != v:
            bad.append((os.path.basename(os.path.dirname(os.path.dirname(vf))), k, m.group(1), v, ext[m.group(1)]))

for pkg, k, cid, declared, actual in bad:
    print(f"  {k}  [{pkg}]", file=sys.stderr)
    print(f"      CIEL:{cid} is {actual}, not {declared}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY
else
  echo "WARNING: building DEMO images — training and test use only."
  suffix="-demo"
  demo_package="liberiaemr-demo"
  # content-demo is lifted from upstream; its OCL exports are gitignored, so a fresh
  # checkout has the CSVs and forms but none of the concepts they reference.
  if ! compgen -G "$ROOT/content-packages/content-demo/configuration/backend_configuration/ocl/*.zip" >/dev/null; then
    echo "== fetching the demo OCL exports =="
    "$ROOT/scripts/build/lift-demo-content.sh" --ocl-only
  fi
  "$ROOT/scripts/build/sanitize-ocl-export.sh" \
    "$ROOT"/content-packages/content-demo/configuration/backend_configuration/ocl/*.zip
fi


# Builds the content ZIPs and, with them, target/configuration — the tree with ${var.*}
# resolved. The backend image builds these again inside its own content stage; the local
# build is what the frontend config collection below reads.
echo "== building content packages =="
mvn -B -q -DskipTests -f "$ROOT/pom.xml" clean package

# The content CSVs are now resolved (target/configuration), and the dictionary ZIPs are on
# disk, so this is the only point at which the two can be compared. concept_name is unique
# per locale for a fully specified name, so a content concept that claims a name an imported
# CIEL concept already owns under a DIFFERENT UUID loses with DuplicateConceptNameException
# — one row rejected, the whole clean-install gate red, and the message names neither the
# file nor the dictionary it collided with. validate-content.sh catches the same clash
# between two content CSVs; the exports are gitignored, so it cannot see this half.
echo "== checking concept names against the shipped dictionaries =="
python3 - "$ROOT" "$DEMO" <<'PY' || { echo "FAIL: concept name collides with the dictionary (see above)" >&2; exit 1; }
import csv, glob, json, os, sys, zipfile

root, demo = sys.argv[1], sys.argv[2] == "true"

# (locale, casefolded name) -> (external_id, dictionary) for every FULLY_SPECIFIED name the
# exports carry. Synonyms are excluded: OpenMRS only enforces uniqueness on the fully
# specified name.
owned = {}

def in_this_build(path):
    """A distribution ships the demo layer or the production layers, never both."""
    pkg = path[len(f"{root}/content-packages/"):].split(os.sep)[0]
    return (pkg == "content-demo") == demo

for z in glob.glob(f"{root}/content-packages/*/configuration/backend_configuration/ocl/*.zip"):
    if not in_this_build(z):
        continue
    try:
        with zipfile.ZipFile(z) as f:
            if "export.json" not in f.namelist():
                continue
            export = json.loads(f.read("export.json"))
    except Exception:
        continue
    for concept in export.get("concepts") or []:
        ext = str(concept.get("external_id") or "")
        if not ext:
            continue
        for name in concept.get("names") or []:
            if not isinstance(name, dict) or name.get("name_type") != "FULLY_SPECIFIED":
                continue
            if name.get("retired") is True:
                continue
            text = (name.get("name") or "").strip()
            if text:
                owned.setdefault(((name.get("locale") or "en"), text.casefold()),
                                 (ext, os.path.basename(z)))

collisions = []
for f in sorted(glob.glob(
        f"{root}/content-packages/*/target/configuration/backend_configuration/concepts/*.csv")):
    if not in_this_build(f):
        continue
    with open(f, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    fsn_cols = [c for c in (rows[0].keys() if rows else [])
                if c and c.strip().lower().startswith("fully specified name")]
    for n, row in enumerate(rows, start=2):
        uuid = (row.get("Uuid") or "").strip()
        for col in fsn_cols:
            locale = col.split(":", 1)[1].strip() if ":" in col else "en"
            text = (row.get(col) or "").strip()
            if not uuid or not text:
                continue
            held = owned.get((locale, text.casefold()))
            if held and held[0] != uuid:
                collisions.append(
                    f"{os.path.basename(f)}:{n} names {uuid} '{text}' in locale '{locale}', "
                    f"but {held[1]} already gives that name to {held[0]}")

for c in collisions:
    print(f"  {c}", file=sys.stderr)
sys.exit(1 if collisions else 0)
PY

echo "== resolving OMODs from distro.properties =="
"$ROOT/scripts/build/resolve-modules.sh" --out "$ROOT/distribution/backend/modules"

echo "== generating the frontend import map =="
"$ROOT/scripts/build/generate-import-map.sh" --out "$ROOT/distribution/frontend/spa-assemble-config.json"

echo "== collecting frontend runtime configuration =="
"$ROOT/scripts/build/collect-frontend-config.sh" --site "$SITE" --demo "$DEMO" \
  --out "$ROOT/distribution/frontend/config"

# A config file is only loaded if it is BOTH in the image and named in SPA_CONFIG_URLS, and
# the order there is the override order. Nothing fails at runtime when the two disagree —
# O3 just quietly runs on the wrong configuration — so the drift is caught here instead.
echo "== checking SPA_CONFIG_URLS against what was collected =="
compose="$ROOT/distribution/compose/facility/docker-compose.yml"
[[ "$DEMO" == "true" ]] && compose="$ROOT/distribution/compose/facility/docker-compose.demo.yml"
declared="$(sed -n '/SPA_CONFIG_URLS/,/^ *[A-Za-z_]*:/p' "$compose" \
  | grep -oE '/openmrs/spa/config/[A-Za-z0-9._-]+\.json')"
if ! diff -u <(echo "$declared") "$ROOT/distribution/frontend/config/.config-urls" \
     --label "SPA_CONFIG_URLS in ${compose#$ROOT/}" --label "collected in layer order"; then
  echo "FAIL: SPA_CONFIG_URLS does not match the collected configuration" >&2
  exit 1
fi
echo "  ok: $(echo "$declared" | wc -l | tr -d ' ') config files, in order"

echo "== backend =="
docker build \
  -f "$ROOT/distribution/backend/Dockerfile" \
  --build-arg "SITE_PACKAGE=liberiaemr-site-${SITE}" \
  --build-arg "DEMO_PACKAGE=${demo_package}" \
  --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
  -t "${REGISTRY}/liberia-emr-backend${suffix}:${VERSION}" \
  "$ROOT"

if [[ "$FRONTEND" == "true" ]]; then
  echo "== frontend =="
  spa_core="$(grep -E '^spa\.core=' "$ROOT/distribution/distro.properties" | cut -d= -f2)"
  [[ -n "$spa_core" ]] || { echo "spa.core is not pinned in distro.properties" >&2; exit 1; }
  # The app shell resolves its configuration from the list it was BUILT with; the compose
  # environment cannot add to it. Same order the files were collected in, which the check
  # above has already reconciled with SPA_CONFIG_URLS in the compose file.
  spa_config_urls="$(paste -sd, "$ROOT/distribution/frontend/config/.config-urls")"
  docker build \
    -f "$ROOT/distribution/frontend/Dockerfile" \
    --build-arg "SPA_CORE=${spa_core}" \
    --build-arg "SPA_CONFIG_URLS=${spa_config_urls}" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-frontend${suffix}:${VERSION}" \
    "$ROOT/distribution/frontend"
else
  echo "== frontend == SKIPPED (--no-frontend)"
fi

echo "== gateway =="
docker build \
  -f "$ROOT/distribution/gateway/Dockerfile" \
  --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
  -t "${REGISTRY}/liberia-emr-gateway:${VERSION}" \
  "$ROOT/distribution/gateway"

# The sync images never ship in a demo distribution: the demo overlay disables the
# service three ways over, so building them would only invite running them.
if [[ "$SYNC" == "true" && "$DEMO" == "false" ]]; then
  dbsync_version="$(grep -E '^sync\.dbsync=' "$ROOT/distribution/distro.properties" | cut -d= -f2)"
  [[ -n "$dbsync_version" ]] || { echo "sync.dbsync is not pinned in distro.properties" >&2; exit 1; }
  echo "== sync sender =="
  docker build \
    -f "$ROOT/distribution/sync/Dockerfile" \
    --target sender \
    --build-arg "DBSYNC_VERSION=${dbsync_version}" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-sync:${VERSION}" \
    "$ROOT/distribution/sync"
  echo "== sync receiver =="
  docker build \
    -f "$ROOT/distribution/sync/Dockerfile" \
    --target receiver \
    --build-arg "DBSYNC_VERSION=${dbsync_version}" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-sync-receiver:${VERSION}" \
    "$ROOT/distribution/sync"
  echo "== sync broker =="
  docker build \
    -f "$ROOT/distribution/broker/Dockerfile" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-broker:${VERSION}" \
    "$ROOT/distribution/broker"
  echo "== certificate expiry exporter =="
  docker build \
    -f "$ROOT/distribution/monitoring/cert-expiry/Dockerfile" \
    --build-arg "LIBERIAEMR_VERSION=${VERSION}" \
    -t "${REGISTRY}/liberia-emr-cert-expiry:${VERSION}" \
    "$ROOT/distribution/monitoring/cert-expiry"
else
  echo "== sync sender/receiver/broker/cert-expiry == SKIPPED ($([[ "$DEMO" == "true" ]] && echo demo build || echo --no-sync))"
fi

echo
echo "built ${VERSION} (site: ${SITE}, demo: ${DEMO}, frontend: ${FRONTEND}, sync: ${SYNC})"
