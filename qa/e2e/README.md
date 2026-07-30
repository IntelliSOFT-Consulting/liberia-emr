# End-to-end tests (Cypress)

Browser tests against a fully launched distribution.

## Priority journeys — first go-live

1. Log in, choose a facility location, log out.
2. Register a patient with an MOH Health Record Number.
3. Enrol the patient in Antenatal Care; confirm the programme and workflow state.
4. Record an ANC initial visit; confirm the encounter and observations persist.
5. Record serial partograph observations; confirm the chart plots them.
6. Record a delivery outcome and transition the ANC workflow to Delivered.
7. Record a postnatal visit.
8. Record a family planning method and a discontinuation.

## Offline

Facility instances are offline-first, so the offline path is a **primary** journey, not an
edge case: record clinical data with the network disconnected, reconnect, and confirm
nothing was lost. Test this by actually disconnecting the stack — a mocked offline mode
tests the mock.

## Rules

- No test writes to a production instance, ever.
- Tests run against the demo stack, whose data is synthetic by construction.
- A test that is flaky is deleted or fixed the week it is noticed. A suite people ignore is
  worse than no suite, because it also carries authority.
