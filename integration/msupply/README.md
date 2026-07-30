# mSupply integration

**Status: DEFERRED to the support period. Specification only — do not build.**

mSupply is the MOH's supply-chain system. Integration would connect LiberiaEMR stock and
dispensing (HIS-Lite) to national stock management.

## Why deferred

It is out of scope for the first go-live, which is maternal health. Building it early would
spend the highest-risk engineering time in the project on something no clinician needs at
go-live — while the sync layer, which everything depends on, is still the open risk.

## What this directory should contain before the support period

An **integration-readiness specification**, not code:

- Which direction data flows and what is authoritative on each side
- The stock item master: does mSupply own it, do we, or is it mapped?
- Transaction model — dispense events, receipts, adjustments, stocktakes
- Sync cadence and behaviour when the facility is offline
- Authentication and transport
- What happens on conflict: a facility dispensing record versus an mSupply adjustment

Producing that spec is the deliverable. Writing routes against an unagreed contract is not.
