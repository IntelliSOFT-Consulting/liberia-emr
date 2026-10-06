#!/usr/bin/env bash
# Tests for scripts/validate/released-uuids.sh (LE-399).
#
#   scripts/validate/tests/released-uuids.test.sh
#
# Each case builds a throwaway repository holding a minimal content package, tags it as a
# release, applies one change, and runs the guard against it (RELEASED_UUIDS_ROOT).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../released-uuids.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
passed=0 failed=0

PKG=content-packages/content-x/configuration
VARS="$PKG/variables.properties"
CSV="$PKG/backend_configuration/concepts/concepts-x.csv"

# A released package: two concept variables, a form variable, and a concept CSV with a row
# through a variable and a literal row.
release() { # repo [tag]
  local repo="$1" tag="${2-liberiaemr-1.0.0}"
  mkdir -p "$repo/$(dirname "$CSV")" "$repo/content-packages/content-demo/configuration"
  cat > "$repo/$VARS" <<'EOF'
var.concept.alpha.uuid=11111111-1111-4111-8111-111111111111
var.concept.beta.uuid=22222222-2222-4222-8222-222222222222
var.form.intake.uuid=33333333-3333-3333-8333-333333333333
var.concept.ciel-fever.uuid=140238AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
EOF
  cat > "$repo/$CSV" <<'EOF'
Uuid,Void/Retire,Fully specified name:en,Data class,Data type
${var.concept.alpha.uuid},,Alpha,Finding,Numeric
44444444-4444-4444-8444-444444444444,,Literal concept,Misc,Text
EOF
  echo 'var.concept.demo.uuid=55555555-5555-4555-8555-555555555555' > "$repo/content-packages/content-demo/configuration/variables.properties"
  git -C "$repo" init -q
  git -C "$repo" -c user.email=t@t -c user.name=t add -A
  git -C "$repo" -c user.email=t@t -c user.name=t commit -qm release
  [[ -z "$tag" ]] || git -C "$repo" tag "$tag"
}

# check <expected: pass|fail> <name> <mutation command run in the repo> [allowlist text] [tag]
check() {
  local want="$1" name="$2" mutate="$3" allow="${4-}" tag="${5-liberiaemr-1.0.0}" repo out rc got
  repo="$work/$name"
  release "$repo" "$tag"
  (cd "$repo" && eval "$mutate")
  printf '%s\n' "$allow" > "$work/$name.allowlist"
  set +e
  out="$(RELEASED_UUIDS_ROOT="$repo" "$GUARD" --allowlist "$work/$name.allowlist" 2>&1)"
  rc=$?
  set -e
  got=pass
  [[ $rc -eq 0 ]] || got=fail
  if [[ "$got" == "$want" ]]; then
    passed=$((passed + 1))
  else
    echo "FAIL [$name]: expected $want, got $got"
    printf '%s\n' "$out" | sed 's/^/    /'
    failed=$((failed + 1))
  fi
}

sedi() { local file="${!#}"; sed -i.bak "$@" && rm -f "$file.bak"; }  # the last argument is the file

check pass unchanged              ':'
check fail var-value-changed      "sedi 's/^var.concept.alpha.uuid=.*/var.concept.alpha.uuid=99999999-9999-4999-8999-999999999999/' $VARS"
check fail var-removed            "sedi '/^var.concept.beta.uuid=/d' $VARS"
check fail ciel-var-changed       "sedi 's/^var.concept.ciel-fever.uuid=.*/var.concept.ciel-fever.uuid=140239AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/' $VARS"
check pass var-moved-to-new-key   "sedi 's/^var.concept.beta.uuid=/var.concept.beta-renamed.uuid=/' $VARS"
check fail literal-row-deleted    "sedi '/^44444444/d' $CSV"
check pass literal-row-retired    "sedi 's/^44444444-4444-4444-8444-444444444444,,/44444444-4444-4444-8444-444444444444,true,/' $CSV"
check pass row-moved-to-other-csv "sedi '/^44444444/d' $CSV && printf 'Uuid,Void/Retire,Fully specified name:en,Data class,Data type\n44444444-4444-4444-8444-444444444444,,Literal concept,Misc,Text\n' > ${CSV%.csv}-2.csv"
check pass new-metadata-added     "echo 'var.concept.gamma.uuid=66666666-6666-4666-8666-666666666666' >> $VARS"
check pass form-version-bump      "sedi 's/^var.form.intake.uuid=.*/var.form.intake.uuid=77777777-7777-3777-8777-777777777777/' $VARS"
check pass demo-content-changed   "echo 'var.concept.demo.uuid=88888888-8888-4888-8888-888888888888' > content-packages/content-demo/configuration/variables.properties"
check pass allowlisted-change     "sedi 's/^var.concept.alpha.uuid=.*/var.concept.alpha.uuid=99999999-9999-4999-8999-999999999999/' $VARS" \
  'var.concept.alpha.uuid  # test: a deliberate, reviewed exception'
check fail allowlist-without-reason "sedi 's/^var.concept.alpha.uuid=.*/var.concept.alpha.uuid=99999999-9999-4999-8999-999999999999/' $VARS" \
  'var.concept.alpha.uuid'
check pass no-release-tag-yet     "sedi '/^var.concept.beta.uuid=/d' $VARS" '' ''

echo "released-uuids: $passed passed, $failed failed"
[[ $failed -eq 0 ]]
