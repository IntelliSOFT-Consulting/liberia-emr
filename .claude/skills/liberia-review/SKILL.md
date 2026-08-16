---
name: liberia-review
description: >-
  Review the current diff against LiberiaEMR's contractual and sustainability
  guardrails — the four-class change taxonomy, distribution/content separation,
  version discipline, UUID variables, append-only production content, the MOH
  security controls, and the demo/PHI/secret rules from IMPLEMENTATION.md. Use
  before opening a PR, or when asked to review LiberiaEMR content, distribution,
  or integration changes. Complements (does not replace) the built-in
  /code-review, which hunts generic correctness bugs.
---

# LiberiaEMR review

You are reviewing a change to an **OpenMRS 3.x distribution for the MOH, Republic of
Liberia**. The rules below are not style preferences — most encode a **contract** with the
Ministry or a **sustainability constraint** that keeps this project on the OpenMRS mainline.
A change that reads fine but breaks one of them is a defect. The single source of truth is
[`IMPLEMENTATION.md`](../../../IMPLEMENTATION.md); read it if a rule here is unclear, and
prefer it if the two ever disagree.

## How to review (adopted from Claude's code-review practice)

1. **Scope to the diff.** Review what changed on this branch. `git diff main...HEAD` (or the
   staged diff if reviewing pre-commit). Read enough surrounding code to judge each change —
   an unresolved `${var.*}`, a UUID collision, or a loosened privilege is only visible in
   context.
2. **Don't duplicate the deterministic validators.** `scripts/validate/validate-content.sh`,
   `no-secrets.sh`, `no-demo-in-release.sh`, and `lift-demo-content.sh --check` already catch
   the mechanical violations (malformed JSON/CSV, `#` comments in Initializer CSVs, obvious
   secrets, edited demo content, version-discipline breaches). **Run them first** and treat a
   pass as settled. Spend your effort on the *judgment* calls they cannot make: is this the
   right change **class**? does this metadata edit break existing patient data? does this
   quietly weaken a security control?
3. **Verify before you report.** For each candidate finding, construct a concrete failure:
   the input/state, and the wrong outcome (metadata that won't load, a UUID that collides on
   upgrade, a role that gains a privilege it shouldn't). If you can't, it's a question, not a
   finding — mark it as such or drop it.
4. **Rank by severity, lead with the worst.** A loosened security control or a
   production-breaking metadata change outranks everything. Don't pad the list with nits.
5. **Prefer high-confidence findings.** A short list of real problems is worth more than a
   long list of maybes. Say "no blocking issues found" when that's the truth.

## The LiberiaEMR checklist

Group your reading around the four change classes — the tree location makes the class
explicit (§3), and getting the class wrong is the most common way this project decays.

### Classification & separation (§0, §3, §11)
- Is the change in the **right tree** for its class? `content-packages/*/configuration/**`
  for Configure; `packages/modify-pr/.patches/**` for Modify+PR (with an upstream PR link,
  opened the same week); `packages/esm-*` for Custom Build; `integration/**` for External.
- **No integration logic** (DHIS2, mSupply, EIP, FHIR) smuggled inside a content package — it
  belongs in `integration/`.
- **Distribution and content stay separate.** Deployment/assembly concerns don't leak into
  content packages, and clinical content isn't hard-wired into the distribution. The
  e-partograph is a greenfield ESM pinned in `distro.properties`, **not** a content package
  and **not** a "modify" of any community component.

### Version discipline (§6)
- `content.properties` declares **ranges** (`>=`) — never pinned exacts.
- `distro.properties` **pins exact** tested versions with the `content.` prefix for content
  packages — **never** `latest`, dynamic versions, or `-SNAPSHOT` outside development.
- Semver bump matches the change: `1.1.0` backward-compatible metadata, `1.1.1` non-breaking
  fix, `2.0.0` breaking metadata/workflow change.

### UUID variables (§7)
- No **hard-coded UUIDs** in forms, reports, or frontend JSON — declare each UUID **once** in
  `configuration/variables.properties` and reference `${var.*}`. A new UUID introduced inline
  is a finding even if it "works," because a site package can no longer override it.
- New frontend runtime config (`config-*.json`) that must be loaded is also listed in
  `spa.configUrls` / `SPA_CONFIG_URLS` — config copied in but never referenced silently does
  nothing.

### Append-only in production (§9) — the highest-stakes content rule
For any edit to metadata that could already be in production, ask what happens on the
**upgrade path**, not just a clean install:
- No changed UUIDs; no numeric concept flipped to coded/text; no coded answers removed
  without migration analysis; no retired concept reused for a new meaning; no encounter
  semantics silently changed; no program state deleted while patient data may reference it.
- Form changes that alter meaning create a **new form version** preserving the historical
  schema — they don't mutate the existing one in place.
- The clean-DB CI job won't catch these — only the upgrade test would. Flag them here.

### Security — contractual, never loosen (§10, CONTRIBUTING "Review")
Anything touching `docs/security/` or the RBAC CSVs (`privileges/`, `roles/`,
`globalproperties/`) needs extra scrutiny and a **second human reviewer** — say so in your
output. Check nothing regresses below the MOH ICT SOP baseline: 13-char password minimum,
90-day expiry, no reuse of last 3, lockout after 5 failed attempts, 10-minute session
timeout, audit logs retained ≥3 months, TLS for facility↔cloud sync, encrypted backups. A
role or privilege that gains reach it didn't have, or a global property that relaxes one of
these, is a **contract breach** — treat it as the top finding regardless of intent.

### Data hygiene (§11, Appendix)
- **No demo content, demo patients, test users, or sample observations** in any production
  package. `content-demo` is training-only and never shipped.
- **No secrets, keys, or PHI** anywhere — only `.env.example` templates.
- **No `#` comments inside Initializer CSVs** — Initializer reads them as malformed rows;
  explanatory prose goes in a sibling `README.md`.

### Governance (§11, CONTRIBUTING)
- Content strategy and review sit with the **senior engineer**; test strategy and QA sign-off
  with the **QA Engineer**. Flag a change that has a junior/support role owning strategy or
  QA rather than executing against it.

## Output

Report findings most-severe first. For each: the file and location, one sentence stating the
defect, the concrete failure scenario, and which IMPLEMENTATION.md rule it breaks (e.g.
"§7 — hard-coded UUID"). Call out separately any change that needs a **second reviewer**
(security/RBAC) or that only the **upgrade test** would catch. If nothing blocks, say so
plainly and list the validators you ran.
