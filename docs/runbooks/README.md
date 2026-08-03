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
| [dak-to-iniz.md](dak-to-iniz.md) | Turn a DAK data dictionary row into loaded metadata — ⚠ not yet rehearsed |

Every runbook must have been **rehearsed** before go-live. An untested restore procedure is
a document, not a capability. `dak-to-iniz.md` is the one procedure here that has not been
executed end to end, and it says so at the top: the DAK itself is not in this repository.
