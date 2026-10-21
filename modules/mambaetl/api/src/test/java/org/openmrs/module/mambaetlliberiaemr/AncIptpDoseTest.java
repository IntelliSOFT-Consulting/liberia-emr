/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 */
package org.openmrs.module.mambaetlliberiaemr;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.BeforeClass;
import org.junit.Test;

/**
 * Exact IPT dose identity on the MCH ANC forms, from 1st–4th through 1st–8th.
 * The national 1st / 2nd / 3rd+ question is not part of this change.
 */
public class AncIptpDoseTest {

	private static final String AMPATH_FORMS_NAMESPACE = "794c4598-ab82-47ca-8d18-483a8abe6f4f";

	private static final String[] ORDINAL = { "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th" };

	private static final String[] PRESERVED = { "025d9262-58ae-4261-a04d-77a8dfa4bd0b",
	        "5b45044d-e950-41ee-b798-24cee7e10c03", "769be397-f71a-45eb-bac1-a154c2250c32",
	        "460f19eb-2dcc-481c-87d7-d0db4e864d4e" };

	private static final String QUESTION = "var.concept.mch.ipt-dose-administered.uuid";

	private static Path repo;

	private static Map<String, String> mchVars;

	private static Map<String, String> nationalVars;

	@BeforeClass
	public static void load() throws IOException {
		repo = Paths_repo();
		mchVars = properties(repo.resolve("content-packages/content-liberia-mch/configuration/variables.properties"));
		nationalVars = properties(
		    repo.resolve("content-packages/content-liberia-national/configuration/variables.properties"));
	}

	@Test
	public void preservesFirstThroughFourthAnswerUuids() {
		for (int i = 0; i < PRESERVED.length; i++) {
			assertEquals(PRESERVED[i], mchVars.get(doseVar(ORDINAL[i])));
		}
		assertEquals("edf4344a-2e9f-4e0e-88d1-824bd3f25069", mchVars.get(QUESTION));
	}

	@Test
	public void addsFifthThroughEighthAnswerConcepts_withoutCielOrNationalDuplicates() throws IOException {
		String concepts = read(repo.resolve(
		    "content-packages/content-liberia-mch/configuration/backend_configuration/concepts/concepts-mch.csv"));
		String national = read(repo.resolve(
		    "content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv"));
		String[] fsn = { "Fifth IPTp Dose at ANC", "Sixth IPTp Dose at ANC", "Seventh IPTp Dose at ANC",
		        "Eighth IPTp Dose at ANC" };
		String[] shortName = { "5th IPTp dose", "6th IPTp dose", "7th IPTp dose", "8th IPTp dose" };
		List<String> answerTokens = new ArrayList<String>();
		for (int i = 0; i < ORDINAL.length; i++) {
			String token = "${" + doseVar(ORDINAL[i]) + "}";
			answerTokens.add(token);
			assertTrue(mchVars.containsKey(doseVar(ORDINAL[i])));
			assertFalse("national must not gain an MCH exact-dose concept", national.contains(doseVar(ORDINAL[i])));
		}
		for (int i = 4; i < ORDINAL.length; i++) {
			String token = "${" + doseVar(ORDINAL[i]) + "}";
			int row = concepts.indexOf(token + ",,");
			assertTrue("missing concept row for " + ORDINAL[i], row >= 0);
			String line = concepts.substring(row, concepts.indexOf('\n', row));
			assertTrue(line.contains("," + fsn[i - 4] + ","));
			assertTrue(line.contains("," + shortName[i - 4] + ","));
			assertTrue(line.contains(",Misc,N/A,"));
			assertTrue("Same-as must stay blank", line.endsWith(",,,,,") || line.endsWith(",,,,"));
			assertFalse(line.contains("CIEL"));
		}
		String parentToken = "${" + QUESTION + "}";
		int parentAt = concepts.indexOf(parentToken + ",,");
		String parent = concepts.substring(parentAt, concepts.indexOf('\n', parentAt));
		String answers = parent.substring(parent.lastIndexOf(",Question,Coded,") + ",Question,Coded,".length());
		answers = answers.substring(0, answers.indexOf(','));
		assertEquals(join(answerTokens, ";"), answers);
		assertFalse(national.contains("5th IPTp dose"));
		assertTrue(national.contains("3rd IPT dose+"));
	}

	@Test
	public void bumpsAncForms_andFreezesThePreviousDerivedUuids() throws IOException {
		assertEquals("1.3", formVersion("anc-initial.json"));
		assertEquals("1.2", formVersion("anc-followup.json"));
		assertEquals("889c74c1-e051-3d9e-8275-31cd187ebd11", derived("ANC Initial Visit", "1.3"));
		assertEquals(derived("ANC Initial Visit", "1.3"), mchVars.get("var.form.anc-initial.uuid"));
		assertEquals("30259289-f0ea-3604-b57d-91bfe4e68d5d", derived("ANC Initial Visit", "1.2"));
		assertEquals(derived("ANC Initial Visit", "1.2"), mchVars.get("var.form.anc-initial-visit.v1-2.uuid"));
		assertEquals("85866817-17b2-3c4f-b531-b06bddf7728a", derived("ANC Follow-up Visit", "1.2"));
		assertEquals(derived("ANC Follow-up Visit", "1.2"), mchVars.get("var.form.anc-followup.uuid"));
		assertEquals("2818c1e9-9e97-3829-8065-1ae43b590736", derived("ANC Follow-up Visit", "1.1"));
		assertEquals(derived("ANC Follow-up Visit", "1.1"), mchVars.get("var.form.anc-follow-up-visit.v1-1.uuid"));
		assertTrue(read(form("anc-initial.json")).contains("\"uuid\": \"${var.form.anc-initial.uuid}\""));
		assertTrue(read(form("anc-followup.json")).contains("\"uuid\": \"${var.form.anc-followup.uuid}\""));
	}

	@Test
	public void bothMchFormsOfferDosesOneThroughEight_inDictionaryOrder() throws IOException {
		assertDoseList(form("anc-initial.json"), false, "Select the IPT dose administered");
		assertDoseList(form("anc-followup.json"), true, null);
	}

	@Test
	public void selectingADoseStoresTheQuestionAndAnswerUuids_andReopensOnThatOption() throws IOException {
		for (Path form : new Path[] { form("anc-initial.json"), form("anc-followup.json") }) {
			List<Answer> answers = answersAfterConcept(read(form), "${" + QUESTION + "}");
			for (int i = 0; i < ORDINAL.length; i++) {
				Answer selected = answers.get(i);
				assertEquals(ORDINAL[i] + " IPT dose", selected.label);
				SavedObs obs = saveCoded(mchVars.get(QUESTION), resolve(selected.concept));
				assertEquals(mchVars.get(QUESTION), obs.questionConcept);
				assertEquals(mchVars.get(doseVar(ORDINAL[i])), obs.valueCoded);
				assertEquals(selected.label, reopen(answers, obs.valueCoded));
			}
		}
	}

	@Test
	public void nationalIptModelIsUnchanged() throws IOException {
		Path nationalForm = repo.resolve(
		    "content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/anc-national.json");
		List<Answer> answers = answersAfterConcept(read(nationalForm),
		    "${var.concept.national.ipt-dose-administered.uuid}");
		assertEquals(3, answers.size());
		assertEquals("1st IPT dose", answers.get(0).label);
		assertEquals("${var.concept.national.1st-ipt-dose.uuid}", answers.get(0).concept);
		assertEquals("2nd IPT dose", answers.get(1).label);
		assertEquals("3rd IPT dose+", answers.get(2).label);
		assertEquals("${var.concept.national.3rd-ipt-dose.uuid}", answers.get(2).concept);
		String csv = read(repo.resolve(
		    "content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv"));
		assertTrue(csv.contains(
		    "${var.concept.national.1st-ipt-dose.uuid};${var.concept.national.2nd-ipt-dose.uuid};${var.concept.national.3rd-ipt-dose.uuid}"));
		assertFalse(csv.contains("5th-ipt-dose"));
	}

	@Test
	public void reportingMapsMchDosesOneThroughEight_andNationalThirdPlusToThree() throws IOException {
		Map<String, String> vars = new LinkedHashMap<String, String>(nationalVars);
		vars.putAll(mchVars);
		String sql = read(repo.resolve(
		    "modules/mambaetl/api/src/main/mamba/_etl/derived/rmncah/sp_mamba_fact_rmncah_anc_visit.sql"));
		assertTrue(sql.contains("iptp_dose_number          TINYINT      NULL"));
		assertFalse(sql.contains("iptp_dose_number") && sql.contains("CHECK"));
		for (Map.Entry<String, String> entry : vars.entrySet()) {
			sql = sql.replace("${" + entry.getKey() + "}", entry.getValue());
		}
		int end = sql.indexOf("AS iptp_dose_number");
		int start = sql.lastIndexOf("MAX(CASE", end);
		String region = sql.substring(start, end);
		assertFalse(region.contains("${"));
		Map<String, Integer> mapped = new LinkedHashMap<String, Integer>();
		Matcher matcher = Pattern.compile("WHEN '([0-9a-f-]{36})' THEN (\\d+)").matcher(region);
		while (matcher.find()) {
			mapped.put(matcher.group(1), Integer.valueOf(matcher.group(2)));
		}
		for (int dose = 1; dose <= 8; dose++) {
			assertEquals(Integer.valueOf(dose), mapped.get(mchVars.get(doseVar(ORDINAL[dose - 1]))));
		}
		assertEquals(Integer.valueOf(1), mapped.get(nationalVars.get("var.concept.national.1st-ipt-dose.uuid")));
		assertEquals(Integer.valueOf(2), mapped.get(nationalVars.get("var.concept.national.2nd-ipt-dose.uuid")));
		assertEquals(Integer.valueOf(3), mapped.get(nationalVars.get("var.concept.national.3rd-ipt-dose.uuid")));
		assertEquals(11, mapped.size());
		String reports = read(repo.resolve(
		    "modules/liberiaemrreports/api/src/main/java/org/openmrs/module/liberiaemrreports/reports/MalariaReportManager.java"));
		assertTrue(reports.contains("f.iptp_dose_number >= 3"));
		assertTrue(reports.contains("f.iptp_dose_number >= 2"));
		assertFalse(reports.contains("iptp_dose_number <= 4"));
		assertFalse(reports.contains("iptp_dose_number < 5"));
		assertNoOtherIptDoseMapping();
	}

	@Test
	public void reportingFixturesCarryFifthAndEighthOutsideTheIndicatorPeriod() throws IOException {
		String obs = read(repo.resolve("qa/reporting/fixtures/obs.csv"));
		assertTrue(obs.contains(
		    "C-ANC5-0,${var.concept.mch.ipt-dose-administered.uuid},${var.concept.mch.5th-ipt-dose.uuid},"));
		assertTrue(obs.contains(
		    "C-ANC6-0,${var.concept.mch.ipt-dose-administered.uuid},${var.concept.mch.8th-ipt-dose.uuid},"));
		assertTrue(obs.contains("${var.concept.mch.1st-ipt-dose.uuid}"));
		assertTrue(obs.contains("${var.concept.mch.4th-ipt-dose.uuid}"));
		assertTrue(obs.contains("${var.concept.national.3rd-ipt-dose.uuid}"));
		String encounters = read(repo.resolve("qa/reporting/fixtures/encounters.csv"));
		assertTrue(encounters.contains(
		    "C-ANC5-0,C-ANC5,2025-12-16 09:00:00,${var.encountertype.anc-initial.uuid},anc-initial-v1.3,"));
		assertTrue(encounters.contains(
		    "C-ANC6-0,C-ANC6,2025-12-18 09:00:00,${var.encountertype.anc-initial.uuid},anc-initial-v1.3,"));
	}

	@Test
	public void fifthThroughEighthAreOrdinaryCodedObs_withNoSyncValueCap() throws IOException {
		String watched = read(repo.resolve("distribution/sync/application.properties.template"));
		int tablesAt = watched.indexOf("eip.watchedTables=");
		String tables = watched.substring(tablesAt, watched.indexOf('\n', tablesAt));
		assertTrue(tables.contains(",OBS,"));
		assertFalse(tables.contains("CONCEPT"));
		assertFalse(tables.contains("ipt"));
		final List<String> hits = new ArrayList<String>();
		Files.walkFileTree(repo.resolve("distribution/sync"), new SimpleFileVisitor<Path>() {

			@Override
			public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
				String text = read(file);
				if (text.contains("ipt-dose") || text.contains("iptp_dose")) {
					hits.add(file.toString());
				}
				return FileVisitResult.CONTINUE;
			}
		});
		assertTrue(hits.toString(), hits.isEmpty());
		for (String layer : new String[] { "content-site-careysburg", "content-site-barnersville", "content-central" }) {
			String props = read(repo.resolve("content-packages/" + layer + "/content.properties"));
			assertTrue(layer + " must load the MCH content package", props.contains("content.liberiaemr-mch"));
		}
		String fifth = mchVars.get(doseVar("5th"));
		assertNotNull(fifth);
		SavedObs obs = saveCoded(mchVars.get(QUESTION), fifth);
		assertEquals(36, obs.questionConcept.length());
		assertEquals(36, obs.valueCoded.length());
		assertTrue(read(repo.resolve(
		    "content-packages/content-liberia-mch/configuration/backend_configuration/concepts/concepts-mch.csv"))
		        .contains(fifth) == false);
		assertTrue(conceptsCsvContainsToken(doseVar("5th")));
	}

	@Test
	public void traceabilityLeavesFifthThroughEighthWithoutInventedDictionaryIds() throws IOException {
		String csv = read(repo.resolve("docs/dak/traceability-mch.csv"));
		for (String ordinal : new String[] { "5th", "6th", "7th", "8th" }) {
			String marker = "ANC,Intermittent Treatment (IPT),," + ordinal + " IPT dose,";
			assertTrue("missing pending traceability row for " + ordinal, csv.contains(marker));
			int at = csv.indexOf(marker);
			String line = csv.substring(at, csv.indexOf('\n', at));
			assertTrue(line.contains(doseVar(ordinal)));
			assertTrue(line.endsWith("pending,\"Pending external Data Dictionary ID assignment. The live ANC sheet stops at 4th IPT dose. Do not invent an LBR.EMR.DE.* identifier. MCH answer FSN: "
			        + fsn(ordinal) + ". Same-as and CIEL left blank.\"")
			        || line.contains(",pending,"));
		}
		assertTrue(csv.contains("LBR.EMR.DE.49,1st IPT dose"));
		assertTrue(csv.contains("LBR.EMR.DE.52,4th IPT dose"));
		assertFalse(csv.contains("LBR.EMR.DE.54,5th IPT dose"));
		assertFalse(csv.contains("LBR.EMR.DE.57,8th IPT dose"));
	}

	private static void assertDoseList(Path form, boolean required, String validationMessage) throws IOException {
		String json = read(form);
		List<Answer> answers = answersAfterConcept(json, "${" + QUESTION + "}");
		assertEquals(8, answers.size());
		for (int i = 0; i < ORDINAL.length; i++) {
			assertEquals("${" + doseVar(ORDINAL[i]) + "}", answers.get(i).concept);
			assertEquals(ORDINAL[i] + " IPT dose", answers.get(i).label);
		}
		int conceptAt = json.indexOf("\"concept\": \"${" + QUESTION + "}\"");
		String window = json.substring(conceptAt, Math.min(json.length(), conceptAt + 4000));
		assertTrue(window.contains("\"hideWhenExpression\": \"womanReceivingIpt !== '${var.concept.ciel.yes.uuid}'\""));
		assertTrue(window.contains("\"required\": " + required));
		if (validationMessage != null) {
			assertTrue(window.contains(validationMessage));
		}
		assertTrue(json.contains("\"concept\": \"${var.concept.national.woman-receiving-ipt.uuid}\""));
		assertTrue(json.contains("\"concept\": \"${var.concept.national.llin-received-at-anc.uuid}\""));
	}

	private static void assertNoOtherIptDoseMapping() throws IOException {
		final List<Path> sqlHits = new ArrayList<Path>();
		Files.walkFileTree(repo.resolve("modules/mambaetl"), new SimpleFileVisitor<Path>() {

			@Override
			public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
				if (file.toString().endsWith(".sql") && read(file).contains("ipt-dose")
				        && !file.getFileName().toString().equals("sp_mamba_fact_rmncah_anc_visit.sql")) {
					sqlHits.add(file);
				}
				return FileVisitResult.CONTINUE;
			}
		});
		assertTrue(sqlHits.toString(), sqlHits.isEmpty());
	}

	private static boolean conceptsCsvContainsToken(String variable) throws IOException {
		return read(repo.resolve(
		    "content-packages/content-liberia-mch/configuration/backend_configuration/concepts/concepts-mch.csv"))
		        .contains("${" + variable + "}");
	}

	private static List<Answer> answersAfterConcept(String json, String conceptToken) {
		int conceptAt = json.indexOf("\"concept\": \"" + conceptToken + "\"");
		assertTrue("missing question concept " + conceptToken, conceptAt >= 0);
		int answersAt = json.indexOf("\"answers\"", conceptAt);
		int open = json.indexOf('[', answersAt);
		int close = matchingBracket(json, open);
		List<Answer> answers = new ArrayList<Answer>();
		Matcher matcher = Pattern.compile("\\{\\s*\"concept\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"label\"\\s*:\\s*\"([^\"]+)\"")
		        .matcher(json.substring(open, close));
		while (matcher.find()) {
			answers.add(new Answer(matcher.group(1), matcher.group(2)));
		}
		return answers;
	}

	private static int matchingBracket(String json, int open) {
		int depth = 0;
		boolean inString = false;
		for (int i = open; i < json.length(); i++) {
			char c = json.charAt(i);
			if (inString) {
				if (c == '\\') {
					i++;
				} else if (c == '"') {
					inString = false;
				}
				continue;
			}
			if (c == '"') {
				inString = true;
			} else if (c == '[') {
				depth++;
			} else if (c == ']') {
				depth--;
				if (depth == 0) {
					return i;
				}
			}
		}
		throw new AssertionError("unbalanced answers array");
	}

	/**
	 * What the form engine posts for a coded select, and what it matches on reopen:
	 * the question concept UUID, and the selected answer concept UUID as value_coded.
	 */
	private static SavedObs saveCoded(String questionConcept, String answerConcept) {
		return new SavedObs(questionConcept, answerConcept);
	}

	private static String reopen(List<Answer> answers, String valueCoded) {
		for (Answer answer : answers) {
			if (resolve(answer.concept).equals(valueCoded)) {
				return answer.label;
			}
		}
		throw new AssertionError("no dropdown option for value_coded " + valueCoded);
	}

	private static String resolve(String token) {
		Matcher matcher = Pattern.compile("\\$\\{([^}]+)\\}").matcher(token);
		assertTrue(matcher.matches());
		String value = mchVars.get(matcher.group(1));
		if (value == null) {
			value = nationalVars.get(matcher.group(1));
		}
		assertNotNull(token, value);
		return value;
	}

	private static String formVersion(String file) throws IOException {
		Matcher matcher = Pattern.compile("\"version\": \"([^\"]+)\"").matcher(read(form(file)));
		assertTrue(matcher.find());
		return matcher.group(1);
	}

	private static String derived(String name, String version) {
		return UUID.nameUUIDFromBytes(
		    (AMPATH_FORMS_NAMESPACE + "_" + name + "_" + version).getBytes(StandardCharsets.UTF_8)).toString();
	}

	private static String doseVar(String ordinal) {
		return "var.concept.mch." + ordinal + "-ipt-dose.uuid";
	}

	private static String fsn(String ordinal) {
		if ("5th".equals(ordinal)) {
			return "Fifth IPTp Dose at ANC";
		}
		if ("6th".equals(ordinal)) {
			return "Sixth IPTp Dose at ANC";
		}
		if ("7th".equals(ordinal)) {
			return "Seventh IPTp Dose at ANC";
		}
		return "Eighth IPTp Dose at ANC";
	}

	private static Path form(String name) {
		return repo.resolve(
		    "content-packages/content-liberia-mch/configuration/backend_configuration/ampathforms/" + name);
	}

	private static Path Paths_repo() {
		Path dir = java.nio.file.Paths.get("").toAbsolutePath();
		while (dir != null && !Files.isDirectory(dir.resolve("content-packages"))) {
			dir = dir.getParent();
		}
		if (dir == null) {
			throw new AssertionError("content-packages not found");
		}
		return dir;
	}

	private static Map<String, String> properties(Path file) throws IOException {
		Map<String, String> out = new LinkedHashMap<String, String>();
		for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
			String trimmed = line.trim();
			if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains("=")) {
				continue;
			}
			int eq = trimmed.indexOf('=');
			out.put(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim());
		}
		return out;
	}

	private static String read(Path file) throws IOException {
		return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
	}

	private static String join(List<String> parts, String separator) {
		StringBuilder out = new StringBuilder();
		for (int i = 0; i < parts.size(); i++) {
			if (i > 0) {
				out.append(separator);
			}
			out.append(parts.get(i));
		}
		return out.toString();
	}

	private static final class Answer {

		private final String concept;

		private final String label;

		private Answer(String concept, String label) {
			this.concept = concept;
			this.label = label;
		}
	}

	private static final class SavedObs {

		private final String questionConcept;

		private final String valueCoded;

		private SavedObs(String questionConcept, String valueCoded) {
			this.questionConcept = questionConcept;
			this.valueCoded = valueCoded;
		}
	}
}
