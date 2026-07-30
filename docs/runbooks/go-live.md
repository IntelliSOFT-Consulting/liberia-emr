# Runbook — go-live checklist

First go-live scope: **maternal health** — ANC, Labour & Delivery, PNC, Family Planning —
at Careysburg and Barnersville Health Centers.

## Blocking items

Go-live cannot proceed while any of these is open.

### Security — see [../security/moh-ict-sop-mapping.md](../security/moh-ict-sop-mapping.md)
- [ ] A4/A5 — password expiry and history mechanism decided (ADR 0004) and implemented
- [ ] A7 — server-side session timeout matching the 10-minute client timer
- [ ] B4 — named-account policy in training and operations
- [ ] C3 — log review confirms no PHI in application logs
- [ ] D3 — backup encryption implemented and a restore rehearsed

### Metadata — see [../metadata-specs/mch.md](../metadata-specs/mch.md)
- [ ] CIEL mappings for the partograph concepts
- [ ] Coded answers for amniotic fluid and moulding declared or mapped
- [ ] Programme outcome concepts agreed
- [ ] Lost-to-follow-up interval defined
- [ ] ANC Number format confirmed by the MOH
- [ ] The five MCH forms written and reviewed
- [ ] Indicator definitions agreed

### Distribution
- [ ] Every version in `distro.properties` reconciled against RefApp 3.7.1 (ADR 0006)
- [ ] The three VERIFY items in `distro.properties` closed — `omod.spa` off SNAPSHOT,
      `omod.dispensing` confirmed or dropped, `omod.htmlformentry` confirmed or dropped
- [ ] Clean install on an empty database passes
- [ ] **Upgrade from the previous release passes** — see `qa/upgrade/`
- [ ] Images published and immutable

### Clinical
- [ ] e-partograph implemented, alert/action geometry confirmed against the DAK
- [ ] Offline behaviour tested by actually disconnecting the facility, not by mocking it
- [ ] UAT signed off (`qa/uat/`)

### Sync
- [ ] Identity reconciliation policy agreed (ADR 0005)
- [ ] Facility→central push tested including a multi-day outage and recovery
- [ ] Mutual TLS working with MOH ICT Unit certificates

### Operations
- [ ] Backup running, off-site, and a restore rehearsed
- [ ] Disaster recovery rehearsed
- [ ] MOH ICT Unit trained on all four runbooks
- [ ] Facility staff trained on the demo stack — **never on production**

## Cutover

1. Freeze configuration changes.
2. Final backup of any pre-existing system.
3. Deploy the release per [deploy.md](deploy.md).
4. Verify the post-deploy checks at both facilities.
5. Register a test patient, complete an ANC encounter, confirm it reaches central.
6. **Void the test patient.** Do not leave test data in a production database.
7. Release to clinical use with support on site.

## After go-live

Production content is **append-only** (IMPLEMENTATION.md §9). No UUID changes, no concept
type changes, no deletion of program states patient data references. Corrections are made
by retiring and replacing, with a migration — never by editing in place.
