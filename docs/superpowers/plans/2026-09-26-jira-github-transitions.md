# Jira ↔ GitHub Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the branch/commit/PR conventions and Jira Automation rules that move LE
issues across the LE board, and make the dev deploy visible to Jira.

**Architecture:** Transitions run in Jira Automation (GitHub for Jira app triggers), not in
this repo. The repo contributes (a) a `dev` GitHub deployment recorded by the `smoke-test`
job, and (b) documentation for humans (`CONTRIBUTING.md`), agents (`IMPLEMENTATION.md`, the
`liberia-review` skill) and the Jira admin (a new runbook).

**Tech Stack:** Markdown, GitHub Actions YAML, `actionlint`, `grep`.

**Spec:** `docs/superpowers/specs/2026-09-26-jira-github-transitions-design.md`

## Global Constraints

- Jira project key `LE`; board `LE board` (id 497).
- Issue key is **uppercase** `LE-<n>` in branch names, commit subjects and PR titles.
- Branch: `<type>/LE-<n>-<scope>-<summary>`; keyless `chore/<summary>` or `ci/<summary>` only for work with no Jira issue.
- Commit subject and PR title end with the key in square brackets: `… [LE-224]`.
- One branch, one PR, one issue key.
- Status IDs: To Do 11297, In Development 11298, In Review 11299, Ready for Testing 11371, Testing 11300, Issues/Bugs 11405, Reopened (Failed QA) 11301, Cancelled 11577, Done 11302.
- Rules: R1a Branch created and R1b Commit created (two flows — the LE flow builder takes one trigger per flow) → In Development (from To Do, Reopened (Failed QA)); R2 Pull request created → In Review (from To Do, In Development, Reopened (Failed QA)); R3 Deployment successful, environment type Development → Ready for Testing (from In Development, In Review).
- `environment: dev` goes on the `smoke-test` job, **not** `deploy-dev`.
- Manual transitions: Testing, Done, Reopened (Failed QA), Issues/Bugs, Cancelled — and any card the automation missed.
- Agents never edit the pipeline or Jira rules to unstick a card; they report it.
- Do not renumber `IMPLEMENTATION.md` sections — the `liberia-review` skill cites them by number.

## Review Focus

1. **Draft PR opened just to get CI** — `CONTRIBUTING.md` currently tells people to open a draft PR for CI; that now moves the card to In Review early. The docs must say so and offer `gh workflow run ci.yml --ref <branch>` instead. Test in Task 3.
2. **Lowercase key from the old habit** (`feat/le-224-…`) — a reader must be told explicitly it does not count. Tests in Tasks 3 and 5.
3. **Agent finds a stuck card** — expected behaviour is to report it and move it by hand only where the lifecycle allows, never to edit `ci.yml` or Jira rules. Test in Task 4.
4. **Keyless `chore/` or `ci/` branch** — the review skill must not flag it. Test in Task 5.
5. **Two keys in one PR title** — R2/R3 would move both issues; docs must say one key per PR. Test in Task 3.

---

### Task 1: Jira automation runbook

**Files:**
- Create: `docs/runbooks/jira-automation.md`
- Modify: `docs/runbooks/README.md` (runbook table, and the "not yet rehearsed" paragraph)

**Interfaces:**
- Produces: the path `docs/runbooks/jira-automation.md` and the rule names `R1a Start work`, `R1b Start work`, `R2 Open for review`, `R3 Ready for QA`, which Tasks 3 and 4 link to and cite.

- [ ] **Step 1: Write the failing check**

```bash
cd "$(git rev-parse --show-toplevel)"
test -f docs/runbooks/jira-automation.md \
 && grep -q 'R1a Start work' docs/runbooks/jira-automation.md \
 && grep -q 'R3 Ready for QA' docs/runbooks/jira-automation.md \
 && grep -q '11371' docs/runbooks/jira-automation.md \
 && grep -q '(jira-automation.md)' docs/runbooks/README.md \
 && echo PASS || echo FAIL
```

- [ ] **Step 2: Run it — expect `FAIL`**

- [ ] **Step 3: Create `docs/runbooks/jira-automation.md` with exactly this content**

````markdown
# Runbook — Jira automation for the LE board

> ⚠ **Not yet rehearsed.** The rules below must be created by an LE project admin, then
> checked with the rehearsal at the end of this runbook.

Work on this repository moves its issue across the **LE board** (project `LE`, board id 497)
without anyone dragging cards. Pushing a branch starts the issue, opening a PR puts it in
review, and a smoke-tested deploy to dev hands it to QA. QA owns every move after that.

The contributor side — how to name branches, commits and PRs so the rules fire — is in
[CONTRIBUTING.md](../../CONTRIBUTING.md#jira-board). This runbook is the admin side.

## Preconditions

- The **GitHub for Jira** app is installed on intellisoftkenya.atlassian.net with the
  `IntelliSOFT-Consulting` organisation connected. Check: open any LE issue whose key is in a
  pushed branch name — its **Development** panel lists the branch.
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

Create each in **Project settings → Automation → Create rule**, scoped to project LE, with
the rule actor left as *Automation for Jira*. The triggers are under **DevOps**; each acts on
every issue whose key appears in the event.

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
app reads the environment name `dev` as type **Development** and links the deployment to
every issue key in the commits since the previous successful `dev` deployment. A merge
commit carries the PR title in its body, which is why the PR title must contain the key.

If an issue's Development panel shows the deployment as **Unmapped** rather than
Development, R3 will not fire. Add a `.jira/config.yml` to the repository root mapping the
name:

```yaml
deployments:
  environmentMapping:
    development:
      - "dev"
```

## Troubleshooting

Start with **Project settings → Automation → Audit log**: it shows whether a rule ran, and
if it ran, which condition stopped it.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Stays in To Do after pushing | Key missing or lowercase in the branch name; branch not pushed | Push a commit whose subject ends `[LE-n]` — R1b fires on commits |
| Stays in In Review after a merge | Dev deploy or smoke test failed, or rolled back | Fix `main`; the next successful dev deploy carries the issue |
| Stays in In Review after a green deploy | PR title and commits lack an uppercase key; or the deployment is Unmapped | Move it by hand and note it in the PR; check the environment mapping above |
| Moved backwards unexpectedly | A rule condition was widened | Compare the rule with the table above |
| Two issues moved by one PR | Two keys in the PR title or commits | Move the wrong one back by hand; one key per PR |

Moving a card by hand is the documented fallback, not a workaround.

## Rehearsal

1. Create a throwaway LE issue, `LE-<n>`.
2. `git switch -c chore/LE-<n>-jira-automation-smoke origin/main`, commit an empty change
   (`git commit --allow-empty -m "chore: jira automation smoke [LE-<n>]"`), push. Expect
   **In Development**.
3. Open a PR titled `chore: jira automation smoke [LE-<n>]`. Expect **In Review**.
4. Merge. When the `main` run's **Smoke test (dev)** job passes, expect a `dev` deployment on
   the issue's Development panel and the card in **Ready for Testing**.
5. Move the card to Cancelled, and remove the ⚠ banner at the top of this runbook.
````

- [ ] **Step 4: Edit `docs/runbooks/README.md`**

Add this row after the `sync-operations.md` row of the table:

```markdown
| [jira-automation.md](jira-automation.md) | Jira Automation rules that move LE issues from branch, PR and dev deploy — ⚠ not yet rehearsed |
```

Replace the paragraph's sentence `Two procedures here have not been executed end to end, and each
says so at the top:` with `Three procedures here have not been executed end to end, and each
says so at the top:`, and append to the end of that paragraph (after `MOH-issued material.`):

```markdown
 The Jira rules in `jira-automation.md` wait for an LE project admin to create them.
```

(The leading space joins it to the preceding sentence; keep the paragraph's existing line
wrapping at ~92 columns.)

- [ ] **Step 5: Run the Step 1 check — expect `PASS`**

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks/jira-automation.md docs/runbooks/README.md
git commit -m "docs(runbooks): Jira automation rules for the LE board

Records the three Jira Automation rules that move LE issues from branch,
PR and dev deploy, with status IDs, so an admin can rebuild them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record the dev deployment

**Files:**
- Modify: `.github/workflows/ci.yml` — the `smoke-test:` job (currently near line 1101)

**Interfaces:**
- Produces: a GitHub deployment to environment `dev` on every green smoke test on `main`, consumed by rule R3.

- [ ] **Step 1: Write the failing check**

```bash
cd "$(git rev-parse --show-toplevel)"
awk '/^  smoke-test:/{f=1;next} f&&/^  [a-z]/{exit} f' .github/workflows/ci.yml \
  | grep -q '^    environment: dev$' && echo PASS || echo FAIL
awk '/^  deploy-dev:/{f=1;next} f&&/^  [a-z]/{exit} f' .github/workflows/ci.yml \
  | grep -q 'environment:' && echo "FAIL (deploy-dev must not declare it)" || echo PASS
```

- [ ] **Step 2: Run it — expect the first line `FAIL`, the second `PASS`**

- [ ] **Step 3: Add the environment to `smoke-test`**

Change:

```yaml
  smoke-test:
    name: Smoke test (dev)
    runs-on: ubuntu-latest
    needs: deploy-dev
```

to:

```yaml
  smoke-test:
    name: Smoke test (dev)
    runs-on: ubuntu-latest
    needs: deploy-dev
    # Records a GitHub deployment to "dev" that succeeds only when the new version
    # is up AND healthy. The GitHub for Jira app reads it as a Development deploy and
    # Jira rule R3 moves the linked LE issues to Ready for Testing
    # (docs/runbooks/jira-automation.md). Deliberately not on deploy-dev: a deploy
    # that smoke-test then rolls back must never reach QA.
    environment: dev
```

- [ ] **Step 4: Run the Step 1 check — expect `PASS` twice — then lint**

Run: `actionlint .github/workflows/ci.yml`
Expected: no output, exit 0. If it reports pre-existing findings, run `git stash; actionlint .github/workflows/ci.yml; git stash pop` and confirm the same findings exist without this change.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: record smoke-tested dev deploys as a GitHub deployment

Jira rule R3 moves LE issues to Ready for Testing on a successful Development
deployment. Putting the environment on smoke-test rather than deploy-dev means
a deploy that gets rolled back never reaches QA.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Contributor conventions in `CONTRIBUTING.md`

**Files:**
- Modify: `CONTRIBUTING.md` — `## Branches` (≈ lines 25–42), new `## Jira board` section after it, `## Commits` (≈ line 130 to end)
- Modify: `docs/superpowers/specs/2026-09-26-jira-github-transitions-design.md` — the commit-subject convention line

**Interfaces:**
- Consumes: `docs/runbooks/jira-automation.md` (Task 1).
- Produces: the anchor `CONTRIBUTING.md#jira-board`, linked from the runbook (Task 1) and `IMPLEMENTATION.md` (Task 4).

- [ ] **Step 1: Write the failing check**

```bash
cd "$(git rev-parse --show-toplevel)"
f=CONTRIBUTING.md
grep -q '^## Jira board$' $f \
 && grep -q 'feat/LE-<n>-<scope>-<summary>' $f \
 && grep -q 'gh workflow run ci.yml --ref' $f \
 && grep -qi 'lowercase' $f \
 && grep -q 'One key per' $f \
 && grep -q '\[LE-224\]' $f \
 && grep -q '(docs/runbooks/jira-automation.md)' $f \
 && echo PASS || echo FAIL
```

- [ ] **Step 2: Run it — expect `FAIL`**

- [ ] **Step 3: Replace the `## Branches` code block and the `<scope>` sentence**

Replace:

````markdown
```
main                        always releasable
feat/<scope>-<summary>      new content or feature
fix/<scope>-<summary>       corrections
chore/<summary>             build, CI, docs
```

`<scope>` names the layer or component: `mch`, `national`, `site-careysburg`, `epartograph`,
`eip`, `distro`.
````

with:

````markdown
```
main                               always releasable
feat/LE-<n>-<scope>-<summary>      new content or feature
fix/LE-<n>-<scope>-<summary>       corrections
chore/LE-<n>-<summary>             build, CI, docs
chore/<summary>, ci/<summary>      work with no Jira issue — nothing moves on the board
```

`LE-<n>` is the Jira issue the branch implements, in **uppercase** — `feat/le-224-…`, the
older habit, does not link to Jira. One branch per issue. `<scope>` names the layer or
component: `mch`, `national`, `site-careysburg`, `epartograph`, `eip`, `distro`.
````

- [ ] **Step 4: Fix the draft-PR advice in the paragraph below it**

Replace `open a draft PR, or run the workflow by hand.` with:

```markdown
run the workflow by hand
(`gh workflow run ci.yml --ref <branch>`), or open a draft PR — which moves the Jira issue to
In Review, so do that only once the work is ready to be looked at.
```

(Rewrap the paragraph to ~92 columns.)

- [ ] **Step 5: Insert a `## Jira board` section immediately before `## Running it locally`**

````markdown
## Jira board

Branches, commits, PRs and the dev deploy move the issue across the
[LE board](https://intellisoftkenya.atlassian.net/jira/software/projects/LE/boards/497)
through Jira Automation. Name things as above and in [Commits](#commits) and you do not drag
cards; QA drags the rest.

| From → To | Moved by | When |
| --- | --- | --- |
| To Do, Reopened (Failed QA) → **In Development** | Automation | You **push** the branch, or a commit with the key. A local checkout is invisible to Jira |
| → **In Review** | Automation | You open the PR — **draft PRs count** |
| → **Ready for Testing** | Automation | The merge is deployed to dev **and** its smoke test passes. A merge alone moves nothing |
| → **Testing** | QA | QA picks it up on dev |
| → **Done** / **Reopened (Failed QA)** | QA | Passed / failed. Your next push after a reopen moves it back to In Development |
| → Issues/Bugs, Cancelled | Anyone | By hand; not git-driven |

**One key per branch, PR title and commit.** Two keys move two issues. A PR closed without
merging moves nothing — whoever closes it moves the card.

### If a card does not move

| Symptom | Fix |
| --- | --- |
| Still To Do after pushing | Key missing or lowercase in the branch — push a commit whose subject ends `[LE-n]` |
| Still In Review after merging | The dev deploy or smoke test failed; the next green deploy carries it |
| Still In Review after a green deploy | Key missing from the PR title — move it by hand and say so in the PR |

Moving a card by hand is the fallback, not a workaround; do not change `ci.yml` or the Jira
rules to force one. Rules and troubleshooting:
[docs/runbooks/jira-automation.md](docs/runbooks/jira-automation.md).
````

- [ ] **Step 6: Update `## Commits`**

Replace:

````markdown
Imperative subject, scope prefix, and the *why* in the body:

```
mch: add ANC workflow states
````

with:

````markdown
Imperative subject, scope prefix, the Jira key in square brackets at the end, and the *why*
in the body. Give the PR title the same form — GitHub copies it into the merge commit, which
is what links the dev deploy back to the issue:

```
mch: add ANC workflow states [LE-224]
````

(The body lines of the example stay as they are.)

- [ ] **Step 7: Align the spec with the existing commit convention**

In `docs/superpowers/specs/2026-09-26-jira-github-transitions-design.md`, replace the
**Commit subject** and **PR title** bullets' examples `feat(mch): add parity field [LE-224]`
with `mch: add parity field [LE-224]`, and `conventional-commit form` with `the scope-prefix
form from CONTRIBUTING.md's Commits section`.

- [ ] **Step 8: Run the Step 1 check — expect `PASS`**

- [ ] **Step 9: Commit**

```bash
git add CONTRIBUTING.md docs/superpowers/specs/2026-09-26-jira-github-transitions-design.md
git commit -m "docs(contributing): Jira keys in branches, commits and PR titles

Branches, commits and PR titles now carry an uppercase LE key so Jira
Automation can move the issue from push to review to QA. Also stops
recommending a draft PR just to get CI, since that now moves the card.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Agent instructions in `IMPLEMENTATION.md`

**Files:**
- Modify: `IMPLEMENTATION.md` — §8, the `ci.yml` row of the workflow table, and a new `### Work tracking` subsection at the end of §8 (just before the `---` that precedes `## 9.`)

**Interfaces:**
- Consumes: `CONTRIBUTING.md#jira-board` (Task 3), `docs/runbooks/jira-automation.md` (Task 1).

- [ ] **Step 1: Write the failing check**

```bash
cd "$(git rev-parse --show-toplevel)"
f=IMPLEMENTATION.md
grep -q '^### Work tracking — the LE Jira board$' $f \
 && grep -q 'Do not edit `ci.yml` or the Jira rules' $f \
 && grep -q 'CONTRIBUTING.md#jira-board' $f \
 && grep -q 'records a `dev` deployment' $f \
 && [ "$(grep -c '^## [0-9]' $f)" = "$(git show origin/main:$f | grep -c '^## [0-9]')" ] \
 && echo PASS || echo FAIL
```

- [ ] **Step 2: Run it — expect `FAIL`**

- [ ] **Step 3: Extend the `ci.yml` table row**

In the `| \`ci.yml\` |` row, replace `and updates the dev environment.` with
`and updates the dev environment; a passing smoke test there records a \`dev\` deployment that Jira reads.`

- [ ] **Step 4: Insert the subsection at the end of §8, before the `---` above `## 9.`**

```markdown
### Work tracking — the LE Jira board

Git activity moves issues on the LE board through Jira Automation. To keep it working:

1. **Work from an issue.** Before creating a branch, get the `LE-<n>` key from the human. Name
   the branch `<type>/LE-<n>-<scope>-<summary>`, key in uppercase. Only work with no issue
   uses a keyless `chore/` or `ci/` branch.
2. **Key every commit and the PR title**, suffixed in square brackets: `mch: add ANC
   workflow states [LE-224]`. One key, the branch's own.
3. **Open a PR — draft or not — only when the work is ready for review**; opening one moves
   the issue to In Review. For CI before then, `gh workflow run ci.yml --ref <branch>`.
4. **Do not move issues yourself** between In Development, In Review and Ready for Testing;
   the automation does. Testing, Done and Reopened belong to QA.
5. **A card that did not move is a finding to report**, with the symptom from the table in
   [CONTRIBUTING.md](CONTRIBUTING.md#jira-board). Do not edit `ci.yml` or the Jira rules to
   force a transition — see [docs/runbooks/jira-automation.md](docs/runbooks/jira-automation.md).
```

- [ ] **Step 5: Run the Step 1 check — expect `PASS`**

- [ ] **Step 6: Commit**

```bash
git add IMPLEMENTATION.md
git commit -m "docs(implementation): tell agents how work moves the LE Jira board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `liberia-review` skill check

**Files:**
- Modify: `.claude/skills/liberia-review/SKILL.md` — `### Governance (§11, CONTRIBUTING)` list

**Interfaces:**
- Consumes: the conventions in `CONTRIBUTING.md` (Task 3).

- [ ] **Step 1: Write the failing check**

```bash
cd "$(git rev-parse --show-toplevel)"
f=.claude/skills/liberia-review/SKILL.md
gov=$(mktemp)
awk '/^### Governance/{f=1;next} /^## /{f=0} f' $f > "$gov"
grep -q 'LE-<n>' "$gov" \
 && grep -q 'lowercase' "$gov" \
 && grep -q 'keyless `chore/` or `ci/`' "$gov" \
 && grep -q 'not a blocker' "$gov" \
 && echo PASS || echo FAIL; rm -f "$gov"
```

- [ ] **Step 2: Run it — expect `FAIL`**

- [ ] **Step 3: Append this bullet to the Governance list** (after the senior engineer / QA Engineer bullet)

```markdown
- **Jira key** (CONTRIBUTING "Branches", "Jira board"): the branch name
  (`git branch --show-current`) and PR title carry the uppercase `LE-<n>` of one issue, and
  commit subjects end `[LE-<n>]`. A lowercase `le-<n>`, a missing key, or two keys stops the
  board moving. A keyless `chore/` or `ci/` branch with no issue is fine. Report it as a
  finding, not a blocker — it breaks tracking, not the product.
```

- [ ] **Step 4: Run the Step 1 check — expect `PASS`**

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/liberia-review/SKILL.md
git commit -m "docs(review): check branch and PR title carry the LE Jira key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-branch verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Project validators**

Run: `./scripts/validate/validate-content.sh && ./scripts/validate/no-secrets.sh`
Expected: both exit 0.

- [ ] **Step 2: Every relative link added on this branch resolves**

```bash
cd "$(git rev-parse --show-toplevel)"
for f in CONTRIBUTING.md IMPLEMENTATION.md docs/runbooks/jira-automation.md docs/runbooks/README.md; do
  d=$(dirname "$f")
  grep -oE '\]\([^)#]+' "$f" | sed 's/^](//' | grep -v '^https\?:' | sort -u | while read -r p; do
    [ -e "$d/$p" ] || echo "BROKEN in $f: $p"
  done
done; echo done
```

Expected: only `done`.

- [ ] **Step 3: Re-run the checks from Tasks 1–5** — all `PASS`.

- [ ] **Step 4: Report** the branch's commits (`git log --oneline origin/main..HEAD`) and the
  hand-offs outside this repo: an LE admin creates R1–R3 from the runbook, then runs its
  Rehearsal; and the spec's open question — whether commits from a cancelled or failed `main`
  run are linked by the next successful `dev` deployment — can only be answered by watching
  that happen once, so list it as unverified. Do not push or open the PR without the human's
  go-ahead.
