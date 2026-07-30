# IP handover to the Ministry of Health, Republic of Liberia

Full intellectual property in LiberiaEMR transfers to the **Ministry of Health, Republic of
Liberia**. This is a contractual requirement, and it shapes technical decisions throughout
the repository rather than being a clause bolted on at the end.

## What handover actually requires

A handover that only transfers a licence is not a handover. The MOH must be able to
**operate, modify and rebuild** this system without the original delivery team. Three things
have to be true:

### 1. Everything is reproducible from configuration

Any release can be rebuilt from a git tag: `distribution/distro.properties` pins every
platform, module and content version, and `content-packages/` holds all clinical content and
configuration. There is no build step that depends on a machine, a person, or an
undocumented artefact.

This is why configuration is deliberately **not** included in backups — it is reproducible
from the tag. It is also why `latest` and `-SNAPSHOT` are forbidden: a release that cannot be
rebuilt identically has not really been handed over.

### 2. We stay on the community mainline

The project stays on OpenMRS community releases. A large maintained fork would hand the MOH
a system only its authors can upgrade.

Where a community component genuinely needs changing, the change is upstreamed
(`packages/modify-pr/`), and every patch carries a required upstream PR link. Where no
community component exists, we build a normal O3 module (`packages/esm-*`) — greenfield, not
a fork.

### 3. The reasoning is transferable, not just the code

- [`docs/adr/`](docs/adr/) — why each significant decision was made, so it is not
  re-litigated by whoever maintains this next
- [`docs/runbooks/`](docs/runbooks/) — written to be followed by someone who did not build
  the system
- [`docs/metadata-specs/`](docs/metadata-specs/) — the clinical specification behind the
  metadata
- [`docs/security/`](docs/security/) — how each contractual control is enforced, **including
  which ones are still open**

That last point matters: a handover document that lists only what works is a sales document.
The security mapping and the go-live checklist name the open items explicitly.

## What the MOH receives

| | |
| --- | --- |
| Source | This repository, complete history |
| Content packages | Versioned Maven artefacts |
| Images | Immutable, versioned, published to the registry |
| Documentation | Architecture, ADRs, runbooks, metadata specs, security mapping |
| Test suites | API, E2E, manual scripts, UAT records, upgrade harness |

## What the MOH must hold, and we must not

- Production secrets and credentials — the MOH secret store, never this repository
- TLS certificates and their lifecycle
- OCL/CIEL subscription credentials
- DHIS2 credentials and the data-element mappings
- Any production database or backup

`scripts/validate/no-secrets.sh` enforces the repository side of this in CI.

## Licence

Mozilla Public License 2.0 with Healthcare Disclaimer, consistent with OpenMRS. Custom
components in `packages/` carry the same licence so the MOH inherits a single, coherent
position rather than a mix requiring legal review.

## Handover readiness

Handover is not complete while the ICT Unit has not rehearsed the runbooks. An operations
team that has never restored a backup or executed the disaster-recovery procedure has been
given documents, not a capability. See the operations section of
[docs/runbooks/go-live.md](docs/runbooks/go-live.md).
