# 0002 — Base on O3 RefApp 3.6 + HIS-Lite, pinned exactly

**Status:** Superseded by [0006](0006-pin-o3-refapp-3.7.1.md)

The *principle* below — pin exactly, treat the RefApp as a tested-together set, treat its
content package as a baseline and not a configuration — still holds and is carried forward
unchanged. Only the baseline version moved, 3.6 → 3.7.1. This file is kept for the
reasoning; do not use its version numbers.

## Context

The project needs dispensing, laboratory, billing and stock at facility scale. HIS-Lite on
the O3 Reference Application 3.6 covers all four with community components.

The alternative — assembling modules independently — gives more control over each version
and loses the thing that matters most: RefApp versions are tested *together*. On facility
hardware with no vendor on site, a combination nobody else runs is a combination nobody
else has debugged.

## Decision

Base the distribution on **O3 RefApp 3.6 + HIS-Lite**. Pin every platform, module, frontend
module and content-package version exactly in `distribution/distro.properties`.

No `latest`, no dynamic version, no `-SNAPSHOT` outside development.

The RefApp content package is included as the metadata baseline but is explicitly **not** a
production configuration: it has no facility locations, identifiers or formularies. Those
come from our layers.

## Consequences

- Two builds of the same tag produce the same images. This is what makes the upgrade test
  meaningful and a rollback possible.
- Upgrades are deliberate: bump the pins, run the clean-install and upgrade tests, release.
- Cost: we do not get upstream fixes automatically. Accepted — an unnoticed change in a
  facility instance is worse than a known-old one.

## Follow-up

⚠ The versions currently in `distro.properties` are a **starting point**, not a verified
manifest. Reconcile every one against the published
`openmrs-distro-referenceapplication` 3.6.0 `distro.properties` and record the result here
before the first release.

**Done — see [0006](0006-pin-o3-refapp-3.7.1.md).** The reconciliation was carried out on
2026-07-28 and found that the hand-written pins here did not correspond to any released
RefApp; the baseline was moved to 3.7.1 rather than back-fitted to 3.6.
