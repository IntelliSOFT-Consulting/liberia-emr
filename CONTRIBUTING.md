# Contributing to LiberiaEMR

Read [IMPLEMENTATION.md](IMPLEMENTATION.md) in full first. The conventions there encode both
OpenMRS best practice and this project's contractual and sustainability constraints.

## Classify your change first

Every change is exactly one of four classes, and the class determines where it goes. Getting
this wrong is the most common way this kind of project decays.

| Class | Meaning | Location |
| --- | --- | --- |
| **Configure** | Community configuration only — Initializer CSV/JSON, O3 runtime JSON | `content-packages/*/configuration/**` |
| **Modify + PR** | A change to a community component that **will be upstreamed** | `packages/modify-pr/.patches/**` |
| **Custom Build** | Greenfield component with no community equivalent | `packages/esm-*`, pinned in `distro.properties` |
| **External** | Integration with a system outside O3 | `integration/**` |

The backend Custom Build, [`modules/liberiaemr/`](modules/liberiaemr/), is not pinned in
`distro.properties`: the backend image builds it from source (IMPLEMENTATION.md §3 and
Appendix item 3).

Ask in order: can this be **configuration**? If not, can it be a **new extension** in a
Custom Build ESM? Only then reach for a patch — and open the upstream PR the same week.

## Branches

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

Every change goes through a pull request. `main` is protected; CI must pass. The required
check is the **CI gate** job in `.github/workflows/ci.yml`, which fails unless every job it
depends on succeeded (only the clean-database and sync-hardening jobs may be skipped).
`ci.yml` runs on the pull request; of pushes, only a push to `main` triggers it, so a branch
gets no CI until a PR exists — run the workflow by hand (`gh workflow run ci.yml --ref
<branch>`), or open a draft PR, which moves the Jira issue to In Review, so do that only once
the work is ready to be looked at. The review posted by `claude-review.yml` is advisory and
never blocks a merge.

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

## Running it locally

[docs/runbooks/local-development.md](docs/runbooks/local-development.md) — how to bring a
stack up on your machine, the content edit→rebuild→restart loop, and the things that do not
work locally yet (the frontend module dev server, `mvn verify` on Apple Silicon, CIEL).

## Before you open a PR

```bash
./scripts/validate/validate-content.sh   # JSON, CSV, version discipline, variables
./scripts/validate/no-secrets.sh
./scripts/build/lift-demo-content.sh --check   # content-demo unchanged from upstream
mvn -B clean verify                      # Initializer schema validation
```

The root reactor builds the content packages only. If you touched the backend module or an
ESM, build it too — CI does:

```bash
(cd modules/liberiaemr && mvn -B clean package)            # backend module
(cd packages/esm-liberia-<name> && yarn install --frozen-lockfile \
   && yarn lint && yarn typescript && yarn build)          # each ESM you changed
```

## Review

- Content changes are reviewed by the senior engineer.
- Test strategy and QA sign-off sit with the QA Engineer.
- Junior and support roles execute against that strategy; they do not own it
  (IMPLEMENTATION.md §11).
- Anything touching `docs/security/` or the RBAC CSVs needs a second reviewer. A loosened
  control is a contract breach, and it is easy to loosen one by accident while fixing
  something else.

## Metadata changes: order matters

Follow the build order in IMPLEMENTATION.md §5 and write the metadata spec in
`docs/metadata-specs/` **before** the forms:

```
concepts → identifiers/locations/providers → visit & encounter model
        → programmes & workflows → forms → frontend config → reports → integrations
```

Starting with forms produces duplicated concepts and encounters that do not aggregate. This
is not a style preference — it is the failure this ordering exists to prevent.

Where the metadata comes from a DAK data element, follow
[docs/runbooks/dak-to-iniz.md](docs/runbooks/dak-to-iniz.md) and record the row in that
programme's traceability table, `docs/dak/traceability-<programme>.csv` — today only
[traceability-mch.csv](docs/dak/traceability-mch.csv) exists; a new programme starts a new file
with the same columns, documented in [docs/dak/](docs/dak/). A concept with no traceable source
cannot be defended in review.

### Layer order is a constraint, not a suggestion

Layers load **common → national → programme → site**. A layer cannot forward-reference
something a later layer declares. If a role needs a privilege from `national`, the role
belongs in `national` — not in `common` with a comment hoping for the best.

### Anything already in production is append-only

Do not change a UUID, change a concept from numeric to coded or text, remove coded answers
without a migration analysis, reuse a retired concept for a new meaning, or delete a program
state that patient data references. Retire → introduce a corrected concept → migrate. For
forms, create a **new form version** and preserve the historical schema (IMPLEMENTATION.md §9).

## Upstream PR workflow (Modify + PR)

1. Confirm it cannot be configuration or an extension.
2. Write the patch in `packages/modify-pr/.patches/`.
3. Open the upstream PR **and link it in the required sidecar file**. A patch without a PR
   link is a fork, which is the thing we are avoiding.
4. When it merges: bump the pin in `distro.properties`, delete the patch and its sidecar.

## Never commit

- Secrets, keys, certificates or credentials — only `.env.example` templates
- PHI, or any data derived from a production database
- Demo patients or test users in a non-demo content package
- Hard-coded UUIDs in forms, reports or frontend JSON
- `latest`, dynamic versions or `-SNAPSHOT` outside development
- Exact versions in `content.properties`, or ranges in `distro.properties`

CI enforces all of these. If a check blocks you, the check is usually right.

## Commits

Imperative subject, scope prefix, the Jira key in square brackets at the end, and the *why*
in the body. Give the PR title the same form — GitHub copies it into the merge commit, which
is what links the dev deploy back to the issue:

```
mch: add ANC workflow states [LE-224]

The ANC programme needs explicit terminal states so that lost-to-follow-up
is computable for reporting. Delivered and Transferred Out are terminal;
Active is initial.
```
