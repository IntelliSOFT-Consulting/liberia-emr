# Module Maven Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a maintainer cut a `modules/liberiaemr` release with `mvn release:prepare` locally, and have CI publish it to Repsy from the resulting `liberiaemr-x.y.z` tag.

**Architecture:** maven-release-plugin runs locally with `pushChanges=false`, so it never touches the protected `main` branch. It does the version math, the two version commits and the tag. The maintainer merges the version commits through a normal PR, then pushes the tag; that tag push triggers `modules.yml`, whose existing deploy step publishes using credentials that never leave the `repsy-publish` environment. `release:perform` is not used.

**Tech Stack:** Maven 3.x, maven-release-plugin 3.3.1, GitHub Actions, bash, Python 3 (stdlib `xml.etree` only).

**Spec:** `docs/superpowers/specs/2026-09-23-module-maven-release-design.md`

## Global Constraints

- maven-release-plugin pinned at **3.3.1**. Do not use a version range.
- `tagNameFormat` is **`@{project.artifactId}-@{project.version}`**, producing `liberiaemr-1.1.0`. A bare `x.y.z` tag triggers a *distribution* release via `release.yml` and must never be produced by this plugin.
- `developerConnection` uses **SSH**: `scm:git:git@github.com:IntelliSOFT-Consulting/liberia-emr.git`.
- **No `<distributionManagement>`.** The Repsy URL stays in `modules.yml`, overridable by the `REPSY_MAVEN_URL` repository variable.
- `preparationGoals` is **`clean package`**, not the default `clean verify` (`docs/runbooks/local-development.md` §5: `verify` is fragile on Apple Silicon).
- The workflow tag filter is **`liberiaemr-[0-9]+.[0-9]+.[0-9]+`**. GitHub filter patterns support `[0-9]` ranges and `+`; this matches the style already used in `release.yml`.
- Publishing must **fail loudly, never skip silently**, on: a SNAPSHOT version behind a release tag, a tag/pom version mismatch, or a tag unreachable from `main`.
- Every commit message ends with the two attribution lines used throughout this branch (`Co-Authored-By:` and `Claude-Session:`).

---

## File Structure

| File | Responsibility |
|---|---|
| `modules/liberiaemr/pom.xml` | Correct `<scm>`; pin and configure maven-release-plugin |
| `scripts/ci/module-publish-decision.sh` | **New.** The whole publish/no-publish decision, as a testable unit |
| `qa/ci/verify-module-publish-decision.sh` | **New.** Test suite for the above, following `qa/sync/verify-*.sh` conventions |
| `.github/workflows/modules.yml` | Call the decision script; add the tag trigger; **remove the push `paths` filter**; drop `versions:set` and the `release:` trigger |
| `scripts/release/prepare-module.sh` | **New.** Wrapper encoding the four-step release sequence |
| `modules/liberiaemr/README.md` | Rewrite the versioning/publishing section around the tag flow |
| `docs/runbooks/release-module.md` | **New.** The runbook: sequence, ordering rules, abort path |

**Note on extracting the decision.** PR #112 put this logic inline in the workflow, matching `ci.yml`'s `changes` job. That was right when it was a four-line string comparison. It is no longer: the decision now has four branches, three distinct failure modes, and a `git merge-base` call that can only be tested against a real repository. Task 2 extracts it to a script so it can have a committed test. This is a deliberate departure from the inline house style, and the header comment should say so.

---

### Task 1: Correct the SCM and configure maven-release-plugin

**Files:**
- Modify: `modules/liberiaemr/pom.xml:20-24` (the `<scm>` block)
- Modify: `modules/liberiaemr/pom.xml:56-108` (inside `<pluginManagement><plugins>`)

**Interfaces:**
- Consumes: nothing.
- Produces: a pom on which `mvn release:prepare -DdryRun=true` succeeds, and which tags as `liberiaemr-<version>`.

- [ ] **Step 1: Prove the current pom is broken**

Run, from `modules/liberiaemr`:

```bash
mvn -B -q -DforceStdout help:evaluate -Dexpression=project.scm.developerConnection
```

Expected: prints `scm:git:git@github.com:openmrs/openmrs-module-liberiaemr.git` — an unrelated upstream repository. This is what `release:prepare` would try to tag.

- [ ] **Step 2: Repoint `<scm>`**

Replace the `<scm>` block at `modules/liberiaemr/pom.xml:20-24` with:

```xml
	<!-- This module lives in the liberia-emr monorepo, not in its own repository. The
	     OpenMRS module scaffold this was generated from left openmrs/openmrs-module-liberiaemr
	     here, which would make release:prepare tag an unrelated upstream repo. -->
	<scm>
		<connection>scm:git:https://github.com/IntelliSOFT-Consulting/liberia-emr.git</connection>
		<developerConnection>scm:git:git@github.com:IntelliSOFT-Consulting/liberia-emr.git</developerConnection>
		<url>https://github.com/IntelliSOFT-Consulting/liberia-emr/tree/main/modules/liberiaemr</url>
		<tag>HEAD</tag>
	</scm>
```

- [ ] **Step 3: Verify the SCM now resolves to this repository**

Run, from `modules/liberiaemr`:

```bash
mvn -B -q -DforceStdout help:evaluate -Dexpression=project.scm.developerConnection
```

Expected: `scm:git:git@github.com:IntelliSOFT-Consulting/liberia-emr.git`

- [ ] **Step 4: Add the plugin to `<pluginManagement>`**

Insert this `<plugin>` as the last child of `<pluginManagement><plugins>`, immediately before the `</plugins>` at `modules/liberiaemr/pom.xml:107`:

**XML comments cannot contain `--`.** Use an em dash in the prose below, never a double
hyphen — both `xmllint` and Maven's POM parser hard-reject it.

```xml
				<!-- Releases are cut LOCALLY: `mvn release:prepare` in this directory, then the
				     version commits go up as a normal PR and the tag is pushed after it merges.
				     CI publishes from that tag. See docs/runbooks/release-module.md.
				
				     pushChanges=false is load-bearing. Repository ruleset "Prevent direct push to
				     Main" blocks pushes to main that arrive without a passing CI gate, which is
				     exactly what release:prepare's two commits would do. Leaving the push to a PR
				     means no ruleset bypass and no new privileged credential.
				
				     tagNameFormat is pinned even though it matches the plugin default: a bare
				     x.y.z tag is the DISTRIBUTION release namespace and is wired to release.yml,
				     so a default drifting that way would fire a full distribution release.
				
				     preparationGoals drops `verify` to `package` — local-development.md §5,
				     `mvn verify` is fragile on Apple Silicon. CI re-runs the full build on the
				     tag before publishing, so this local run is a sanity check, not the gate. -->
				<plugin>
					<groupId>org.apache.maven.plugins</groupId>
					<artifactId>maven-release-plugin</artifactId>
					<version>3.3.1</version>
					<configuration>
						<tagNameFormat>@{project.artifactId}-@{project.version}</tagNameFormat>
						<autoVersionSubmodules>true</autoVersionSubmodules>
						<pushChanges>false</pushChanges>
						<localCheckout>true</localCheckout>
						<preparationGoals>clean package</preparationGoals>
					</configuration>
				</plugin>
```

- [ ] **Step 5: Dry-run the release to prove the configuration**

Run, from `modules/liberiaemr`:

```bash
mvn -B release:prepare -DdryRun=true \
  -DreleaseVersion=1.0.0 -DdevelopmentVersion=1.1.0-SNAPSHOT
```

Expected: BUILD SUCCESS. It writes `pom.xml.tag` / `pom.xml.next` files and makes no commits.

Confirm the tag it would create is namespaced, not bare:

```bash
grep -m1 "<tag>" pom.xml.tag
```

Expected: `<tag>liberiaemr-1.0.0</tag>`. If this prints `<tag>1.0.0</tag>`, `tagNameFormat` did not apply — stop and fix it, because that tag would trigger a distribution release.

- [ ] **Step 6: Clean up the dry run**

```bash
mvn -B release:clean
git status --short
```

Expected: `git status` shows only `pom.xml` modified. No `pom.xml.tag`, `pom.xml.next`, or `release.properties` left behind.

- [ ] **Step 7: Commit**

```bash
git add modules/liberiaemr/pom.xml
git commit -m "$(cat <<'EOF'
build(module): point scm at this repo and configure maven-release-plugin

The scm block still named openmrs/openmrs-module-liberiaemr, inherited from
the module scaffold -- release:prepare would have tried to tag an unrelated
upstream repository.

Configure the release plugin for a local-prepare flow: pushChanges=false so
the two version commits never hit the protected main branch, and a pinned
tagNameFormat so a module tag can never land in the bare x.y.z namespace that
release.yml watches for distribution releases.

Verified with release:prepare -DdryRun=true, which produces the tag
liberiaemr-1.0.0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)"
```

---

### Task 2: Extract the publish decision into a tested script

**Files:**
- Create: `scripts/ci/module-publish-decision.sh`
- Test: `qa/ci/verify-module-publish-decision.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/ci/module-publish-decision.sh`, invoked with no arguments, reading these environment variables:
  - `GITHUB_EVENT_NAME`, `GITHUB_REF`, `GITHUB_REF_NAME`, `GITHUB_SHA` — the event
  - `BEFORE_SHA` — `github.event.before`, the commit `main` was on before this push
  - `POM` — path to the module pom (default `modules/liberiaemr/pom.xml`)
  - `MAIN_REF` — the ref to test tag reachability against (default `origin/main`)
  - `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY` — files to append to
  
  It writes `publish=true` or `publish=false` to `$GITHUB_OUTPUT`, a human-readable reason to both stdout and `$GITHUB_STEP_SUMMARY`, and exits non-zero on any inconsistency that must not be resolved by skipping.

**Why this script also does path filtering.** `modules.yml` currently narrows the `push`
trigger with `paths: ['modules/**', …]`. Task 3 must *remove* that filter, because `paths`
applies to the whole push event and a tag push reports no changed files — the workflow's own
comment at `modules.yml:41-44` says a `tags:` filter sitting beside `paths:` "would silently
never fire". So the path check moves in here, where it becomes one more branch of the single
question this script answers.

- [ ] **Step 1: Write the failing test**

Create `qa/ci/verify-module-publish-decision.sh`:

```bash
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

run() { # name want_publish want_rc  VAR=VAL...
  local name="$1" want="$2" wantrc="$3"; shift 3
  local out="$WORK/out-$RANDOM" sum="$WORK/sum-$RANDOM" log="$WORK/log-$RANDOM"
  : > "$out"; : > "$sum"
  ( cd "$repo" && env "$@" MAIN_REF=origin/main \
      GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="$sum" bash "$SCRIPT" ) > "$log" 2>&1
  local rc=$? got
  got="$(sed -n 's/^publish=//p' "$out")"; got="${got:-<none>}"
  if [[ "$got" == "$want" && "$rc" == "$wantrc" ]]; then
    printf '  ok   %-46s publish=%-7s rc=%s\n' "$name" "$got" "$rc"
  else
    printf '  FAIL %-46s publish=%-7s rc=%s (wanted publish=%s rc=%s)\n' \
      "$name" "$got" "$rc" "$want" "$wantrc"
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
  GITHUB_SHA="$doc_sha" POM="$(make_pom 1.1.0-SNAPSHOT)"

echo
[[ $fail -eq 0 ]] && echo "publish decision ok" || { echo "FAILURES"; exit 1; }
```

Make it executable: `chmod +x qa/ci/verify-module-publish-decision.sh`

- [ ] **Step 2: Run the test to verify it fails**

Run: `./qa/ci/verify-module-publish-decision.sh`

Expected: every case FAILs, because `scripts/ci/module-publish-decision.sh` does not exist yet (`bash: ... No such file or directory`).

- [ ] **Step 3: Write the decision script**

Create `scripts/ci/module-publish-decision.sh`:

```bash
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

say() { echo "$1"; [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; }
emit() { echo "publish=$1" >> "$GITHUB_OUTPUT"; say "$2"; }
die() { echo "::error::$1"; [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "FAILED: $1" >> "$GITHUB_STEP_SUMMARY"; exit 1; }

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
if [[ "$GITHUB_REF" == refs/tags/liberiaemr-* ]]; then
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
  # The filter therefore lives here. Same allow-list as the trigger used to carry.
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
```

Make it executable: `chmod +x scripts/ci/module-publish-decision.sh`

- [ ] **Step 4: Run the test to verify it passes**

Run: `./qa/ci/verify-module-publish-decision.sh`

Expected: all twelve cases `ok`, ending with `publish decision ok`.

- [ ] **Step 5: Lint both scripts**

```bash
shellcheck -s bash scripts/ci/module-publish-decision.sh qa/ci/verify-module-publish-decision.sh
```

Expected: no output, exit 0. Fix anything reported before committing.

- [ ] **Step 6: Commit**

```bash
git add scripts/ci/module-publish-decision.sh qa/ci/verify-module-publish-decision.sh
git commit -m "$(cat <<'EOF'
ci(module): extract the publish decision and give it a test

The decision gains a module-tag stream, a reachability guard and three fatal
failure modes, which is more than belongs inline in a workflow. Extract it so
it can be tested against real git repositories -- the squash guard cannot be
tested any other way.

The guard itself: release:prepare tags the release commit, so squashing the
release PR leaves the tag on an object that never reaches main. Publishing
from it would put a version on Repsy whose commit is not in the branch
history. It now fails the run instead.

Twelve cases cover both streams, the three fatal shapes, path filtering of main
pushes, a bare distribution tag, and a GitHub release.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)"
```

---

### Task 3: Wire the workflow to the decision and drop `versions:set`

**Files:**
- Modify: `.github/workflows/modules.yml` — the `on:` block, the `decide` job, the `publish` job, and the header comment

**Interfaces:**
- Consumes: `scripts/ci/module-publish-decision.sh` from Task 2.
- Produces: a `modules.yml` that publishes on `liberiaemr-x.y.z` tags and refuses on GitHub releases.

- [ ] **Step 1: Add the tag trigger and REMOVE the push paths filter**

This is the subtle one. `modules.yml:41-44` already warns, about the `release:` trigger, that
`paths` applies to the whole push event and a tag push commonly reports no changed files —
so **a `tags:` filter sitting beside a `paths:` filter would silently never fire.** Adding
`tags:` while leaving `paths:` in place produces a workflow that looks correct and never
publishes a release.

So the `push` trigger loses `paths` entirely. Task 2's script does that filtering instead.
`pull_request` is a separate trigger key and keeps its own `paths` filter unchanged.

The `on:` block becomes:

```yaml
on:
  # No `paths` filter here, and there cannot be one: `paths` applies to the whole push
  # event, and a tag push reports no changed files — so a paths filter beside the tags
  # filter below would stop module releases firing at all (the same trap described for
  # the `release:` trigger). scripts/ci/module-publish-decision.sh filters main pushes
  # by path instead, which also puts the whole publish decision in one place.
  push:
    branches: [main]
    # maven-release-plugin's tags, namespaced so they cannot collide with the bare x.y.z
    # tags release.yml watches for DISTRIBUTION releases.
    tags: ['liberiaemr-[0-9]+.[0-9]+.[0-9]+']
  pull_request:
    branches: [main]
    paths:
      - 'modules/**'
      - '.github/workflows/modules.yml'
      - 'scripts/ci/module-publish-decision.sh'
      - 'qa/ci/verify-module-publish-decision.sh'
  workflow_dispatch:
```

Also delete the `release:` trigger and its comment block. A GitHub release no longer
publishes the module, so running the workflow on one would only produce a job that refuses.

**Trade-off to be aware of:** `build-and-test` now runs on every push to `main`, not only
module ones. It takes ~27s, which is worth paying for a trigger that cannot silently fail.

- [ ] **Step 2: Replace the decide job's inline script**

Replace the `decide` job's steps with a checkout that can see `main`, plus a call to the script:

```yaml
    steps:
      # fetch-depth: 0 and the explicit main fetch are for the reachability check in the
      # script: a tag push checks out a detached commit with no branches, so there would
      # otherwise be no origin/main to compare against.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Make main available for the reachability check
        run: git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
      - id: decide
        name: Decide whether this event publishes
        env:
          # github.event.before is how the script path-filters a main push, now that the
          # trigger cannot carry a paths filter. It is absent on non-push events, which the
          # script treats as "no usable base" and fails open on.
          BEFORE_SHA: ${{ github.event.before }}
        run: ./scripts/ci/module-publish-decision.sh
```

Note: with the `release:` trigger deleted in Step 1, the script's `release` branch is
unreachable from this workflow. Keep it — it is two lines, it is tested, and it means
re-adding the trigger cannot accidentally publish.

- [ ] **Step 3: Delete the `Stamp the release version` step**

Remove `.github/workflows/modules.yml:203-218` entirely — the comment block and the `versions:set` step. On a module tag the pom already carries the release version, because `release:prepare` committed it. There is nothing left to stamp.

- [ ] **Step 4: Rewrite the version-stream check**

Replace the `Check the version matches the stream` step with one that matches the two streams that now exist:

```yaml
      # The decision script already asserted the tag stream's invariants. This re-checks them
      # against the tree the deploy will actually run on, which is a different question: the
      # script reads the pom from a plain checkout, this runs in the publish job.
      - name: Check the version matches the stream
        working-directory: modules/liberiaemr
        run: |
          set -euo pipefail
          version="$(mvn -B -q -DforceStdout help:evaluate -Dexpression=project.version)"
          echo "module version: ${version}"
          if [[ "${GITHUB_REF}" == refs/tags/liberiaemr-* ]]; then
            want="${GITHUB_REF_NAME#liberiaemr-}"
            [[ "${version}" != *SNAPSHOT* ]] \
              || { echo "::error::tag ${GITHUB_REF_NAME} would publish a SNAPSHOT"; exit 1; }
            [[ "${version}" == "${want}" ]] \
              || { echo "::error::version ${version} does not match tag ${GITHUB_REF_NAME}"; exit 1; }
          else
            [[ "${version}" == *SNAPSHOT* ]] \
              || { echo "::error::main must publish a SNAPSHOT, got ${version}." >&2
                   echo "release:prepare sets the next -SNAPSHOT; check its second commit merged." >&2
                   exit 1; }
          fi
```

- [ ] **Step 5: Update the header comment's version-stream block**

The header comment still describes the opt-in-by-pom-version scheme from PR #112. Replace that description (the block introduced by `# Two version streams, and they are the whole design:`) with:

```
# Two version streams, and they are the whole design:
#
#   push to main              ->  1.0.0-SNAPSHOT   re-deployed over itself on every merge
#   push liberiaemr-x.y.z     ->  x.y.z            immutable, cut by maven-release-plugin
#
# A GitHub release publishes NOTHING here. The bare x.y.z tags are the distribution's
# release namespace (release.yml); the module's are liberiaemr-x.y.z, cut locally with
# `mvn release:prepare` and pushed after the release PR merges. The decision, its failure
# modes and its test live in scripts/ci/module-publish-decision.sh and
# qa/ci/verify-module-publish-decision.sh. The sequence is docs/runbooks/release-module.md.
#
# The backend image takes neither version: distribution/backend/Dockerfile builds the module
# from source (it COPYs modules/liberiaemr) and stamps it with the distribution version it is
# being built into, so a release image never ships a SNAPSHOT (IMPLEMENTATION.md §6/§11) and
# never depends on the module having been published at all. Repsy is for consumers outside
# this repository.
```

- [ ] **Step 6: Verify the workflow parses and lints**

```bash
python3 -c "import yaml; w=yaml.safe_load(open('.github/workflows/modules.yml')); print('jobs:', list(w['jobs'])); print('on.push:', w[True]['push']); assert 'paths' not in w[True]['push'], 'push must not have a paths filter — it would stop tag pushes firing'; assert 'release' not in w[True], 'release trigger should be gone'; print('trigger shape ok')"
actionlint .github/workflows/modules.yml
```

Expected: jobs `['build-and-test', 'decide', 'publish']`; the `push` trigger shows `branches` and the `liberiaemr-…` tag pattern and **no `paths`**; `trigger shape ok`; actionlint exits 0 with no output.

(`w[True]` is not a typo — YAML parses the bare key `on` as the boolean `True`.)

If `actionlint` is not installed:

```bash
curl -sSL -o /tmp/al.tgz https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_darwin_arm64.tar.gz
tar xzf /tmp/al.tgz -C /tmp actionlint && /tmp/actionlint .github/workflows/modules.yml
```

- [ ] **Step 7: Re-run the decision test**

Run: `./qa/ci/verify-module-publish-decision.sh`

Expected: still all twelve `ok`. The script did not change in this task; this confirms the workflow edit did not disturb it.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/modules.yml
git commit -m "$(cat <<'EOF'
ci(module): publish from liberiaemr-x.y.z tags, not from GitHub releases

The module's release stream becomes its own namespaced tags, cut by
maven-release-plugin. A GitHub release now publishes nothing here -- the bare
x.y.z tags belong to the distribution.

versions:set goes away entirely. It existed to rewrite the pom at publish time
because no release version existed anywhere; release:prepare now commits that
version before the tag is cut, so the step had nothing left to do. What was a
mutation is an assertion.

decide checks out with fetch-depth 0 and fetches main so the script can test
tag reachability -- a tag push checks out a detached commit with no branches.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)"
```

---

### Task 4: The `prepare-module.sh` wrapper

**Files:**
- Create: `scripts/release/prepare-module.sh`

**Interfaces:**
- Consumes: the pom configuration from Task 1.
- Produces: `scripts/release/prepare-module.sh <release-version> [next-snapshot]`, which runs `release:prepare` and prints the remaining steps.

- [ ] **Step 1: Write the script**

Create `scripts/release/prepare-module.sh`:

```bash
#!/usr/bin/env bash
# Cuts a modules/liberiaemr release locally. Pushes nothing.
#
#   scripts/release/prepare-module.sh <release-version> [next-snapshot]
#   scripts/release/prepare-module.sh 1.1.0
#   scripts/release/prepare-module.sh 1.1.0 1.2.0-SNAPSHOT
#
# Runs maven-release-plugin's prepare goal, which sets the release version, commits it,
# tags it liberiaemr-<version>, sets the next snapshot and commits that. Both commits and
# the tag stay local -- see docs/runbooks/release-module.md for what to do with them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE="$ROOT/modules/liberiaemr"

version="${1:-}"
next="${2:-}"

[[ -n "$version" ]] || {
  echo "usage: ${BASH_SOURCE[0]##*/} <release-version> [next-snapshot]" >&2
  exit 1
}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "release version must be x.y.z, got '$version'" >&2
  exit 1
}
[[ "$version" != *SNAPSHOT* ]] || { echo "refusing to release a SNAPSHOT" >&2; exit 1; }

# Default the next snapshot to a patch bump, which is what the plugin would suggest.
if [[ -z "$next" ]]; then
  IFS=. read -r major minor patch <<<"$version"
  next="${major}.${minor}.$((patch + 1))-SNAPSHOT"
fi
[[ "$next" == *-SNAPSHOT ]] || { echo "next version must end in -SNAPSHOT, got '$next'" >&2; exit 1; }

# release:prepare commits. A dirty tree means it would sweep up unrelated work, and a
# detached HEAD means the commits would land nowhere.
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] \
  || { echo "working tree is dirty; commit or stash first" >&2; git -C "$ROOT" status --short >&2; exit 1; }
branch="$(git -C "$ROOT" branch --show-current)"
[[ -n "$branch" ]] || { echo "HEAD is detached; check out a branch first" >&2; exit 1; }

tag="liberiaemr-${version}"
git -C "$ROOT" rev-parse -q --verify "refs/tags/${tag}" >/dev/null \
  && { echo "tag ${tag} already exists" >&2; exit 1; } || true

echo "==> releasing ${version} from branch ${branch}, next ${next}"
( cd "$MODULE" && mvn -B release:prepare \
    -DreleaseVersion="$version" -DdevelopmentVersion="$next" )

cat <<EOF

==> prepared ${tag}. Nothing has been pushed.

Next, in order -- the order matters:

  1. Open a PR for the two version commits on ${branch}:
       git push origin ${branch}
       gh pr create --base main --title "release(module): ${version}"

  2. Merge it with a MERGE COMMIT, not a squash. A squash rewrites the commit
     this tag points at, and CI refuses to publish from a tag that is not
     reachable from main.

  3. Only then push the tag, which is what publishes to Repsy:
       git push origin ${tag}

To abandon this instead:
       cd modules/liberiaemr && mvn release:rollback && mvn release:clean
       git tag -d ${tag}
EOF
```

Make it executable: `chmod +x scripts/release/prepare-module.sh`

- [ ] **Step 2: Verify the argument guards**

```bash
./scripts/release/prepare-module.sh            ; echo "rc=$? (want 1)"
./scripts/release/prepare-module.sh 1.1        ; echo "rc=$? (want 1)"
./scripts/release/prepare-module.sh 1.1.0-SNAPSHOT ; echo "rc=$? (want 1)"
./scripts/release/prepare-module.sh 1.1.0 2.0.0    ; echo "rc=$? (want 1)"
```

Expected: each exits 1 with its own message. The last is rejected because the next version does not end in `-SNAPSHOT`.

- [ ] **Step 3: Verify the dirty-tree guard**

```bash
touch modules/liberiaemr/scratch.tmp
./scripts/release/prepare-module.sh 1.1.0 ; echo "rc=$? (want 1)"
rm modules/liberiaemr/scratch.tmp
```

Expected: refuses with `working tree is dirty` and lists the file. This must be tested with an untracked file present, because `git status --porcelain` reports those too.

- [ ] **Step 4: Lint**

```bash
shellcheck -s bash scripts/release/prepare-module.sh
```

Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/release/prepare-module.sh
git commit -m "$(cat <<'EOF'
feat(release): wrapper for cutting a module release locally

The release sequence has two ordering rules whose failure modes are quiet --
push the tag only after the PR merges, and merge rather than squash -- so it
is worth encoding rather than documenting twice.

Refuses a dirty tree, a detached HEAD, a non-x.y.z version, a next version
that is not a SNAPSHOT, and a tag that already exists. On success it prints
the three remaining steps with the real tag substituted in, and the rollback
path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)"
```

---

### Task 5: Documentation

**Files:**
- Create: `docs/runbooks/release-module.md`
- Modify: `modules/liberiaemr/README.md` — the version table row and the "Releasing the module is opt-in" section
- Modify: `docs/runbooks/README.md` — add the new runbook to its index

**Interfaces:**
- Consumes: the flow built in Tasks 1–4.
- Produces: no code interface.

- [ ] **Step 1: Check how the runbook index lists entries**

```bash
sed -n '1,40p' docs/runbooks/README.md
```

Match whatever format it uses in Step 4. If the file has no index list, skip Step 4.

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/release-module.md`:

```markdown
# Releasing the LiberiaEMR module

Cuts a new `org.openmrs.module:liberiaemr` version and publishes it to Repsy.

This is **not** the distribution release. The distribution's releases are the bare `x.y.z`
tags handled by `release.yml` and `docs/runbooks/deploy.md`. This module has its own version
line and its own tags, `liberiaemr-x.y.z`, and the two are deliberately independent: the
backend image builds the module from source, so a distribution release does not need a
published module version at all. Repsy serves consumers outside this repository.

## Before you start

- You need push access and an SSH key on GitHub — `release:prepare` tags through
  `developerConnection`, which is the SSH remote.
- You do **not** need Repsy credentials. They stay in the `repsy-publish` GitHub
  environment; CI does the deploy.
- Start from a clean tree on a branch cut from an up-to-date `main`.

## Cut the release

```bash
./scripts/release/prepare-module.sh 1.1.0
```

This sets the version to `1.1.0`, commits it, tags `liberiaemr-1.1.0`, sets the pom to
`1.1.1-SNAPSHOT` and commits that. Pass a second argument if you want a different next
version: `./scripts/release/prepare-module.sh 1.1.0 1.2.0-SNAPSHOT`.

**Nothing is pushed.** The two commits and the tag are local.

## Land it — the order matters

1. **Open a PR** for the two version commits and get it reviewed.

2. **Merge it with a merge commit, not a squash.** `release:prepare` tagged the release
   commit; a squash rewrites that commit, so the tag would point at an object that never
   reaches `main`. CI refuses to publish from such a tag — see below.

3. **Push the tag.** This is what publishes:

   ```bash
   git push origin liberiaemr-1.1.0
   ```

   `modules.yml` builds and tests the tag, then deploys to Repsy and asserts that a `.omod`
   — not just a `.jar` — was uploaded.

## When it refuses

The publish decision fails loudly rather than skipping. `scripts/ci/module-publish-decision.sh`
is the single place these come from, and `qa/ci/verify-module-publish-decision.sh` tests each.

| Error | Cause | Fix |
|---|---|---|
| `resolves to … a SNAPSHOT` | The tag is on a commit whose pom is still a snapshot | The tag is on the wrong commit; move it to the release commit |
| `wants X but the pom says Y` | Tag and pom disagree | The tag was created by hand, not by `release:prepare` |
| `is not reachable from origin/main` | The release PR was squashed, or the tag was pushed before it merged | Merge the PR, move the tag onto the merged commit, push again |

## Abandoning a prepare

Before anything is pushed:

```bash
cd modules/liberiaemr
mvn release:rollback     # restores the pom and reverts the two commits
mvn release:clean        # removes release.properties and the pom backups
git tag -d liberiaemr-1.1.0
```

After the tag is pushed, the version is published and immutable. Do not delete and re-push
a tag to "fix" a release — cut the next one.

## What a release does not do

- It does not change what any deployed environment runs. The backend image builds the module
  from source and stamps it with the distribution version.
- It does not touch `distribution/distro.properties`. Nothing there pins the module.
- It does not require a distribution release, and a distribution release does not require it.
```

- [ ] **Step 3: Rewrite the README section**

In `modules/liberiaemr/README.md`, replace the whole `### Releasing the module is opt-in` section (added by PR #112, which described a mechanism this replaces) with:

```markdown
### Cutting a release

The module has its own version line and its own tags. A distribution release does **not**
publish it, and it does not need one:

```bash
./scripts/release/prepare-module.sh 1.1.0
```

That runs `mvn release:prepare` locally — version commits plus a `liberiaemr-1.1.0` tag,
none of it pushed. Open a PR for the commits, **merge it rather than squashing**, then push
the tag; the tag push is what publishes to Repsy.

Squashing would rewrite the commit the tag points at, so CI refuses to publish from a tag
that is not reachable from `main`. The full sequence, the failure table and the abort path
are in [docs/runbooks/release-module.md](../../docs/runbooks/release-module.md).

Repsy credentials never leave the `repsy-publish` GitHub environment — `release:perform` is
not used, and no maintainer needs them locally.
```

Then update the version table's release row to:

```markdown
| Repsy, release | the tag, e.g. `1.2.0` | a pushed `liberiaemr-x.y.z` tag; the pom already carries the version |
```

- [ ] **Step 4: Add the runbook to the index**

Add `release-module.md` to `docs/runbooks/README.md` in whatever format Step 1 revealed, described as cutting and publishing a module version.

- [ ] **Step 5: Check for stale cross-references**

```bash
grep -rn "opt-in\|bump the pom\|versions:set" modules/liberiaemr/README.md docs/ .github/workflows/modules.yml
```

Expected: no hits describing the superseded PR #112 mechanism. Any that remain must be updated — they now describe behaviour that no longer exists.

- [ ] **Step 6: Run the repo's validators**

```bash
./scripts/validate/validate-content.sh
./scripts/validate/no-secrets.sh
```

Expected: `content validation passed` and `no secrets detected`.

- [ ] **Step 7: Commit**

```bash
git add docs/runbooks/release-module.md docs/runbooks/README.md modules/liberiaemr/README.md
git commit -m "$(cat <<'EOF'
docs(module): document the tag-driven release flow

Adds the module release runbook: the sequence, the two ordering rules, a table
mapping each refusal CI can emit to its cause and fix, and the abort path.

Rewrites the README section PR #112 added. It described releasing as opt-in by
bumping the pom before cutting a distribution release; the module now has its
own version line and its own tags, so that mechanism is gone rather than
merely changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)"
```

---

### Task 6: End-to-end verification

**Files:** none modified — this task only verifies.

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Full local dry run**

```bash
./scripts/release/prepare-module.sh 1.1.0
```

Expected: BUILD SUCCESS, then the three-step instructions. Confirm the state it produced:

```bash
git log --oneline -2
git tag --list 'liberiaemr-*'
grep -m1 "<version>" modules/liberiaemr/pom.xml
```

Expected: two new commits (`[maven-release-plugin] prepare release …` and `… prepare for next development iteration`), the tag `liberiaemr-1.1.0`, and the pom back on `1.1.1-SNAPSHOT`.

- [ ] **Step 2: Prove the decision accepts that real tag**

```bash
mkdir -p /tmp/dec && : > /tmp/dec/out && : > /tmp/dec/sum
GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/liberiaemr-1.1.0 \
GITHUB_REF_NAME=liberiaemr-1.1.0 \
GITHUB_SHA="$(git rev-parse liberiaemr-1.1.0)" \
MAIN_REF=HEAD GITHUB_OUTPUT=/tmp/dec/out GITHUB_STEP_SUMMARY=/tmp/dec/sum \
  ./scripts/ci/module-publish-decision.sh
cat /tmp/dec/out
```

`MAIN_REF=HEAD` stands in for `origin/main`, since these commits are not on `main` yet.

Expected: `module tag liberiaemr-1.1.0 -> publishing 1.1.0.` and `publish=true`.

- [ ] **Step 3: Roll the dry run back**

```bash
cd modules/liberiaemr && mvn -B release:rollback && mvn -B release:clean && cd ../..
git tag -d liberiaemr-1.1.0
git log --oneline -1
git status --short
```

Expected: the two release commits are reverted, the tag is gone, and the tree is clean. **Do not skip this** — the plan's earlier commits must be the only ones on the branch.

- [ ] **Step 4: Re-run every check**

```bash
./qa/ci/verify-module-publish-decision.sh
shellcheck -s bash scripts/ci/module-publish-decision.sh scripts/release/prepare-module.sh qa/ci/verify-module-publish-decision.sh
actionlint .github/workflows/modules.yml
./scripts/validate/validate-content.sh
./scripts/validate/no-secrets.sh
```

Expected: all pass, all silent or with their success line.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/module-maven-release
gh pr create --base main \
  --title "feat(module): cut module releases with maven-release-plugin" \
  --body-file <(cat <<'EOF'
Implements `docs/superpowers/specs/2026-09-23-module-maven-release-design.md`.

`mvn release:prepare` runs locally with `pushChanges=false`; CI publishes from the pushed
`liberiaemr-x.y.z` tag. `release:perform` is not used, so Repsy credentials never leave the
`repsy-publish` environment.

Also fixes `<scm>`, which named `openmrs/openmrs-module-liberiaemr` — `release:prepare`
would have tried to tag an unrelated upstream repository.

Supersedes the opt-in-by-pom-version mechanism from #112: a GitHub release no longer
publishes the module at all.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016vTjN75QV27HoqBCw1gNPd
EOF
)
```

- [ ] **Step 6: Confirm CI is green**

```bash
gh pr checks --watch
```

Expected: `CI gate` passes; `Decide whether to publish` passes and reports `pull_request … never publishes`; `Publish to Repsy` skips.

---

## Post-merge note (not a task)

The first real release cannot be verified before merge, because the tag trigger only exists
once this is on `main`. After merging, cut `1.0.0` as the first genuine exercise of the flow
and watch `modules.yml` publish it.
