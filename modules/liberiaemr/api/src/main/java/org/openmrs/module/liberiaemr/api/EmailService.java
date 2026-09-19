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

import java.util.Properties;

import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

import org.openmrs.api.context.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Service responsible for sending emails via SMTP. Configuration is read from OpenMRS Global
 * Properties so it can be changed at runtime without redeploying.
 */
@Component("liberiaemr.EmailService")
public class EmailService {
	
	private static final Logger log = LoggerFactory.getLogger(EmailService.class);
	
	/**
	 * Sends a password reset email to the given recipient.
	 * 
	 * @param recipientEmail the email address of the recipient
	 * @param resetLink the full URL the user should click to reset their password
	 * @throws MessagingException if the email cannot be sent
	 */
	public void sendPasswordResetEmail(String recipientEmail, String resetLink) throws MessagingException {
		String host = getGlobalProperty("liberiaemr.email.host", "smtp.gmail.com");
		String port = getGlobalProperty("liberiaemr.email.port", "587");
		String username = getGlobalProperty("liberiaemr.email.username", "");
		String smtpPass = getGlobalProperty("liberiaemr.email.password", "");
		String fromAddress = getGlobalProperty("liberiaemr.email.from", "noreply@liberiaemr.org");
		
		Properties props = new Properties();
		props.put("mail.smtp.host", host);
		props.put("mail.smtp.port", port);
		
		// Enable authentication only if credentials are provided
		if (!username.isEmpty() && !smtpPass.isEmpty()) {
			props.put("mail.smtp.auth", "true");
			// Use STARTTLS for ports 587, SSL for 465
			if ("587".equals(port)) {
				props.put("mail.smtp.starttls.enable", "true");
			} else if ("465".equals(port)) {
				props.put("mail.smtp.ssl.enable", "true");
			}
		}
		
		Session session;
		if (!username.isEmpty() && !smtpPass.isEmpty()) {
			final String user = username;
			final String pass = smtpPass;
			session = Session.getInstance(props, new javax.mail.Authenticator() {
				
				@Override
				protected javax.mail.PasswordAuthentication getPasswordAuthentication() {
					return new javax.mail.PasswordAuthentication(user, pass);
				}
			});
		} else {
			session = Session.getInstance(props);
		}
		
		MimeMessage message = new MimeMessage(session);
		message.setFrom(new InternetAddress(fromAddress));
		message.setRecipient(Message.RecipientType.TO, new InternetAddress(recipientEmail));
		message.setSubject("LiberiaEMR - Password Reset Request");
		
		String htmlBody = buildEmailBody(resetLink);
		message.setContent(htmlBody, "text/html; charset=utf-8");
		
		log.warn("Sending password reset email to {}", recipientEmail);
		Transport.send(message);
		log.warn("Password reset email sent successfully to {}", recipientEmail);
	}
	
	/**
	 * Builds a simple, professional HTML email body for the password reset.
	 */
	private String buildEmailBody(String resetLink) {
		return "<!DOCTYPE html>" + "<html><body style='font-family: Arial, sans-serif; color: #333;'>"
		        + "<div style='max-width: 600px; margin: 0 auto; padding: 20px;'>"
		        + "<h2 style='color: #0F62FE;'>LiberiaEMR Password Reset</h2>"
		        + "<p>You have requested to reset your password. Click the button below to set a new password:</p>"
		        + "<p style='text-align: center; margin: 30px 0;'>" + "<a href='" + resetLink + "' style='"
		        + "background-color: #0F62FE; color: white; padding: 12px 24px; "
		        + "text-decoration: none; border-radius: 4px; font-size: 16px;'" + ">Reset Password</a></p>"
		        + "<p>If the button doesn't work, copy and paste the following link into your browser:</p>"
		        + "<p style='word-break: break-all; color: #0F62FE;'>" + resetLink + "</p>"
		        + "<p style='margin-top: 30px; color: #888; font-size: 12px;'>"
		        + "This link will expire in 2 hours. If you did not request a password reset, "
		        + "please ignore this email.</p>" + "</div></body></html>";
	}
	
	private String getGlobalProperty(String property, String defaultValue) {
		String value = Context.getAdministrationService().getGlobalProperty(property);
		return (value != null && !value.trim().isEmpty()) ? value.trim() : defaultValue;
	}
}
