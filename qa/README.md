# QA — per SQM Framework v1.0

| Directory | Type | Who |
| --- | --- | --- |
| [`api/`](api/) | Automated API tests | QA Engineer directs; developers contribute |
| [`e2e/`](e2e/) | Automated Cypress tests | QA Engineer directs |
| [`manual/`](manual/) | Manual and exploratory testing | Tester executes against QA Engineer's plan |
| [`uat/`](uat/) | UAT scripts and sign-off | MOH / UNFPA / facility staff execute |
| [`upgrade/`](upgrade/) | Clean-install and upgrade harness | **Runs on every release** |

Test **strategy and review** sit with the QA Engineer. Support and junior roles execute
against that strategy and do not own it (IMPLEMENTATION.md §11).

## The two tests every release must pass

1. **Clean install** — empty database → Initializer loads all metadata → O3 launches.
2. **Upgrade from the previous production database** — migrations run → Initializer updates
   metadata → **existing patient data stays valid**.

A clean install passing tells you almost nothing about an upgrade. Only the upgrade test
surfaces UUID collisions, changed concept datatypes, retired metadata still referenced by
patient data, and altered workflow semantics — the exact failures that hurt most, because
they land on a database that already has patients in it.

See [`upgrade/`](upgrade/).
