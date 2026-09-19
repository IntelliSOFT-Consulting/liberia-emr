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
import org.openmrs.Person;
import org.openmrs.PersonAttribute;
import org.openmrs.User;
import org.openmrs.api.APIException;
import org.openmrs.api.AdministrationService;
import org.openmrs.api.UserService;
import org.openmrs.module.liberiaemr.api.EmailService;
import org.openmrs.module.liberiaemr.api.dao.LiberiaEMRDao;
import org.openmrs.module.liberiaemr.api.dao.PasswordResetTokenDao;
import org.openmrs.module.liberiaemr.api.impl.LiberiaEMRServiceImpl;

import java.util.Collections;

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

	@Test
	public void requestPasswordReset_shouldSendEmailAndGenerateTokenWhenUserFound() throws Exception {
		// Given
		String requestEmail = "test@example.com";
		User user = new User();
		user.setUserId(10);
		Person person = new Person();
		org.openmrs.PersonAttributeType type = new org.openmrs.PersonAttributeType();
		type.setName("Email");
		PersonAttribute emailAttr = new PersonAttribute();
		emailAttr.setAttributeType(type);
		emailAttr.setValue(requestEmail);
		person.addAttribute(emailAttr);
		user.setPerson(person);

		when(userService.getAllUsers()).thenReturn(Collections.singletonList(user));
		when(adminService.getGlobalProperty("liberiaemr.passwordReset.tokenExpiryHours", "2")).thenReturn("2");
		when(adminService.getGlobalProperty("liberiaemr.frontend.url", "http://localhost:8080/openmrs/spa")).thenReturn("http://myfrontend.com");

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
	public void requestPasswordReset_shouldFailSilentlyIfEmailNotFound() throws Exception {
		// Given
		String requestEmail = "notfound@example.com";
		User user = new User();
		Person person = new Person();
		org.openmrs.PersonAttributeType type = new org.openmrs.PersonAttributeType();
		type.setName("Email");
		PersonAttribute emailAttr = new PersonAttribute();
		emailAttr.setAttributeType(type);
		emailAttr.setValue("other@example.com");
		person.addAttribute(emailAttr);
		user.setPerson(person);

		when(userService.getAllUsers()).thenReturn(Collections.singletonList(user));

		// When
		basicModuleService.requestPasswordReset(requestEmail);

		// Then
		// Token generation and email sending should not be called
		verify(tokenDao, never()).voidExistingTokensForUser(anyInt());
		verify(tokenDao, never()).savePasswordResetToken(any());
		verify(emailService, never()).sendPasswordResetEmail(anyString(), anyString());
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
