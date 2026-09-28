/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.mfl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A run's counts (the API's MflRunCounts). On a dry run they are what would happen. */
public class MflRunCounts {

	private int created, updated, retired, unretired, unchanged, failed, warnings;

	public MflRunCounts() {
	}

	public MflRunCounts(int created, int updated, int retired, int unretired, int unchanged, int failed, int warnings) {
		this.created = created;
		this.updated = updated;
		this.retired = retired;
		this.unretired = unretired;
		this.unchanged = unchanged;
		this.failed = failed;
		this.warnings = warnings;
	}

	/**
	 * @param unchanged locations the run compared and left as they were, those with warnings
	 *            included
	 */
	static MflRunCounts of(List<MflRunItem> items, int unchanged) {
		MflRunCounts counts = new MflRunCounts();
		counts.unchanged = unchanged;
		for (MflRunItem item : items) {
			switch (item.getAction()) {
				case CREATE:
					counts.created++;
					break;
				case UPDATE:
					counts.updated++;
					break;
				case RETIRE:
					counts.retired++;
					break;
				case UNRETIRE:
					counts.unretired++;
					break;
				case ERROR:
					counts.failed++;
					break;
				default:
					break;
			}
			if (!item.getWarnings().isEmpty()) {
				counts.warnings++;
			}
		}
		return counts;
	}

	public Map<String, Object> toMap() {
		Map<String, Object> map = new LinkedHashMap<String, Object>();
		map.put("created", created);
		map.put("updated", updated);
		map.put("retired", retired);
		map.put("unretired", unretired);
		map.put("unchanged", unchanged);
		map.put("failed", failed);
		map.put("warnings", warnings);
		return map;
	}

	public int getCreated() {
		return created;
	}

	public int getUpdated() {
		return updated;
	}

	public int getRetired() {
		return retired;
	}

	public int getUnretired() {
		return unretired;
	}

	public int getUnchanged() {
		return unchanged;
	}

	public int getFailed() {
		return failed;
	}

	public int getWarnings() {
		return warnings;
	}
}
