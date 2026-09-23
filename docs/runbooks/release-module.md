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

## A manual run does not publish

A `workflow_dispatch` run of `modules.yml` selected against a `liberiaemr-x.y.z` tag does
**not** publish, even though the tag it checks out looks release-ready. The publish decision
requires the triggering event to be a `push`; a manual dispatch reports `publish=false` and
exits cleanly, with no error. If a release does not show up on Repsy after a dispatched run,
this is why — the tag has to reach GitHub by `git push origin <tag>`, not by re-running the
workflow against it.

## When it refuses

The publish decision fails loudly rather than skipping. `scripts/ci/module-publish-decision.sh`
is the single place these come from, and `qa/ci/verify-module-publish-decision.sh` tests each.

| Error | Cause | Fix |
|---|---|---|
| `resolves to … a SNAPSHOT` | The tag is on a commit whose pom is still a snapshot | The tag is on the wrong commit; move it to the release commit |
| `wants X but the pom says Y` | Tag and pom disagree | The tag was created by hand, not by `release:prepare` |
| `is not reachable from origin/main` | The release PR was squashed, or the tag was pushed before it merged | Merge the PR, move the tag onto the merged commit, push again |

## Abandoning a prepare

`mvn release:rollback` does **not** give you back the tree you started with. It restores the
pom's contents, but by adding a **third, compensating commit** on top — the two
`[maven-release-plugin]` commits stay in history. `HEAD` ends up three commits ahead of where
you started, not back at it. This is documented upstream `maven-release-plugin` behaviour, not
a bug.

```bash
cd modules/liberiaemr
mvn release:rollback     # restores the pom's contents via a third, compensating commit --
                          # the two release commits are still there
mvn release:clean        # removes release.properties and the *.releaseBackup files
git tag -d liberiaemr-1.1.0
```

None of that touches history. Because nothing has been pushed yet, the honest way to get
history back to where you started is to reset past all three commits:

```bash
git log --oneline
# find the commit BEFORE the first "[maven-release-plugin] prepare release" commit,
# then:
git reset --hard <that commit>
```

After the tag is pushed, the version is published and immutable. Do not delete and re-push
a tag to "fix" a release — cut the next one.

## What a release does not do

- It does not change what any deployed environment runs. The backend image builds the module
  from source and stamps it with the distribution version.
- It does not touch `distribution/distro.properties`. Nothing there pins the module.
- It does not require a distribution release, and a distribution release does not require it.
