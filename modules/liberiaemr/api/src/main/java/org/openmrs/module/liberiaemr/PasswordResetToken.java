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

import java.util.Date;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.JoinColumn;
import javax.persistence.ManyToOne;
import javax.persistence.Table;

import org.openmrs.User;

/**
 * Represents a password reset token issued to a user. Tokens are single-use and expire after a
 * configurable duration (default: 2 hours).
 */
@Entity
@Table(name = "liberiaemr_password_reset_token")
public class PasswordResetToken {
	
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	@Column(name = "token_id")
	private Integer tokenId;
	
	@ManyToOne(optional = false)
	@JoinColumn(name = "user_id", nullable = false)
	private User user;
	
	@Column(name = "token", nullable = false, unique = true, length = 255)
	private String token;
	
	@Column(name = "date_created", nullable = false)
	private Date dateCreated;
	
	@Column(name = "date_expires", nullable = false)
	private Date dateExpires;
	
	@Column(name = "voided", nullable = false)
	private Boolean voided = Boolean.FALSE;
	
	public PasswordResetToken() {
	}
	
	public PasswordResetToken(User user, String token, Date dateCreated, Date dateExpires) {
		this.user = user;
		this.token = token;
		this.dateCreated = dateCreated;
		this.dateExpires = dateExpires;
		this.voided = Boolean.FALSE;
	}
	
	public Integer getTokenId() {
		return tokenId;
	}
	
	public void setTokenId(Integer tokenId) {
		this.tokenId = tokenId;
	}
	
	public User getUser() {
		return user;
	}
	
	public void setUser(User user) {
		this.user = user;
	}
	
	public String getToken() {
		return token;
	}
	
	public void setToken(String token) {
		this.token = token;
	}
	
	public Date getDateCreated() {
		return dateCreated;
	}
	
	public void setDateCreated(Date dateCreated) {
		this.dateCreated = dateCreated;
	}
	
	public Date getDateExpires() {
		return dateExpires;
	}
	
	public void setDateExpires(Date dateExpires) {
		this.dateExpires = dateExpires;
	}
	
	public Boolean getVoided() {
		return voided;
	}
	
	public void setVoided(Boolean voided) {
		this.voided = voided;
	}
	
	/**
	 * @return true if this token has expired or has been voided
	 */
	public boolean isExpiredOrVoided() {
		return Boolean.TRUE.equals(voided) || new Date().after(dateExpires);
	}
}
