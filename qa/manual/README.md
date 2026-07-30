# Manual and exploratory testing

Executed by the Tester against a plan owned by the QA Engineer.

## What belongs here

- Test charters for exploratory sessions
- Session notes and findings
- Scripted manual cases for anything not economically automatable

## Where manual testing earns its place

Clinical usability under real conditions is not something an assertion catches: a midwife
working one-handed during labour, on a small screen, in poor light, on a slow machine. The
e-partograph in particular needs a clinician's eye on it, not just a passing Cypress run.

## Reporting

Every finding gets: what was done, what was expected, what happened, environment, release
version, and severity. A finding without the release version cannot be triaged.

Never perform exploratory testing on production.
