# User acceptance testing

Executed by MOH, UNFPA and facility staff — not by the delivery team.

## Scope — first go-live

Maternal health at Careysburg and Barnersville: ANC, Labour & Delivery, PNC, Family
Planning.

## What belongs here

- UAT scripts written in clinical language, not system language ("register a woman for
  antenatal care", not "create a patient and enrol in program X")
- Test data definitions — **synthetic only**
- Sign-off records: who, when, which release version, which scripts passed
- Defects raised during UAT and their resolution

## Rules

- UAT runs on a **dedicated UAT environment** at the exact release version proposed for
  go-live, using the demo content package. Not on production, and not on a build that then
  gets changed before release.
- Sign-off names a release version. "UAT passed" without a version is not sign-off.
- Every defect is triaged before go-live: fixed, or accepted with a documented reason.

## Sign-off is a go-live gate

See the checklist in [../../docs/runbooks/go-live.md](../../docs/runbooks/go-live.md).
