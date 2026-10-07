/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.identity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.hibernate.jdbc.ReturningWork;
import org.hibernate.jdbc.Work;
import org.junit.Before;
import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.test.BaseModuleContextSensitiveTest;

/**
 * The identity review queue (ADR 0005 band 2): a person decides whether two records are one
 * person, and the decision links them, separates them, or leaves them as they are, without
 * deleting or reusing any CPI (sync-eip.md 2.5.2).
 */
public class IdentityReviewTest extends BaseModuleContextSensitiveTest {

	private static final String S = IdentityService.SCHEMA;

	private IdentityService service;

	private String alice, bea, cora, dee;

	@Before
	public void schema() {
		// DDL commits in H2, so the identity tables are made before this test writes anything.
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.execute("CREATE SCHEMA IF NOT EXISTS " + S);
					s.execute("CREATE TABLE IF NOT EXISTS " + S + ".cpi (cpi_id INT AUTO_INCREMENT PRIMARY KEY, "
					        + "cpi CHAR(36) NOT NULL, code CHAR(16) NOT NULL, primary_cpi_id INT, date_created TIMESTAMP NOT NULL, "
					        + "date_changed TIMESTAMP, change_reason VARCHAR(500))");
					s.execute("CREATE TABLE IF NOT EXISTS " + S + ".patient_link (link_id INT AUTO_INCREMENT PRIMARY KEY, "
					        + "patient_uuid CHAR(38) NOT NULL, cpi_id INT NOT NULL, facility_location_uuid CHAR(38), "
					        + "basis VARCHAR(30) NOT NULL, date_created TIMESTAMP NOT NULL, national_id VARCHAR(50))");
					s.execute("CREATE TABLE IF NOT EXISTS " + S + ".cpi_event (event_id INT AUTO_INCREMENT PRIMARY KEY, "
					        + "cpi_id INT NOT NULL, kind VARCHAR(30) NOT NULL, primary_before INT, primary_after INT, "
					        + "reason VARCHAR(500), actor_user_id INT, date_created TIMESTAMP NOT NULL)");
					s.execute("CREATE TABLE IF NOT EXISTS " + S + ".match_review (review_id INT AUTO_INCREMENT PRIMARY KEY, "
					        + "patient_uuid CHAR(38) NOT NULL, candidate_patient_uuid CHAR(38) NOT NULL, reason VARCHAR(255) NOT NULL, "
					        + "status VARCHAR(20) NOT NULL, date_created TIMESTAMP NOT NULL, decision VARCHAR(20), decided_by INT, "
					        + "date_decided TIMESTAMP, decision_reason VARCHAR(500))");
					// Another test class may have made patient_link first, with fewer columns.
					s.execute("ALTER TABLE " + S + ".patient_link ADD COLUMN IF NOT EXISTS national_id VARCHAR(50)");
					for (String table : new String[] { "match_review", "cpi_event", "patient_link", "cpi" }) {
						s.execute("DELETE FROM " + S + "." + table);
					}
				}
			}
		});
		service = Context.getRegisteredComponent("liberiaemr.IdentityService", IdentityService.class);
		alice = Context.getPatientService().getPatient(2).getUuid();
		bea = Context.getPatientService().getPatient(6).getUuid();
		cora = Context.getPatientService().getPatient(7).getUuid();
		dee = Context.getPatientService().getPatient(8).getUuid();
	}

	@Test
	public void samePerson_linksTheTwoPeople_andRecordsWhoDecidedAndWhy() {
		int a = mint(alice), b = mint(bea);
		int review = openReview(alice, bea, "National ID matches but sex differs");

		Map<String, Object> after = service.decide(review, IdentityService.DECISION_SAME, " Checked the cards with both clinics ",
		    Context.getAuthenticatedUser());

		assertEquals(b, primaryOf(a));
		assertEquals(Boolean.TRUE, after.get("linked"));
		assertEquals(IdentityService.REVIEW_DECIDED, after.get("status"));
		@SuppressWarnings("unchecked")
		Map<String, Object> decision = (Map<String, Object>) after.get("decision");
		assertEquals(IdentityService.DECISION_SAME, decision.get("decision"));
		assertEquals("Checked the cards with both clinics", decision.get("reason"));
		assertEquals(IdentityService.BASIS_REVIEW, scalar("SELECT basis FROM " + S + ".patient_link WHERE patient_uuid = '" + alice + "'"));
		assertEquals(Context.getAuthenticatedUser().getUserId().intValue(), ((Number) scalar("SELECT actor_user_id FROM " + S
		        + ".cpi_event WHERE kind = 'ALIASED' AND cpi_id = " + a)).intValue());
	}

	@Test
	public void differentPeople_onRecordsNotLinked_changesNoLink() {
		int a = mint(alice), b = mint(bea);
		int review = openReview(alice, bea, "National ID matches but sex differs");

		service.decide(review, IdentityService.DECISION_DIFFERENT, "Two people share a household card", Context.getAuthenticatedUser());

		assertEquals(a, primaryOf(a));
		assertEquals(b, primaryOf(b));
		assertEquals(0, ((Number) scalar("SELECT COUNT(*) FROM " + S + ".cpi_event")).intValue());
		assertEquals(IdentityService.REVIEW_DECIDED, scalar("SELECT status FROM " + S + ".match_review WHERE review_id = " + review));
	}

	@Test
	public void differentPeople_onThePersonsPrimary_separatesIt_andKeepsTheRestOnePerson() {
		// alice's CPI is the person's primary; bea and cora are aliases of it.
		int a = mint(alice), b = mint(bea), c = mint(cora);
		alias(b, a);
		alias(c, a);
		int review = openReview(alice, bea, "National ID changed after the record was linked; check the link still holds");
		int cpis = count("SELECT COUNT(*) FROM " + S + ".cpi");

		service.decide(review, IdentityService.DECISION_DIFFERENT, "Mother and daughter, same card", Context.getAuthenticatedUser());

		assertEquals(a, primaryOf(a));
		assertEquals(b, primaryOf(b));
		assertEquals(b, primaryOf(c));
		assertEquals("nothing is deleted or minted", cpis, count("SELECT COUNT(*) FROM " + S + ".cpi"));
		assertEquals(IdentityService.BASIS_NEW, scalar("SELECT basis FROM " + S + ".patient_link WHERE patient_uuid = '" + alice + "'"));
		assertEquals(1, count("SELECT COUNT(*) FROM " + S + ".cpi_event WHERE kind = 'SEPARATED' AND cpi_id = " + a));
		assertEquals(2, count("SELECT COUNT(*) FROM " + S + ".cpi_event WHERE kind = 'REPOINTED'"));
	}

	@Test
	public void differentPeople_onAnAlias_separatesIt_andMovesWhatHungFromIt() {
		// alice is the primary, bea an alias of alice, dee an alias of bea.
		int a = mint(alice), b = mint(bea), d = mint(dee);
		alias(b, a);
		alias(d, b);
		int review = openReview(bea, alice, "National ID changed after the record was linked; check the link still holds");

		service.decide(review, IdentityService.DECISION_DIFFERENT, "Different mothers on the two cards", Context.getAuthenticatedUser());

		assertEquals(b, primaryOf(b));
		assertEquals(a, primaryOf(d));
		assertEquals(a, primaryOf(a));
	}

	@Test
	public void samePerson_onRecordsLinkedAlready_keepsTheLink() {
		int a = mint(alice), b = mint(bea);
		alias(a, b);
		int review = openReview(alice, bea, "National ID changed after the record was linked; check the link still holds");

		service.decide(review, IdentityService.DECISION_SAME, "Corrected a typo in the ID", Context.getAuthenticatedUser());

		assertEquals(b, primaryOf(a));
		assertEquals(0, count("SELECT COUNT(*) FROM " + S + ".cpi_event"));
	}

	@Test
	public void aReviewIsDecidedOnce() {
		mint(alice);
		mint(bea);
		int review = openReview(alice, bea, "National ID matches but sex differs");
		service.decide(review, IdentityService.DECISION_DIFFERENT, "First reviewer", Context.getAuthenticatedUser());
		try {
			service.decide(review, IdentityService.DECISION_SAME, "Second reviewer", Context.getAuthenticatedUser());
			fail("a decided review was decided again");
		}
		catch (IdentityService.StaleException expected) {}
	}

	@Test
	public void aDecisionNeedsAKnownAnswerAndAReason() {
		mint(alice);
		mint(bea);
		int review = openReview(alice, bea, "National ID matches but sex differs");
		for (String[] bad : new String[][] { { IdentityService.DECISION_SAME, "  " }, { "MAYBE", "a reason" },
		        { IdentityService.DECISION_SAME, new String(new char[501]).replace('\0', 'x') } }) {
			try {
				service.decide(review, bad[0], bad[1], Context.getAuthenticatedUser());
				fail("accepted " + bad[0]);
			}
			catch (IllegalArgumentException expected) {}
		}
		assertEquals(IdentityService.REVIEW_OPEN, scalar("SELECT status FROM " + S + ".match_review WHERE review_id = " + review));
	}

	@Test
	public void theReviewShowsBothRecordsSideBySide() {
		mint(alice);
		mint(bea);
		int review = openReview(alice, bea, "National ID matches but sex differs");

		Map<String, Object> detail = service.getReview(review);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> records = (List<Map<String, Object>>) detail.get("records");
		assertEquals(2, records.size());
		assertEquals(alice, records.get(0).get("patientUuid"));
		assertEquals(bea, records.get(1).get("patientUuid"));
		assertTrue(records.get(0).get("name") != null);
		assertTrue(records.get(0).containsKey("identifiers"));
		assertEquals(0, ((Number) records.get(0).get("otherRecordsLinked")).intValue());
		assertNull(detail.get("decision"));

		Map<String, Object> list = service.listReviews();
		assertEquals(1, ((Number) list.get("total")).intValue());
	}

	@Test
	public void theNationalIdRule_neverLinksOrRequeuesAPairAPersonRuledDifferent() {
		// alice has a CPI; bea arrives with alice's National ID, and a person has already said
		// they are different people.
		final String type = Context.getPatientService().getAllPatientIdentifierTypes().get(0).getUuid();
		Context.getAdministrationService().setGlobalProperty(IdentityService.GP_NATIONAL_ID_TYPE, type);
		int a = mint(alice);
		identify(2, type, "LR-SHARED-1");
		identify(6, type, "LR-SHARED-1");
		exec("INSERT INTO " + S + ".match_review (patient_uuid, candidate_patient_uuid, reason, status, date_created, decision, "
		        + "decided_by, date_decided, decision_reason) VALUES ('" + bea + "', '" + alice + "', 'earlier', 'DECIDED', "
		        + "CURRENT_TIMESTAMP, 'DIFFERENT_PEOPLE', 1, CURRENT_TIMESTAMP, 'Twins')");

		service.assignPending();

		int b = ((Number) scalar("SELECT cpi_id FROM " + S + ".patient_link WHERE patient_uuid = '" + bea + "'")).intValue();
		assertFalse("the rule linked a pair a person ruled different", primaryOf(b) == primaryOf(a));
		assertEquals(0, count("SELECT COUNT(*) FROM " + S + ".match_review WHERE status = 'OPEN'"));
	}

	private int mint(final String patientUuid) {
		Timestamp now = new Timestamp(System.currentTimeMillis());
		exec("INSERT INTO " + S + ".cpi (cpi, code, date_created) VALUES ('" + UUID.randomUUID() + "', '"
		        + UUID.randomUUID().toString().substring(0, 16) + "', '" + now + "')");
		int cpi = ((Number) scalar("SELECT MAX(cpi_id) FROM " + S + ".cpi")).intValue();
		exec("INSERT INTO " + S + ".patient_link (patient_uuid, cpi_id, basis, date_created, national_id) VALUES ('" + patientUuid
		        + "', " + cpi + ", 'NEW', '" + now + "', '')");
		return cpi;
	}

	private void alias(int cpi, int primary) {
		exec("UPDATE " + S + ".cpi SET primary_cpi_id = " + primary + " WHERE cpi_id = " + cpi);
	}

	private int openReview(String patientUuid, String candidateUuid, String reason) {
		exec("INSERT INTO " + S + ".match_review (patient_uuid, candidate_patient_uuid, reason, status, date_created) VALUES ('"
		        + patientUuid + "', '" + candidateUuid + "', '" + reason + "', 'OPEN', CURRENT_TIMESTAMP)");
		return ((Number) scalar("SELECT MAX(review_id) FROM " + S + ".match_review")).intValue();
	}

	private void identify(int patientId, String typeUuid, String identifier) {
		exec("INSERT INTO patient_identifier (patient_id, identifier, identifier_type, preferred, location_id, creator, "
		        + "date_created, voided, uuid) VALUES (" + patientId + ", '" + identifier + "', (SELECT patient_identifier_type_id "
		        + "FROM patient_identifier_type WHERE uuid = '" + typeUuid + "'), 1, 1, 1, CURRENT_TIMESTAMP, 0, '"
		        + UUID.randomUUID() + "')");
	}

	private int primaryOf(int cpi) {
		int id = cpi;
		for (int hop = 0; hop < 20; hop++) {
			Object parent = scalar("SELECT primary_cpi_id FROM " + S + ".cpi WHERE cpi_id = " + id);
			if (parent == null) {
				return id;
			}
			id = ((Number) parent).intValue();
		}
		throw new AssertionError("alias chain from " + cpi + " does not end");
	}

	private int count(String sql) {
		return ((Number) scalar(sql)).intValue();
	}

	private static Object scalar(final String sql) {
		return Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class).getCurrentSession()
		        .doReturningWork(new ReturningWork<Object>() {

			        @Override
			        public Object execute(Connection connection) throws SQLException {
				        List<Map<String, Object>> rows = IdentityService.query(connection, sql);
				        return rows.isEmpty() ? null : rows.get(0).values().iterator().next();
			        }
		        });
	}

	private static void exec(final String sql) {
		work(new Work() {

			@Override
			public void execute(Connection connection) throws SQLException {
				try (Statement s = connection.createStatement()) {
					s.executeUpdate(sql);
				}
			}
		});
	}

	private static void work(Work work) {
		Context.getRegisteredComponent("dbSessionFactory", DbSessionFactory.class).getCurrentSession().doWork(work);
	}
}
