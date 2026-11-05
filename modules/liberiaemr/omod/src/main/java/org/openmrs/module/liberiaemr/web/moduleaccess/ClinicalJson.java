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

import java.nio.charset.StandardCharsets;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Removes encounter, observation, and order objects from visit and FHIR JSON. A keeper failure
 * drops that node. A document that cannot be safely parsed or filtered is emptied.
 */
public final class ClinicalJson {

	public interface Keeper {

		boolean keep(String kind, String uuid, String formUuid, String typeUuid);
	}

	private static final Log log = LogFactory.getLog(ClinicalJson.class);

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private ClinicalJson() {
	}

	public static byte[] filter(byte[] body, Keeper keeper) {
		if (body == null || body.length == 0 || keeper == null) {
			return body;
		}
		try {
			JsonNode root = MAPPER.readTree(body);
			JsonNode filtered = walk(root, null, keeper);
			return MAPPER.writeValueAsBytes(filtered == null ? MAPPER.createObjectNode() : filtered);
		}
		catch (Exception e) {
			log.warn("Clinical JSON filter failed closed", e);
			return empty(body);
		}
	}

	public static String filter(String body, Keeper keeper) {
		return new String(filter(body == null ? null : body.getBytes(StandardCharsets.UTF_8), keeper),
		        StandardCharsets.UTF_8);
	}

	private static JsonNode walk(JsonNode node, String field, Keeper keeper) {
		if (node == null || node.isNull()) { return node; }
		if (node.isArray()) {
			ArrayNode copy = MAPPER.createArrayNode();
			for (JsonNode child : node) {
				JsonNode walked = walk(child, field, keeper);
				if (walked != null) { copy.add(walked); }
			}
			return copy;
		}
		if (!node.isObject()) { return node; }
		if (drop((ObjectNode) node, field, keeper)) { return null; }
		ObjectNode copy = MAPPER.createObjectNode();
		node.fields().forEachRemaining(entry -> {
			JsonNode walked = walk(entry.getValue(), entry.getKey(), keeper);
			if (walked != null) { copy.set(entry.getKey(), walked); }
		});
		return copy;
	}

	private static boolean drop(ObjectNode node, String field, Keeper keeper) {
		String uuid = text(node, "uuid");
		String form = text(node.get("form"), "uuid");
		String type = text(node.get("encounterType"), "uuid");
		if (type == null) {
			type = text(node.get("orderType"), "uuid");
		}
		try {
			if (node.has("encounterType") || (node.has("form") && node.has("obs")) || "encounters".equals(field)) {
				return !keeper.keep("encounter", uuid, form, type);
			}
			// Nested records are decided on their own. A custom representation can leave out uuid, so a
			// nested record without one cannot be decided and is dropped.
			if ("obs".equals(field) || "groupMembers".equals(field)) {
				return uuid == null || !keeper.keep("obs", uuid, form, type);
			}
			if ("orders".equals(field) || "order".equals(field)) {
				return uuid == null || !keeper.keep("order", uuid, form, type);
			}
			if ("entry".equals(field) && node.has("resource")) {
				return false;
			}
			if (node.has("resourceType")) {
				String resource = text(node, "resourceType");
				if ("Encounter".equals(resource) || "Observation".equals(resource) || "MedicationRequest".equals(resource)
				        || "MedicationDispense".equals(resource) || "ServiceRequest".equals(resource)
				        || "Immunization".equals(resource)) {
					return !keeper.keep(resource, text(node, "id"), null, null);
				}
			}
		}
		catch (RuntimeException e) {
			return true;
		}
		return false;
	}

	static boolean looksClinical(byte[] body) {
		String text = new String(body, StandardCharsets.UTF_8);
		return text.contains("encounterType") || text.contains("\"MedicationRequest\"")
		        || text.contains("\"ServiceRequest\"") || text.contains("\"MedicationDispense\"")
		        || text.contains("\"Observation\"") || text.contains("\"Immunization\"") || text.contains("\"Encounter\"");
	}

	private static byte[] empty(byte[] body) {
		String text = new String(body, StandardCharsets.UTF_8);
		String empty = text.contains("\"Bundle\"") ? "{\"resourceType\":\"Bundle\",\"entry\":[]}" : "{\"results\":[]}";
		return empty.getBytes(StandardCharsets.UTF_8);
	}

	private static String text(JsonNode node, String field) {
		if (node == null || !node.has(field) || node.get(field).isNull()) {
			return null;
		}
		String value = node.get(field).asText();
		return value == null || value.isEmpty() ? null : value;
	}
}
