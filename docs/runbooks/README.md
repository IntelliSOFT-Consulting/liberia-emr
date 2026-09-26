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
| [jira-automation.md](jira-automation.md) | Jira Automation rules that move LE issues from branch, PR and dev deploy — ⚠ not yet rehearsed |
| [dak-to-iniz.md](dak-to-iniz.md) | Turn a DAK data dictionary row into loaded metadata — ⚠ not yet rehearsed |

Every runbook must have been **rehearsed** before go-live. An untested restore procedure is
a document, not a capability. Three procedures here have not been executed end to end, and each
says so at the top: `dak-to-iniz.md`, because the DAK itself is not in this repository, and
the enrolment, rotation, upgrade and account sections of `sync-operations.md`, which wait for
MOH-issued material. The Jira flows in `jira-automation.md` exist but wait for their
rehearsal.
