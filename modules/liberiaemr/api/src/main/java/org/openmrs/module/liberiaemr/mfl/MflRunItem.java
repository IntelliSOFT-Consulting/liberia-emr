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

import java.util.ArrayList;
import java.util.List;

/**
 * One location's line in a run's log: its changes, warnings or error. A location that is unchanged
 * and has no warning gets no item.
 */
public class MflRunItem {

	/** One field that changed; from is null on CREATE, to is null when the field was emptied. */
	public static class Change {

		private final String field;

		private final String from;

		private final String to;

		public Change(String field, String from, String to) {
			this.field = field;
			this.from = from;
			this.to = to;
		}

		/** name, parent, latitude, …, tag:&lt;name&gt; or attribute:&lt;type name&gt;. */
		public String getField() {
			return field;
		}

		public String getFrom() {
			return from;
		}

		public String getTo() {
			return to;
		}
	}

	private MflAction action;

	private final MflLevel level;

	private final String mflUid;

	private final String mflCode;

	private final String locationUuid;

	private final String name;

	private final List<Change> changes;

	private final List<String> warnings;

	private String error;

	public MflRunItem(MflAction action, MflLevel level, String mflUid, String mflCode, String locationUuid, String name,
	    List<Change> changes, List<String> warnings, String error) {
		this.action = action;
		this.level = level;
		this.mflUid = mflUid;
		this.mflCode = mflCode;
		this.locationUuid = locationUuid;
		this.name = name;
		this.changes = new ArrayList<Change>(changes);
		this.warnings = new ArrayList<String>(warnings);
		this.error = error;
	}

	/** Turns an item whose change could not be applied into an error; nothing of it was written. */
	void fail(String message) {
		this.action = MflAction.ERROR;
		this.error = message;
	}

	public MflAction getAction() {
		return action;
	}

	public MflLevel getLevel() {
		return level;
	}

	public String getMflUid() {
		return mflUid;
	}

	public String getMflCode() {
		return mflCode;
	}

	public String getLocationUuid() {
		return locationUuid;
	}

	public String getName() {
		return name;
	}

	public List<Change> getChanges() {
		return changes;
	}

	public List<String> getWarnings() {
		return warnings;
	}

	public String getError() {
		return error;
	}
}
