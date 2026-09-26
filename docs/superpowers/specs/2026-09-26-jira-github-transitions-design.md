# Jira ↔ GitHub status transitions — design

**Date:** 2026-09-26
**Status:** approved; implemented by `docs/superpowers/plans/2026-09-26-jira-github-transitions.md`

## Goal

Work on this repository moves its Jira issue across the **LE board** without anyone dragging
cards: pushing a branch starts it, opening a PR puts it in review, and a healthy deploy to
dev hands it to QA. Human and AI contributors need written conventions that make the
automation fire, and a documented fallback when it does not.

**Success looks like:** a new contributor — human or agent — who follows `CONTRIBUTING.md`
(or `IMPLEMENTATION.md`) names branches, commits and PRs so that every transition up to
*Ready for Testing* happens on its own, and knows what to do when one does not.

## Decisions

| Decision | Choice | Rejected alternative |
|---|---|---|
| Where transitions run | **Jira Automation** rules using the GitHub for Jira app's triggers | A GitHub Actions workflow calling the Jira REST API |
| "QA board" | The **QA columns of the existing LE board** (board 497) | A separate QA project with cloned issues |
| What hands an issue to QA | **Successful deploy to dev** (smoke-tested) | PR merge — would queue work for QA that failed to deploy or was rolled back |
| Enforcement | **Conventions + review skill check only** | A CI job failing PRs without a key (can be added later) |

## The LE board

Project **LE** (Liberia EMR, team-managed), board **LE board** (id 497), simple board, no
transition restrictions. Columns, left to right, one status each:

| Column / status | Status ID |
|---|---|
| To Do | 11297 |
| In Development | 11298 |
| In Review | 11299 |
| Ready for Testing | 11371 |
| Testing | 11300 |
| Issues/Bugs | 11405 |
| Reopened (Failed QA) | 11301 |
| Cancelled | 11577 |
| Done | 11302 |

## Conventions

- **Branch:** `<type>/LE-<n>-<scope>-<summary>`, e.g. `feat/LE-224-mch-opd-exam-findings`.
  The key is **uppercase**. One branch per issue. `<type>` and `<scope>` keep their
  existing meanings from `CONTRIBUTING.md`.
- **Commit subject:** the scope-prefix form from CONTRIBUTING.md's Commits section with the
  key as a suffix — `mch: add parity field [LE-224]`. Every commit carries the key.
- **PR title:** the same form — `mch: add parity field [LE-224]`. GitHub writes the PR
  title into the merge commit body, which puts an uppercase key in the commit the
  deployment scan reads (the branch name in `Merge pull request #N from …` is not enough).
- **No Jira issue:** pure `chore/` or `ci/` work keeps its keyless name; nothing moves on the
  board, by design.

## Status lifecycle

| From → To | Who | Trigger |
|---|---|---|
| To Do / Reopened (Failed QA) → **In Development** | Automation (R1a, R1b) | Branch created or commit created containing the key |
| To Do / In Development / Reopened (Failed QA) → **In Review** | Automation (R2) | Pull request created |
| In Development / In Review → **Ready for Testing** | Automation (R3) | Deployment successful to the `dev` environment |
| Ready for Testing → **Testing** | QA | Picks the issue up |
| Testing → **Done** | QA | Passed on dev |
| Testing → **Reopened (Failed QA)** | QA | Failed; the next push returns it to In Development via R1b |
| any → Issues/Bugs, Cancelled | Manual | Not git-driven |

Clarifications that belong in the docs:

- A local `git checkout -b` is invisible to Jira. The trigger is **pushing** the branch or
  its first commit.
- A **draft PR** fires "Pull request created" and moves the issue to In Review. Open a PR
  (draft or not) only when the work is ready for review.
- A PR **closed without merging** moves nothing; whoever closes it moves the card by hand.
- A merge alone does not move the issue; it stays In Review until the dev deploy passes its
  smoke test.

## Components

### A. Jira Automation rules (project LE, actor "Automation for Jira")

| Rule | Trigger | Conditions | Action |
|---|---|---|---|
| R1a Start work (branch) | Branch created | Status ∈ {To Do, Reopened (Failed QA)} | Transition to In Development |
| R1b Start work (commit) | Commit created | Status ∈ {To Do, Reopened (Failed QA)} | Transition to In Development |
| R2 Open for review | Pull request created | Status ∈ {To Do, In Development, Reopened (Failed QA)} | Transition to In Review |
| R3 Ready for QA | Deployment successful | Environment type = Development; status ∈ {In Development, In Review} | Transition to Ready for Testing |

R1 is two flows because the LE flow builder takes one trigger per flow.
The conditions only allow forward moves, so commits pushed during review or QA never drag an
issue backwards. R2 accepts To Do in case the PR event is processed before the branch
event; R3 accepts In Development in case the PR step was skipped.

Creating these rules needs Jira project-admin rights and is **not** done by this change; the
runbook is the hand-off.

### B. `ci.yml`

Add `environment: dev` to the `smoke-test` job (not `deploy-dev`). GitHub then records a
deployment whose success means *deployed and healthy*; a smoke failure that triggers
`rollback-dev` never reaches QA. GitHub creates the environment on first use; no protection
rules or secrets are needed. The GitHub for Jira app is expected to map the name `dev` to
the Development environment type and to associate the deployment with every issue key found
in the commits since the previous successful `dev` deployment.

To verify, not assume — both are open until the runbook's rehearsal: that `dev` maps to
Development rather than Unmapped (if not, the runbook's `.jira/config.yml` mapping is the
fix); and that commits from a cancelled or failed `main` run are picked up by the next
successful deployment.

### C. Documentation

| File | Audience | Change |
|---|---|---|
| `CONTRIBUTING.md` | Humans | Replace the Branches block with the conventions above; add the lifecycle table and a "card didn't move" section |
| `IMPLEMENTATION.md` | AI agents | New section beside §8 stating the rules as imperatives: branch from the issue key; key in every commit and PR title; transition issues by hand only where the lifecycle says manual; report a stuck card rather than working around the pipeline. Links to `CONTRIBUTING.md` instead of duplicating it |
| `.claude/skills/liberia-review/SKILL.md` | AI agents | One check: branch name and PR title carry an uppercase `LE-<n>`, or the branch is keyless `chore/`/`ci/`. Reported as a finding, not a blocker |
| `docs/runbooks/jira-automation.md` (new) | Jira admin, lead | Exact R1–R3 definitions with status IDs, the environment mapping, troubleshooting, the audit log as first stop |
| `docs/runbooks/README.md` | All | List the new runbook |

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Stays in To Do after pushing | Key missing or lowercase in branch name; branch not pushed | Push a commit with `[LE-n]` — R1b fires on commits |
| Stays in In Review after merge | Dev deploy or smoke test failed / rolled back | Fix `main`; the next successful deploy carries the issue |
| Stays in In Review after a green deploy | PR title and commits lack an uppercase key | Move by hand; note it in the PR |
| Moved backwards unexpectedly | A rule condition was loosened | Compare the audit log with the runbook table |
| Work spans two issues | One-branch-per-issue broken | Split the branch, or move the second card by hand |

Manual transition is the documented fallback, not a workaround. An agent that finds a stuck
card reports it; it does not modify the pipeline or the Jira rules.

## Verification

- `scripts/validate/validate-content.sh` and `scripts/validate/no-secrets.sh` still pass.
- The `ci.yml` edit is valid (`actionlint` if available, otherwise the PR's CI run).
- End-to-end dry run once an admin has created R1–R3: a throwaway LE issue, branch
  `chore/LE-<n>-jira-automation-smoke` → In Development; open PR → In Review; merge → the
  `main` run's `smoke-test` shows a `dev` deployment on the issue's development panel and
  the card reaches Ready for Testing.

## Out of scope

- CI enforcement of keys in branch names / PR titles.
- Transitions driven by staging or production deploys (`release.yml`).
- Renaming existing branches.
- Creating the Jira Automation rules.
