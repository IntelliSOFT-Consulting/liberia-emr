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

import java.sql.Connection;

import liquibase.change.custom.CustomTaskChange;
import liquibase.database.Database;
import liquibase.database.jvm.JdbcConnection;
import liquibase.exception.CustomChangeException;
import liquibase.exception.ValidationErrors;
import liquibase.resource.ResourceAccessor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The liquibase changeset that recomputes {@code openmrs_identity.patient_link.facility_location_uuid}
 * on every existing link (liquibase.xml, liberiaemr-2026-09-30-identity-facility-of-origin).
 * <p>
 * Links minted before the fix hold the root of the identifier location's tree, which under the MFL
 * hierarchy is the county or the country. This rewrites them with {@link FacilityOfOrigin}, the
 * same code that mints new links, rather than a second copy of the rule in SQL. It writes only
 * rows whose value changes, so running it again changes nothing. Its changeset only runs where the
 * identity schema exists, which is central alone; it logs counts, never a record.
 */
public class FacilityOfOriginBackfill implements CustomTaskChange {

	private static final Logger log = LoggerFactory.getLogger(FacilityOfOriginBackfill.class);

	private String message = "facility of origin not recomputed";

	@Override
	public void execute(Database database) throws CustomChangeException {
		try {
			Connection connection = ((JdbcConnection) database.getConnection()).getUnderlyingConnection();
			int[] counts = FacilityOfOrigin.backfill(connection, FacilityOfOrigin.healthFacilityTagUuid());
			message = "Recomputed the facility of origin of " + counts[0] + " identity link(s); " + counts[1] + " changed";
			log.info(message);
		}
		catch (Exception e) {
			throw new CustomChangeException("could not recompute patient_link.facility_location_uuid", e);
		}
	}

	@Override
	public String getConfirmationMessage() {
		return message;
	}

	@Override
	public void setUp() {
	}

	@Override
	public void setFileOpener(ResourceAccessor resourceAccessor) {
	}

	@Override
	public ValidationErrors validate(Database database) {
		return new ValidationErrors();
	}
}
