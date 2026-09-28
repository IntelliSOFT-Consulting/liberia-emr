/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

/** What a run did, or on a dry run would do, to one location (docs/architecture/mfl-sync-api.md). */
public enum MflAction {
	CREATE, UPDATE, RETIRE, UNRETIRE,
	/** Unchanged, but with warnings. */
	WARNING,
	/** Not applied; the message says why. */
	ERROR
}
