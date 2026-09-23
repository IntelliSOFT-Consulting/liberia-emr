#!/usr/bin/env bash
# Exercises the publish decision over every event shape that reaches modules.yml.
#
#   qa/ci/verify-module-publish-decision.sh
#
# Builds throwaway git repositories so the tag-reachability check is tested for real
# rather than mocked. Needs git and python3.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci/module-publish-decision.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0

# A pom carrying $1 as the project version. The parent's 1.1.1 comes first on purpose:
# a reader that picks the first <version> it sees gets the wrong answer.
make_pom() {
  local f="$WORK/pom-$RANDOM.xml"
  cat > "$f" <<XML
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent><groupId>g</groupId><artifactId>a</artifactId><version>1.1.1</version></parent>
  <artifactId>liberiaemr</artifactId>
  <version>$1</version>
</project>
XML
  echo "$f"
}

# A repo modelling every shape the decision has to tell apart. Sets globals rather than
# echoing a path, because $(make_repo) would run it in a subshell and lose them:
#
#   base_sha   -- empty first commit
#   mod_sha    -- a commit touching modules/liberiaemr
#   doc_sha    -- a commit touching only docs/, and the tip of origin/main
#   orphan_sha -- a commit on a side branch, NOT reachable from origin/main
#                 (this is what a squash-merged release PR leaves a tag pointing at)
make_repo() {
  repo="$WORK/repo-$RANDOM"
  git init -q -b main "$repo"
  g() { git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }

  g commit -q --allow-empty -m base
  base_sha="$(git -C "$repo" rev-parse HEAD)"

  mkdir -p "$repo/modules/liberiaemr"; echo x > "$repo/modules/liberiaemr/f"
  g add -A; g commit -q -m "module change"
  mod_sha="$(git -C "$repo" rev-parse HEAD)"

  mkdir -p "$repo/docs"; echo y > "$repo/docs/f"
  g add -A; g commit -q -m "docs change"
  doc_sha="$(git -C "$repo" rev-parse HEAD)"

  # A real remote-tracking ref. A local branch named "origin/main" would also resolve, but
  # ambiguously -- refs/heads/origin/main wins over refs/remotes/origin/main.
  git -C "$repo" update-ref refs/remotes/origin/main "$doc_sha"

  git -C "$repo" checkout -q -b side "$base_sha"
  g commit -q --allow-empty -m orphan
  orphan_sha="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" checkout -q main
}

run() { # name want_publish want_rc  VAR=VAL... [EXPECT_MSG=substring]
  local name="$1" want="$2" wantrc="$3"; shift 3
  # EXPECT_MSG is pulled out of the VAR=VAL list rather than added as a new positional
  # parameter, so every existing call site keeps working unchanged. When present, it asserts
  # the script's stdout contains a specific message rather than just publish/rc -- needed so
  # a case can be distinguished from the catch-all, which produces the same publish=false.
  local wantmsg="" args=() a
  for a in "$@"; do
    if [[ "$a" == EXPECT_MSG=* ]]; then wantmsg="${a#EXPECT_MSG=}"; else args+=("$a"); fi
  done
  local out="$WORK/out-$RANDOM" sum="$WORK/sum-$RANDOM" log="$WORK/log-$RANDOM"
  : > "$out"; : > "$sum"
  ( cd "$repo" && env "${args[@]}" MAIN_REF=origin/main \
      GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="$sum" bash "$SCRIPT" ) > "$log" 2>&1
  local rc=$? got msgok=1
  got="$(sed -n 's/^publish=//p' "$out")"; got="${got:-<none>}"
  [[ -z "$wantmsg" ]] || grep -qF -- "$wantmsg" "$log" || msgok=0
  if [[ "$got" == "$want" && "$rc" == "$wantrc" && "$msgok" == 1 ]]; then
    printf '  ok   %-46s publish=%-7s rc=%s\n' "$name" "$got" "$rc"
  else
    printf '  FAIL %-46s publish=%-7s rc=%s (wanted publish=%s rc=%s%s)\n' \
      "$name" "$got" "$rc" "$want" "$wantrc" "${wantmsg:+, message containing: $wantmsg}"
    sed 's/^/       /' "$log"; fail=1
  fi
}

make_repo

echo "== module tag stream =="
run "tag matches pom, reachable from main"  true     0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-1.1.0 \
  GITHUB_REF_NAME=liberiaemr-1.1.0 GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0)"
run "tag does not match pom"                "<none>" 1 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-1.2.0 \
  GITHUB_REF_NAME=liberiaemr-1.2.0 GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0)"
run "pom is a SNAPSHOT behind a tag"        "<none>" 1 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-1.1.0 \
  GITHUB_REF_NAME=liberiaemr-1.1.0 GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0-SNAPSHOT)"
run "tag orphaned by a squash merge"        "<none>" 1 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-1.1.0 \
  GITHUB_REF_NAME=liberiaemr-1.1.0 GITHUB_SHA="$orphan_sha" POM="$(make_pom 1.1.0)"
run "workflow_dispatch against a release tag" false    0 \
  GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/tags/liberiaemr-1.1.0 \
  GITHUB_REF_NAME=liberiaemr-1.1.0 GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0)"
run "malformed module tag rejected by the version check" "<none>" 1 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-foo \
  GITHUB_REF_NAME=liberiaemr-foo GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0)"
  # The script's own prefix match (`refs/tags/liberiaemr-*`) is looser than the workflow's
  # tag trigger glob (`liberiaemr-[0-9]+.[0-9]+.[0-9]+`), which would never deliver this ref
  # to the script in the first place. This documents what happens if it ever did: the tag's
  # "version" (foo) cannot match any real pom version, so it dies on the ordinary mismatch
  # check rather than publishing something nonsensical.

echo "== other tags must not publish =="
run "bare distribution tag"                 false    0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/1.1.0 \
  GITHUB_REF_NAME=1.1.0 GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0)"

echo "== snapshot stream: main pushes are path-filtered here, not by the trigger =="
run "main push touching modules/"           true     0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main \
  GITHUB_SHA="$mod_sha" BEFORE_SHA="$base_sha" POM="$(make_pom 1.0.0-SNAPSHOT)"
run "main push touching only docs/"         false    0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main \
  GITHUB_SHA="$doc_sha" BEFORE_SHA="$mod_sha" POM="$(make_pom 1.0.0-SNAPSHOT)"
run "main push with no usable base"         true     0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main \
  GITHUB_SHA="$doc_sha" BEFORE_SHA=0000000000000000000000000000000000000000 \
  POM="$(make_pom 1.0.0-SNAPSHOT)"
run "main push with a well-formed but unresolvable base" true 0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main \
  GITHUB_SHA="$doc_sha" BEFORE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef \
  POM="$(make_pom 1.0.0-SNAPSHOT)"
  # 40 hex characters, shaped exactly like a real commit SHA, but not one that exists in this
  # repo (e.g. a shallow-clone or force-push edge case). Only the all-zeros limb of the
  # "no usable base" check was covered before; this exercises the `git cat-file -e` limb.

echo "== everything else =="
run "push to a branch"                      false    0 \
  GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/feat GITHUB_REF_NAME=feat \
  GITHUB_SHA="$doc_sha" POM="$(make_pom 1.0.0-SNAPSHOT)"
run "pull_request"                          false    0 \
  GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/pull/9/merge GITHUB_REF_NAME=feat \
  GITHUB_SHA="$doc_sha" POM="$(make_pom 1.0.0-SNAPSHOT)"
run "workflow_dispatch"                     false    0 \
  GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main \
  GITHUB_SHA="$doc_sha" POM="$(make_pom 1.0.0-SNAPSHOT)"
run "a GitHub release never publishes"      false    0 \
  GITHUB_EVENT_NAME=release GITHUB_REF=refs/tags/1.1.0 GITHUB_REF_NAME=1.1.0 \
  GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0-SNAPSHOT)" \
  EXPECT_MSG="a GitHub release does not publish the module"
  # Deleting the script's dedicated `release` branch would leave this case looking green
  # (the catch-all also produces publish=false) without the message assertion above.

echo
# shellcheck disable=SC2015  # not if/then/else: the LHS only ever echoes, never fails
[[ $fail -eq 0 ]] && echo "publish decision ok" || { echo "FAILURES"; exit 1; }
