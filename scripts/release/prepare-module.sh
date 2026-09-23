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
     release:rollback adds a THIRD commit rather than removing the two above; to get
     history back, find the commit before this run (git log --oneline) and:
       git reset --hard <that commit>
EOF
