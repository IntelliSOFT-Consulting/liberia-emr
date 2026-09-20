/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.api.impl;

import org.openmrs.api.APIException;
import org.openmrs.api.UserService;
import org.openmrs.api.impl.BaseOpenmrsService;
import org.openmrs.User;
import org.openmrs.api.AdministrationService;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.Item;
import org.openmrs.module.liberiaemr.PasswordResetToken;
import org.openmrs.module.liberiaemr.api.EmailService;
import org.openmrs.module.liberiaemr.api.LiberiaEMRService;
import org.openmrs.module.liberiaemr.api.dao.LiberiaEMRDao;
import org.openmrs.module.liberiaemr.api.dao.PasswordResetTokenDao;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.UUID;
import java.util.Calendar;

import javax.mail.MessagingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LiberiaEMRServiceImpl extends BaseOpenmrsService implements LiberiaEMRService {

	private static final Logger log = LoggerFactory.getLogger(LiberiaEMRServiceImpl.class);
	
	private static final String DEFAULT_FRONTEND_URL = "http://localhost:8080/openmrs/spa";
	
	LiberiaEMRDao dao;
	PasswordResetTokenDao tokenDao;
	EmailService emailService;
	AdministrationService adminService;
	
	UserService userService;
	
	/**
	 * Injected in moduleApplicationContext.xml
	 */
	public void setDao(LiberiaEMRDao dao) {
		this.dao = dao;
	}
	
	public void setTokenDao(PasswordResetTokenDao tokenDao) {
		this.tokenDao = tokenDao;
	}
	
	public void setEmailService(EmailService emailService) {
		this.emailService = emailService;
	}
	
	public void setAdminService(AdministrationService adminService) {
		this.adminService = adminService;
	}
	
	/**
	 * Injected in moduleApplicationContext.xml
	 */
	public void setUserService(UserService userService) {
		this.userService = userService;
	}
	
	@Override
	@Transactional(readOnly = true)
	public Item getItemByUuid(String uuid) throws APIException {
		return dao.getItemByUuid(uuid);
	}
	
	@Override
	@Transactional
	public Item saveItem(Item item) throws APIException {
		if (item.getOwner() == null) {
			item.setOwner(userService.getUser(1));
		}
		
		return dao.saveItem(item);
	}
	
	@Override
	@Transactional
	public void requestPasswordReset(String email) throws APIException {
		try {
			addProxyPrivilege("Get Users");
			addProxyPrivilege("Get Global Properties");
			
			User user = findUserByEmail(email);
			
			// To prevent email enumeration, we just log and return if user not found.
			if (user == null) {
				log.warn("AUDIT: Password reset requested for email '{}' but no matching user found. Failing silently.",
				    email);
				return;
			}
			
			// 2. Void existing tokens for this user
			tokenDao.voidExistingTokensForUser(user.getUserId());
			
			// 3. Generate new token
			String tokenStr = UUID.randomUUID().toString();
			
			// 4. Calculate expiry (default 2 hours)
			String expiryHoursStr = adminService.getGlobalProperty("liberiaemr.passwordReset.tokenExpiryHours", "2");
			int expiryHours = 2;
			try {
				expiryHours = Integer.parseInt(expiryHoursStr);
			}
			catch (NumberFormatException e) {
				log.error("Invalid tokenExpiryHours global property. Defaulting to 2.");
			}
			
			Calendar cal = Calendar.getInstance();
			Date now = cal.getTime();
			cal.add(Calendar.HOUR, expiryHours);
			Date expiry = cal.getTime();
			
			PasswordResetToken token = new PasswordResetToken(user, tokenStr, now, expiry);
			tokenDao.savePasswordResetToken(token);
			
			// 5. Send Email
			String frontendUrl = resolveFrontendUrl();
			String resetLink = frontendUrl + "/login/reset-password?token=" + tokenStr;
			
			try {
				emailService.sendPasswordResetEmail(email, resetLink);
			}
			catch (MessagingException e) {
				log.error("Failed to send password reset email to " + email, e);
				throw new APIException("Failed to send password reset email", e);
			}
		}
		finally {
			removeProxyPrivilege("Get Users");
			removeProxyPrivilege("Get Global Properties");
		}
	}
	
	/**
	 * The base URL the emailed reset link is built from. LIBERIAEMR_FRONTEND_URL first, because
	 * the public address of an instance is deployment state that the same image carries to
	 * every facility; the global property remains for a developer changing it on a live box.
	 *
	 * A trailing slash would produce a double-slashed link, which some mail clients mangle.
	 *
	 * @return the frontend base URL, without a trailing slash
	 */
	private String resolveFrontendUrl() {
		String url = System.getenv("LIBERIAEMR_FRONTEND_URL");
		if (url == null || url.trim().isEmpty()) {
			url = adminService.getGlobalProperty("liberiaemr.frontend.url", DEFAULT_FRONTEND_URL);
		}
		// getGlobalProperty(name, default) does not return null in production, but an
		// AdministrationService that has no value for the property at all can, and a null here
		// would take down the whole request on a line that is only building a link.
		if (url == null || url.trim().isEmpty()) {
			url = DEFAULT_FRONTEND_URL;
		}
		url = url.trim();
		while (url.endsWith("/")) {
			url = url.substring(0, url.length() - 1);
		}
		return url;
	}
	
	/**
	 * Resolves the account to reset from the CORE users.email column — the one place OpenMRS
	 * itself stores a user's address, and what UserService.getUserByUsernameOrEmail queries with
	 * an index.
	 *
	 * An earlier revision matched on an "Email" PersonAttribute instead. No such attribute type
	 * exists anywhere in this distribution's content, so that lookup could never match a real
	 * account: every user was "not found" and no reset mail was ever sent. Do not reintroduce it
	 * without also shipping the attribute type — and prefer users.email, which needs no content
	 * at all.
	 *
	 * getUserByUsernameOrEmail matches EITHER column, so the address is re-checked against
	 * getEmail() here: a caller who posts a bare username must not be able to use this endpoint
	 * to discover that the username exists, or to have mail sent anywhere.
	 *
	 * @param email the address the caller asked to reset
	 * @return the matching active user, or null if there is none
	 */
	private User findUserByEmail(String email) {
		User user = userService.getUserByUsernameOrEmail(email);
		if (user == null || Boolean.TRUE.equals(user.isRetired())) {
			return null;
		}
		if (user.getEmail() == null || !user.getEmail().trim().equalsIgnoreCase(email.trim())) {
			return null;
		}
		return user;
	}
	
	@Override
	@Transactional
	public void confirmPasswordReset(String tokenString, String newPassword) throws APIException {
		PasswordResetToken token = tokenDao.getPasswordResetToken(tokenString);
		
		if (token == null || token.isExpiredOrVoided()) {
			log.warn("AUDIT: Password reset failed. Invalid or expired token provided.");
			throw new APIException("Invalid or expired password reset token.");
		}
		
		User user = token.getUser();
		
		// Update password using Context (bypass proxy issues with user permissions by running as super user if needed, or directly)
		// Wait, we need to bypass authorization since the user is not logged in.
		// The controller should use Context.becomeUser to execute this, but let's just change it.
		// Actually, OpenMRS UserService.changePassword requires the current password. 
		// If we don't know it, we can use userService.changePassword(user, newPassword) if we're superuser.
		// Since we'll be calling this via a daemon or proxy, let's just use the direct method.
		// Wait, UserService doesn't have a method to set password without the old one, except for admin.
		// There is userService.changePassword(user, newPassword) which only works if Context.hasPrivilege("Edit Users")
		
		try {
			// Temporarily escalate privileges to change password if not authenticated
			addProxyPrivilege("Edit Users");
			addProxyPrivilege("Edit User Passwords");
			addProxyPrivilege("Get Global Properties");
			userService.changePassword(user, newPassword);
		} catch (Exception e) {
			log.warn("AUDIT: Password reset failed for user ID: {} (Username: {}). Error: {}", user.getUserId(), user.getUsername(), e.getMessage());
			throw e;
		} finally {
			removeProxyPrivilege("Edit Users");
			removeProxyPrivilege("Edit User Passwords");
			removeProxyPrivilege("Get Global Properties");
		}
		
		// Void the token so it can't be reused
		token.setVoided(true);
		tokenDao.savePasswordResetToken(token);
		
		log.info("AUDIT: Password successfully reset for user ID: {} (Username: {})", user.getUserId(), user.getUsername());
	}

	public void addProxyPrivilege(String privilege) {
		Context.addProxyPrivilege(privilege);
	}

	public void removeProxyPrivilege(String privilege) {
		Context.removeProxyPrivilege(privilege);
	}
}
