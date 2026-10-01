package org.openmrs.module.liberiaemr.web.remotesearch;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.openmrs.Concept;
import org.openmrs.ConceptDatatype;
import org.openmrs.Encounter;
import org.openmrs.EncounterRole;
import org.openmrs.EncounterType;
import org.openmrs.Location;
import org.openmrs.Obs;
import org.openmrs.Patient;
import org.openmrs.PatientIdentifier;
import org.openmrs.PatientIdentifierType;
import org.openmrs.PersonAddress;
import org.openmrs.PersonName;
import org.openmrs.Provider;
import org.openmrs.Visit;
import org.openmrs.VisitType;
import org.openmrs.api.context.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Searches the central OpenMRS server for patients that are not on this facility and imports
 * a chosen one. Mirrors the SyncStatusService pattern: the server is configured by environment
 * variables, with global properties as a fallback, and the feature reports itself as disabled
 * when no URL is set.
 */
@Component("liberiaemr.RemoteSearchService")
public class RemoteSearchService {

	private static final Logger log = LoggerFactory.getLogger(RemoteSearchService.class);

	public static final String ENV_REMOTE_URL = "LIBERIAEMR_REMOTE_URL";
	public static final String ENV_REMOTE_USER = "LIBERIAEMR_REMOTE_USER";
	public static final String ENV_REMOTE_PASSWORD = "LIBERIAEMR_REMOTE_PASSWORD";

	public static final String GP_REMOTE_URL = "liberiaemr.remoteSearch.url";
	public static final String GP_REMOTE_USER = "liberiaemr.remoteSearch.user";
	public static final String GP_REMOTE_PASSWORD = "liberiaemr.remoteSearch.password";

	/** Global property naming the facility's location, used when a central identifier location is unknown here. */
	public static final String GP_FACILITY_LOCATION = "liberiaemr.facility.locationUuid";

	/** Minimum query length; the UI enforces the same so this only guards direct API calls. */
	public static final int MIN_QUERY_LENGTH = 2;

	private static final int TIMEOUT_MS = 10000;
	private static final int MAX_RESULTS = 20;
	private static final int PAGE_SIZE = 100;
	private static final int MAX_PAGES = 100;

	/** OpenMRS core's built-in "Unknown" encounter role, used when central's role is not defined here. */
	private static final String UNKNOWN_ENCOUNTER_ROLE_UUID = "a0b03050-c99b-11e0-9572-0800200c9a66";

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

	private final ObjectMapper mapper = new ObjectMapper();

	public boolean isEnabled() {
		return !getRemoteUrl().isEmpty();
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
			JsonNode results = executeGet(url).path("results");

			List<JsonNode> remaining = new ArrayList<>();
			int alreadyLocal = 0;
			if (results.isArray()) {
				for (JsonNode result : results) {
					// A patient that syncs between sites shares one UUID; if it is already here the
					// local search shows it, and listing it again would only be a duplicate row.
					String uuid = result.path("uuid").asText("");
					if (isValidUuid(uuid) && Context.getPatientService().getPatientByUuid(uuid) != null) {
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

	/**
	 * Copies a central patient, with their visits, encounters and observations, to this facility, or
	 * returns the local patient it already matches. This is strictly a copy: every call to central is
	 * a GET ({@link #executeGet}), so nothing on the central server is changed, voided or deleted.
	 * Clinical records that cannot be mapped to local metadata are skipped and logged rather than
	 * failing the whole import.
	 *
	 * @return the local patient's UUID
	 * @throws RemoteSearchException when the feature is off, central cannot be reached, or the
	 *             patient cannot be saved here
	 */
	public String importPatient(String remoteUuid) throws RemoteSearchException {
		String baseUrl = requireRemoteUrl();
		if (!isValidUuid(remoteUuid)) {
			throw new IllegalArgumentException("remoteUuid must be a UUID");
		}
		String uuid = remoteUuid.trim();

		try {
			Patient existing = Context.getPatientService().getPatientByUuid(uuid);
			if (existing != null) {
				return existing.getUuid();
			}

			JsonNode remotePatient = executeGet(baseUrl + "/ws/rest/v1/patient/" + uuid + "?v=full");

			// The same person can already be here under a different UUID (registered locally, or
			// imported from another route). Open that record rather than creating a second one.
			Patient duplicate = findLocalByIdentifier(remotePatient.path("identifiers"));
			if (duplicate != null) {
				log.info("Remote patient {} matches local patient {} by identifier", uuid, duplicate.getUuid());
				return duplicate.getUuid();
			}

			Patient p = new Patient();
			p.setUuid(remotePatient.path("uuid").asText(uuid));
			applyPerson(p, remotePatient.path("person"));
			applyIdentifiers(p, remotePatient.path("identifiers"));

			if (p.getIdentifiers().isEmpty()) {
				throw new IllegalStateException("None of the central identifiers could be mapped to a local identifier type");
			}

			Context.getPatientService().savePatient(p);
			log.info("Imported remote patient {}", uuid);

			// The patient is already saved, so a failure in the clinical history must not undo or hide it.
			try {
				importClinicalData(baseUrl, p);
			}
			catch (Exception e) {
				log.error("Imported patient " + uuid + " but could not import their clinical history", e);
			}
			return p.getUuid();
		}
		catch (RemoteSearchException e) {
			throw e;
		}
		catch (Exception e) {
			log.error("Error importing remote patient " + uuid, e);
			throw new RemoteSearchException("Failed to import patient from central server", false, e);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Clinical history (visits, encounters, observations)
	// ---------------------------------------------------------------------------------------------

	/** Dates as OpenMRS REST returns them ("1990-01-01T00:00:00.000+0000"), or a bare date. */
	private Date parseDate(String value) throws Exception {
		try {
			return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ").parse(value);
		}
		catch (Exception e) {
			return new SimpleDateFormat("yyyy-MM-dd").parse(value.substring(0, Math.min(10, value.length())));
		}
	}

	private Date parseDateOrNull(JsonNode node) {
		String value = node.asText("");
		if (value.isEmpty()) {
			return null;
		}
		try {
			return parseDate(value);
		}
		catch (Exception e) {
			log.warn("Could not read central date '{}'", value);
			return null;
		}
	}

	/** Reads every page of a central list endpoint (read-only). */
	private List<JsonNode> fetchAll(String url) throws Exception {
		List<JsonNode> all = new ArrayList<>();
		String separator = url.contains("?") ? "&" : "?";
		for (int page = 0; page < MAX_PAGES; page++) {
			JsonNode results = executeGet(url + separator + "limit=" + PAGE_SIZE + "&startIndex=" + (page * PAGE_SIZE))
					.path("results");
			if (!results.isArray()) {
				break;
			}
			for (JsonNode result : results) {
				all.add(result);
			}
			if (results.size() < PAGE_SIZE) {
				break;
			}
		}
		return all;
	}

	/**
	 * Recreates the patient's visits, encounters and observations. Each record is saved on its own and
	 * a failure only skips that record, so one unmappable encounter does not lose the rest of the chart.
	 */
	private void importClinicalData(String baseUrl, Patient patient) throws Exception {
		String rep = "v=full&patient=" + patient.getUuid();
		Location fallbackLocation = getFallbackLocation();

		Map<String, Visit> visitsByRemoteUuid = new HashMap<>();
		int visitsSaved = 0;
		for (JsonNode node : fetchAll(baseUrl + "/ws/rest/v1/visit?" + rep)) {
			if (node.path("voided").asBoolean(false)) {
				continue;
			}
			String remoteUuid = node.path("uuid").asText("");
			try {
				Visit visit = Context.getVisitService().getVisitByUuid(remoteUuid);
				if (visit == null) {
					visit = buildVisit(patient, node, fallbackLocation);
					if (visit == null) {
						continue;
					}
					visit = Context.getVisitService().saveVisit(visit);
					visitsSaved++;
				}
				visitsByRemoteUuid.put(remoteUuid, visit);
			}
			catch (Exception e) {
				log.warn("Skipping central visit " + remoteUuid, e);
			}
		}

		int encountersSaved = 0;
		for (JsonNode node : fetchAll(baseUrl + "/ws/rest/v1/encounter?" + rep)) {
			if (node.path("voided").asBoolean(false)) {
				continue;
			}
			String remoteUuid = node.path("uuid").asText("");
			try {
				if (Context.getEncounterService().getEncounterByUuid(remoteUuid) != null) {
					continue;
				}
				Encounter encounter = buildEncounter(baseUrl, patient, node, visitsByRemoteUuid, fallbackLocation);
				if (encounter == null) {
					continue;
				}
				Context.getEncounterService().saveEncounter(encounter);
				encountersSaved++;
			}
			catch (Exception e) {
				log.warn("Skipping central encounter " + remoteUuid, e);
			}
		}
		log.info("Imported {} visits and {} encounters for patient {}", visitsSaved, encountersSaved, patient.getUuid());
	}

	private Location mapLocation(JsonNode locationNode, Location fallback) {
		String uuid = locationNode.path("uuid").asText("");
		Location location = uuid.isEmpty() ? null : Context.getLocationService().getLocationByUuid(uuid);
		return location != null ? location : fallback;
	}

	private Visit buildVisit(Patient patient, JsonNode node, Location fallbackLocation) {
		VisitType type = mapVisitType(node.path("visitType"));
		Date start = parseDateOrNull(node.path("startDatetime"));
		if (type == null || start == null) {
			log.warn("Skipping central visit {}: no local visit type or start date", node.path("uuid").asText());
			return null;
		}
		Visit visit = new Visit();
		visit.setUuid(node.path("uuid").asText());
		visit.setPatient(patient);
		visit.setVisitType(type);
		visit.setStartDatetime(start);
		visit.setStopDatetime(parseDateOrNull(node.path("stopDatetime")));
		visit.setLocation(mapLocation(node.path("location"), fallbackLocation));
		return visit;
	}

	private VisitType mapVisitType(JsonNode typeNode) {
		String uuid = typeNode.path("uuid").asText("");
		VisitType type = uuid.isEmpty() ? null : Context.getVisitService().getVisitTypeByUuid(uuid);
		if (type == null) {
			String name = typeNode.path("display").asText(typeNode.path("name").asText(""));
			if (!name.isEmpty()) {
				List<VisitType> byName = Context.getVisitService().getVisitTypes(name);
				type = byName.isEmpty() ? null : byName.get(0);
			}
		}
		if (type == null) {
			// A visit is still worth keeping under some type; the first local one beats losing it.
			List<VisitType> all = Context.getVisitService().getAllVisitTypes();
			type = all.isEmpty() ? null : all.get(0);
		}
		return type;
	}

	private EncounterType mapEncounterType(JsonNode typeNode) {
		String uuid = typeNode.path("uuid").asText("");
		EncounterType type = uuid.isEmpty() ? null : Context.getEncounterService().getEncounterTypeByUuid(uuid);
		if (type == null) {
			String name = typeNode.path("display").asText(typeNode.path("name").asText(""));
			if (!name.isEmpty()) {
				type = Context.getEncounterService().getEncounterType(name);
			}
		}
		return type;
	}

	private Encounter buildEncounter(String baseUrl, Patient patient, JsonNode node, Map<String, Visit> visits,
			Location fallbackLocation) throws Exception {
		EncounterType type = mapEncounterType(node.path("encounterType"));
		Date when = parseDateOrNull(node.path("encounterDatetime"));
		if (type == null || when == null) {
			log.warn("Skipping central encounter {}: no local encounter type or date", node.path("uuid").asText());
			return null;
		}

		Encounter encounter = new Encounter();
		encounter.setUuid(node.path("uuid").asText());
		encounter.setPatient(patient);
		encounter.setEncounterType(type);
		encounter.setEncounterDatetime(when);
		encounter.setLocation(mapLocation(node.path("location"), fallbackLocation));

		String formUuid = node.path("form").path("uuid").asText("");
		if (!formUuid.isEmpty()) {
			encounter.setForm(Context.getFormService().getFormByUuid(formUuid));
		}

		String visitUuid = node.path("visit").path("uuid").asText("");
		if (!visitUuid.isEmpty()) {
			Visit visit = visits.get(visitUuid);
			if (visit == null) {
				visit = Context.getVisitService().getVisitByUuid(visitUuid);
			}
			encounter.setVisit(visit);
		}

		JsonNode providers = node.path("encounterProviders");
		if (providers.isArray()) {
			for (JsonNode ep : providers) {
				if (ep.path("voided").asBoolean(false)) {
					continue;
				}
				Provider provider = Context.getProviderService().getProviderByUuid(ep.path("provider").path("uuid").asText(""));
				if (provider == null) {
					log.warn("Central provider {} is not defined here; encounter keeps no provider for it",
							ep.path("provider").path("uuid").asText());
					continue;
				}
				EncounterRole role = Context.getEncounterService()
						.getEncounterRoleByUuid(ep.path("encounterRole").path("uuid").asText(""));
				if (role == null) {
					role = Context.getEncounterService().getEncounterRoleByUuid(UNKNOWN_ENCOUNTER_ROLE_UUID);
				}
				if (role != null) {
					encounter.addProvider(role, provider);
				}
			}
		}

		JsonNode observations = node.path("obs");
		if (observations.isArray()) {
			for (JsonNode obsNode : observations) {
				Obs obs = buildObs(baseUrl, patient, encounter, obsNode);
				if (obs != null) {
					encounter.addObs(obs);
				}
			}
		}
		return encounter;
	}

	/**
	 * Builds one observation (and its group members) with the value typed by the LOCAL concept's
	 * datatype. Returns null, with a warning, when the concept or a coded answer has no local match.
	 */
	private Obs buildObs(String baseUrl, Patient patient, Encounter encounter, JsonNode node) throws Exception {
		if (node.path("voided").asBoolean(false)) {
			return null;
		}
		// The encounter representation can nest group members as bare references; re-read the obs in full.
		JsonNode members = node.path("groupMembers");
		if (members.isArray() && members.size() > 0 && members.get(0).path("concept").isMissingNode()) {
			node = executeGet(baseUrl + "/ws/rest/v1/obs/" + node.path("uuid").asText() + "?v=full");
			members = node.path("groupMembers");
		}

		Concept concept = Context.getConceptService().getConceptByUuid(node.path("concept").path("uuid").asText(""));
		if (concept == null) {
			log.warn("Skipping central obs {}: concept {} is not defined here", node.path("uuid").asText(),
					node.path("concept").path("uuid").asText());
			return null;
		}

		Obs obs = new Obs();
		obs.setUuid(node.path("uuid").asText());
		obs.setPerson(patient);
		obs.setConcept(concept);
		obs.setEncounter(encounter);
		obs.setObsDatetime(orDefault(parseDateOrNull(node.path("obsDatetime")), encounter.getEncounterDatetime()));
		obs.setLocation(encounter.getLocation());
		String comment = node.path("comment").asText("");
		if (!comment.isEmpty()) {
			obs.setComment(comment);
		}

		if (members.isArray() && members.size() > 0) {
			for (JsonNode memberNode : members) {
				Obs member = buildObs(baseUrl, patient, encounter, memberNode);
				if (member != null) {
					obs.addGroupMember(member);
				}
			}
			return obs.hasGroupMembers(false) ? obs : null;
		}

		return applyObsValue(obs, concept, node.path("value")) ? obs : null;
	}

	private static Date orDefault(Date value, Date fallback) {
		return value != null ? value : fallback;
	}

	private boolean applyObsValue(Obs obs, Concept concept, JsonNode value) throws Exception {
		if (value.isMissingNode() || value.isNull()) {
			return false;
		}
		ConceptDatatype datatype = concept.getDatatype();
		if (datatype == null) {
			return false;
		}
		if (datatype.isNumeric()) {
			if (!value.isNumber() && !value.isTextual()) {
				return false;
			}
			obs.setValueNumeric(value.asDouble());
		} else if (datatype.isCoded()) {
			Concept answer = Context.getConceptService().getConceptByUuid(value.path("uuid").asText(""));
			if (answer == null) {
				log.warn("Skipping central obs {}: coded answer {} is not defined here", obs.getUuid(),
						value.path("uuid").asText());
				return false;
			}
			obs.setValueCoded(answer);
		} else if (datatype.isBoolean()) {
			if (value.isBoolean()) {
				obs.setValueBoolean(value.asBoolean());
			} else {
				Concept answer = Context.getConceptService().getConceptByUuid(value.path("uuid").asText(""));
				if (answer == null) {
					return false;
				}
				obs.setValueCoded(answer);
			}
		} else if (datatype.isDate() || datatype.isTime() || datatype.isDateTime()) {
			Date date = parseDateOrNull(value);
			if (date == null) {
				return false;
			}
			obs.setValueDatetime(date);
		} else if (datatype.isText()) {
			obs.setValueText(value.asText());
		} else {
			// Complex (images, documents) values are not copied.
			return false;
		}
		return true;
	}

	private void applyPerson(Patient p, JsonNode personNode) throws Exception {
		if (personNode.isMissingNode()) {
			throw new IllegalStateException("Central patient has no person record");
		}

		p.setGender(personNode.path("gender").asText());

		String birthdateStr = personNode.path("birthdate").asText("");
		if (!birthdateStr.isEmpty()) {
			p.setBirthdate(parseDate(birthdateStr));
		}
		p.setBirthdateEstimated(personNode.path("birthdateEstimated").asBoolean(false));
		p.setDead(personNode.path("dead").asBoolean(false));

		JsonNode namesNode = personNode.path("names");
		if (namesNode.isArray()) {
			boolean first = true;
			for (JsonNode nameNode : namesNode) {
				if (nameNode.path("voided").asBoolean(false)) {
					continue;
				}
				PersonName name = new PersonName();
				name.setGivenName(nameNode.path("givenName").asText(null));
				name.setMiddleName(nameNode.path("middleName").asText(null));
				name.setFamilyName(nameNode.path("familyName").asText(null));
				name.setPreferred(first || nameNode.path("preferred").asBoolean(false));
				first = false;
				p.addName(name);
			}
		}

		JsonNode addressesNode = personNode.path("addresses");
		if (addressesNode.isArray()) {
			for (JsonNode addrNode : addressesNode) {
				if (addrNode.path("voided").asBoolean(false)) {
					continue;
				}
				PersonAddress addr = new PersonAddress();
				addr.setAddress1(addrNode.path("address1").asText(null));
				addr.setAddress2(addrNode.path("address2").asText(null));
				addr.setCityVillage(addrNode.path("cityVillage").asText(null));
				addr.setStateProvince(addrNode.path("stateProvince").asText(null));
				addr.setCountry(addrNode.path("country").asText(null));
				addr.setCountyDistrict(addrNode.path("countyDistrict").asText(null));
				addr.setPreferred(addrNode.path("preferred").asBoolean(false));
				p.addAddress(addr);
			}
		}
	}

	private void applyIdentifiers(Patient p, JsonNode identifiersNode) {
		if (!identifiersNode.isArray()) {
			return;
		}

		Location fallbackLocation = getFallbackLocation();
		for (JsonNode idNode : identifiersNode) {
			if (idNode.path("voided").asBoolean(false)) {
				continue;
			}
			PatientIdentifierType type = Context.getPatientService()
					.getPatientIdentifierTypeByUuid(idNode.path("identifierType").path("uuid").asText(""));
			if (type == null) {
				log.warn("Skipping central identifier of unknown type {}", idNode.path("identifierType").path("uuid").asText());
				continue;
			}

			// Identifier locations are central's; they usually exist here too because the location
			// tree is synced from the MFL. When one does not, the facility's own location keeps the
			// identifier rather than dropping it (and with it the whole import).
			Location location = null;
			String locUuid = idNode.path("location").path("uuid").asText("");
			if (!locUuid.isEmpty()) {
				location = Context.getLocationService().getLocationByUuid(locUuid);
			}
			if (location == null) {
				location = fallbackLocation;
			}
			if (location == null) {
				log.warn("Skipping central identifier {}: no matching or fallback location", idNode.path("identifier").asText());
				continue;
			}

			PatientIdentifier identifier = new PatientIdentifier();
			identifier.setIdentifier(idNode.path("identifier").asText());
			identifier.setIdentifierType(type);
			identifier.setLocation(location);
			identifier.setPreferred(idNode.path("preferred").asBoolean(false));
			p.addIdentifier(identifier);
		}
	}

	private Location getFallbackLocation() {
		String uuid = Context.getAdministrationService().getGlobalProperty(GP_FACILITY_LOCATION, "");
		if (uuid != null && !uuid.trim().isEmpty()) {
			Location location = Context.getLocationService().getLocationByUuid(uuid.trim());
			if (location != null) {
				return location;
			}
		}
		return Context.getUserContext().getLocation();
	}

	private Patient findLocalByIdentifier(JsonNode identifiersNode) {
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
			List<Patient> matches = Context.getPatientService().getPatients(null, value,
					Collections.singletonList(type), true);
			if (!matches.isEmpty()) {
				return matches.get(0);
			}
		}
		return null;
	}

	private String requireRemoteUrl() throws RemoteSearchException {
		String baseUrl = getRemoteUrl();
		if (baseUrl.isEmpty()) {
			throw new RemoteSearchException("Remote search is not configured", true, null);
		}
		return baseUrl;
	}

	private JsonNode executeGet(String urlStr) throws Exception {
		HttpURLConnection connection = (HttpURLConnection) new URL(urlStr).openConnection();
		connection.setRequestMethod("GET");
		connection.setConnectTimeout(TIMEOUT_MS);
		connection.setReadTimeout(TIMEOUT_MS);
		connection.setRequestProperty("Accept", "application/json");

		String user = getRemoteUser();
		String password = getRemotePassword();

		if (!user.isEmpty()) {
			String auth = user + ":" + password;
			String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes("UTF-8"));
			connection.setRequestProperty("Authorization", "Basic " + encodedAuth);
		}

		try {
			if (connection.getResponseCode() != 200) {
				throw new IllegalStateException("Remote server answered " + connection.getResponseCode());
			}
			try (InputStream body = connection.getInputStream()) {
				return mapper.readTree(body);
			}
		}
		finally {
			connection.disconnect();
		}
	}

	private String getRemoteUrl() {
		String value = System.getenv(ENV_REMOTE_URL);
		if (value == null || value.trim().isEmpty()) {
			value = Context.getAdministrationService().getGlobalProperty(GP_REMOTE_URL, "");
		}
		value = value == null ? "" : value.trim();
		while (value.endsWith("/")) {
			value = value.substring(0, value.length() - 1);
		}
		return value;
	}

	private String getRemoteUser() {
		String value = System.getenv(ENV_REMOTE_USER);
		if (value == null || value.trim().isEmpty()) {
			value = Context.getAdministrationService().getGlobalProperty(GP_REMOTE_USER, "");
		}
		return value == null ? "" : value.trim();
	}

	private String getRemotePassword() {
		String value = System.getenv(ENV_REMOTE_PASSWORD);
		if (value == null || value.trim().isEmpty()) {
			value = Context.getAdministrationService().getGlobalProperty(GP_REMOTE_PASSWORD, "");
		}
		return value == null ? "" : value.trim();
	}
}
