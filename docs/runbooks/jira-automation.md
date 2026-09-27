# Runbook — Jira automation for the LE board

> **Rehearsed 2026-09-26** with LE-315 (PR #151): R1b, R2 and R3 each moved the card as
> described below. R1a has not been exercised yet — the rehearsal branch was pushed before
> the repository was connected — and one case under *The dev environment* is still open.

Work on this repository moves its issue across the **LE board** (project `LE`, board id 497)
without anyone dragging cards. Pushing a branch starts the issue, opening a PR puts it in
review, and a smoke-tested deploy to dev hands it to QA. QA owns every move after that.

The contributor side — how to name branches, commits and PRs so the rules fire — is in
[CONTRIBUTING.md](../../CONTRIBUTING.md#jira-board). This runbook is the admin side.

## Preconditions

- The **GitHub for Jira** app (listed in Jira as *GitHub for Atlassian*) is installed on
  intellisoftkenya.atlassian.net with the `IntelliSOFT-Consulting` organisation connected.
- **liberia-emr is in that app's repository access.** The installation is limited to selected
  repositories, and until this repository was added nothing reached Jira at all. A GitHub
  org owner sets it under *Organisation settings → GitHub Apps → Jira → Configure →
  Repository access*. Events GitHub sent before the repository was added are not replayed.
  Check: open any LE issue whose key is in a branch pushed since — its **Development**
  panel lists the branch.
- The `smoke-test` job in `.github/workflows/ci.yml` declares `environment: dev`. That job
  running green on `main` is what Jira sees as a successful dev deployment.

## Board statuses

| Column / status | Status ID | Moved by |
| --- | --- | --- |
| To Do | 11297 | Manual |
| In Development | 11298 | R1a, R1b |
| In Review | 11299 | R2 |
| Ready for Testing | 11371 | R3 |
| Testing | 11300 | QA |
| Issues/Bugs | 11405 | Manual |
| Reopened (Failed QA) | 11301 | QA |
| Cancelled | 11577 | Manual |
| Done | 11302 | QA |

## The rules

They live in **Space settings → Automation** (*Create flow → Create from scratch*), scoped to
LE, with the actor left as *Automation for Jira* and *Who can edit this flow?* set to
**All admins**. The triggers are under **DevOps**; each acts
on every issue whose key appears in the event. The flow builder takes one trigger per flow,
so R1 is two flows with the same condition and action.

| Rule | Trigger | Condition: *Issue fields condition*, Status is one of | Action: *Transition issue* to |
| --- | --- | --- | --- |
| **R1a Start work** (branch created) | Branch created | To Do, Reopened (Failed QA) | In Development |
| **R1b Start work** (commit created) | Commit created | To Do, Reopened (Failed QA) | In Development |
| **R2 Open for review** | Pull request created | To Do, In Development, Reopened (Failed QA) | In Review |
| **R3 Ready for QA** | Deployment successful, environment type **Development** | In Development, In Review | Ready for Testing |

The conditions matter more than the triggers. They only allow forward moves, so a commit
pushed during review or QA never drags an issue back. R2 accepts To Do in case the PR event
arrives before the branch event; R3 accepts In Development in case the PR step was skipped.
Do not widen them.

## The dev environment

GitHub records a deployment for every job that declares `environment:`. The GitHub for Jira
app reads the environment name `dev` as type **Development**, which R3 depends on, and links
the deployment to every issue key in the commits since the previous successful `dev`
deployment. A merge commit carries the PR title in its body, which is why the PR title must
contain the key.

What the 2026-09-26 rehearsal established:

- `dev` is read as Development: R3 fired 12 seconds after the deployment was recorded.
- The first-ever `dev` deployment moved no other issue. The 16 LE issues then In Development
  or In Review stayed put.

> ⚠ **Still unverified:** that a deploy following a failed, rolled-back or cancelled one still
> links the earlier commits. Until someone has watched that happen, treat a card stuck in In
> Review after such a deploy as a manual move.

If an issue's Development panel ever shows a deployment as **Unmapped** rather than
Development — after renaming the environment, say — R3 will not fire. Add a
`.jira/config.yml` to the repository root mapping the name:

```yaml
deployments:
  environmentMapping:
    development:
      - "dev"
```

## Troubleshooting

Start with **Space settings → Automation → Audit log**: it shows whether a rule ran, and
if it ran, which condition stopped it.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No flow ran at all — the audit log has no entry, and the issue's Development panel is empty | The repository is not in the GitHub app's repository access | Add it (see Preconditions), then push a new keyed commit; earlier events are not replayed |
| Stays in To Do after pushing | Key missing or lowercase in the branch name; branch not pushed | Push a commit whose subject ends `[LE-n]` — R1b fires on commits |
| Stays in In Review after a merge | Dev deploy or smoke test failed, or rolled back | Fix `main`; the next successful dev deploy should carry the issue — if it does not, move it by hand (see ⚠ under *The dev environment*) |
| Stays in In Review after a green deploy | PR title and commits lack an uppercase key; or the deployment is Unmapped | Move it by hand and note it in the PR; check the environment mapping above |
| Moved backwards unexpectedly | A rule condition was widened | Compare the rule with the table above |
| Two issues moved by one PR | Two keys in the PR title or commits (bodies count) | Move the wrong one back by hand; one key per PR |

Moving a card by hand is the documented fallback, not a workaround.

## Rehearsal

1. Create a throwaway LE issue, `LE-<n>`.
2. `git switch -c chore/LE-<n>-jira-automation-smoke origin/main`, commit an empty change
   (`git commit --allow-empty -m "chore: jira automation smoke [LE-<n>]"`), push. Expect
   **In Development**.
3. Open a PR titled `chore: jira automation smoke [LE-<n>]`. Expect **In Review**.
4. Merge. When the `main` run's **Smoke test (dev)** job passes, expect a `dev` deployment on
   the issue's Development panel, typed **Development** (not Unmapped), and the card in
   **Ready for Testing**.
5. Move the card to Cancelled, and record the result in the note at the top of this runbook.
