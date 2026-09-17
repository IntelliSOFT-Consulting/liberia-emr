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
import java.util.List;
import java.util.UUID;
import java.util.Calendar;

import javax.mail.MessagingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LiberiaEMRServiceImpl extends BaseOpenmrsService implements LiberiaEMRService {

	private static final Logger log = LoggerFactory.getLogger(LiberiaEMRServiceImpl.class);
	
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
		// 1. Find user by email property
		// Since email is a user property in OpenMRS
		User user = null;
		try {
			Context.addProxyPrivilege("Get Users");
			Context.addProxyPrivilege("Get Global Properties");
			List<User> users = userService.getAllUsers();
			for (User u : users) {
				String userEmail = null;
				org.openmrs.PersonAttribute emailAttr = u.getPerson().getAttribute("Email");
				if (emailAttr == null) {
					emailAttr = u.getPerson().getAttribute("email");
				}
				if (emailAttr != null) {
					userEmail = emailAttr.getValue();
				}
				
				if (userEmail != null && userEmail.equalsIgnoreCase(email)) {
					user = u;
					break;
				}
			}
			
			// To prevent email enumeration, we just log and return if user not found
			if (user == null) {
				log.warn("AUDIT: Password reset requested for email '{}' but no matching user found. Failing silently.", email);
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
			} catch (NumberFormatException e) {
				log.error("Invalid tokenExpiryHours global property. Defaulting to 2.");
			}
			
			Calendar cal = Calendar.getInstance();
			Date now = cal.getTime();
			cal.add(Calendar.HOUR, expiryHours);
			Date expiry = cal.getTime();
			
			PasswordResetToken token = new PasswordResetToken(user, tokenStr, now, expiry);
			tokenDao.savePasswordResetToken(token);
			
			// 5. Send Email
			String frontendUrl = adminService.getGlobalProperty("liberiaemr.frontend.url", "http://localhost:8080/openmrs/spa");
			String resetLink = frontendUrl + "/login/reset-password?token=" + tokenStr;
			
			try {
				emailService.sendPasswordResetEmail(email, resetLink);
			} catch (MessagingException e) {
				log.error("Failed to send password reset email to " + email, e);
				throw new APIException("Failed to send password reset email", e);
			}
		} finally {
			Context.removeProxyPrivilege("Get Users");
			Context.removeProxyPrivilege("Get Global Properties");
		}
	}
	
	@Override
	@Transactional
	public void confirmPasswordReset(String tokenString, String newPassword) throws APIException {
		PasswordResetToken token = tokenDao.getPasswordResetToken(tokenString);
		
		if (token == null || token.isExpiredOrVoided()) {
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
			Context.addProxyPrivilege("Edit Users");
			Context.addProxyPrivilege("Edit User Passwords");
			Context.addProxyPrivilege("Get Global Properties");
			userService.changePassword(user, newPassword);
		} finally {
			Context.removeProxyPrivilege("Edit Users");
			Context.removeProxyPrivilege("Edit User Passwords");
			Context.removeProxyPrivilege("Get Global Properties");
		}
		
		// Void the token so it can't be reused
		token.setVoided(true);
		tokenDao.savePasswordResetToken(token);
		
		log.info("AUDIT: Password successfully reset for user ID: {} (Username: {})", user.getUserId(), user.getUsername());
	}
}
