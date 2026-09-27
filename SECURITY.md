# Security Policy

LiberiaEMR holds patient health information for the Ministry of Health, Republic of Liberia.
A vulnerability here can expose patient records, so please report it privately.

## Reporting a vulnerability

Email **dev@intellisoftkenya.com**.

**Do not** open a public GitHub issue, pull request or discussion for a suspected
vulnerability. This repository is public, and anything posted there is visible at once.

Include what you can of:

- the component affected: backend module (`modules/liberiaemr`), a frontend module
  (`packages/esm-liberia-*`), a distribution image, the sync layer, or the content
  packages;
- the version, image tag or commit;
- the steps to reproduce, and what an attacker gains.

**Never include patient data** in a report: no names, identifiers or record contents, and no
screenshots showing them. Describe the record ("a patient registered at the facility"), not
the patient. The same goes for credentials, tokens and certificates. If you had to use one to
reproduce the issue, say so and rotate it. Do not send it.

## What happens next

1. We acknowledge your report and confirm that we can reproduce it, or ask you for more.
2. We assess its impact, fix it on `main`, and ship the fix in a release.
3. Where a deployed facility or central instance is affected, we tell the MOH ICT Unit.
4. We credit you in the release notes, unless you ask us not to.

Please give us reasonable time to ship a fix before disclosing anything publicly.

## Supported versions

No release has been cut yet. Until the first one, security fixes go to `main` only.

Once releases exist, fixes go to the **latest release**. A facility on an older release gets
the fix by upgrading.

## Scope

In scope: everything in this repository, including the images built from `distribution/`.

Vulnerabilities in upstream components (OpenMRS core and modules, O3 frontend modules,
openmrs-dbsync, MariaDB, ActiveMQ Artemis) belong upstream. Report them to that project. If
LiberiaEMR's configuration or pinned version makes the issue worse, report that part to us
too.

The security controls this project must meet are mapped in
[docs/security/moh-ict-sop-mapping.md](docs/security/moh-ict-sop-mapping.md).
