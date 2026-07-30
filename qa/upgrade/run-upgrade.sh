#!/usr/bin/env bash
# Upgrade test: previous release's database -> new release -> data still valid.
#
#   qa/upgrade/run-upgrade.sh [--from 1.0.0] [--to 1.1.0]
#
# THE critical release gate. A clean install runs against an empty database where nothing
# can collide. This is the only test that runs new metadata against a database that already
# contains patients, and therefore the only one that surfaces UUID collisions, changed
# concept datatypes, retired metadata still referenced by patient data, and altered
# workflow semantics. See README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$ROOT/qa/upgrade/fixtures"
FROM=""
TO="${LIBERIAEMR_VERSION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --to)   TO="$2";   shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Default --from to the most recent release tag.
if [[ -z "$FROM" ]]; then
  FROM="$(git -C "$ROOT" tag --list '[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1)"
fi

if [[ -z "$FROM" ]]; then
  echo "No previous release tag exists — nothing to upgrade from." >&2
  echo "This is expected for the FIRST release only. Every release after it must pass" >&2
  echo "this test before publishing." >&2
  exit 0
fi

fixture="$FIXTURES/${FROM}.sql.gz"
if [[ ! -f "$fixture" ]]; then
  cat >&2 <<MSG
FAIL: no upgrade fixture for release ${FROM}: ${fixture#$ROOT/}

The fixture is a database dump representing the previous release, built from the demo
content package plus SYNTHETIC patients — never a copy of production, which would put PHI
in a CI runner.

It must cover: patients in each MCH programme, patients in each workflow state, encounters
of every encounter type, and observations on every concept whose datatype might change.

See qa/upgrade/README.md.
MSG
  exit 1
fi

echo "upgrade test ${FROM} -> ${TO:-<unset>}"
echo
echo "NOT IMPLEMENTED: restore the fixture, start at ${TO}, then assert:" >&2
cat >&2 <<'ASSERTIONS'
  * every pre-existing patient is still retrievable
  * observation counts per patient are unchanged
  * no observation is orphaned from its concept
  * programme enrolments and workflow states survive
  * encounters still resolve to an encounter type and a form
  * no ${var.*} placeholder appears in loaded metadata
  * Initializer reported zero errors
ASSERTIONS
exit 1
