# Runbook — disaster recovery

Scenario: a facility instance is lost entirely — hardware failure, fire, theft.

## What recovery depends on

| Asset | Source | Risk |
| --- | --- | --- |
| Application | registry images at the recorded release tag | Low — immutable and reproducible |
| Configuration | the release tag in this repository | Low — reproducible from git |
| Patient data | the encrypted off-site backup | **This is the whole risk** |
| Undelivered sync queue | backup, or replayed from source | Data recorded but never pushed |
| Secrets | MOH secret store | Not in git, by design |

Everything except patient data is reproducible from a tag. Recovery time is therefore
determined almost entirely by how recent and how restorable the last backup is.

## Procedure

1. Provision replacement hardware; install Docker.
2. Clone this repository at the release tag the facility was running.
3. Recreate `facility.env` from the MOH secret store — never from memory.
4. Restore the database and volumes per [backup-restore.md](backup-restore.md).
5. Bring the stack up at that same release version.
6. Verify against the post-deploy checks in [deploy.md](deploy.md).
7. Confirm with central which records had already been pushed, then let the sync queue
   drain. Idempotent replay means re-pushing a record central already holds is safe.
8. Record the data-loss window — from the last good backup to the incident — and report it.

## Between backup and incident

Data recorded in that window is lost unless it had already been pushed to central. This is
the strongest operational argument for keeping the sync service healthy: central is not a
backup, but it does narrow the window.

## Rehearsal

⚠ Rehearse this procedure before go-live and annually after. A disaster-recovery plan that
has never been executed is an estimate.
