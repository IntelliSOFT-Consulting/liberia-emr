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

Ask in order: can this be **configuration**? If not, can it be a **new extension** in a
Custom Build ESM? Only then reach for a patch — and open the upstream PR the same week.

## Branches

```
main                        always releasable
feat/<scope>-<summary>      new content or feature
fix/<scope>-<summary>       corrections
chore/<summary>             build, CI, docs
```

`<scope>` names the layer or component: `mch`, `national`, `site-careysburg`, `epartograph`,
`eip`, `distro`.

Every change goes through a pull request. `main` is protected; CI must pass.

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

Imperative subject, scope prefix, and the *why* in the body:

```
mch: add ANC workflow states

The ANC programme needs explicit terminal states so that lost-to-follow-up
is computable for reporting. Delivered and Transferred Out are terminal;
Active is initial.
```
