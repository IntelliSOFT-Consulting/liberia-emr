/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.moduleaccess;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.hibernate.FlushMode;
import org.hibernate.Session;
import org.hibernate.SessionFactory;
import org.openmrs.OrderType;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership;

/**
 * The last flushed row, read on the current connection without flushing the caller's edits
 * and without opening a second session.
 */
final class PersistedOwnership {
	private PersistedOwnership() { }

	/** Flushed ownership for a FHIR delete, which arrives as a uuid rather than a domain object. */
	static Ownership byUuid(ModuleRecordClassifier classifier, Class<?> type, String uuid) {
		if (classifier == null || type == null || uuid == null) { return null; }
		if (org.openmrs.Encounter.class.isAssignableFrom(type)) {
			Integer id = identifier("select encounter_id from encounter where uuid = :uuid", uuid);
			return id == null ? null : encounter(classifier, id);
		}
		if (org.openmrs.Obs.class.isAssignableFrom(type)) {
			Integer id = identifier("select obs_id from obs where uuid = :uuid", uuid);
			return id == null ? null : observation(classifier, id);
		}
		if (org.openmrs.Order.class.isAssignableFrom(type)) {
			Integer id = identifier("select order_id from orders where uuid = :uuid", uuid);
			return id == null ? null : order(classifier, id);
		}
		return null;
	}

	static Ownership encounter(ModuleRecordClassifier classifier, Integer id) {
		if (id == null) { return null; }
		Object[] row = one("select f.uuid as form_uuid, t.uuid as type_uuid from encounter e "
		        + "left join form f on e.form_id = f.form_id "
		        + "left join encounter_type t on e.encounter_type = t.encounter_type_id "
		        + "where e.encounter_id = :id", id);
		if (row == null) { return null; }
		return classifier.assessEncounterIdentity(text(row, 0), text(row, 1), text(row, 1));
	}

	static Ownership observation(ModuleRecordClassifier classifier, Integer id) {
		if (id == null) { return null; }
		return observation(classifier, id, new HashSet<Integer>());
	}

	private static Ownership observation(ModuleRecordClassifier classifier, Integer id, Set<Integer> visited) {
		if (id == null || !visited.add(id) || visited.size() > 100) { return Ownership.ambiguous(); }
		Object[] row = one("select o.obs_group_id as group_id, f.uuid as form_uuid, t.uuid as type_uuid, ord.order_type_id as order_type_id from obs o "
		        + "left join encounter e on o.encounter_id = e.encounter_id "
		        + "left join form f on e.form_id = f.form_id "
		        + "left join encounter_type t on e.encounter_type = t.encounter_type_id "
		        + "left join orders ord on o.order_id = ord.order_id "
		        + "where o.obs_id = :id", id);
		if (row == null) { return Ownership.ambiguous(); }
		Ownership parent = null;
		if (row[0] != null) {
			Integer parentId = integer(row[0]);
			if (parentId == null) { return Ownership.ambiguous(); }
			parent = observation(classifier, parentId, visited);
			if (parent.ambiguous) { return Ownership.ambiguous(); }
		}
		Ownership encounter = row[2] == null ? null : classifier.assessEncounterIdentity(text(row, 1), text(row, 2), text(row, 2));
		if (row[2] != null && (encounter == null || encounter.ambiguous)) { return Ownership.ambiguous(); }
		if ((encounter != null && encounter.excluded) || (parent != null && parent.excluded)) { return Ownership.excluded(); }
		Ownership direct = encounter;
		if (row[3] != null) {
			Ownership order = orderType(classifier, integer(row[3]));
			if (order.ambiguous) { return Ownership.ambiguous(); }
			if (direct != null && (direct.module == ModuleAccess.LABORATORY || direct.module == ModuleAccess.PHARMACY)
			        && order.module != null && direct.module != order.module) {
				return Ownership.ambiguous();
			}
			if (order.module != null) { direct = order; }
		}
		if (parent == null) { return direct == null ? Ownership.unrelated() : direct; }
		if (direct == null || direct.module == null || parent.module == null || direct.module != parent.module) {
			return row[2] == null && row[3] == null ? parent : Ownership.ambiguous();
		}
		return direct;
	}

	static Ownership order(ModuleRecordClassifier classifier, Integer id) {
		if (id == null) { return null; }
		Object[] row = one("select o.order_type_id from orders o where o.order_id = :id", id);
		if (row == null) { return null; }
		return orderType(classifier, integer(row[0]));
	}

	private static Ownership orderType(ModuleRecordClassifier classifier, Integer typeId) {
		if (typeId == null) { return Ownership.ambiguous(); }
		SessionFactory factory = Context.getRegisteredComponents(SessionFactory.class).get(0);
		OrderType type = (OrderType) factory.getCurrentSession().get(OrderType.class, typeId);
		if (type == null) { return Ownership.ambiguous(); }
		org.openmrs.Order order = new org.openmrs.Order();
		order.setOrderType(type);
		return classifier.assessOrder(order);
	}

	private static Integer identifier(String sql, String uuid) {
		Object[] row = row(sql, "uuid", uuid);
		if (row == null || row[0] == null) { return null; }
		return integer(row[0]);
	}

	/**
	 * An integer id from a SQL cell. Null and unreadable values are null so callers fail closed
	 * instead of throwing from an authorization path. OpenMRS ids on these columns are signed
	 * INT, which fits in a Java int, so narrowing a JDBC Number is exact for the values the
	 * driver returns.
	 */
	private static Integer integer(Object value) {
		if (value == null) { return null; }
		if (value instanceof Number) { return Integer.valueOf(((Number) value).intValue()); }
		try {
			return Integer.valueOf(value.toString());
		}
		catch (NumberFormatException e) {
			return null;
		}
	}

	private static Object[] one(String sql, Integer id) {
		return row(sql, "id", id);
	}

	@SuppressWarnings("unchecked")
	private static Object[] row(String sql, String name, Object value) {
		SessionFactory factory = Context.getRegisteredComponents(SessionFactory.class).get(0);
		Session session = factory.getCurrentSession();
		List<Object[]> rows = session.createSQLQuery(sql).setParameter(name, value).setFlushMode(FlushMode.MANUAL).list();
		if (rows == null || rows.isEmpty()) { return null; }
		Object found = rows.get(0);
		return found instanceof Object[] ? (Object[]) found : new Object[] { found };
	}

	private static String text(Object[] row, int index) {
		return row[index] == null ? null : row[index].toString();
	}
}
