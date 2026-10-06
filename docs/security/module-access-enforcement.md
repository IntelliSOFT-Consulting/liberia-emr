# Module access enforcement

Nine facility roles are limited to eleven modules. The server is the authority.
OpenMRS 3 display conditions only hide entry points. A typed URL still reaches
the page, and the API denies it.

The guard runs only when the authenticated user holds at least one of these
roles, including by inheritance: Registrar, Nurse, Physician Assistant, Lab
Technician, Pharmacist, Midwife, Finance, Systems Administrator, Facility
in-charge. Clinician, Records Officer, and Privilege Level: Full keep ordinary
OpenMRS checks unless they also hold one of those roles. A generic privilege
from another role does not bypass a matrix role.

## Why OpenMRS privileges are not enough

Registration stays on Patient, Person, identifier, and relationship privileges.
Billing stays on the cashier view and manage privileges. Those two modules have
no custom service advice.

The other nine modules do not. OpenMRS authorizes encounters, observations, and
orders by operation (`Get Encounters`, `Add Observations`, `Edit Orders`), not
by module. Several forms share the Consultation encounter type (general
consultation, national ANC, national PNC, national family planning, immunization,
AEFI). A formless encounter is protected only when its type is dedicated
(labor and delivery and its stage types, immunizations, lab results, and the
other dedicated types in `ModuleRecordClassifier`). Drug and test orders are
recognized from order-type ancestry, including a `DrugOrder` or `TestOrder`
that has not yet been given its type. Concept text is not evidence.

Triage, Vitals, and appointments stay outside the model. An order attached to
a Vitals or Triage encounter does not reclassify that encounter. The order is
still Laboratory or Pharmacy and is decided on its own.

## Where a decision is made

`ModuleRecordClassifier` names the module from the form row stored with the
encounter, the encounter type, or the order type. A caller-supplied label that
disagrees with the stored form or type is ambiguous and denied. Moving a
protected record onto another module, onto Vitals, or onto an unrelated type
requires write on both the stored module and the resulting module.

`PersistedOwnership` reads that stored row with Hibernate flush mode manual.
REST updates the in-memory object before save, so a service getter at save time
would see the edit rather than the stored module.

`ModuleAccessGuard` advises EncounterService, ObsService, and OrderService,
ahead of core authorization:

* Reads are filtered. A matrix role that may read a module but was not given
  the generic privilege receives that privilege for the call, and the result is
  limited to modules that role may read.
* Creates require write on the resulting module. Updates require write on the
  stored module and the resulting module.
* Void, unvoid, discontinue, fulfiller status, transfer, and retrospective
  order saves are writes. Purge of a protected or ambiguous record is denied.
* `saveOrderGroup` is denied as a whole unless every order in the group and its
  nested groups is allowed. A group is returned whole only when every order in
  it could be read directly. The stored group is not trimmed.
* A protected encounter save also decides each nested observation and order.
  One denial fails the save.

FHIR2 4.2.0 writes Encounter, Observation, MedicationRequest, and
ServiceRequest through `Session.saveOrUpdate`, so those DAOs are advised
separately. Observation update goes through `ObsService.saveObs`. MedicationDispense
create, update, and delete require Pharmacy write and a linked drug order.
An unlinked dispense is denied. MedicationRequest and MedicationDispense reads
proxy Get Orders or Get Medication Dispense for that call when the role may
already read Pharmacy. They do not proxy Get Encounters.

`ClinicalResponseFilter` applies the same read decision where the service
advice does not run: a visit representation (`VisitResource` returns
`visit.getEncounters()`), observations and orders embedded in an encounter
representation, and FHIR Encounter, Observation, ServiceRequest,
MedicationRequest, Immunization, and MedicationDispense payloads. A nested
record without a uuid cannot be decided and is dropped. Direct obs and order
resources are not filtered again. Appointments are not filtered.

Call-scoped privileges, added only after the module decision allows the call
and removed before it returns:

* Get/Add/Edit Encounters, Observations, and Orders, so a matrix allow is not
  then rejected by the generic check the role was not given.
* Get Order Types, because `OrderService.saveOrder` calls `getOrderTypeByUuid`.
* Edit or Delete Medication Dispense, on the FHIR dispense call.
* Get Care Settings, while an order or medication request is bound, and Get
  Order Frequencies for a Pharmacy write. Get Providers for one orderer lookup,
  and for the cashier lookup during a bill POST.
* Get Visits for `getVisit`, `getVisitByUuid`, and `getActiveVisitsByPatient`
  during a bill POST. Visit listing is not advised. Finance is not given Get
  Visits.
* Manage Cashier Metadata for a cash-point get, and for binding `cashPoint` on
  that same bill POST. The approved billing bundle grants View Cashier
  Metadata, not cash-point create, retire, or purge. Saving a bill still
  requires Manage Cashier Bills.

Get Locations, Get Concepts, and Get Order Frequencies are not standing grants.
Authenticated already holds Get Locations and Get Order Types. Get Beds and
Get Admission Locations are proxied for a protected encounter save because bed
management reads the assignment on update. They are not kept after the save.

The forms launcher hides a protected form the user cannot write. That listing
performs no clinical write.

## What each module uses

| Module | Mechanism |
|---|---|
| Registration | Existing patient, person, identifier, and relationship privileges. No advice. |
| Billing | Existing cashier privileges, plus the bill-POST visit, provider, and cash-point lookups above. Bill JSON is not rewritten. |
| TB, ANC, PNC, Family Planning, Labor and Delivery, Immunization, General Consultation | Encounter and observation advice. Ownership is the form and encounter type. |
| Laboratory | Test-order ancestry, lab-result encounters, and observations linked to a test order. |
| Pharmacy | Drug-order ancestry, FHIR MedicationRequest reads, and MedicationDispense writes linked to a drug order. |

## Frontend

Display conditions are presentation. Matrix roles hold Get People, so a module
privilege shows the entry and its absence hides it. An account without Get
People (Clinician, Records Officer) keeps the previous shell. System Developer
keeps it. The partograph, TB, and immunization Add actions check the write
privilege. The dispensing app 1.11.1 has no config key for its worklist query
or for the Dispense button privilege (`Task: dispensing.create.dispense`, and
`Encounter?_query=encountersWithMedicationRequests`). The distribution patch
reads MedicationRequest and shows Dispense for Manage Pharmacy. Edit and delete
still use their upstream task privileges.

## Limits

* `EncounterService.getAllEncounters(Cohort)` returns a map and is not filtered.
  Known callers are emrapi inpatient ADT and htmlformentry. No protected-module
  exposure was shown from those callers.
* An order create without an order type, and without a DrugOrder or TestOrder
  class, is ambiguous and denied. OpenMRS would fill the type in later.
* Reporting SQL and labonfhir jobs that do not enter these services are outside
  the guard.
* Metadata administration, purge, and cashier refunds are not implied by a
  module write.
* If the session flushes the caller's edit before the guarded save, that edit
  is what the guard treats as stored. Ordinary REST and FHIR updates do not
  flush first.
* A Clinician who does not hold a matrix role is not guarded. Hiding a button
  does not deny that API.
* Nested encounter, visit, and FHIR filtering is proven on the JSON walker and
  the policy tests, not by an HTTP call against a running backend.

## Upgrade

Initializer 2.12.0 replaces a role's privileges and inherited roles from the
CSV. It does not merge them. Privileges added by hand to Nurse, Clinician,
Midwife, Pharmacist, or Lab Technician are removed on the next load. User role
assignments are not changed. Load the content against a copy of a facility
database before applying it to that facility.
