/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.api.dao;

import org.hibernate.criterion.Restrictions;
import org.openmrs.api.db.hibernate.DbSession;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.liberiaemr.PasswordResetToken;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

/**
 * DAO for managing {@link PasswordResetToken} persistence operations.
 */
@Repository("liberiaemr.PasswordResetTokenDao")
public class PasswordResetTokenDao {
	
	@Autowired
	DbSessionFactory sessionFactory;
	
	private DbSession getSession() {
		return sessionFactory.getCurrentSession();
	}
	
	/**
	 * Saves or updates a password reset token.
	 * 
	 * @param token the token to save
	 * @return the saved token
	 */
	public PasswordResetToken savePasswordResetToken(PasswordResetToken token) {
		getSession().saveOrUpdate(token);
		return token;
	}
	
	/**
	 * Finds a non-voided password reset token by its token string.
	 * 
	 * @param tokenString the UUID token string
	 * @return the matching token, or null if not found
	 */
	public PasswordResetToken getPasswordResetToken(String tokenString) {
		return (PasswordResetToken) getSession().createCriteria(PasswordResetToken.class)
		        .add(Restrictions.eq("token", tokenString)).add(Restrictions.eq("voided", Boolean.FALSE)).uniqueResult();
	}
	
	/**
	 * Voids all active (non-voided) tokens for a given user. This is called before generating a new
	 * token to invalidate prior requests.
	 * 
	 * @param userId the user ID
	 */
	public void voidExistingTokensForUser(Integer userId) {
		getSession()
		        .createQuery("UPDATE PasswordResetToken SET voided = true WHERE user.userId = :userId AND voided = false")
		        .setParameter("userId", userId).executeUpdate();
	}
}
