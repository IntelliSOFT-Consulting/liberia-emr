# Cutting `modules/liberiaemr` releases with maven-release-plugin

Status: approved; implemented by `docs/superpowers/plans/2026-09-23-module-maven-release.md` (LE-338)
Date: 2026-09-23
Branch: `feat/module-maven-release`, stacked on `ci/gate-module-release-publish` (PR #112)

## The problem

`modules/liberiaemr` has no release process of its own. Its version stream is driven
entirely from outside: `main` merges republish `1.0.0-SNAPSHOT` over itself, and a release
version only exists because `modules.yml` rewrites the pom with `versions:set` at publish
time. There is no command a maintainer can run to cut a module release, and no record in the
repository of which commit a published module version was built from.

maven-release-plugin is the standard answer: it does the version math, commits the result,
tags it, and rolls the pom on to the next snapshot.

## Constraints discovered before designing

These are facts about this repository, each verified, and each one rules out part of the
default maven-release-plugin flow.

1. **`<scm>` names the wrong repository.** `modules/liberiaemr/pom.xml` currently declares
   `scm:git:git@github.com:openmrs/openmrs-module-liberiaemr.git` — a leftover from the
   OpenMRS module scaffold. `release:prepare` tags and pushes to `developerConnection`, so as
   it stands the plugin would attempt to tag an unrelated upstream repository. This must be
   fixed no matter what else is decided.

2. **`main` is governed by an active ruleset.** Repository ruleset 20730366, "Prevent direct
   push to Main", targets `~DEFAULT_BRANCH` with `deletion`, `non_fast_forward`,
   `copilot_code_review` and a required `CI gate` status check. `release:prepare` ordinarily
   pushes two commits straight to `main`; they would arrive without a `CI gate` status and be
   rejected. One repository role holds an `always` bypass, so a maintainer could force the
   issue, but CI's `GITHUB_TOKEN` should not be given that power.

3. **The module is a subdirectory of a monorepo.** maven-release-plugin assumes the pom's
   directory is the SCM root. More importantly the repository's bare `x.y.z` tags already
   mean *distribution* releases — `release.yml` triggers on
   `push: tags: ['[0-9]+.[0-9]+.[0-9]+']`. A module tag that landed in that namespace would
   fire a full distribution release.

4. **There is no `<distributionManagement>`.** Repsy is supplied ad hoc by
   `modules.yml` via `-DaltDeploymentRepository`, defaulted in the workflow and overridable
   by the `REPSY_MAVEN_URL` repository variable.

5. **Repsy credentials are deliberately confined to CI.** They live in the `repsy-publish`
   GitHub environment. `modules.yml` says in as many words that a fork PR must not be able to
   reach them. Any design that runs `deploy` on a laptop regresses this.

6. **A `tags:` filter cannot coexist with the `paths:` filter on `push`.** `paths` applies
   to the whole push event, and a tag push commonly reports no changed files, so the two
   together match nothing. `modules.yml:41-44` already documents this — it is why the
   existing workflow publishes off a `release` event rather than a tag push. Adding `tags:`
   beside `paths:` yields a workflow that looks right and never fires.

7. **`mvn verify` is documented as broken on Apple Silicon.**
   `docs/runbooks/local-development.md` §5: the packager plugin's `validate-configurations`
   goal starts a testcontainer with an x86-only JNA. `release:prepare`'s default
   `preparationGoals` is exactly `clean verify`. The module itself does not use the packager
   plugin, so this probably does not bite here — but it is unconfirmed, and the default is
   not worth gambling a release command on.

## Decisions

| Question | Decision |
|---|---|
| Where does `release:prepare` run? | Locally, by a maintainer |
| Where does the deploy happen? | CI, triggered by the pushed tag |
| Is `release:perform` used? | No |
| What happens to PR #112? | Kept, with its `release`-event branch reduced to an explicit refusal |
| How do maintainers authenticate? | SSH, so `developerConnection` uses `git@github.com:` |
| Squash-merged release PR? | Enforced in CI, not left to convention |

PR #112 merged on 2026-09-23 as commit `22045e8`, so the `decide` job this design modifies
is already on `main`.

Running `prepare` locally with `pushChanges=false` is what lets constraint 2 stand
untouched: the plugin never pushes, so nothing needs a ruleset bypass and no new privileged
credential is introduced. Deploying from CI is what lets constraint 5 stand: Repsy
credentials stay in the `repsy-publish` environment.

## Design

### Pom configuration

`<scm>` is repointed at this repository:

```xml
<scm>
  <connection>scm:git:https://github.com/IntelliSOFT-Consulting/liberia-emr.git</connection>
  <developerConnection>scm:git:git@github.com:IntelliSOFT-Consulting/liberia-emr.git</developerConnection>
  <url>https://github.com/IntelliSOFT-Consulting/liberia-emr/tree/main/modules/liberiaemr</url>
  <tag>HEAD</tag>
</scm>
```

The plugin is pinned at **3.3.1** (the current release on Maven Central as of this date):

```xml
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

Each setting earns its place:

- `tagNameFormat` produces `liberiaemr-1.1.0`. This is also the plugin's default, and it is
  pinned anyway: if the default ever changed to a bare version, constraint 3 says a module
  release would trigger a distribution release. A default worth relying on is worth writing
  down.
- `autoVersionSubmodules` versions `api` and `omod` with the parent instead of prompting
  three times.
- `pushChanges=false` is the constraint-2 decision expressed in configuration.
- `localCheckout=true` makes `prepare` work against the local clone rather than re-fetching
  from the remote.
- `preparationGoals` drops `verify` to `package` for constraint 6. CI re-runs the full build
  on the tag before publishing, so the local run is a fast sanity check, not the gate.

No `<distributionManagement>` is added. Constraint 4's arrangement is better than the
alternative: the destination stays overridable by a repository variable instead of being
frozen into the pom, and `deploy` never runs locally anyway.

### Workflow changes (`modules.yml`)

A new trigger, and the removal of an old filter:

```yaml
push:
  branches: [main]
  tags: ['liberiaemr-[0-9]+.[0-9]+.[0-9]+']
  # no paths -- see constraint 6
```

Constraint 6 forces the `paths` filter off the `push` trigger. Path filtering of `main`
pushes therefore moves into the decision script, which is the right home for it anyway: the
question "does this event publish" then has exactly one answer in exactly one place. The
`pull_request` trigger is a separate key and keeps its own `paths` filter.

The `release:` trigger is deleted outright. A GitHub release no longer publishes the module,
so running on one would only produce a job that refuses.

The `decide` job introduced in PR #112 gains a case for module tags, and its `release` case
changes meaning — from "publish if the pom base matches the tag" to a flat refusal:

| Event | Decision |
|---|---|
| push to `main` touching `modules/` | publish the SNAPSHOT stream |
| push to `main` touching nothing under `modules/` | do not publish (this is the filtering the trigger can no longer do) |
| push of a `liberiaemr-x.y.z` tag | publish, after asserting the pom version equals the tag suffix, is not a SNAPSHOT, and the tag is reachable from `main` |
| `release` (a GitHub release) | never publish — the module's release stream is its own tags now |
| anything else | never publish |

The `publish` job gets *simpler*. `Stamp the release version` — the `versions:set` call — is
deleted outright: on a module tag the pom already carries the release version, because
`prepare` committed it. What was a mutation becomes an assertion, which is the safer shape.

### The release sequence

```
1. mvn release:prepare        # local, in modules/liberiaemr; pushes nothing
2. open a PR with the two version commits
3. merge it with a MERGE COMMIT, not a squash
4. git push origin liberiaemr-x.y.z   ->  CI publishes to Repsy
```

Two ordering rules carry real consequences:

**Push the tag only after the PR merges.** The tag is local until pushed, so this is entirely
under the maintainer's control, and it is what stops a version being published from a commit
that review might still reject.

**Do not squash the release PR.** `prepare` tags the release commit. A squash merge rewrites
that commit, so the tag would point at an object that never reaches `main` — the artifact
would publish, but from a commit not in the branch history.

This second rule is **enforced, not merely documented**. `decide` checks out with
`fetch-depth: 0`, and on a module tag runs `git merge-base --is-ancestor "$GITHUB_SHA"
origin/main`. An unreachable tag fails the job, which blocks `publish` through `needs` and
turns the run red — the same fail-loudly shape already used for an unreadable pom. A quiet
mistake that would otherwise only surface later, as a published version whose commit is not
in the branch history, becomes a red run before anything reaches Repsy.

Note the ordering consequence: because the check compares against `main`, the tag genuinely
must be pushed *after* the release PR merges. Pushing it first now fails the run rather than
publishing early, so the two ordering rules reinforce each other.

### Tooling

`scripts/release/prepare-module.sh`, following the house conventions in `scripts/`
(`#!/usr/bin/env bash`, `set -euo pipefail`, a `ROOT=` derived from `BASH_SOURCE`, a header
comment carrying the usage line):

- refuses to run on a dirty working tree, or from a detached HEAD
- runs `release:prepare` with the configured flags
- on success prints the remaining three steps with the actual tag name substituted in
- mentions `mvn release:rollback` and `release:clean` for the abort path

The sequence above is fiddly and its failure modes are quiet, which is exactly the case for
encoding it rather than documenting it twice.

### Documentation

- `modules/liberiaemr/README.md` — the "Releasing the module is opt-in" section added by
  PR #112 describes a mechanism this design replaces. It is rewritten around the tag flow.
  The version table's "Repsy, release" row changes to name the `liberiaemr-x.y.z` tag.
- `docs/runbooks/` — a new module-release runbook holding the sequence, the two ordering
  rules, the abort path, and what to do when a tag is pushed by mistake.
- `.github/workflows/modules.yml` — its header comment block documents the version streams
  and must describe the tag stream.

## Testing

1. `actionlint` on the changed workflow. The repo-wide run reports ten pre-existing findings
   in `ci.yml`; the changed file must stay clean.
2. The `decide` script extracted back out of the parsed YAML, exercised over the existing ten
   cases plus new module-tag cases: tag matching the pom, tag not matching, tag suffix that
   is a SNAPSHOT, a malformed tag, a tag reachable from `main`, and a tag that is not
   (the squash case, which must fail rather than skip).
3. `mvn release:prepare -DdryRun=true` locally in `modules/liberiaemr`, followed by
   `mvn release:clean`, to prove the pom configuration before anything is committed. This
   also settles constraint 6 for the module empirically.
4. `./scripts/validate/validate-content.sh` and `./scripts/validate/no-secrets.sh`, per the
   CONTRIBUTING pre-PR checklist.

## Explicitly out of scope

- Releasing anything other than `modules/liberiaemr`.
- `release:perform`. CI's existing deploy step already works and already asserts the `.omod`
  was uploaded; re-implementing that through `perform` would need `workingDirectory` pointed
  into `target/checkout/modules/liberiaemr` for the monorepo layout, for no gain.
- Changing the distribution's own release process in `release.yml`.
- Backfilling module versions for distribution releases cut before this exists.
