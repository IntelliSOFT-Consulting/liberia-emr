#!/usr/bin/env bash
# Decides whether this event publishes modules/liberiaemr to Repsy, and says why.
#
#   scripts/ci/module-publish-decision.sh
#
# Reads the event from the environment (GITHUB_EVENT_NAME / _REF / _REF_NAME / _SHA),
# writes publish=true|false to $GITHUB_OUTPUT, and the reason to stdout and
# $GITHUB_STEP_SUMMARY. Called by the `decide` job in .github/workflows/modules.yml.
#
# Lives in a script rather than inline in the workflow -- which is how ci.yml's `changes`
# job does it -- because the tag-reachability check below can only be tested against a real
# git repository, and this has four branches and three failure modes.
# qa/ci/verify-module-publish-decision.sh is that test.
#
# Two streams publish, and nothing else does:
#
#   push to main              ->  1.0.0-SNAPSHOT, re-deployed over itself
#   push liberiaemr-x.y.z     ->  x.y.z, immutable, cut by maven-release-plugin
#
# A GitHub release does NOT publish the module. The distribution's x.y.z tags are its own
# release namespace; the module's releases are the liberiaemr-x.y.z tags.
set -euo pipefail

POM="${POM:-modules/liberiaemr/pom.xml}"
MAIN_REF="${MAIN_REF:-origin/main}"

say() { echo "$1"; if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi; }
emit() { echo "publish=$1" >> "$GITHUB_OUTPUT"; say "$2"; }
die() { echo "::error::$1"; if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "FAILED: $1" >> "$GITHUB_STEP_SUMMARY"; fi; exit 1; }

# The project-level <version>, never <parent><version>. find() searches direct children
# only, so the parent's version -- which comes first in this pom -- cannot be picked up.
pom_version() {
  python3 - "$POM" <<'PY'
import sys, xml.etree.ElementTree as ET
NS = "{http://maven.apache.org/POM/4.0.0}"
v = ET.parse(sys.argv[1]).getroot().find(NS + "version")
if v is None or not (v.text or "").strip():
    sys.exit("pom has no project-level <version>: " + sys.argv[1])
print(v.text.strip())
PY
}

# --- the module release stream -------------------------------------------------
# GITHUB_EVENT_NAME == push as well as the ref match: workflow_dispatch can be run
# against any ref, including an existing liberiaemr-x.y.z tag, from the GitHub UI. A
# tag push must be the ONLY way a release version reaches Repsy -- a dispatch against
# one falls through to the catch-all below and publishes nothing, honestly, rather
# than re-publishing an already-released, immutable version.
if [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" == refs/tags/liberiaemr-* ]]; then
  want="${GITHUB_REF_NAME#liberiaemr-}"
  version="$(pom_version)"
  echo "module tag: ${GITHUB_REF_NAME} (wants ${want}); pom: ${version}"

  # Each of these is a wrong artifact rather than a reason to skip, so each is fatal.
  [[ "$version" != *SNAPSHOT* ]] \
    || die "tag ${GITHUB_REF_NAME} resolves to ${version}, a SNAPSHOT. release:prepare should have committed the release version before tagging."
  [[ "$version" == "$want" ]] \
    || die "tag ${GITHUB_REF_NAME} wants ${want} but the pom says ${version}."

  # The squash guard. release:prepare tags the release commit; squashing the release PR
  # rewrites it, leaving the tag on an object that never reaches main. Publishing from it
  # would put a version on Repsy whose commit is not in the branch history.
  git merge-base --is-ancestor "$GITHUB_SHA" "$MAIN_REF" 2>/dev/null \
    || die "tag ${GITHUB_REF_NAME} (${GITHUB_SHA}) is not reachable from ${MAIN_REF}. Was the release PR squash-merged, or the tag pushed before it merged? Merge the PR, move the tag onto the merged commit, and push it again."

  emit true "module tag ${GITHUB_REF_NAME} -> publishing ${version}."
  exit 0
fi

# --- a GitHub release is not the module's release stream -------------------------
if [[ "$GITHUB_EVENT_NAME" == "release" ]]; then
  emit false "a GitHub release does not publish the module; its releases are the liberiaemr-x.y.z tags cut by maven-release-plugin. Nothing published."
  exit 0
fi

# --- the snapshot stream ---------------------------------------------------------
if [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" == "refs/heads/main" ]]; then
  # The workflow's `push` trigger carries no `paths` filter, and cannot: `paths` applies to
  # the whole push event, and the tag pushes handled above report no changed files at all,
  # so a paths filter beside the tags filter would stop module releases firing entirely.
  # The filter therefore lives here, but it is narrower than what the trigger used to carry:
  # the old trigger's paths were ['modules/**', '.github/workflows/modules.yml'], while this
  # greps the diff for `^modules/` only. A workflow-only change (editing modules.yml itself)
  # no longer republishes the SNAPSHOT -- matching modules/liberiaemr/README.md, which
  # documents the stream as triggering on changes that touch `modules/**`.
  #
  # Uncertain cases FAIL OPEN, as ci.yml's `changes` job does: a base we cannot diff against
  # means publish, because re-deploying a SNAPSHOT over itself is cheap and missing one is not.
  if [[ -z "${BEFORE_SHA:-}" ]] || [[ "$BEFORE_SHA" =~ ^0+$ ]] \
     || ! git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null; then
    emit true "main push with no usable base (${BEFORE_SHA:-none}) -> publishing the SNAPSHOT stream rather than guessing."
    exit 0
  fi

  if git diff --name-only "$BEFORE_SHA" "$GITHUB_SHA" | grep -qE '^modules/'; then
    emit true "main push touched modules/ -> publishing the SNAPSHOT stream."
  else
    emit false "main push touched nothing under modules/ -> the SNAPSHOT is unchanged, nothing published."
  fi
  exit 0
fi

emit false "${GITHUB_EVENT_NAME} on ${GITHUB_REF} never publishes."
