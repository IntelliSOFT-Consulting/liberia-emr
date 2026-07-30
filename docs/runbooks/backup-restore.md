# Runbook — backup and restore

Encrypted backups are contractual (MOH ICT SOPs). Audit-log retention of ≥ 3 months depends
on this schedule, not only on the audit module's own settings.

> ⚠ **Status: not yet implemented.** Backup encryption is an open item in
> [../security/moh-ict-sop-mapping.md](../security/moh-ict-sop-mapping.md) (D3) and blocks
> go-live sign-off. This runbook is the specification to build against.

## What must be backed up

| Item | Contains | Frequency |
| --- | --- | --- |
| MariaDB database | all patient data | daily, plus before every upgrade |
| `openmrs-data` volume | attachments, uploaded files | daily |
| `sync-queue` volume | undelivered sync messages | daily |
| `facility.env` | connection secrets | on change — **store in the MOH secret store, never in git** |

Configuration is **not** backed up: it is reproducible from the release tag. That is the
point of the two-artefact model.

## Requirements

- **Encrypted at rest.** An unencrypted database dump on a facility shelf is a PHI breach.
- **Off-site copy**, given the disaster-recovery scenario is total facility loss.
- **Retention ≥ 3 months**, to satisfy the audit-log retention control.
- **Restore rehearsed quarterly.** An untested backup is an assumption.

## Restore

1. Stop the stack: `docker compose --env-file facility.env down`
2. Restore the database volume from the encrypted backup.
3. Restore `openmrs-data` and `sync-queue`.
4. Start with `LIBERIAEMR_VERSION` set to **the release the backup was taken from** — not
   the latest. Restoring an old database under a newer release runs migrations against data
   that has not been through the upgrade test.
5. Verify: login, patient search, a chart, MCH enrolments, sync queue draining.
6. Record the restore in the operations log.

## To build

- [ ] Backup script with encryption
- [ ] Scheduled execution and off-site copy
- [ ] Restore verification job
- [ ] Quarterly rehearsal added to the operations calendar
