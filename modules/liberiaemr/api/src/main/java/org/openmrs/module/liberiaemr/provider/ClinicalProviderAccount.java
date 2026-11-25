/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.provider;

import org.openmrs.Person;
import org.openmrs.Provider;
import org.openmrs.User;
import org.openmrs.api.ProviderService;
import org.openmrs.api.context.Context;
import org.openmrs.util.PrivilegeConstants;

/**
 * Gives a user who can add encounters a Provider record when they have none (LE-617).
 * <p>
 * The O3 form engine saves every encounter with the session's currentProvider, and the REST module
 * sets that only from a Provider linked to the user's person. A clinical user created without
 * "Create a Provider account" therefore fails every form with "Cannot read properties of null
 * (reading 'uuid')". A person with any provider, retired included, is left alone: a retired one is
 * an administrator's decision.
 */
public final class ClinicalProviderAccount {
	
	private ClinicalProviderAccount() {
	}
	
	/** Returns the Provider created for the signed-in user, or null when none was needed. */
	public static Provider ensureForAuthenticatedUser() {
		if (!Context.isAuthenticated()) {
			return null;
		}
		User user = Context.getAuthenticatedUser();
		if (!needsCheck(user)) {
			return null;
		}
		Context.addProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
		Context.addProxyPrivilege(PrivilegeConstants.MANAGE_PROVIDERS);
		try {
			return ensureFor(user, Context.getProviderService());
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.GET_PROVIDERS);
			Context.removeProxyPrivilege(PrivilegeConstants.MANAGE_PROVIDERS);
		}
	}
	
	/** Only a real, non-retired user with a person who may add encounters. */
	static boolean needsCheck(User user) {
		return user != null && user.getPerson() != null && !Boolean.TRUE.equals(user.getRetired())
		        && user.hasPrivilege(PrivilegeConstants.ADD_ENCOUNTERS);
	}
	
	/**
	 * Synchronized: O3 fires several /session calls at boot and duplicate identifiers pass
	 * validation.
	 */
	static synchronized Provider ensureFor(User user, ProviderService providers) {
		Person person = user.getPerson();
		if (!providers.getProvidersByPerson(person, true).isEmpty()) {
			return null;
		}
		Provider provider = new Provider();
		provider.setPerson(person);
		provider.setIdentifier(identifier(user, providers));
		return providers.saveProvider(provider);
	}
	
	/** The user's system id, or their uuid when another provider already holds it. */
	static String identifier(User user, ProviderService providers) {
		String systemId = user.getSystemId();
		if (systemId != null && !systemId.isEmpty() && providers.getProviderByIdentifier(systemId) == null) {
			return systemId;
		}
		return user.getUuid();
	}
}
