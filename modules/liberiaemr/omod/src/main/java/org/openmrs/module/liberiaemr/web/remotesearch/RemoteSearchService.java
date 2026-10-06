/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.web.remotesearch;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.regex.Pattern;

import org.openmrs.Concept;
import org.openmrs.Location;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifierType;
import org.openmrs.PersonName;
import org.openmrs.User;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.web.central.CentralClient;
import org.openmrs.util.PrivilegeConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Searches the central OpenMRS server for patients that are not on this facility and imports a
 * chosen one as a patient shell (demographics and identifiers only). The central server comes from
 * the deployment environment ({@link CentralClient}); with none set the feature reports
 * itself as disabled.
 */
@Component("liberiaemr.RemoteSearchService")
public class RemoteSearchService {

	private static final Logger log = LoggerFactory.getLogger(RemoteSearchService.class);

	/** Global property naming the facility's location, used when a central identifier location is unknown here. */
	public static final String GP_FACILITY_LOCATION = "liberiaemr.facility.locationUuid";

	/** Minimum query length; the UI enforces the same so this only guards direct API calls. */
	public static final int MIN_QUERY_LENGTH = 2;

	private static final int MAX_RESULTS = 20;


	private static final Pattern UUID_PATTERN = Pattern
			.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

	// Only what the result rows show. The central default representation returns identifiers as
	// references, which carry no identifier value, and returns far more than a search list needs.
	private static final String SEARCH_REP = "custom:(uuid,display,identifiers:(identifier,preferred,"
			+ "identifierType:(uuid,name)),person:(uuid,display,gender,age,birthdate,birthdateEstimated,dead,"
			+ "preferredName:(givenName,middleName,familyName)))";

	/** Thrown for failures whose message is safe to show to the user. */
	public static class RemoteSearchException extends Exception {

		private static final long serialVersionUID = 1L;

		private final boolean notConfigured;

		public RemoteSearchException(String message, boolean notConfigured, Throwable cause) {
			super(message, cause);
			this.notConfigured = notConfigured;
		}

		public boolean isNotConfigured() {
			return notConfigured;
		}
	}

	/** Central matches to list, plus how many more were left out because they are already on this facility. */
	public static class SearchOutcome {

		private final List<JsonNode> results;

		private final int alreadyLocalCount;

		public SearchOutcome(List<JsonNode> results, int alreadyLocalCount) {
			this.results = results;
			this.alreadyLocalCount = alreadyLocalCount;
		}

		public List<JsonNode> getResults() {
			return results;
		}

		public int getAlreadyLocalCount() {
			return alreadyLocalCount;
		}
	}

	private final CentralClient central;

	public RemoteSearchService() {
		this(new CentralClient());
	}

	/** @param central the connection to central; tests pass one aimed at a stand-in server */
	RemoteSearchService(CentralClient central) {
		this.central = central;
	}

	/** The shared connection to central, for the remote history fetch. */
	public CentralClient getCentral() {
		return central;
	}

	public boolean isEnabled() {
		return central.isEnabled();
	}

	/** Whether this facility already holds a patient with this UUID. A seam so the search can be tested without a Context. */
	protected boolean existsLocally(String uuid) {
		return Context.getPatientService().getPatientByUuid(uuid) != null;
	}

	public boolean isValidUuid(String value) {
		return value != null && UUID_PATTERN.matcher(value.trim()).matches();
	}

	/**
	 * @return the matching central patients that are not already on this facility, and the count of
	 *         matches left out because they are; the list is empty (not an error) when nothing matches
	 * @throws RemoteSearchException when the feature is off or central cannot be reached
	 */
	public SearchOutcome searchPatients(String query) throws RemoteSearchException {
		String baseUrl = requireRemoteUrl();
		String trimmed = query == null ? "" : query.trim();
		if (trimmed.length() < MIN_QUERY_LENGTH) {
			return new SearchOutcome(Collections.<JsonNode>emptyList(), 0);
		}

		try {
			String url = baseUrl + "/ws/rest/v1/patient?q=" + URLEncoder.encode(trimmed, "UTF-8") + "&limit=" + MAX_RESULTS
					+ "&v=" + URLEncoder.encode(SEARCH_REP, "UTF-8");
			JsonNode results = central.executeGet(url).path("results");

			List<JsonNode> remaining = new ArrayList<>();
			int alreadyLocal = 0;
			if (results.isArray()) {
				for (JsonNode result : results) {
					// A patient that syncs between sites shares one UUID; if it is already here the
					// local search shows it, and listing it again would only be a duplicate row.
					String uuid = result.path("uuid").asText("");
					if (isValidUuid(uuid) && existsLocally(uuid)) {
						alreadyLocal++;
						continue;
					}
					remaining.add(result);
				}
			}
			return new SearchOutcome(remaining, alreadyLocal);
		}
		catch (Exception e) {
			log.error("Error searching remote patients", e);
			throw new RemoteSearchException("Failed to contact central server", false, e);
		}
	}

	/** The local patient an import resolved to, and whether this import created it. */
	public static class ImportOutcome {

		private final String localUuid;

		private final boolean created;

		public ImportOutcome(String localUuid, boolean created) {
			this.localUuid = localUuid;
			this.created = created;
		}

		public String getLocalUuid() {
			return localUuid;
		}

		public boolean isCreated() {
			return created;
		}
	}

	/**
	 * Brings a central patient to this facility as a <em>patient shell</em>: person, patient, names,
	 * addresses and identifiers, each keeping central's UUID and preferred flag (design: remote import
	 * sync isolation, Architecture §1). Nothing clinical is copied; the history is served by central and
	 * cached outside the synced tables. Every call to central is a GET ({@link CentralClient}), so nothing
	 * there is changed.
	 * <p>
	 * Safe to repeat: when the shell already exists, the rows it lacks are added and nothing is
	 * duplicated. The shell is written by one {@code savePatient}, which saves names, addresses and
	 * identifiers with it, so a failure leaves nothing half-created.
	 *
	 * @throws RemoteSearchException when the feature is off, central cannot be reached, or the
	 *             patient cannot be saved here
	 */
	public ImportOutcome importPatient(String remoteUuid) throws RemoteSearchException {
		String baseUrl = requireRemoteUrl();
		if (!isValidUuid(remoteUuid)) {
			throw new IllegalArgumentException("remoteUuid must be a UUID");
		}
		String uuid = remoteUuid.trim();

		try {
			Patient existing = Context.getPatientService().getPatientByUuid(uuid);
			JsonNode remotePatient;
			try {
				remotePatient = central.executeGet(baseUrl + "/ws/rest/v1/patient/" + uuid + "?v=full");
			}
			catch (Exception e) {
				if (existing != null) {
					// Already here: open it; the missing rows can be added on a later import.
					log.warn("Central unreachable while re-importing patient {}; opening the local shell", uuid);
					return new ImportOutcome(existing.getUuid(), false);
				}
				throw e;
			}

			PatientShellBuilder builder = new PatientShellBuilder(lookups());
			if (existing != null) {
				if (builder.reconcile(existing, remotePatient)) {
					Context.getPatientService().savePatient(existing);
					log.info("Added missing central rows to patient shell {}", uuid);
				}
				return new ImportOutcome(existing.getUuid(), false);
			}

			// The same person can already be here under a different UUID (registered locally, or
			// imported from another route). Open that record rather than creating a second one.
			// An identifier alone is not proof: OpenMRS ID is generated from the same sequence at every
			// facility, so two unrelated patients can share one. Demographics must agree too.
			Patient duplicate = findLocalByIdentifier(remotePatient.path("identifiers"), remotePatient.path("person"));
			if (duplicate != null) {
				log.info("Remote patient {} matches local patient {} by identifier and demographics", uuid,
				    duplicate.getUuid());
				return new ImportOutcome(duplicate.getUuid(), false);
			}

			Patient shell = builder.build(remotePatient);
			if (shell.getIdentifiers().isEmpty()) {
				throw new IllegalStateException("None of the central identifiers could be mapped to a local identifier type");
			}
			Context.getPatientService().savePatient(shell);
			log.info("Imported patient shell {}", uuid);
			return new ImportOutcome(shell.getUuid(), true);
		}
		catch (RemoteSearchException e) {
			throw e;
		}
		catch (Exception e) {
			log.error("Error importing remote patient " + uuid, e);
			throw new RemoteSearchException("Failed to import patient from central server", false, e);
		}
	}

	/** The OpenMRS-backed lookups the shell builder uses. */
	private PatientShellBuilder.Lookups lookups() {
		return new PatientShellBuilder.Lookups() {

			@Override
			public PatientIdentifierType identifierType(String typeUuid) {
				return Context.getPatientService().getPatientIdentifierTypeByUuid(typeUuid);
			}

			@Override
			public Location location(String locationUuid) {
				return Context.getLocationService().getLocationByUuid(locationUuid);
			}

			@Override
			public Location placeholderLocation(String locationUuid, String name) {
				return createPlaceholderLocation(locationUuid, name);
			}

			@Override
			public User user(String userUuid) {
				// Users are looked up only to copy central's audit fields, which a Records Officer
				// importing a patient has no privilege to read.
				Context.addProxyPrivilege(PrivilegeConstants.GET_USERS);
				try {
					return Context.getUserService().getUserByUuid(userUuid);
				}
				finally {
					Context.removeProxyPrivilege(PrivilegeConstants.GET_USERS);
				}
			}

			@Override
			public Concept concept(String conceptUuid) {
				return Context.getConceptService().getConceptByUuid(conceptUuid);
			}

			@Override
			public boolean heldByAnotherPatient(PatientIdentifierType type, String value, String patientUuid) {
				for (Patient holder : Context.getPatientService().getPatients(null, value, Collections.singletonList(type),
				    true)) {
					if (!holder.getUuid().equals(patientUuid)) {
						return true;
					}
				}
				return false;
			}
		};
	}

	/**
	 * Central's identifier location, created here retired with central's UUID, as dbsync's receiver
	 * does for a location it lacks. Being retired keeps it out of every location picker. Location
	 * rows are not in {@code eip.watchedTables}, so it stays at this facility. Saved on its own: an
	 * import that fails afterwards leaves it for the next attempt to reuse.
	 *
	 * @return the saved location, or null when it cannot be saved (an active local location with the
	 *         same name, for one)
	 */
	private Location createPlaceholderLocation(String locationUuid, String name) {
		Location location = new Location();
		location.setUuid(locationUuid);
		location.setName(name == null || name.trim().isEmpty() ? locationUuid : name.trim());
		location.setDescription("Central location of an imported patient's identifier");
		location.setRetired(true);
		location.setRetireReason("Imported from central for a patient identifier; not a location of this facility");
		Context.addProxyPrivilege(PrivilegeConstants.MANAGE_LOCATIONS);
		Context.addProxyPrivilege(PrivilegeConstants.GET_LOCATIONS);
		try {
			Location saved = Context.getLocationService().saveLocation(location);
			log.info("Brought central location {} ({}) here, retired, for an imported identifier", locationUuid,
			    saved.getName());
			return saved;
		}
		catch (Exception e) {
			log.warn("Could not bring central location " + locationUuid + " here", e);
			return null;
		}
		finally {
			Context.removeProxyPrivilege(PrivilegeConstants.GET_LOCATIONS);
			Context.removeProxyPrivilege(PrivilegeConstants.MANAGE_LOCATIONS);
		}
	}

	private Patient findLocalByIdentifier(JsonNode identifiersNode, JsonNode remotePerson) {
		if (!identifiersNode.isArray()) {
			return null;
		}
		for (JsonNode idNode : identifiersNode) {
			String value = idNode.path("identifier").asText("");
			PatientIdentifierType type = Context.getPatientService()
					.getPatientIdentifierTypeByUuid(idNode.path("identifierType").path("uuid").asText(""));
			if (value.isEmpty() || type == null) {
				continue;
			}
			for (Patient match : Context.getPatientService().getPatients(null, value, Collections.singletonList(type),
					true)) {
				if (samePerson(match, remotePerson)) {
					return match;
				}
				log.warn("Central identifier {} is also held by local patient {}, whose details differ; not treating "
						+ "them as the same person", value, match.getUuid());
			}
		}
		return null;
	}

	/**
	 * Whether a local patient with a shared identifier is plausibly the central patient: same gender,
	 * same birthdate, and a family name in common (ignoring case). Anything less is a different person.
	 */
	boolean samePerson(Patient local, JsonNode remotePerson) {
		String gender = remotePerson.path("gender").asText("");
		if (gender.isEmpty() || local.getGender() == null || !gender.equalsIgnoreCase(local.getGender())) {
			return false;
		}

		Date remoteBirthdate = PatientShellBuilder.parseDateOrNull(remotePerson.path("birthdate"));
		if (remoteBirthdate == null || local.getBirthdate() == null) {
			return false;
		}
		SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd");
		if (!day.format(remoteBirthdate).equals(day.format(local.getBirthdate()))) {
			return false;
		}

		JsonNode names = remotePerson.path("names");
		if (!names.isArray()) {
			return false;
		}
		for (JsonNode name : names) {
			String family = name.path("familyName").asText("").trim();
			if (family.isEmpty() || name.path("voided").asBoolean(false)) {
				continue;
			}
			for (PersonName localName : local.getNames()) {
				if (!localName.getVoided() && family.equalsIgnoreCase(
						localName.getFamilyName() == null ? "" : localName.getFamilyName().trim())) {
					return true;
				}
			}
		}
		return false;
	}

	private String requireRemoteUrl() throws RemoteSearchException {
		String baseUrl = central.getCentralUrl();
		if (baseUrl.isEmpty()) {
			throw new RemoteSearchException("Remote search is not configured", true, null);
		}
		return baseUrl;
	}
}
