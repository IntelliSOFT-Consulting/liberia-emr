package org.liberiaemr.recon;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Which synced tables are compared, and how the sender's configuration names them. */
public final class Tables {

	/**
	 * Every table the sender can watch that holds its own uuid and creation date. patient and the
	 * order subclasses share their uuid with person and orders, which are compared instead.
	 */
	public static final Set<String> COMPARED = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList("person",
	    "person_name", "person_address", "person_attribute", "patient_identifier", "relationship", "visit",
	    "visit_attribute", "encounter", "encounter_provider", "encounter_diagnosis", "obs", "conditions", "allergy",
	    "diagnosis_attribute", "patient_program", "patient_state", "patient_program_attribute", "orders", "order_group",
	    "order_attribute", "order_group_attribute", "users", "provider")));

	private Tables() {
	}

	/** @return the compared tables among eip.watchedTables, in the sender's order */
	public static Set<String> watched(String watchedTables) {
		Set<String> out = new LinkedHashSet<>();
		if (watchedTables == null) {
			return out;
		}
		for (String t : watchedTables.split(",")) {
			String table = t.trim().toLowerCase(Locale.ROOT);
			if (COMPARED.contains(table)) {
				out.add(table);
			}
		}
		return out;
	}
}
