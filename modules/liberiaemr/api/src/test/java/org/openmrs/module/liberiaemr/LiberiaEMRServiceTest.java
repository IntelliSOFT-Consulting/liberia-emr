/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr;

import org.junit.Before;
import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.MockitoAnnotations;
import org.openmrs.User;
import org.openmrs.api.APIException;
import org.openmrs.api.AdministrationService;
import org.openmrs.api.UserService;
import org.openmrs.module.liberiaemr.api.EmailService;
import org.openmrs.module.liberiaemr.api.dao.LiberiaEMRDao;
import org.openmrs.module.liberiaemr.api.dao.PasswordResetTokenDao;
import org.openmrs.module.liberiaemr.api.impl.LiberiaEMRServiceImpl;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.anyInt;
import static org.mockito.Mockito.any;
import static org.hamcrest.Matchers.hasProperty;
import static org.hamcrest.Matchers.is;
import static org.junit.Assert.assertThat;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * This is a unit test, which verifies logic in LiberiaEMRService. It doesn't extend
 * BaseModuleContextSensitiveTest, thus it is run without the in-memory DB and Spring context.
 */
public class LiberiaEMRServiceTest {

	@Spy
	@InjectMocks
	LiberiaEMRServiceImpl basicModuleService;

	@Mock
	LiberiaEMRDao dao;

	@Mock
	UserService userService;

	@Mock
	PasswordResetTokenDao tokenDao;

	@Mock
	EmailService emailService;

	@Mock
	AdministrationService adminService;

	@Before
	public void setupMocks() {
		MockitoAnnotations.initMocks(this);
		// Do nothing for proxy privilege calls to avoid Context NPEs
		doNothing().when(basicModuleService).addProxyPrivilege(anyString());
		doNothing().when(basicModuleService).removeProxyPrivilege(anyString());
	}

	@Test
	public void saveItem_shouldSetOwnerIfNotSet() {
		//Given
		Item item = new Item();
		item.setDescription("some description");

		when(dao.saveItem(item)).thenReturn(item);

		User user = new User();
		when(userService.getUser(1)).thenReturn(user);

		//When
		basicModuleService.saveItem(item);

		//Then
		assertThat(item, hasProperty("owner", is(user)));
	}

	/**
	 * A user is resolved from the CORE users.email column. The previous version of this test
	 * hand-built an "Email" PersonAttribute in memory, which is why it stayed green while the
	 * production lookup matched nobody — no such attribute type exists in this distribution's
	 * content. Building the user through User.setEmail keeps the test on the same field the
	 * service queries.
	 */
	private User userWithEmail(Integer userId, String email) {
		User user = new User();
		user.setUserId(userId);
		user.setUsername("jdoe");
		user.setEmail(email);
		return user;
	}

	@Test
	public void requestPasswordReset_shouldSendEmailAndGenerateTokenWhenUserFound() throws Exception {
		// Given
		String requestEmail = "test@example.com";
		User user = userWithEmail(10, requestEmail);

		when(userService.getUserByUsernameOrEmail(requestEmail)).thenReturn(user);
		when(adminService.getGlobalProperty("liberiaemr.passwordReset.tokenExpiryHours", "2")).thenReturn("2");
		when(adminService.getGlobalProperty("liberiaemr.frontend.url", "http://localhost:8080/openmrs/spa"))
		        .thenReturn("http://myfrontend.com");

		// When
		basicModuleService.requestPasswordReset(requestEmail);

		// Then
		verify(basicModuleService, atLeastOnce()).addProxyPrivilege("Get Users");

		verify(tokenDao).voidExistingTokensForUser(user.getUserId());

		ArgumentCaptor<PasswordResetToken> tokenCaptor = ArgumentCaptor.forClass(PasswordResetToken.class);
		verify(tokenDao).savePasswordResetToken(tokenCaptor.capture());

		PasswordResetToken savedToken = tokenCaptor.getValue();
		assertNotNull(savedToken);
		assertEquals(user, savedToken.getUser());
		assertFalse(savedToken.isExpiredOrVoided());

		String expectedLink = "http://myfrontend.com/login/reset-password?token=" + savedToken.getToken();
		verify(emailService).sendPasswordResetEmail(requestEmail, expectedLink);
	}

	@Test
	public void requestPasswordReset_shouldMatchEmailCaseInsensitively() throws Exception {
		User user = userWithEmail(11, "Test@Example.com");
		when(userService.getUserByUsernameOrEmail("test@example.COM")).thenReturn(user);
		when(adminService.getGlobalProperty("liberiaemr.passwordReset.tokenExpiryHours", "2")).thenReturn("2");
		// Left unstubbed on purpose: an AdministrationService with no value for the frontend URL
		// returns null here, and the link must still be built from the built-in default.

		basicModuleService.requestPasswordReset("test@example.COM");

		verify(tokenDao).savePasswordResetToken(any(PasswordResetToken.class));
		verify(emailService).sendPasswordResetEmail(anyString(), anyString());
	}

	@Test
	public void requestPasswordReset_shouldStripTrailingSlashFromFrontendUrl() throws Exception {
		String requestEmail = "test@example.com";
		when(userService.getUserByUsernameOrEmail(requestEmail)).thenReturn(userWithEmail(12, requestEmail));
		when(adminService.getGlobalProperty("liberiaemr.passwordReset.tokenExpiryHours", "2")).thenReturn("2");
		when(adminService.getGlobalProperty("liberiaemr.frontend.url", "http://localhost:8080/openmrs/spa"))
		        .thenReturn("http://myfrontend.com/");

		basicModuleService.requestPasswordReset(requestEmail);

		ArgumentCaptor<String> linkCaptor = ArgumentCaptor.forClass(String.class);
		verify(emailService).sendPasswordResetEmail(anyString(), linkCaptor.capture());
		assertTrue(linkCaptor.getValue().startsWith("http://myfrontend.com/login/reset-password?token="));
	}

	@Test
	public void requestPasswordReset_shouldFailSilentlyIfEmailNotFound() throws Exception {
		// Given
		when(userService.getUserByUsernameOrEmail("notfound@example.com")).thenReturn(null);

		// When
		basicModuleService.requestPasswordReset("notfound@example.com");

		// Then
		// Token generation and email sending should not be called
		verify(tokenDao, never()).voidExistingTokensForUser(anyInt());
		verify(tokenDao, never()).savePasswordResetToken(any());
		verify(emailService, never()).sendPasswordResetEmail(anyString(), anyString());
	}

	/**
	 * getUserByUsernameOrEmail matches EITHER column, so a caller posting a bare username gets a
	 * hit. That must not send mail or confirm the username exists.
	 */
	@Test
	public void requestPasswordReset_shouldNotMatchOnUsernameAlone() throws Exception {
		User user = userWithEmail(13, "real@example.com");
		when(userService.getUserByUsernameOrEmail("jdoe")).thenReturn(user);

		basicModuleService.requestPasswordReset("jdoe");

		verify(tokenDao, never()).savePasswordResetToken(any());
		verify(emailService, never()).sendPasswordResetEmail(anyString(), anyString());
	}

	@Test
	public void requestPasswordReset_shouldNotMatchUserWithNoEmailSet() throws Exception {
		User user = new User();
		user.setUserId(14);
		user.setUsername("jdoe");
		when(userService.getUserByUsernameOrEmail("jdoe")).thenReturn(user);

		basicModuleService.requestPasswordReset("jdoe");

		verify(tokenDao, never()).savePasswordResetToken(any());
		verify(emailService, never()).sendPasswordResetEmail(anyString(), anyString());
	}

	@Test
	public void requestPasswordReset_shouldNotMatchRetiredUser() throws Exception {
		User user = userWithEmail(15, "retired@example.com");
		user.setRetired(true);
		when(userService.getUserByUsernameOrEmail("retired@example.com")).thenReturn(user);

		basicModuleService.requestPasswordReset("retired@example.com");

		verify(tokenDao, never()).savePasswordResetToken(any());
		verify(emailService, never()).sendPasswordResetEmail(anyString(), anyString());
	}

	/**
	 * The privileges are elevated for an ANONYMOUS caller, so leaking one would leave the whole
	 * thread able to read users. The finally block must run on the not-found path too.
	 */
	@Test
	public void requestPasswordReset_shouldRemoveProxyPrivilegesWhenUserNotFound() throws Exception {
		when(userService.getUserByUsernameOrEmail(anyString())).thenReturn(null);

		basicModuleService.requestPasswordReset("notfound@example.com");

		verify(basicModuleService).removeProxyPrivilege("Get Users");
		verify(basicModuleService).removeProxyPrivilege("Get Global Properties");
	}

	@Test
	public void confirmPasswordReset_shouldChangePasswordAndVoidToken() {
		// Given
		String tokenStr = "valid-token";
		String newPassword = "NewStrongPassword123!";
		
		PasswordResetToken token = new PasswordResetToken();
		User user = new User();
		user.setUserId(99);
		token.setUser(user);
		token.setToken(tokenStr);
		
		// Set token as not expired
		java.util.Calendar cal = java.util.Calendar.getInstance();
		cal.add(java.util.Calendar.HOUR, 1);
		token.setDateExpires(cal.getTime());

		when(tokenDao.getPasswordResetToken(tokenStr)).thenReturn(token);

		// When
		basicModuleService.confirmPasswordReset(tokenStr, newPassword);

		// Then
		// Proxy privileges should be added
		verify(basicModuleService).addProxyPrivilege("Edit User Passwords");

		// Password should be changed
		verify(userService).changePassword(user, newPassword);

		// Token should be voided
		assertTrue(token.getVoided());
		verify(tokenDao).savePasswordResetToken(token);
	}

	@Test
	public void confirmPasswordReset_shouldRemoveProxyPrivilegesWhenChangePasswordFails() {
		String tokenStr = "valid-token";
		PasswordResetToken token = new PasswordResetToken();
		User user = new User();
		user.setUserId(98);
		token.setUser(user);
		token.setToken(tokenStr);
		java.util.Calendar cal = java.util.Calendar.getInstance();
		cal.add(java.util.Calendar.HOUR, 1);
		token.setDateExpires(cal.getTime());

		when(tokenDao.getPasswordResetToken(tokenStr)).thenReturn(token);
		org.mockito.Mockito.doThrow(new APIException("too short")).when(userService).changePassword(user, "short");

		try {
			basicModuleService.confirmPasswordReset(tokenStr, "short");
			org.junit.Assert.fail("expected the password policy failure to propagate");
		}
		catch (APIException expected) {
			// the point of the test is what happens next
		}

		verify(basicModuleService).removeProxyPrivilege("Edit Users");
		verify(basicModuleService).removeProxyPrivilege("Edit User Passwords");
		verify(basicModuleService).removeProxyPrivilege("Get Global Properties");

		// A failed attempt must NOT burn the token — the user has to be able to retry with a
		// compliant password using the same link.
		assertFalse(Boolean.TRUE.equals(token.getVoided()));
		verify(tokenDao, never()).savePasswordResetToken(token);
	}

	@Test(expected = APIException.class)
	public void confirmPasswordReset_shouldThrowErrorIfTokenExpired() {
		// Given
		String tokenStr = "expired-token";
		
		PasswordResetToken token = new PasswordResetToken();
		token.setToken(tokenStr);
		
		// Set token as expired (in the past)
		java.util.Calendar cal = java.util.Calendar.getInstance();
		cal.add(java.util.Calendar.HOUR, -1);
		token.setDateExpires(cal.getTime());

		when(tokenDao.getPasswordResetToken(tokenStr)).thenReturn(token);

		// When
		basicModuleService.confirmPasswordReset(tokenStr, "somepassword");
		
		// Then (Exception is expected)
	}
}
