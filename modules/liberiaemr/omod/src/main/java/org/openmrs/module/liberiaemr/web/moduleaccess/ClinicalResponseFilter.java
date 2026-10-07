/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.moduleaccess;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletOutputStream;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.WriteListener;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpServletResponseWrapper;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.Encounter;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessGuard;
import org.openmrs.module.liberiaemr.moduleaccess.ModulePrivileges;
import org.openmrs.util.PrivilegeConstants;

/**
 * Visit representations, records nested in an encounter, and FHIR reads do not enter the encounter,
 * observation, or order service advice. This filter applies that same decision to those paths, and
 * only for a matrix role.
 * Triage and Vitals stay because their ownership is excluded. Other URLs are not read.
 */
public class ClinicalResponseFilter implements Filter {
	private static final Log log = LogFactory.getLog(ClinicalResponseFilter.class);
	/** The encounter resource and its subresources, not encountertype or encounterrole. */
	private static final Pattern ENCOUNTER = Pattern.compile("/ws/rest/v1/encounter(/|$)");
	private final ModuleAccessGuard guard = new ModuleAccessGuard();

	@Override
	public void init(FilterConfig filterConfig) { }

	@Override
	public void destroy() { }

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) throws IOException, ServletException {
		HttpServletRequest http = (HttpServletRequest) request;
		boolean clinical = interesting(http.getRequestURI());
		if (clinical) { ModuleAccessGuard.holdReads(); }
		try {
		if (!clinical) {
			chain.doFilter(request, response);
			return;
		}
		Buffer buffer = new Buffer((HttpServletResponse) response);
		chain.doFilter(request, buffer);
		byte[] body = buffer.bytes();
		if (!matrix()) {
			write((HttpServletResponse) response, body);
			return;
		}
		boolean compressed = isGzip(body);
		byte[] plain = compressed ? gunzip(body) : body;
		byte[] filtered = authorize(plain);
		write((HttpServletResponse) response, compressed ? gzip(filtered) : filtered);
		}
		finally {
			if (clinical) { ModuleAccessGuard.releaseHeld(); }
		}
	}

	/**
	 * Visit embeds encounters directly. An encounter embeds observations and orders that the service
	 * guard does not decide one by one. FHIR DAOs query Hibernate and skip the service guard.
	 */
	static boolean interesting(String uri) {
		if (uri == null) { return false; }
		return uri.contains("/ws/fhir2/") || uri.contains("/ws/rest/v1/visit") || ENCOUNTER.matcher(uri).find();
	}

	private byte[] authorize(byte[] plain) {
		boolean opened = false;
		try {
			if (!Context.isSessionOpen()) {
				Context.openSession();
				opened = true;
			}
			return ClinicalJson.filter(plain, this::keep);
		}
		catch (RuntimeException e) {
			log.warn("Clinical response filter failed closed", e);
			return ClinicalJson.filter(plain, (kind, uuid, formUuid, typeUuid) -> false);
		}
		finally {
			if (opened) {
				try { Context.closeSession(); }
				catch (RuntimeException ignored) { }
			}
		}
	}

	private boolean matrix() {
		boolean opened = false;
		try {
			if (!Context.isSessionOpen()) {
				Context.openSession();
				opened = true;
			}
			return ModulePrivileges.matrixRole();
		}
		catch (RuntimeException e) {
			// Unknown caller: filter, so a protected payload is not returned unread.
			return true;
		}
		finally {
			if (opened) {
				try { Context.closeSession(); }
				catch (RuntimeException ignored) { }
			}
		}
	}

	private boolean keep(String kind, String uuid, String formUuid, String typeUuid) {
		try {
			boolean hadEncounters = ModulePrivileges.own(PrivilegeConstants.GET_ENCOUNTERS);
			boolean hadObservations = ModulePrivileges.own(PrivilegeConstants.GET_OBS);
			boolean hadOrders = ModulePrivileges.own(PrivilegeConstants.GET_ORDERS);
			if ("encounter".equals(kind) || "Encounter".equals(kind)) {
				if (formUuid != null || typeUuid != null) {
					Encounter probe = new Encounter();
					if (formUuid != null) {
						org.openmrs.Form form = new org.openmrs.Form();
						form.setUuid(formUuid);
						probe.setForm(form);
					}
					if (typeUuid != null) {
						org.openmrs.EncounterType type = new org.openmrs.EncounterType();
						type.setUuid(typeUuid);
						probe.setEncounterType(type);
					}
					return guard.keepEncounter(probe, ModulePrivileges.current(), hadEncounters);
				}
				Encounter encounter = uuid == null ? null : Context.getEncounterService().getEncounterByUuid(uuid);
				return encounter != null && guard.keepEncounter(encounter, ModulePrivileges.current(), hadEncounters);
			}
			if ("obs".equals(kind) || "Observation".equals(kind) || "Immunization".equals(kind)) {
				if ("Immunization".equals(kind)) {
					Encounter encounter = uuid == null ? null : Context.getEncounterService().getEncounterByUuid(uuid);
					if (encounter != null) {
						return guard.keepEncounter(encounter, ModulePrivileges.current(), hadEncounters);
					}
				}
				Obs obs = uuid == null ? null : Context.getObsService().getObsByUuid(uuid);
				return obs != null && guard.keepObservation(obs, ModulePrivileges.current(), hadObservations);
			}
			if ("order".equals(kind) || "MedicationRequest".equals(kind) || "ServiceRequest".equals(kind)) {
				Order order = uuid == null ? null : Context.getOrderService().getOrderByUuid(uuid);
				return order != null && guard.keepOrder(order, ModulePrivileges.current(), hadOrders);
			}
			if ("MedicationDispense".equals(kind)) {
				return org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.PHARMACY
				        .allows(ModulePrivileges.current(), org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access.READ);
			}
		}
		catch (RuntimeException e) {
			return false;
		}
		return true;
	}

	private static void write(HttpServletResponse response, byte[] body) throws IOException {
		response.setContentLength(body.length);
		response.getOutputStream().write(body);
	}

	private static boolean isGzip(byte[] body) {
		return body != null && body.length > 2 && (body[0] & 0xff) == 0x1f && (body[1] & 0xff) == 0x8b;
	}

	private static byte[] gunzip(byte[] body) {
		try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(body));
		        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
			byte[] chunk = new byte[4096];
			int read;
			while ((read = in.read(chunk)) >= 0) { out.write(chunk, 0, read); }
			return out.toByteArray();
		}
		catch (IOException e) {
			return "{\"results\":[]}".getBytes(StandardCharsets.UTF_8);
		}
	}

	private static byte[] gzip(byte[] body) {
		try (ByteArrayOutputStream out = new ByteArrayOutputStream(); GZIPOutputStream zip = new GZIPOutputStream(out)) {
			zip.write(body);
			zip.finish();
			return out.toByteArray();
		}
		catch (IOException e) {
			return body;
		}
	}

	private static final class Buffer extends HttpServletResponseWrapper {
		private final ByteArrayOutputStream body = new ByteArrayOutputStream();
		private PrintWriter writer;

		Buffer(HttpServletResponse response) { super(response); }

		@Override
		public ServletOutputStream getOutputStream() {
			return new ServletOutputStream() {
				@Override
				public void write(int b) { body.write(b); }
				public boolean isReady() { return true; }
				public void setWriteListener(WriteListener writeListener) { }
			};
		}

		@Override
		public PrintWriter getWriter() {
			if (writer == null) { writer = new PrintWriter(new OutputStreamWriter(body, StandardCharsets.UTF_8), false); }
			return writer;
		}

		@Override
		public void flushBuffer() { }

		@Override
		public void setContentLength(int len) { }

		public void setContentLengthLong(long len) { }

		byte[] bytes() {
			if (writer != null) { writer.flush(); }
			return body.toByteArray();
		}
	}
}
