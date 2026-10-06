# LE-39 Phase 1 review — 2026-10-05

> **Historical record. Not a description of current behavior.**
> This review describes the first, pre-reduction Phase 1 design. Its `Le39*`
> types, file list, test counts, and its statements that no REST, FHIR, or
> frontend enforcement exists are all superseded. The current enforcement, its
> limits, and the open findings are in `le39-enforcement-inventory.md`, which is
> authoritative. Only the 99-cell matrix and the role-inheritance rationale
> (sections B–E) still apply.

## A. Baseline and scope

Source of truth: the user's authoritative Phase 1 prompt of 2026-10-02, including the
clarified Labor & Delivery row. Branch: `LE-39-module-rbac`. Starting commit: `353999`
(short hash); the working tree was clean before this task.

This change supplies content role/privilege definitions and a fixed backend entitlement and
resource-classification foundation. No REST/FHIR interception, frontend gates, billing or
stock/dispensing enforcement adapters are registered. No existing users are migrated,
reassigned or aliased. These unit tests do **not** prove API-level enforcement.

## B–C. Roles and inheritance

Created exact roles: **Registrar**, **Physician Assistant**, **Finance**, **Systems Administrator**,
**Facility in-charge**. Their UUIDs are new variables in common content; they do not reuse the
identities of Records Officer, Clinician or Organizational: System Administrator.

Changed existing roles: **Nurse**, **Lab Technician**, **Pharmacist**, **Midwife** receive their
specified entitlements. **Clinician** changes only the representation of its existing grants.
Existing role UUIDs are unchanged. Other role rows are byte-for-byte unchanged.

Two inheritance edges are removed:

- **Midwife → Nurse**: unavoidable because inheriting the new Nurse grants would give Midwife
  TB Screening W and General Consultation W, contradicting its R and N cells. Midwife retains
  every pre-change inherited Nurse privilege as a direct grant, plus its own program privileges.
- **Clinician → Nurse**: preserves Clinician's pre-change effective privilege set exactly.
  Otherwise this non-matrix role would silently gain Nurse's new LE-39 privileges. Copying
  the existing ten Nurse privileges directly avoids an unrelated access expansion without
  adding a helper role or subtraction semantics.

All nine matrix roles now have empty inherited-role lists. Existing unrelated inheritance
is unchanged. Multiple assigned roles still compose additively: N means no grant from that
role, not a veto of grants held through another role. There is no role-name alias or custom
privilege-denial mechanism.

Initializer 2.12.0's installed `RoleLineProcessor.fill` was inspected: it calls
`setInheritedRoles` and `setPrivileges` with the parsed sets, including an empty inherited
set. Thus the CSV change expresses replacement on upgrade, not an additive-only hint. A
live database upgrade was **not** run; review site-specific additions and verify the upgrade
before rollout. No user-role rows are changed by this work.

Definitions remain with the existing common role owner, with the new privileges in the same
layer. This avoids a forward reference or duplicate declarations across content layers.

## D. Exact privilege vocabulary

Exactly 12 new privilege records:

- Read TB Screening
- Write TB Screening
- Manage General Consultation
- Manage ANC
- Manage Laboratory
- Manage PNC
- Manage Pharmacy
- Read Labor and Delivery
- Write Labor and Delivery
- Read Immunization
- Write Immunization
- Manage Family Planning

The three Read/Write pairs explicitly implement Write ⇒ Read in `Le39Module`; a Write role
is not redundantly granted the corresponding Read privilege. Each single Manage privilege
supports module read and write. None conveys purge, metadata administration, role
administration, refund approval or other elevated-operation authority. Existing
operation-specific checks remain mandatory.

Reused Registration bundles:

- **REG-R**: Get Patients; Get People; Get Patient Identifiers; Get Relationships.
- **REG-W**: all REG-R privileges plus Add Patients; Edit Patients; Add People; Edit People;
  Add Patient Identifiers; Edit Patient Identifiers; Add Relationships; Edit Relationships.

Reused **BILL-W**: View Cashier Bills; Manage Cashier Bills; View Cashier Metadata.
The model requires the full specified bundle. It does not change how individual billing
operations check their prerequisites.

## E. Complete role → privilege mapping

The following lists are the complete direct and effective configured grants for the nine
roles. Existing unrelated legitimate grants are retained; these are not expanded to make
new clinical roles operational before Phase 2. No new role receives generic
encounter/observation privileges.

**Registrar**

Get Patients; Get People; Get Patient Identifiers; Get Relationships; Add Patients; Edit Patients; Add People; Edit People; Add Patient Identifiers; Edit Patient Identifiers; Add Relationships; Edit Relationships.

**Nurse**

Get Patients; Get Visits; Add Visits; Get Encounters; Add Encounters; Edit Encounters; Get Observations; Add Observations; Get Concepts; Get Forms; Get People; Get Patient Identifiers; Get Relationships; Write TB Screening; Manage General Consultation; Manage ANC; Manage PNC; Manage Pharmacy; Write Labor and Delivery; Write Immunization; Manage Family Planning.

**Physician Assistant**

Get Patients; Get People; Get Patient Identifiers; Get Relationships; Read TB Screening; Manage General Consultation; Manage ANC; Manage Laboratory; Manage Pharmacy; Read Labor and Delivery; Read Immunization.

**Lab Technician**

Get Orders; Edit Orders; Get Encounters; Add Encounters; Get Observations; Add Observations; Get Concepts; Get Patients; Get People; Get Patient Identifiers; Get Relationships; Read TB Screening; Manage Laboratory.

**Pharmacist**

Get Orders; Get Medication Dispense; Edit Medication Dispense; Get Concepts; Get Patients; Get People; Get Patient Identifiers; Get Relationships; Read TB Screening; Manage Pharmacy.

**Midwife**

Get Patient Programs; Add Patient Programs; Edit Patient Programs; Get Patients; Get Visits; Add Visits; Get Encounters; Add Encounters; Edit Encounters; Get Observations; Add Observations; Get Concepts; Get Forms; Get People; Get Patient Identifiers; Get Relationships; Read TB Screening; Manage ANC; Manage Laboratory; Manage PNC; Manage Pharmacy; Write Labor and Delivery; Write Immunization; Manage Family Planning.

**Finance**

Get Patients; Get People; Get Patient Identifiers; Get Relationships; Read TB Screening; View Cashier Bills; Manage Cashier Bills; View Cashier Metadata.

**Systems Administrator**

Get Patients; Get People; Get Patient Identifiers; Get Relationships; Add Patients; Edit Patients; Add People; Edit People; Add Patient Identifiers; Edit Patient Identifiers; Add Relationships; Edit Relationships; View Cashier Bills; Manage Cashier Bills; View Cashier Metadata; Write TB Screening; Manage General Consultation; Manage ANC; Manage Laboratory; Manage PNC; Manage Pharmacy; Write Labor and Delivery; Write Immunization; Manage Family Planning.

**Facility in-charge**

Get Patients; Get People; Get Patient Identifiers; Get Relationships; Add Patients; Edit Patients; Add People; Edit People; Add Patient Identifiers; Edit Patient Identifiers; Add Relationships; Edit Relationships; View Cashier Bills; Manage Cashier Bills; View Cashier Metadata; Write TB Screening; Manage General Consultation; Manage ANC; Manage Laboratory; Manage PNC; Manage Pharmacy; Write Labor and Delivery; Write Immunization; Manage Family Planning.

The independent 99-cell test oracle is:

| Module | Registrar | Nurse | Physician Assistant | Lab Technician | Pharmacist | Midwife | Finance | Systems Administrator | Facility in-charge |
|---|---|---|---|---|---|---|---|---|---|
| Registration | W | R | R | R | R | R | R | W | W |
| TB Screening | N | W | R | R | R | R | R | W | W |
| General Consultation | N | W | W | N | N | N | N | W | W |
| Billing | N | N | N | N | N | N | W | W | W |
| ANC | N | W | W | N | N | W | N | W | W |
| Laboratory | N | N | W | W | N | W | N | W | W |
| PNC | N | W | N | N | N | W | N | W | W |
| Pharmacy | N | W | W | N | W | W | N | W | W |
| Labor & Delivery | N | W | R | N | N | W | N | W | W |
| Immunization | N | W | R | N | N | W | N | W | W |
| Family Planning | N | W | N | N | N | W | N | W | W |

## F. Fixed classifier rules for all 11 modules

`Le39Classifier` accepts database IDs and loads evidence through its trusted `Records` port.
A future persistence adapter must supply the original persisted state, not a submitted DTO
or an ORM entity already modified from request input. The module boundary and resource kind
must be selected by server code, never from a client-supplied module label. Form and type
names below describe fixed UUID bindings; runtime classification never compares display names.

| Module | Accepted persisted evidence |
|---|---|
| Registration | Existing Patient, Person, PatientIdentifier or Relationship of the requested demographic resource kind and matching database ID. Clinical encounters are not Registration merely because they belong to a patient. |
| TB Screening | `form.tb-screening` paired with `encountertype.tb-screening`; or that dedicated encounter type without a form. |
| General Consultation | `form.opd-consultation` paired with `encountertype.consultation`. The shared Consultation type alone is insufficient. |
| Billing | Trusted existence lookup of a bill, or payment with its persisted bill relationship. Arbitrary identifiers and absent records do not qualify. |
| ANC | `form.anc-initial` + `encountertype.anc-initial`; `form.anc-followup` + `encountertype.anc-followup`; `form.anc-national` + `encountertype.consultation`. Formless dedicated types: `anc`, `anc-initial`, `anc-followup`. |
| Laboratory | Persisted order with the core Test Order type, or a subtype whose persisted parent chain reaches it; a conflicting DrugOrder class, contradictory type ancestry or cyclic ancestry is ambiguous. Also formless `encountertypes.lab-results`. |
| PNC | `form.pnc-visit` or `form.newborn-pnc` + `encountertype.mch-pnc`; `form.pnc-national` + `encountertype.consultation`. Formless dedicated types: `pnc`, `mch-pnc`. |
| Pharmacy | Persisted order with the core Drug Order type, or a subtype whose persisted parent chain reaches it; conflicting TestOrder class or contradictory/cyclic ancestry is ambiguous. Dispensing requires a persisted relationship to a classified Pharmacy order. An unlinked dispense is ambiguous. |
| Labor & Delivery | `form.first-and-second-stage-of-labor-and-delivery`, `form.partograph`, `form.third-stage-of-labor-and-delivery`, or `form.fourth-stage-monitoring-for-woman-and-baby`, each paired with `encountertype.labor-delivery`. Formless dedicated types: `labor-delivery`, `labour-admission`, `delivery`, `partograph`. |
| Immunization | `form.immunization` or `form.aefi` + `encountertype.consultation`; or formless dedicated `encountertypes.immunizations`. |
| Family Planning | `form.family-planning` + `encountertype.mch-family-planning`; `form.family-planning-national` + `encountertype.consultation`. Formless dedicated types: `family-planning`, `mch-family-planning`. |

All bindings use `var.*.uuid` from the existing content variable files, filtered into
`liberiaemr-uuids.properties`. The core order type UUIDs use OpenMRS's existing constants.
No delivery-summary form rule is invented for the unimplemented form.

Observation rules:

1. Load the observation by ID and resolve its persisted group-parent chain before applying
   order ownership. Missing parents, cycles, more than 100 observations in the chain, and
   ambiguous parent classifications fail closed even when an order is attached.
2. Reload any persisted encounter and classify its form/type pair or dedicated type. A
   present but missing/conflicting encounter fails closed. Detached relationship metadata
   is ignored. Resolved Triage/Vitals provenance, directly or through a group, remains
   excluded despite attached orders; cycles or unresolved provenance still fail closed.
3. For protected records, retain encounter context across the chain: conflicting encounter
   modules are ambiguous even if orders agree. Reload each order by its persisted ID;
   a broken/unclassified order fails closed. A valid Laboratory/Pharmacy order may identify
   work within recognized clinical context such as ANC, but cannot override conflicting
   Laboratory/Pharmacy encounter ownership. No new form/type identities are accepted.
4. When a child has its own encounter or order evidence, its resulting owner must agree
   with its resolved group parent. Laboratory-versus-Pharmacy order conflicts fail closed
   in both directions. A child without either relationship can inherit its parent's result.
5. Concepts, values, text, clinical meaning and payload module labels provide no evidence.

An unknown form is conservative ambiguity even with a dedicated encounter type; a known
form with a conflicting type is also ambiguous. No form, encounter type or clinical record
is modified by classification. This initial allowlist deliberately does not guess identities
of old form versions from their clinical content.

## G–H. Historical records and excluded pathways

The result distinguishes a confirmed module, ambiguity, and excluded scope. An ambiguous
record cannot pass `atProtectedBoundary`, even when the principal has every entitlement.
A record classified into a different module also fails that boundary. Read-only grants
never authorize a write. ALLOW is only the LE-39 component's decision and is not a bypass
of core or operation-specific authorization.

Triage/Vitals encounter types (with no contradictory known protected form), Triage Form
on its Triage encounter, their observations (including attached Drug/Test Orders), and
appointment operations are excluded from the confirmed module model. Broken or cyclic
group provenance remains ambiguous and is denied rather than bypassed by an exclusion. Excluded does **not** mean authorized. If an
excluded resource is presented to a protected module boundary, that boundary rejects it;
its own excluded pathway continues using current authorization. There is no global
observation hook and no change to existing Triage/Vitals or Appointments behavior.

No historical metadata rewrite or manual classification workflow is introduced. Unmapped
historical form identities, missing links and contradictory provenance remain a residual
migration/data-quality issue. Phase 2 must apply fail-closed handling at protected boundaries
without installing a blanket denial for unrelated observations.

## I. Files changed and purpose

| File | Purpose |
|---|---|
| `content-packages/content-common/configuration/backend_configuration/roles/roles-common.csv` | Exact roles, approved grants, and the two inheritance replacements. |
| `content-packages/content-common/configuration/backend_configuration/privileges/privileges-le39-common.csv` | Only the 12 new module privileges. |
| `content-packages/content-common/configuration/variables.properties` | Five new role UUIDs and 12 privilege UUIDs. |
| `content-packages/content-liberia-national/configuration/variables.properties` | Two references to the existing Initializer-derived national PNC and Family Planning form identities. No existing UUID changes. |
| `modules/liberiaemr/api/src/main/java/org/openmrs/module/liberiaemr/rbac/Le39Module.java` | Fixed privilege bundles and explicit Write ⇒ Read. |
| `modules/liberiaemr/api/src/main/java/org/openmrs/module/liberiaemr/rbac/Le39Authorization.java` | Fail-closed decision at a selected protected boundary. |
| `modules/liberiaemr/api/src/main/java/org/openmrs/module/liberiaemr/rbac/Le39Classifier.java` | Persisted-identity classification through a trusted persistence port; no adapters registered. |
| `modules/liberiaemr/api/src/main/resources/liberiaemr-uuids.properties` | Bind existing metadata identities into the classifier. |
| `modules/liberiaemr/api/pom.xml` | Read the required content variable layers and copy real role/privilege CSVs into test resources. |
| `distribution/backend/Dockerfile` | Copy the three additional variable filters required by the API build. |
| `modules/liberiaemr/api/src/test/java/org/openmrs/module/liberiaemr/rbac/Le39EntitlementsTest.java` | Five tests of actual configured grants, the whole matrix, inheritance preservation and exact privilege vocabulary. |
| `modules/liberiaemr/api/src/test/java/org/openmrs/module/liberiaemr/rbac/Le39ClassifierTest.java` | Twenty tests of classification, excluded resources, and protected-boundary decisions. |
| `docs/security/le39-phase1-review.md` | This review record and complete grant mapping. |

No concepts, form files/versions, encounter-type definitions, user assignments, frontend
configuration, appointments code, or LE-37/LE-38 implementation files were changed.
Existing variable values remain identical. The source validator itself is unchanged.

## J–K. Tests and validation

Test commands below require Java 17 (`JAVA_HOME` pointing to the Java 17 installation).

Focused test command:

```sh
mvn -f modules/liberiaemr/pom.xml -pl api -am test \
  -Dtest='Le39*Test' -Dsurefire.failIfNoSpecifiedTests=false -DjavaFormatter.skip=true
```

**25 tests passed, zero failures/errors/skips.** The same 25 pass in the full API run
after the adversarial-review correction (five entitlement tests and twenty classifier tests).
The matrix test reads the actual role CSV, resolves inheritance, checks all 99 cells and
checks read/write decisions separately. In particular it proves:

- Nurse L&D W; Midwife L&D W; Physician Assistant L&D R.
- Physician Assistant General Consultation W and Immunization R.
- Nurse TB Screening W; Midwife TB Screening R.
- Lab Technician Laboratory W; Pharmacist Pharmacy W.
- Registrar Registration W and all other confirmed modules N.
- Finance Billing W; both Systems Administrator and Facility in-charge W in all 11 modules.

It also proves exact privilege creation, bundle completeness, W ⇒ R, R ⇏ W, N granting
neither, preserved pre-existing Clinician grants, and no new generic encounter/observation
grants on the five new roles. Classifier tests cover all 16 current form/type pairs, all
14 dedicated type fallbacks, orders/subtypes/cycles, observations/groups, dispensing,
registration/billing identity, missing records, contradictory evidence, protected-boundary
mismatch, excluded pathways, and ignored free-text/concept hints. Seven added regression
methods cover order-linked Triage/Vitals exclusions, self/multi-observation cycles with
both order kinds, parent/child order conflicts in both directions, matching orders within
matching clinical context, conflicting contexts despite matching orders, broken/conflicting
provenance with orders, and inherited group exclusions. Negative cases assert READ and
WRITE denial at every protected boundary even with complete privileges. The existing ANC
laboratory-result test also asserts ALLOW at the Laboratory WRITE boundary.

A separate temporary Java harness reproduced the original adversarial cases against the
freshly compiled classifier, without invoking the JUnit test methods:

| Reproduction | Result after correction |
|---|---|
| Vitals without order, with Drug Order, with Test Order | EXCLUDED; all protected boundaries DENY |
| Self-cycle with Drug Order or Test Order | UNKNOWN; all protected boundaries DENY |
| Child Laboratory / parent Pharmacy, and reverse | UNKNOWN; all protected boundaries DENY |
| ANC + legitimate Laboratory order | LABORATORY; authorized Laboratory boundary ALLOW |
| Standalone Test Order / Drug Order | LABORATORY / PHARMACY |

Full module build and test command (Java 17):

```sh
mvn -B -ntp -f modules/liberiaemr/pom.xml package -DjavaFormatter.skip=true
```

Java 17 API result: **223 tests, 0 failures, 0 errors, 1 skipped** (222 passed).
The existing skipped test is `LiberiaEMRDaoTest`; the 25 LE-39 tests all execute and pass.
An isolated archive of unchanged `HEAD` on Java 17 produced **198 tests, 0 failures,
0 errors, 1 skipped** (197 passed). The difference is the 25 passing LE-39 tests.

Earlier runs using the local Maven default (Java 26) had 21 identical SnakeYAML class-loading
errors in both the baseline and changed trees. Those results are superseded by the passing
Java 17 API runs; no dependency or unrelated source changes were made to resolve them.
Sandboxed runs also could not write OpenMRS's test logging directory; the successful runs
used normal filesystem access. Initial offline attempts required Maven dependency downloads.
For this correction, Java 17 runs used the cached dependencies (`-o`) and
`-DOPENMRS_APPLICATION_DATA_DIRECTORY=/tmp/le39-correction-openmrs`. The focused run passed
inside the sandbox. The full build initially failed because the sandbox prohibited local
MFL test-server sockets; the identical build passed with those sockets allowed. No source
or test changes were made to bypass that environment restriction.

**Full reactor: BUILD SUCCESS.** API: 223 tests, 0 failures, 0 errors, 1 skipped.
OMOD: 41 tests, 0 failures, 0 errors, 0 skipped. **Total: 264 tests reported; 263 passed,
1 existing skip.** The API jar and `liberiaemr-1.0.1-SNAPSHOT.omod` were built successfully.
The development artifact was not deployed.

A `test`-only reactor invocation initially stopped at OMOD with MDEP-98: the existing
resource-unpacking step needs the API artifact packaged first. Running the repository's
`package` workflow resolved this without changing any build lifecycle configuration.

| Check | Result |
|---|---|
| `scripts/validate/validate-content.sh` | PASS |
| `scripts/validate/no-secrets.sh` | PASS |
| `scripts/validate/no-demo-in-release.sh` | PASS |
| `scripts/build/lift-demo-content.sh --check` | PASS; content-demo matches pinned upstream 1.9.2. Network access was available for this run. |
| `git diff --check` | PASS |

No live database/Initializer upgrade, full Docker image build, or API enforcement test was
performed. Unit tests use an in-memory trusted persistence implementation, not an integration
adapter. These limits must not be reported as production enforcement or live upgrade validation.

## L. Architecture observations

- Clinician's inherited edge was a second privilege leak that needed removal alongside
  Midwife's edge. Its old effective privileges are preserved exactly.
- AMPATH form identity is Initializer-derived from name/version. The legacy national PNC
  and Family Planning JSON literals differ from those runtime identities. New variable
  references identify the derived forms; the clinical JSON is untouched. Unproven historical
  identities stay ambiguous, not guessed by name.
- The new UUID bindings require common, MCH and OPD/IPD variable filters in addition to
  national. The Docker build now supplies them. As with existing `ContentUuids` consumers,
  site-specific UUID overrides require matching module build filters before deployment;
  this change does not add a runtime configuration language.
- Phase 2 still needs trusted original-state persistence adapters, immutable classification
  evidence during updates, collection filtering, and operation-specific checks. New roles
  intentionally do not receive broad clinical prerequisites just to make all existing APIs
  usable. Billing and dispensing persistence ports are contracts here, not production
  implementations. These are the approved phase boundary, not claims of completed enforcement.
- Unrecognised historical forms and inconsistent records remain a data-quality/migration
  issue. There is no newly discovered unresolved blocker to reviewing the Phase 1 foundation.

## M–N. `/liberia-review` and human review

Reviewed the complete uncommitted diff using `.claude/skills/liberia-review/SKILL.md` after
rerunning the prescribed validators after the classifier correction. The order-first
short circuit identified by adversarial review is fixed; the separate reproductions above
now fail closed or remain excluded as required. **No blocking issues found in the corrected
Phase 1 diff.** Only the classifier, its tests, and affected claims in this report changed
in this correction; role grants, inheritance, privilege definitions, and metadata did not.

Configure content remains in content packages, backend Custom Build code in the existing
module, and build inputs in the distribution. No upstream component was patched. UUID
variables resolve, existing clinical metadata is unchanged, no demo content or secrets were
added, and MOH password/session/audit/encryption controls are unchanged. New role entitlements
are explicitly authorized by the source matrix. No unrelated role gains the new privileges.
Version pins/ranges are unchanged; the repository remains on its development SNAPSHOT stream.

Upgrade behavior needs a live upgrade check before rollout, especially locally customized
role grants.
The `LE-39-module-rbac` branch satisfies Jira naming; PR title is **unchecked** (no PR created).

**A second human security/RBAC reviewer is required** by the review skill and the user's
instructions. The reviewer should verify all 99 cells, the two removed inheritance edges,
retained core grants, the trusted persistence boundary, and the scoped ambiguity policy.
This report does not substitute for that reviewer or QA upgrade sign-off.

## O–P. Working tree and verdict

13 changed/new files: six modified tracked files and seven new files. All changes are
uncommitted; nothing was pushed. Existing users are untouched. Phase 2 has not started.

**READY TO COMMIT PHASE 1**, with all focused tests, adversarial reproductions, and requested
validators passing. The Java 17 API/OMOD package build is green (263 passed, one existing
skip). The required second human security/RBAC review remains applicable.
This is not a rollout or Phase 2 approval.
