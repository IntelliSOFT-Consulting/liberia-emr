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

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Paths;
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
		String host = resolve("LIBERIAEMR_SMTP_HOST", "liberiaemr.email.host", "localhost");
		String port = resolve("LIBERIAEMR_SMTP_PORT", "liberiaemr.email.port", "25");
		String username = resolve("LIBERIAEMR_SMTP_USER", "liberiaemr.email.username", "");
		String smtpPass = resolveSecret();
		String fromAddress = resolve("LIBERIAEMR_SMTP_FROM", "liberiaemr.email.from", "noreply@liberiaemr.org");
		
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
		
		log.info("Sending password reset email to {}", recipientEmail);
		Transport.send(message);
		log.info("Password reset email sent successfully to {}", recipientEmail);
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
	
	/**
	 * Environment first, global property second, built-in default last.
	 *
	 * The environment wins because the relay is deployment state, not content: the same image
	 * runs at every facility, and distribution/compose/facility/docker-compose.yml feeds these
	 * from the gitignored .env. A global property still works for a developer poking at a
	 * running instance.
	 *
	 * @param envVar the environment variable to prefer
	 * @param property the global property to fall back to
	 * @param defaultValue used when neither is set
	 * @return the resolved value, trimmed
	 */
	private String resolve(String envVar, String property, String defaultValue) {
		String fromEnv = System.getenv(envVar);
		if (fromEnv != null && !fromEnv.trim().isEmpty()) {
			return fromEnv.trim();
		}
		String value = Context.getAdministrationService().getGlobalProperty(property);
		return (value != null && !value.trim().isEmpty()) ? value.trim() : defaultValue;
	}
	
	/**
	 * The SMTP password, which is a CREDENTIAL and so is never read from versioned content.
	 *
	 * Order: LIBERIAEMR_SMTP_PASSWORD_FILE (a path, read verbatim — the same shape as the
	 * alert webhook's url_file, so no character in the secret is ever interpreted by a
	 * substitution tool), then LIBERIAEMR_SMTP_PASSWORD, then the global property for local
	 * development only.
	 *
	 * The global property is deliberately NOT seeded by any Initializer file. It was, with the
	 * literal YOUR_APP_PASSWORD, which made a versioned file the obvious place to "fix" a
	 * broken relay — leaking a live credential into git history the first time someone did.
	 * Initializer also reapplies its files on EVERY boot, so that seed would have overwritten a
	 * real password an administrator had set, at each restart.
	 *
	 * @return the password, or an empty string when the relay needs no authentication
	 */
	private String resolveSecret() {
		String path = System.getenv("LIBERIAEMR_SMTP_PASSWORD_FILE");
		if (path != null && !path.trim().isEmpty()) {
			return readSecretFile(path.trim());
		}
		return resolve("LIBERIAEMR_SMTP_PASSWORD", "liberiaemr.email.password", "");
	}
	
	/**
	 * Reads a secret file verbatim. Package-private so it can be tested directly: the environment
	 * variable that selects this path cannot be set from inside a JVM test.
	 *
	 * Only a trailing newline is stripped. A password may legitimately begin or end with a space,
	 * and `echo secret > file` is how these files get written.
	 *
	 * @param path the file to read
	 * @return the secret, or an empty string if the file cannot be read
	 */
	static String readSecretFile(String path) {
		try {
			byte[] raw = Files.readAllBytes(Paths.get(path));
			return new String(raw, Charset.forName("UTF-8")).replaceAll("\\r?\\n$", "");
		}
		catch (IOException e) {
			// Say so loudly rather than fall back to a weaker source silently — and never log
			// anything that was read out of the file.
			log.error("LIBERIAEMR_SMTP_PASSWORD_FILE is set to '{}' but could not be read; "
			        + "sending unauthenticated. Reason: {}", path, e.getMessage());
			return "";
		}
	}
}
