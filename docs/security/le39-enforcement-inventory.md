# LE-39 enforcement inventory

This is the authoritative description of LE-39 enforcement. The sections up to
"Exclusions and upgrade verification" are the inventory taken on
`LE-39-module-rbac` on 2026-10-05, before enforcement was added; they record
inspected surfaces and do not claim those surfaces are secured. "Enforcement
now in place", "Remaining limits", and "Audit findings" describe the current
implementation. `le39-phase1-review.md` is a historical record only.

## Source evidence

The distribution pins OpenMRS 2.8.8, REST 3.5.0, FHIR2 4.2.0, billing 2.3.0,
labonfhir 1.5.3, and Initializer 2.12.0 in `distribution/distro.properties`.
Frontend versions are in `distribution/frontend/spa-assemble-config.json`.
Pinned upstream source packages were inspected in `/tmp/le39-verified`, together
with the cached billing 2.3.0 API jar. Temporary source copies are not deliverables.

## Module surfaces

REST paths below are relative to `/ws/rest/v1`; FHIR paths are relative to
`/ws/fhir2/R4`. Clinical form submission uses the upstream form engine, not a
Liberia-specific clinical write controller.

| Module | Actual reads | Actual writes | Persisted ownership and existing checks |
|---|---|---|---|
| Registration | REST `patient`, `person`, patient identifiers, `relationship`; patient searches and demographic subresources | Patient create/update with embedded person; person name update; identifier create/update/delete; relationship create/update/delete; `idgen/identifiersource/{source}/identifier` allocation | Patient/Person/PatientIdentifier/Relationship identity is sufficient. Core Get/Add/Edit privileges apply; purge remains separate. Identifier allocation is not itself a patient record. |
| TB Screening | REST encounter/obs through patient forms and clinical widgets | Form engine encounter create/update, embedded obs/groups; generic obs edits and encounter/obs void | Phase 1 form/type binding; Get/Add/Edit Encounters and Observations are prerequisites, not module authorization. |
| General Consultation | REST encounter/obs and form history | Consultation form encounter/obs writes; linked drug/test orders are separate Pharmacy/Laboratory resources | Exact consultation form/type pair; shared Consultation type alone is ambiguous. Vitals and Triage are excluded. |
| Billing | `billing/bill`, bill detail/payments, `billing/billableService`, `billing/paymentMode`, `billing/patientPaymentStatus/{patient}`; visit context | Bill create/update, bill payment POST, bill and line-item DELETE; payment workflow also updates a visit attribute | Bill/payment ownership is intrinsic; bill line items must retain bill ownership. Existing Cashier view/manage checks are separate from Delete/Purge/Adjust/Refund privileges. The approved bundle does not grant those elevated privileges. Generic visit-attribute mutation needs specific scrutiny. |
| ANC | REST encounter/obs; custom current-pregnancy history fetch | Initial/follow-up/national form encounter and obs; associated orders | Phase 1 ANC bindings. An order-linked result may belong to Laboratory even within ANC. |
| Laboratory | REST `order?orderTypes=...`, encounter/obs results | `order/{id}/fulfillerdetails`, order update/revision, encounter result update and obs result edit | Persisted Test Order type ancestry; lab result encounter binding. Get/Add/Edit Orders plus encounter/obs checks. Fulfiller updates must inspect the existing order. |
| PNC | REST encounter/obs form history and widgets | PNC/newborn/national forms create/update encounters and obs | Phase 1 PNC bindings; generic clinical privileges alone are insufficient. |
| Pharmacy | REST orders; FHIR MedicationRequest and MedicationDispense; diagnosis encounter context | Drug order create/revise/discontinue; FHIR MedicationDispense POST/PUT/DELETE | Persisted Drug Order ancestry and dispense-to-drug-order relationship. Get/Add/Edit Orders and Get/Edit/Delete Medication Dispense are existing checks. Unlinked dispenses are ambiguous under Phase 1. |
| Labor & Delivery | Custom e-partograph `encounter` query with embedded obs; patient forms and widgets | Upstream form workspace writes encounters/obs for the four configured L&D forms | Phase 1 form/type/dedicated-type bindings. Nurse/Midwife W; PA R. Nested obs and destructive cascades require checks, not merely the route launcher. |
| Immunization | Patient forms and immunization frontend; FHIR Immunization is exposed by the installed FHIR module | Form engine encounter/obs writes; FHIR Immunization create/update ultimately saves encounters/obs | Phase 1 form/type and dedicated immunization encounter binding. FHIR uses grouped Obs and the Observation DAO; concept meaning alone is not Phase 1 ownership evidence. |
| Family Planning | REST encounter/obs form history and widgets | MCH/national forms create/update encounter and obs | Phase 1 Family Planning bindings and existing encounter/obs privileges. |

## Cross-cutting boundaries

* REST updates populate an existing Hibernate object before saving; calling a
  service getter at save time can return the already modified object. One SQL
  snapshot on the current session, with flush mode manual, is the persisted-before
  evidence. Both previous and resulting ownership need authorization.
* Core Encounter/Obs/Order service interception can cover ordinary REST writes,
  but cannot alone secure all FHIR writes: FHIR2 `BaseFhirDao.createOrUpdate` and
  `delete` call Hibernate `saveOrUpdate` directly. FHIR DAO advice is an available
  extension point (`FhirAopConfiguration`, `FhirDaoAop`). Existing FHIR DAO
  `@Authorized` checks must remain active.
* Read filtering must cover direct lookups, searches, and nested representations.
  A visit can serialize encounters, and an encounter can serialize obs and orders
  without a new service lookup for each child. Filtering only a top-level service
  list does not prove confidentiality. REST resources are instantiated with
  `resourceClass.newInstance()` by `RestServiceImpl`, so ordinary Spring advice
  does not automatically intercept their conversion methods.
* Order revision/discontinuation creates a successor referencing an existing
  order. Authorization must include that existing order, not just the new row.
  Encounter void/delete can cascade into children with different module owners.
* Custom `liberiaemr/forms` returns available form metadata and encounter-type
  edit privileges after visibility rules. It performs no clinical writes. It is
  a suitable launcher-gating location, but is not an enforcement substitute.
* Custom identity patient lookup, reporting APIs, and serialized visit context
  need review for protected embedded data. Sync, MFL, audit and password-reset
  controllers are separate workflows; this inventory does not authorize changing
  their policy.
* FHIR is not optional speculative infrastructure: dispensing uses it directly;
  Vitals uses FHIR Observation reads. Blanket closure of FHIR would violate the
  exclusions. Login also uses FHIR Location, which is unrelated metadata.
* `labonfhir` supplies order/task event integration and scheduler persistence.
  Those background paths are distinct from the laboratory frontend's actual
  order/fulfiller REST calls; do not invent new user-facing task APIs.

## Exclusions and upgrade verification

Triage Form, Vitals and Appointments retain current authorization. In particular,
an order-linked Vitals observation must remain excluded; classification ambiguity
must not become a global denial of unrelated OpenMRS records.

A running local LiberiaEMR backend/database/gateway/frontend stack was found.
No deployment, restart, role migration or database mutation was performed during
inventory. Live upgrade testing must not silently deploy the unreviewed change:
the request explicitly prohibits deployment. An isolated upgrade test can verify
replacement of existing role grants/inheritance without changing that stack.

## Enforcement now in place

Reduced on 2026-10-05. Package `org.openmrs.module.liberiaemr.moduleaccess`.
Backend authorization is authoritative. The 99-cell privilege model is unchanged.
The guard applies only when the authenticated user holds at least one of the
nine matrix roles, including by inheritance. Clinician, Records Officer, and
Privilege Level: Full keep ordinary OpenMRS checks unless they also hold a
matrix role. A matrix role is not bypassed by generic privileges from another
role.

Trusted creation. A protected encounter is recognized from server-owned form
metadata: the form row's encounter type must match the submitted type, and the
form UUID must be one of the allowlisted forms. A formless encounter is
protected only when its encounter type is one of the dedicated types (labor and
delivery, immunizations, lab results, and the other dedicated types). A
caller-supplied form UUID, encounter type, or concept is not a grant.
Mismatched or conflicting provenance is ambiguous and denied. Vitals and Triage
stay excluded even when a drug or test order is attached to that encounter; the
order itself remains Laboratory or Pharmacy and is authorized on its own.

Service boundary (`ModuleAccessGuard` on EncounterService, ObsService, and
OrderService, installed ahead of core authorization):

* Encounter, observation, and order reads are filtered for matrix roles. A
  generic Get privilege does not return a protected module the role cannot read.
  A matrix role that may read a module but was not given the generic privilege
  receives that privilege only for the allowed call, and the result is limited
  to modules that role may read. Excluded and unrelated rows are omitted from
  that proxied result. A role that already holds the generic privilege still
  sees excluded and unrelated rows.
* Creates require write on the resulting module. Updates read the last flushed
  row on the current session without flushing the caller's edits, and require
  write on both the existing module and the resulting module. Moving a protected
  record onto Vitals, an unrelated type, or another module is denied.
* Void, unvoid, discontinue, and fulfiller status changes are writes. Purge of
  a protected or ambiguous record is denied.
* `EncounterService.transferEncounter` and `OrderService.saveRetrospectiveOrder`
  are writes. Both reach their void and save work through `this`, so the
  inner calls never pass through the advice; the guard decides on the outer
  call. A transfer requires write on the encounter's persisted and current
  module and on each nested observation and order it voids.
* `ObsService.getComplexObs` and `getRevisionObs`, and
  `OrderService.getDiscontinuationOrder` and `getRevisionOrder`, are reads and
  use the same result decision as `getObs` and `getOrder`. The legacy UI
  `complexObsServlet` calls `getComplexObs` directly by id.
* `OrderService.saveOrderGroup` is a write. It saves the group row, then each
  new order and nested group through the service proxy, where the guard is
  already inside. Every order in the group and its nested groups is decided
  before the call proceeds: a new order needs write on its module, an existing
  one needs write on its persisted and current module. One denied order denies
  the whole call, so nothing is written. Add Orders is proxied after that,
  because order numbering requires it.
* `getOrderGroup`, `getOrderGroupByUuid`, `getOrderGroupsByPatient`, and
  `getOrderGroupsByEncounter` are reads. A group is returned whole, so it is
  returned only when every order in it, and in its nested groups, could be read
  directly. A single lookup is denied; a list omits the group. The persistent
  group is never trimmed.
* Registration is not advised. Registrar, Systems Administrator, and Facility
  in-charge write through the existing patient, person, identifier, and
  relationship privileges. The other matrix roles hold the read side of that
  bundle. Records Officer is unchanged.
* Billing is not advised as a module service. Finance, Systems Administrator,
  and Facility in-charge use View Cashier Bills and Manage Cashier Bills.
  Refunds and purge stay on their existing cashier privileges. A bill POST
  (`BillingVisitFilter`) may look up `getVisit`, `getVisitByUuid`, or
  `getActiveVisitsByPatient` after billing write is already held. Get Visits
  is added for that method only and removed before it returns. Visit listing
  is not advised. Finance is not given Get Visits. The bill response still
  carries the visit as a reference.
* FHIR MedicationDispense create, update, and delete are advised on
  `FhirMedicationDispenseDao` after the translator has set the linked drug
  order. Pharmacy write plus that link is required. Edit or Delete Medication
  Dispense is proxied for that call only. There is no Hibernate interceptor.
  MedicationRequest and MedicationDispense reads (`get`, `getSearchResults`,
  `getSearchResultsCount`) proxy Get Orders or Get Medication Dispense for
  that call when the role may already read Pharmacy. They do not proxy Get
  Encounters. Create and delete stay on the write advice.

Response filter (`ClinicalResponseFilter`), only these paths, and only for a
matrix role:

* `/ws/rest/v1/encounter` and its subresources (not `encountertype` or
  `encounterrole`) — the guard decides on the encounter, but its
  representation embeds `obs` and `orders`, which are decided here one by one.

* `/ws/rest/v1/visit` — `VisitResource` returns `visit.getEncounters()` without
  entering EncounterService. A full representation embeds the encounter,
  including its observations.
* `/ws/fhir2/` — FHIR2 DAOs query Hibernate and do not enter the service advice.
  The filter classifies Encounter, Observation, ServiceRequest,
  MedicationRequest, Immunization, and MedicationDispense nodes.

Nested `obs`, `groupMembers`, `orders`, and an observation's `order` are each
decided on their own module, as a direct read would be. A custom
representation can leave out `uuid`; a nested record without one cannot be
decided and is dropped. This applies to visit responses as well: it closes the
same omission there. LiberiaEMR's own encounter and visit requests all ask for
`uuid`. Direct `/ws/rest/v1/obs` and `order` are not filtered again; the
service guard decides on the record it returns. Appointments are not filtered. A protected
node that cannot be classified is dropped. Malformed JSON that is not one of
those clinical payloads is left unchanged. Triage and Vitals nodes are kept
for a matrix role that already holds the generic read privilege.

Proxied generic privileges, each only after a matrix allow and only for that
call: Get/Add/Edit Encounters, Get/Add/Edit Observations, Get/Add/Edit Orders,
Get Order Types (because `OrderService.saveOrder` calls `getOrderTypeByUuid`),
and Edit/Delete Medication Dispense. Get Locations is neither proxied nor
granted by LE-39. Updating an encounter does reload its saved location through
`LocationService.getLocation`, but OpenMRS core grants Get Locations (and Get
Order Types) to the Authenticated role, so every signed-in user already holds
it. Only Records Officer lists it, as it did before. Get Concepts and Get Order
Frequencies are not proxied. Physician Assistant, Systems Administrator, and
Facility in-charge are granted Get Visits, Add Visits, Get Visit Attribute
Types, Get Forms, and Get Concepts so the form launcher can open a visit and
load a form. VisitValidator reads attribute types on every save. Those grants
do not decide a module. Encounter, observation, and order privileges are
still proxied only after a module allow. Get Forms and Get Concepts do not
authorize a clinical record.

UX only. O3 display conditions hide shell entry points. A matrix role needs the
module privilege. An account without Get People keeps the previous shell
(Clinician, Records Officer). System Developer keeps the shell. The forms
launcher hides a protected form the user cannot write. The TB and immunization
widgets stay visible for read or write and hide Add without the write privilege.
The partograph chart stays available to readers; its Add, empty-state, and alert
actions check `Write Labor and Delivery`. The dispensing worklist reads
MedicationRequest and shows Dispense for `Manage Pharmacy`. Edit and delete
dispensing actions still check their upstream task privileges. Register and
edit-patient actions require Add Patients and Edit Patients. These checks are
not the security boundary. Typing a route still reaches the page; the API denies it.

## Close-out UI (2026-10-06)

Appointments stays outside the 11-module matrix. None of the nine roles is
granted an appointment privilege. The installed appointments app 11.1.0
contributes `clinical-appointments-dashboard-link` to `homepage-dashboard-slot`
with no privilege of its own. The framework applies a module `Display conditions`
block to that extension. `View Appointments` is the privilege
`AppointmentsService.getAllAppointments` requires, so the link is hidden unless
the user holds it. The same check treats the System Developer role as allowed.
No appointment privilege was added to a matrix role, and the compiled
appointments bundle was not patched. Typing the route still reaches the page;
the API remains the authority.

Record vitals stays visible. In patient-vitals 12.3.4 the button is inside
`vitals-header`, shown unless the parent passes `hideLinks`. That prop is not a
privilege display condition, and the config schema has no key that hides only
the action. The save path is `POST /ws/rest/v1/encounter` with embedded obs, which
requires Add Encounters and Add Observations. Physician Assistant has neither,
and those privileges are not proxied for a Vitals encounter. Hiding the whole
vitals widget would also hide the history a reader can see. No compiled patch
was added for this one control.

## Remaining limits

* No live REST container was started. Nested encounter, visit, and FHIR
  filtering is proven on the JSON walker and the policy tests, not by an HTTP
  call against a running backend. The omod test classpath cannot yet load a
  context-sensitive filter test (missing api dependencies, then a Mockito mock
  maker conflict).
* A matrix-role order create, through `saveOrder`, an encounter, or an order
  group, is classified from the order type it carries. An order sent without
  an order type is ambiguous and denied, although OpenMRS would fill the type
  in later. Confirm the O3 order basket sends one before rollout.
* Appointment, Triage, and Vitals permissions were not invented. Their current
  behavior is preserved for users who already hold the generic privilege. A
  matrix role that only received a proxied read does not see Vitals. Vitals plus
  a test or drug order does not reclassify the Vitals encounter; the attached
  order is still denied unless the user can write Laboratory or Pharmacy.
* The partograph and TB Add buttons are privilege checks. A Clinician who does
  not hold `Write Labor and Delivery` or `Write TB Screening` does not see those
  buttons. The service guard does not apply to Clinician, so the API still
  accepts the write.
* Reporting SQL and labonfhir jobs that do not enter these services are outside
  this guard.
* Metadata administration, purge, and refunds are not implied by a module write.
* Persisted-before ownership is read from the current database row. If the
  session flushes the caller's edit before the guarded save, the edit is what
  the guard sees as persisted. Ordinary REST and FHIR updates do not flush
  first; a test that creates a user between editing and saving does.
* Initializer 2.12.0 replaces a role's privileges and inherited roles from the
  CSV; it does not merge them. Privileges an administrator added by hand to
  Nurse, Clinician, Midwife, Pharmacist, or Lab Technician are removed on the
  next load. User role assignments are untouched. Not yet run against a copy
  of an existing facility database.

## Audit findings

Found during the 2026-10-05 service-surface audit.

1. Closed. `OrderService.saveOrderGroup` (REST `POST /ordergroup`) let a user
   holding Clinician and Lab Technician persist a drug order that a direct save
   denied, because nested saves skip the guard. See the service boundary above.
2. Closed. The order-group getters (REST `GET /ordergroup/{uuid}`) returned a
   test order to Pharmacist inside its group after a direct read was denied.
3. Closed. Direct REST `/encounter` embedded `obs` and `orders` that the guard
   did not decide one by one. Shown from the REST 3.5.0 encounter
   representation and covered by `ClinicalJson` tests; not run over HTTP
   against a running backend.
4. Open, judgment only. `EncounterService.getAllEncounters(Cohort)` returns a
   map, which the guard does not filter. Callers found are emrapi inpatient ADT
   and htmlformentry velocity functions; no protected-module exposure was
   demonstrated, so it is not intercepted.
