# 0006 — Rebase the distribution on O3 RefApp 3.7.1

**Status:** Accepted
**Supersedes:** [0002](0002-pin-o3-refapp-3.6.md)

## Context

[0002](0002-pin-o3-refapp-3.6.md) decided to base LiberiaEMR on **O3 RefApp 3.6 +
HIS-Lite**, pinned exactly, and left a follow-up: reconcile every version in
`distribution/distro.properties` against a published RefApp manifest before the first
release.

That reconciliation was done on **2026-07-28**, against a resolved
`openmrs-distro-referenceapplication` **3.7.1** manifest. It found two things.

First, the pins in `distro.properties` were hand-written and did not correspond to any
released RefApp — they were plausible-looking numbers, not a tested set. That is precisely
the failure mode 0002 was written to prevent, so leaving them was not an option.

Second, back-fitting to 3.6 would have meant adopting a baseline that is already behind the
community mainline at the start of a multi-year MOH engagement. The sustainability
commitment in the README is to stay on the mainline; starting a version behind spends that
budget before go-live.

## Decision

Rebase on **O3 RefApp 3.7.1 + HIS-Lite**. Every version in `distro.properties` that also
appears in the RefApp manifest is copied from it verbatim, including `groupId` and `type`
lines. The principle from 0002 is unchanged: pin exactly, no `latest`, no dynamic version,
no `-SNAPSHOT` outside development; the RefApp content package is a metadata baseline and
not a production configuration.

Headline pins: platform `2.8.8`, `spa.core` `10.0.0`, patient-chart ESMs `12.3.4`,
`content.referenceapplication` `1.4.0`.

Anything in `distro.properties` that is *not* in the RefApp set is labelled in-file as a
LiberiaEMR addition and carries its own upgrade risk. The RefApp demo artefacts
(`content.referenceapplication-demo`, `omod.referencedemodata`) stay out, per the standing
rule that demo content is never part of a production distribution.

Re-reconciliation is a whole-file operation against a newer RefApp manifest, recorded in a
new ADR. Individual pins are not hand-bumped — that reintroduces the untested combination
this ADR exists to prevent.

## Consequences

- The legacy 2.x UI stack RefApp 3.7.1 no longer ships (`appframework`, `appui`,
  `uiframework`, `uicommons`, `owa`, `metadatasharing`) is dropped. Nothing in
  `content-packages/` required it.
- Roughly 25 ESMs and 15 backend modules that the RefApp ships were missing from our
  manifest and are now present. The distribution is larger than the curated subset we had,
  in exchange for being a combination the community actually runs and debugs.
- All version requirements in `content-packages/*/content.properties` are lower bounds and
  remain satisfied, so no content package needed changing.
- Three items are pinned but **unverified**, marked `VERIFY` in `distro.properties` and
  tracked on the go-live checklist. None may ship open:
  - `omod.spa=3.1.0-SNAPSHOT` — RefApp 3.7.1 itself pins a SNAPSHOT here, contradicting
    the no-SNAPSHOT rule. Needs a released version.
  - `omod.dispensing` — RefApp 3.7.1 ships `esm-dispensing-app` with no backend dispensing
    module (dispensing runs on FHIR `MedicationDispense`). Either confirm the module or
    drop it and relax `content-liberia-pharmacy`.
  - `omod.htmlformentry` — dropped from the RefApp in favour of `o3forms` +
    `esm-form-engine`, but still required by `content-common`. Either confirm or migrate
    the content package.
- `omod.eip` was removed. `openmrs-eip` is a standalone Camel application run as its own
  container, not an OMOD; the entry was an artefact of the hand-written manifest.
