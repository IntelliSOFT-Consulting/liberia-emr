/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.api;

import org.openmrs.annotation.Authorized;
import org.openmrs.api.APIException;
import org.openmrs.api.OpenmrsService;
import org.openmrs.module.liberiaemr.LiberiaEMRConfig;
import org.openmrs.module.liberiaemr.Item;

/**
 * The main service of this module, which is exposed for other modules. See
 * moduleApplicationContext.xml on how it is wired up.
 */
public interface LiberiaEMRService extends OpenmrsService {
	
	/**
	 * Returns an item by uuid. It can be called by any authenticated user. It is fetched in read
	 * only transaction.
	 * 
	 * @param uuid
	 * @return
	 */
	@Authorized()
	Item getItemByUuid(String uuid) throws APIException;
	
	/**
	 * Saves an item. Sets the owner to superuser, if it is not set. It can be called by users with
	 * this module's privilege. It is executed in a transaction.
	 * 
	 * @param item
	 * @return
	 */
	@Authorized(LiberiaEMRConfig.MODULE_PRIVILEGE)
	Item saveItem(Item item) throws APIException;
	
	/**
	 * Initiates a password reset request for the given email address. If the user exists, a token
	 * is generated and an email is sent.
	 * 
	 * @param email the email address (mapped via User Properties)
	 */
	void requestPasswordReset(String email) throws APIException;
	
	/**
	 * Confirms a password reset using the provided token.
	 * 
	 * @param token the UUID token string
	 * @param newPassword the new password to set
	 */
	void confirmPasswordReset(String token, String newPassword) throws APIException;
}
