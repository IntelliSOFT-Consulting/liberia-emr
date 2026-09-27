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

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.openmrs.Location;
import org.openmrs.LocationAttribute;
import org.openmrs.LocationAttributeType;
import org.openmrs.LocationTag;
import org.openmrs.api.LocationService;
import org.openmrs.api.context.Context;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Makes this instance's locations match one MFL pull (ADR 0009 decisions 1, 3 and 5). It first
 * plans every change by comparison alone, so a dry run touches no entity, then applies the plan
 * one location at a time: a location that cannot be saved becomes an error item and the rest go
 * on.
 * <p>
 * It matches on the MFL UID attribute only, never changes an existing UUID, writes only the
 * fields the MFL owns, and never retires what a person retired, nor this instance's own root.
 */
public class MflSyncEngine {

	/** Retirement on absence needs the pull to hold at least this share of what is held. */
	static final double COMPLETENESS = 0.9;

	private static final Logger log = LoggerFactory.getLogger(MflSyncEngine.class);

	private static final Map<String, String> ATTRIBUTE_NAMES = new LinkedHashMap<String, String>();

	static {
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_MFL_UID, "MFL UID");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_MFL_CODE, "MFL Code");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_FACILITY_TYPE, "Facility Type");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_FACILITY_OWNERSHIP, "Facility Ownership");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_EMONC_LEVEL, "EmONC Level");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_FACILITY_SETTING, "Facility Setting");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_MFL_CLOSED_DATE, "MFL Closed Date");
		ATTRIBUTE_NAMES.put(MflConstants.ATTR_MFL_LAST_UPDATED, "MFL Last Updated");
	}

	/** What a run did, or would do. */
	public static class Result {

		private final List<MflRunItem> items;

		private final MflRunCounts counts;

		private final String message;

		private final boolean retirementSkipped;

		Result(List<MflRunItem> items, MflRunCounts counts, String message, boolean retirementSkipped) {
			this.items = items;
			this.counts = counts;
			this.message = message;
			this.retirementSkipped = retirementSkipped;
		}

		public List<MflRunItem> getItems() {
			return items;
		}

		public MflRunCounts getCounts() {
			return counts;
		}

		/** Why retirement on absence was skipped, or null. */
		public String getMessage() {
			return message;
		}

		public boolean isRetirementSkipped() {
			return retirementSkipped;
		}
	}

	/** A location that carries an MFL UID, as it stood before the run. */
	private static final class Held {

		String uuid, name, parentUuid, parentName, retireReason, latitude, longitude, stateProvince, countyDistrict,
		        country;

		boolean retired;

		/** Carries an MFL UID but was not created by the sync: content owns its name and parent. */
		boolean adopted;

		MflLevel level;

		final Set<String> tags = new HashSet<String>();

		final Map<String, String> attributes = new HashMap<String, String>();
	}

	/** One planned change: the item reported, and what applying it takes. */
	private static final class Plan {

		final MflRunItem item;

		final MflLocationSpec spec;

		final String uuid;

		final String parentUuid;

		final boolean create;

		/** An adopted row: name and parent are never written (ADR 0009 decisions 1 and 3). */
		final boolean adopted;

		/** TRUE to retire, FALSE to un-retire, null to leave the retired flag as it is. */
		final Boolean retire;

		final String retireReason;

		Plan(MflRunItem item, MflLocationSpec spec, String uuid, String parentUuid, boolean create, boolean adopted,
		    Boolean retire, String retireReason) {
			this.item = item;
			this.spec = spec;
			this.uuid = uuid;
			this.parentUuid = parentUuid;
			this.create = create;
			this.adopted = adopted;
			this.retire = retire;
			this.retireReason = retireReason;
		}
	}

	private final LocationService locations;

	private final Map<String, LocationAttributeType> types = new LinkedHashMap<String, LocationAttributeType>();

	private final Map<MflLevel, LocationTag> tags = new HashMap<MflLevel, LocationTag>();

	public MflSyncEngine(LocationService locations) {
		this.locations = locations;
	}

	/**
	 * @param dryRun compute and report every change, write none
	 * @param runDate the date written into an absence retire reason
	 * @throws MflException when the content metadata the sync writes is missing
	 */
	public Result run(MflSnapshot snapshot, boolean dryRun, Date runDate) throws MflException {
		resolveMetadata();

		Map<String, List<Held>> held = new HashMap<String, List<Held>>();
		Set<String> localNames = new HashSet<String>();
		Set<String> protectedUuids = new HashSet<String>();
		load(held, localNames, protectedUuids);

		List<MflLocationSpec> specs = MflMapper.map(snapshot.getUnits(), localNames);
		Map<String, MflLocationSpec> specByUid = new HashMap<String, MflLocationSpec>();
		for (MflLocationSpec spec : specs) {
			specByUid.put(spec.getUid(), spec);
		}

		List<Plan> plans = new ArrayList<Plan>();
		List<MflRunItem> items = new ArrayList<MflRunItem>();
		Map<String, String> uuidByUid = new HashMap<String, String>();
		int unchanged = 0;

		for (MflLocationSpec spec : specs) {
			List<Held> rows = held.get(spec.getUid());
			if (rows != null && rows.size() > 1) {
				items.add(duplicate(spec.getUid(), spec.getLevel(), spec.getCode(), rows));
				continue;
			}
			String parentUuid = null;
			if (spec.getParentUid() != null) {
				parentUuid = uuidByUid.get(spec.getParentUid());
				if (parentUuid == null) {
					items.add(new MflRunItem(MflAction.ERROR, spec.getLevel(), spec.getUid(), spec.getCode(),
					        rows == null ? null : rows.get(0).uuid, spec.getName(), none(), spec.getWarnings(),
					        "Parent " + spec.getParentUid() + " is not in this pull or could not be placed"));
					continue;
				}
			}
			Plan plan;
			if (rows == null) {
				plan = planCreate(spec, parentUuid, specByUid);
			} else {
				Held row = rows.get(0);
				plan = planUpdate(spec, row, parentUuid, specByUid, protectedUuids);
				if (plan == null) {
					unchanged++;
					uuidByUid.put(spec.getUid(), row.uuid);
					continue;
				}
			}
			items.add(plan.item);
			if (plan.item.getAction() == MflAction.ERROR && plan.create) {
				continue;
			}
			// A located row can parent its children even when its own change failed or was refused.
			uuidByUid.put(spec.getUid(), plan.uuid);
			if (plan.item.getAction() == MflAction.WARNING) {
				unchanged++;
			} else if (plan.item.getAction() != MflAction.ERROR) {
				plans.add(plan);
			}
		}

		// Retirement on absence needs a pull known to be complete (ADR 0009 decision 5).
		int heldActive = 0;
		for (List<Held> rows : held.values()) {
			for (Held row : rows) {
				heldActive += row.retired ? 0 : 1;
			}
		}
		int pulledActive = 0;
		for (MflLocationSpec spec : specs) {
			pulledActive += spec.isClosed() ? 0 : 1;
		}
		String message = null;
		if (!snapshot.isComplete()) {
			message = "Retirement of locations missing from the MFL was skipped: " + snapshot.getFailures().size()
			        + " page(s) of the pull failed (" + snapshot.getFailures().get(0) + ")";
		} else if (heldActive > 0 && pulledActive < COMPLETENESS * heldActive) {
			message = "Retirement of locations missing from the MFL was skipped: the pull holds " + pulledActive
			        + " active locations, under 90% of the " + heldActive + " held here";
		}

		for (Map.Entry<String, List<Held>> entry : held.entrySet()) {
			if (specByUid.containsKey(entry.getKey())) {
				continue;
			}
			List<Held> rows = entry.getValue();
			if (rows.size() > 1) {
				items.add(duplicate(entry.getKey(), rows.get(0).level, rows.get(0).attributes.get(MflConstants.ATTR_MFL_CODE),
				    rows));
				continue;
			}
			Held row = rows.get(0);
			if (row.retired) {
				continue;
			}
			if (message != null) {
				unchanged++;
				continue;
			}
			MflRunItem item = new MflRunItem(MflAction.RETIRE, row.level, entry.getKey(),
			        row.attributes.get(MflConstants.ATTR_MFL_CODE), row.uuid, row.name, none(), none(), null);
			if (protectedUuids.contains(row.uuid)) {
				item.fail(ownRoot());
			} else {
				plans.add(new Plan(item, null, row.uuid, null, false, row.adopted, Boolean.TRUE,
				        MflConstants.RETIRE_REASON_PREFIX + " not in the MFL since " + ymd(runDate)));
			}
			items.add(item);
		}

		if (!dryRun) {
			for (Plan plan : plans) {
				apply(plan);
			}
		}
		return new Result(items, MflRunCounts.of(items, unchanged), message, message != null);
	}

	private void resolveMetadata() throws MflException {
		for (Map.Entry<String, String> entry : ATTRIBUTE_NAMES.entrySet()) {
			LocationAttributeType type = locations.getLocationAttributeTypeByUuid(entry.getKey());
			if (type == null) {
				throw new MflException("Location attribute type " + entry.getValue() + " (" + entry.getKey()
				        + ") is missing: load content-liberia-national (LE-320) before running the MFL sync");
			}
			types.put(entry.getKey(), type);
		}
		for (MflLevel level : MflLevel.values()) {
			LocationTag tag = locations.getLocationTagByName(level.getTag());
			if (tag == null) {
				throw new MflException("Location tag " + level.getTag()
				        + " is missing: load content-liberia-national before running the MFL sync");
			}
			tags.put(level, tag);
		}
	}

	private void load(Map<String, List<Held>> held, Set<String> localNames, Set<String> protectedUuids) {
		LocationAttributeType uidType = types.get(MflConstants.ATTR_MFL_UID);
		for (Location location : locations.getAllLocations(true)) {
			String uid = value(location, uidType);
			if (!location.getRetired() && location.hasTag(MflConstants.TAG_LOGIN_LOCATION)) {
				for (Location up = location; up != null; up = up.getParentLocation()) {
					protectedUuids.add(up.getUuid());
				}
			}
			if (uid == null) {
				if (!location.getRetired()) {
					localNames.add(location.getName());
				}
				continue;
			}
			Held row = new Held();
			row.uuid = location.getUuid();
			row.name = location.getName();
			row.adopted = !MflUuid.forUid(uid).equals(location.getUuid());
			if (row.adopted && !location.getRetired()) {
				// Its name stays local, so an MFL unit that shares it clashes (ADR 0009 decision 3).
				localNames.add(location.getName());
			}
			row.parentUuid = location.getParentLocation() == null ? null : location.getParentLocation().getUuid();
			row.parentName = location.getParentLocation() == null ? null : location.getParentLocation().getName();
			row.retired = location.getRetired();
			row.retireReason = location.getRetireReason();
			row.latitude = blankToNull(location.getLatitude());
			row.longitude = blankToNull(location.getLongitude());
			row.stateProvince = blankToNull(location.getStateProvince());
			row.countyDistrict = blankToNull(location.getCountyDistrict());
			row.country = blankToNull(location.getCountry());
			row.level = MflLevel.FACILITY;
			for (LocationTag tag : location.getTags()) {
				row.tags.add(tag.getName());
				if (MflLevel.ofTag(tag.getName()) != null) {
					row.level = MflLevel.ofTag(tag.getName());
				}
			}
			for (Map.Entry<String, LocationAttributeType> type : types.entrySet()) {
				row.attributes.put(type.getKey(), value(location, type.getValue()));
			}
			if (!held.containsKey(uid)) {
				held.put(uid, new ArrayList<Held>());
			}
			held.get(uid).add(row);
		}
	}

	private Plan planCreate(MflLocationSpec spec, String parentUuid, Map<String, MflLocationSpec> specByUid) {
		String uuid = MflUuid.forUid(spec.getUid());
		if (locations.getLocationByUuid(uuid) != null) {
			return new Plan(new MflRunItem(MflAction.ERROR, spec.getLevel(), spec.getUid(), spec.getCode(), uuid,
			        spec.getName(), none(), spec.getWarnings(), "Location " + uuid
			                + " already exists but carries no MFL UID: add the attribute or retire it by hand"), spec, uuid,
			        parentUuid, true, false, null, null);
		}
		Held nothing = new Held();
		List<MflRunItem.Change> changes = changes(nothing, spec, parentUuid, specByUid);
		MflRunItem item = new MflRunItem(MflAction.CREATE, spec.getLevel(), spec.getUid(), spec.getCode(), uuid,
		        spec.getName(), changes, spec.getWarnings(), null);
		return new Plan(item, spec, uuid, parentUuid, true, false, spec.isClosed() ? Boolean.TRUE : null,
		        spec.isClosed() ? closedReason(spec) : null);
	}

	private Plan planUpdate(MflLocationSpec spec, Held row, String parentUuid, Map<String, MflLocationSpec> specByUid,
	        Set<String> protectedUuids) {
		List<MflRunItem.Change> changes = changes(row, spec, parentUuid, specByUid);
		List<String> warnings = new ArrayList<String>(spec.getWarnings());
		Boolean retire = null;
		String reason = null;
		if (spec.isClosed() && !row.retired) {
			retire = Boolean.TRUE;
			reason = closedReason(spec);
		} else if (!spec.isClosed() && row.retired) {
			if (row.retireReason != null && row.retireReason.startsWith(MflConstants.RETIRE_REASON_PREFIX)) {
				retire = Boolean.FALSE;
			} else {
				warnings.add("Retired here by hand ('" + row.retireReason + "'), so left retired");
			}
		}

		MflAction action;
		if (retire == Boolean.TRUE) {
			action = MflAction.RETIRE;
		} else if (retire == Boolean.FALSE) {
			action = MflAction.UNRETIRE;
		} else if (!changes.isEmpty()) {
			action = MflAction.UPDATE;
		} else if (!warnings.isEmpty()) {
			action = MflAction.WARNING;
		} else {
			return null;
		}
		MflRunItem item = new MflRunItem(action, spec.getLevel(), spec.getUid(), spec.getCode(), row.uuid, spec.getName(),
		        changes, warnings, null);
		if (action == MflAction.RETIRE && protectedUuids.contains(row.uuid)) {
			item.fail(ownRoot());
		}
		return new Plan(item, spec, row.uuid, parentUuid, false, row.adopted, retire, reason);
	}

	/** Every owned field that differs, in a fixed order: fields, then the level tag, then attributes. */
	private List<MflRunItem.Change> changes(Held row, MflLocationSpec spec, String parentUuid,
	        Map<String, MflLocationSpec> specByUid) {
		List<MflRunItem.Change> changes = new ArrayList<MflRunItem.Change>();
		if (!row.adopted) {
			change(changes, "name", row.name, spec.getName());
		}
		if (!row.adopted && !equal(row.parentUuid, parentUuid)) {
			MflLocationSpec parent = spec.getParentUid() == null ? null : specByUid.get(spec.getParentUid());
			changes.add(new MflRunItem.Change("parent", row.parentName, parent == null ? null : parent.getName()));
		}
		change(changes, "latitude", row.latitude, spec.getLatitude());
		change(changes, "longitude", row.longitude, spec.getLongitude());
		change(changes, "stateProvince", row.stateProvince, spec.getStateProvince());
		change(changes, "countyDistrict", row.countyDistrict, spec.getCountyDistrict());
		change(changes, "country", row.country, spec.getCountry());
		if (!row.tags.contains(spec.getLevel().getTag())) {
			changes.add(new MflRunItem.Change("tag:" + spec.getLevel().getTag(), null, spec.getLevel().getTag()));
		}
		for (Map.Entry<String, String> attribute : spec.getAttributes().entrySet()) {
			change(changes, "attribute:" + types.get(attribute.getKey()).getName(), row.attributes.get(attribute.getKey()),
			    attribute.getValue());
		}
		return changes;
	}

	private void apply(Plan plan) {
		Location location = null;
		try {
			if (plan.create) {
				location = new Location();
				location.setUuid(plan.uuid);
			} else {
				location = locations.getLocationByUuid(plan.uuid);
			}
			if (plan.spec != null) {
				write(location, plan);
			}
			if (plan.retire == Boolean.TRUE && !plan.create) {
				locations.retireLocation(location, plan.retireReason);
			} else if (plan.retire == Boolean.FALSE) {
				locations.unretireLocation(location);
			} else {
				if (plan.retire == Boolean.TRUE) {
					location.setRetired(true);
					location.setRetireReason(plan.retireReason);
				}
				locations.saveLocation(location);
			}
		}
		catch (Exception e) {
			log.warn("MFL sync could not apply {} to {}: {}", plan.item.getAction(), plan.item.getMflUid(), e.getMessage());
			plan.item.fail(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
			if (location != null && !plan.create) {
				try {
					Context.refreshEntity(location);
				}
				catch (Exception ignored) {
					// the next read of this row comes from the database either way
				}
			}
		}
	}

	/**
	 * Sets every owned field; attributes only where they differ, so unchanged ones are not voided. An
	 * adopted row keeps its name and parent: content owns them (ADR 0009 decisions 1 and 3).
	 */
	private void write(Location location, Plan plan) {
		MflLocationSpec spec = plan.spec;
		if (!plan.adopted) {
			location.setName(spec.getName());
			if (plan.parentUuid == null) {
				location.setParentLocation(null);
			} else {
				Location parent = locations.getLocationByUuid(plan.parentUuid);
				if (parent == null) {
					throw new IllegalStateException("Parent " + spec.getParentUid() + " was not created, so this was not either");
				}
				location.setParentLocation(parent);
			}
		}
		location.setLatitude(spec.getLatitude());
		location.setLongitude(spec.getLongitude());
		location.setStateProvince(spec.getStateProvince());
		location.setCountyDistrict(spec.getCountyDistrict());
		location.setCountry(spec.getCountry());
		if (!location.hasTag(spec.getLevel().getTag())) {
			location.addTag(tags.get(spec.getLevel()));
		}
		for (Map.Entry<String, String> attribute : spec.getAttributes().entrySet()) {
			LocationAttributeType type = types.get(attribute.getKey());
			if (equal(value(location, type), attribute.getValue())) {
				continue;
			}
			for (LocationAttribute existing : location.getActiveAttributes(type)) {
				existing.setVoided(true);
				existing.setVoidReason("Changed in the MFL");
			}
			if (attribute.getValue() != null) {
				LocationAttribute replacement = new LocationAttribute();
				replacement.setAttributeType(type);
				replacement.setValue(MflConstants.DATE_ATTRIBUTE_TYPE.equals(attribute.getKey()) ? parseYmd(attribute
				        .getValue()) : attribute.getValue());
				location.addAttribute(replacement);
			}
		}
	}

	private static String value(Location location, LocationAttributeType type) {
		for (LocationAttribute attribute : location.getActiveAttributes(type)) {
			if (attribute.getValueReference() != null) {
				return attribute.getValueReference();
			}
		}
		return null;
	}

	private static MflRunItem duplicate(String uid, MflLevel level, String code, List<Held> rows) {
		List<String> uuids = new ArrayList<String>();
		for (Held row : rows) {
			uuids.add(row.uuid);
		}
		return new MflRunItem(MflAction.ERROR, level, uid, code, rows.get(0).uuid, rows.get(0).name, none(), none(),
		        rows.size() + " locations hold MFL UID " + uid + " (" + String.join(", ", uuids)
		                + "); neither is changed. Retire the one the sync created by hand (ADR 0009, Consequences)");
	}

	private static String ownRoot() {
		return "Not retired: this instance's own facility root. Decide by hand (ADR 0009 §5)";
	}

	private static String closedReason(MflLocationSpec spec) {
		return MflConstants.RETIRE_REASON_PREFIX + " closed " + spec.getClosedDate();
	}

	private static void change(List<MflRunItem.Change> changes, String field, String from, String to) {
		if (!equal(from, to)) {
			changes.add(new MflRunItem.Change(field, from, to));
		}
	}

	private static boolean equal(String a, String b) {
		return a == null ? b == null : a.equals(b);
	}

	private static String blankToNull(String value) {
		return value == null || value.trim().isEmpty() ? null : value;
	}

	private static <T> List<T> none() {
		return Collections.emptyList();
	}

	private static String ymd(Date date) {
		return new SimpleDateFormat("yyyy-MM-dd").format(date);
	}

	private static Date parseYmd(String ymd) {
		try {
			return new SimpleDateFormat("yyyy-MM-dd").parse(ymd);
		}
		catch (ParseException e) {
			throw new IllegalArgumentException("Not a yyyy-mm-dd date: " + ymd);
		}
	}
}
