# Runbooks

Operational procedures for the MOH ICT Unit. Written to be followed by someone who did not
build the system — that is the handover test, and a runbook that assumes project knowledge
fails it.

| Runbook | Purpose |
| --- | --- |
| [local-development.md](local-development.md) | Run and iterate on the stack on your own machine |
| [deploy.md](deploy.md) | Deploy or upgrade a facility or central instance |
| [demo-stack.md](demo-stack.md) | Deploy a training instance with demo data — never on production |
| [backup-restore.md](backup-restore.md) | Backup schedule, encryption, restore procedure |
| [disaster-recovery.md](disaster-recovery.md) | Rebuild a facility after total loss |
| [go-live.md](go-live.md) | Go-live checklist and cutover |
| [sync-operations.md](sync-operations.md) | Enrol facilities, rotate certificates and keys, handle sync alerts |
| [binlog-credentials.md](binlog-credentials.md) | Rotate the database passwords a facility's first boot wrote to its binlog, then purge those binlogs — ⚠ SQL rehearsed on a throwaway database only |
| [mfl-sync.md](mfl-sync.md) | Provision the MFL account, run the first facility-list sync at central, read runs, rotate credentials — ⚠ not yet rehearsed against the live MFL |
| [jira-automation.md](jira-automation.md) | Jira Automation rules that move LE issues from branch, PR and dev deploy |
| [dak-to-iniz.md](dak-to-iniz.md) | Turn a DAK data dictionary row into loaded metadata — ⚠ not yet rehearsed |
| [release-module.md](release-module.md) | Cut and publish a `liberiaemr` module version to Repsy |
| [reporting-etl-existing-database.md](reporting-etl-existing-database.md) | Turn on the reporting ETL on a database created before it — ⚠ not yet rehearsed |

Every runbook must have been **rehearsed** before go-live. An untested restore procedure is
a document, not a capability. Five procedures here have not been executed end to end, and each
says so at the top: `dak-to-iniz.md`, because the DAK itself is not in this repository;
the enrolment, rotation, upgrade and account sections of `sync-operations.md`, which wait for
MOH-issued material; `mfl-sync.md`, which CI exercises only against a stub MFL;
`binlog-credentials.md`, whose SQL was rehearsed on a throwaway database but not with a live
sender; and `reporting-etl-existing-database.md`, which has not yet met a database from before
the ETL.
