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

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.MedicationDispense;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.OrderGroup;
import org.openmrs.OrderType;
import org.openmrs.TestOrder;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccessPolicy.Verdict;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleRecordClassifier.Ownership;
import org.openmrs.util.PrivilegeConstants;

/**
 * Encounter, observation, and order checks for matrix-role users. Other users keep OpenMRS
 * behavior. A proxied privilege lasts for this call only, and only after the module decision
 * allows the operation.
 *
 * <p>Proxied privileges, each required because the matrix allow would otherwise die on a generic
 * OpenMRS check:
 * <ul>
 * <li>{@code Get Encounters} — a matrix role may read an encounter module and was not given Get Encounters
 * (Physician Assistant reading Labor and Delivery). The result is then limited to modules that role may read.</li>
 * <li>{@code Get Observations} — the same collision for observation reads.</li>
 * <li>{@code Get Orders} — the same collision for Laboratory or Pharmacy reads.</li>
 * <li>{@code Add Encounters} or {@code Edit Encounters} — a matrix write of a protected encounter
 * whose role was not given that generic privilege.</li>
 * <li>{@code Add Observations} or {@code Edit Observations} — the same collision for a protected observation.</li>
 * <li>{@code Add Orders} or {@code Edit Orders} — the same collision for a Laboratory or Pharmacy order
 * (Lab Technician creates a test order with Edit Orders but not Add Orders; Nurse writes Pharmacy).
 * An order group proxies Add Orders, which order numbering requires, once every order in it is allowed.</li>
 * <li>{@code Get Order Types} — {@code OrderService.saveOrder} calls {@code getOrderTypeByUuid}, which
 * OpenMRS authorizes separately. Proxied only after the order write is already allowed, so a matrix
 * role can save the order it was granted. It is not a persistent grant and does not authorize a
 * direct order-type lookup.</li>
 * <li>{@code Edit Medication Dispense} or {@code Delete Medication Dispense} — Pharmacy write on the
 * FHIR dispense call. See {@link #authorizeDispense}.</li>
 * <li>{@code Add Encounters} or {@code Edit Encounters}, and {@code Delete Encounters} — a FHIR encounter
 * write whose role was not given that privilege. FHIR accepts either add or edit. Delete is proxied only
 * for a protected module that was already allowed. See {@link #authorizeFhir}.</li>
 * <li>{@code Add Observations} or {@code Edit Observations}, and {@code Delete Observations} — the same
 * collision for a FHIR observation create or void. FHIR observation update calls {@code ObsService.saveObs}
 * and uses the observation bullets above.</li>
 * <li>{@code Add Orders} or {@code Edit Orders}, and {@code Delete Orders} — the same collision for a FHIR
 * MedicationRequest or ServiceRequest. Those DAOs do not call {@code getOrderTypeByUuid}, so Get Order Types
 * is not proxied on this path.</li>
 * </ul>
 * Get Locations, Get Concepts, and Get Order Frequencies are not proxied.
 */
public final class ModuleAccessGuard implements MethodInterceptor {
	private final ModuleRecordClassifier classifier = new ModuleRecordClassifier();
	private final ThreadLocal<Boolean> inside = new ThreadLocal<>();
	/** Read proxies kept until the REST filter finishes rendering the response. */
	private static final ThreadLocal<List<String>> heldReads = new ThreadLocal<>();

	@Override
	public Object invoke(MethodInvocation invocation) throws Throwable {
		if (inside.get() != null || !ModulePrivileges.matrixRole()) { return invocation.proceed(); }
		inside.set(Boolean.TRUE);
		List<String> proxied = new ArrayList<>();
		try {
			String name = invocation.getMethod().getName();
			if (name.startsWith("getCareSetting")) { return readCareSetting(invocation, proxied); }
			if (name.startsWith("getOrderFrequency")) { return readOrderFrequency(invocation, proxied); }
			if (isEncounterRead(name)) { return readEncounters(invocation, proxied); }
			if (isObservationRead(name)) { return readObservations(invocation, proxied); }
			if (isOrderRead(name)) { return readOrders(invocation, proxied); }
			if (isEncounterWrite(name)) { authorizeEncounterWrite(name, invocation.getArguments(), proxied); }
			else if (isObservationWrite(name)) { authorizeObservationWrite(name, invocation.getArguments(), proxied); }
			else if (isOrderWrite(name)) { authorizeOrderWrite(name, invocation.getArguments(), proxied); }
			else if ("saveOrderGroup".equals(name)) { authorizeOrderGroupWrite(invocation.getArguments(), proxied); }
			return invocation.proceed();
		}
		finally {
			release(proxied);
			inside.remove();
		}
	}

	/**
	 * FHIR create or update of an already translated encounter, observation, or order.
	 * Requires write on the persisted module and on the module that would remain.
	 */
	public void authorizeFhir(Object record, List<String> proxied) {
		if (!ModulePrivileges.matrixRole()) { return; }
		if (record instanceof Encounter) { fhirEncounter((Encounter) record, proxied); }
		else if (record instanceof Obs) { fhirObservation((Obs) record, proxied); }
		else if (record instanceof Order) { fhirOrder((Order) record, proxied); }
		else { deny(); }
	}

	/** FHIR void. Ownership comes from the flushed row, not from a request body. A missing row is left for the DAO. */
	public void authorizeFhirDelete(Class<?> type, String uuid, List<String> proxied) {
		if (!ModulePrivileges.matrixRole()) { return; }
		Ownership before = PersistedOwnership.byUuid(classifier, type, uuid);
		if (before == null) { return; }
		require(ModuleAccessPolicy.destroy(before, ModulePrivileges.current()));
		if (before.module == null) { return; }
		String privilege = deletePrivilege(type);
		proxyUnlessAny(proxied, privilege, privilege);
	}

	/**
	 * Pharmacy write plus a linked drug order. Call-scoped medication-dispense privilege when the
	 * role was not given it. A missing link is denied.
	 */
	public static void authorizeDispense(MedicationDispense dispense, boolean delete, List<String> proxied) {
		if (!ModulePrivileges.matrixRole()) { return; }
		if (dispense == null) { return; }
		Ownership ownership = new ModuleRecordClassifier().assessDispense(dispense.getDrugOrder());
		if (ModuleAccessPolicy.destroy(ownership, ModulePrivileges.current()) != Verdict.ALLOW) { deny(); }
		String privilege = delete ? PrivilegeConstants.DELETE_MEDICATION_DISPENSE : PrivilegeConstants.EDIT_MEDICATION_DISPENSE;
		if (!Context.hasPrivilege(privilege)) { proxy(proxied, privilege); }
	}

	/** The response filter calls this so a read proxy survives until JSON rendering finishes. */
	public static void holdReads() {
		if (heldReads.get() == null) { heldReads.set(new ArrayList<String>()); }
	}

	public static void releaseHeld() {
		List<String> held = heldReads.get();
		heldReads.remove();
		if (held != null) { release(held); }
	}

	private Object readCareSetting(MethodInvocation invocation, List<String> proxied) throws Throwable {
		Set<String> privileges = ModulePrivileges.current();
		boolean orderWriter = ModuleAccess.LABORATORY.allows(privileges, Access.WRITE)
		        || ModuleAccess.PHARMACY.allows(privileges, Access.WRITE);
		if (orderWriter) { proxyRead(proxied, PrivilegeConstants.GET_CARE_SETTINGS); }
		return invocation.proceed();
	}

	private Object readOrderFrequency(MethodInvocation invocation, List<String> proxied) throws Throwable {
		if (ModuleAccess.PHARMACY.allows(ModulePrivileges.current(), Access.WRITE)) {
			proxyWrite(proxied, "Get Order Frequencies");
		}
		return invocation.proceed();
	}

	private Object readEncounters(MethodInvocation invocation, List<String> proxied) throws Throwable {
		Set<String> privileges = ModulePrivileges.current();
		boolean had = ModulePrivileges.own(PrivilegeConstants.GET_ENCOUNTERS);
		if (!had && ModulePrivileges.anyClinicalRead(privileges)) { proxyRead(proxied, PrivilegeConstants.GET_ENCOUNTERS); }
		return filter(invocation.proceed(), privileges, had);
	}

	private Object readObservations(MethodInvocation invocation, List<String> proxied) throws Throwable {
		Set<String> privileges = ModulePrivileges.current();
		boolean had = ModulePrivileges.own(PrivilegeConstants.GET_OBS);
		if (!had && ModulePrivileges.anyClinicalRead(privileges)) { proxyRead(proxied, PrivilegeConstants.GET_OBS); }
		return filter(invocation.proceed(), privileges, had);
	}

	private Object readOrders(MethodInvocation invocation, List<String> proxied) throws Throwable {
		Set<String> privileges = ModulePrivileges.current();
		boolean had = ModulePrivileges.own(PrivilegeConstants.GET_ORDERS);
		if (!had && (ModuleAccess.LABORATORY.allows(privileges, Access.READ) || ModuleAccess.PHARMACY.allows(privileges, Access.READ))) {
			proxyRead(proxied, PrivilegeConstants.GET_ORDERS);
		}
		return filter(invocation.proceed(), privileges, had);
	}

	private Object filter(Object result, Set<String> privileges, boolean hadGenericRead) {
		if (result instanceof Encounter) { return keepEncounter((Encounter) result, privileges, hadGenericRead) ? result : omit(); }
		if (result instanceof Obs) { return keepObservation((Obs) result, privileges, hadGenericRead) ? result : omit(); }
		if (result instanceof Order) { return keepOrder((Order) result, privileges, hadGenericRead) ? result : omit(); }
		if (result instanceof OrderGroup) { return keepOrderGroup((OrderGroup) result, privileges, hadGenericRead) ? result : omit(); }
		if (result instanceof Collection) {
			Collection<?> source = (Collection<?>) result;
			List<Object> kept = new ArrayList<>();
			for (Object item : source) {
				if (item instanceof Encounter && keepEncounter((Encounter) item, privileges, hadGenericRead)) { kept.add(item); }
				else if (item instanceof Obs && keepObservation((Obs) item, privileges, hadGenericRead)) { kept.add(item); }
				else if (item instanceof Order && keepOrder((Order) item, privileges, hadGenericRead)) { kept.add(item); }
				else if (item instanceof OrderGroup && keepOrderGroup((OrderGroup) item, privileges, hadGenericRead)) { kept.add(item); }
				else if (!(item instanceof Encounter) && !(item instanceof Obs) && !(item instanceof Order)
				        && !(item instanceof OrderGroup)) { kept.add(item); }
			}
			if (source instanceof Set) { return new HashSet<>(kept); }
			return kept;
		}
		return result;
	}

	/** Shared with the response filter so visit and FHIR reads use this decision. */
	public boolean keepEncounter(Encounter encounter, Set<String> privileges, boolean hadGenericRead) {
		Ownership ownership = classifier.assessStoredEncounter(encounter);
		if (!hadGenericRead && (ownership.isUnrelated() || ownership.excluded)) { return false; }
		return ModuleAccessPolicy.read(ownership, privileges) == Verdict.ALLOW;
	}

	public boolean keepObservation(Obs obs, Set<String> privileges, boolean hadGenericRead) {
		Ownership ownership = classifier.assessObservation(obs);
		if (!hadGenericRead && (ownership.isUnrelated() || ownership.excluded)) { return false; }
		return ModuleAccessPolicy.read(ownership, privileges) == Verdict.ALLOW;
	}

	public boolean keepOrder(Order order, Set<String> privileges, boolean hadGenericRead) {
		Ownership ownership = classifier.assessOrder(order);
		if (!hadGenericRead && (ownership.isUnrelated() || ownership.excluded)) { return false; }
		return ModuleAccessPolicy.read(ownership, privileges) == Verdict.ALLOW;
	}

	/**
	 * A group is returned whole, so it is kept only when every order in it, and in its nested groups,
	 * could be read directly. The persistent group is not trimmed.
	 */
	private boolean keepOrderGroup(OrderGroup group, Set<String> privileges, boolean hadGenericRead) {
		for (OrderGroup member : groupTree(group)) {
			if (member.getOrders() == null) { continue; }
			for (Order order : member.getOrders()) {
				if (!keepOrder(order, privileges, hadGenericRead)) { return false; }
			}
		}
		return true;
	}

	public ModuleRecordClassifier classifier() { return classifier; }

	private void authorizeEncounterWrite(String name, Object[] args, List<String> proxied) {
		Encounter encounter = argument(args, Encounter.class);
		if (encounter == null) { return; }
		Set<String> privileges = ModulePrivileges.current();
		if (name.startsWith("purge")) { denyPurge(classifier.assessStoredEncounter(encounter)); return; }
		Ownership after = classifier.assessStoredEncounter(encounter);
		Ownership before = PersistedOwnership.encounter(classifier, encounter.getEncounterId());
		if (encounter.getEncounterId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (encounter.getAllObs(true) != null) {
			for (Obs obs : encounter.getAllObs(true)) { authorizeNestedObservation(obs, privileges); }
		}
		if (encounter.getOrders() != null) {
			for (Order order : encounter.getOrders()) { authorizeNestedOrder(order, privileges); }
		}
		if (after.module != null) {
			proxyWrite(proxied, encounter.getEncounterId() == null ? PrivilegeConstants.ADD_ENCOUNTERS : PrivilegeConstants.EDIT_ENCOUNTERS);
			if (encounter.getAllObs(true) != null && !encounter.getAllObs(true).isEmpty()) {
				proxyWrite(proxied, encounter.getEncounterId() == null ? PrivilegeConstants.ADD_OBS : PrivilegeConstants.EDIT_OBS);
			}
		if (encounter.getOrders() != null && !encounter.getOrders().isEmpty()) {
			proxyWrite(proxied, PrivilegeConstants.ADD_ORDERS);
			proxyWrite(proxied, PrivilegeConstants.EDIT_ORDERS);
		}
		}
		// Bed management reads the assignment on update. The visit-assignment handler lists this
		// patient's visits while creating an encounter. Neither privilege is kept after the save.
		if (!Context.hasPrivilege("Get Beds")) { proxy(proxied, "Get Beds"); }
		if (!Context.hasPrivilege("Get Admission Locations")) { proxy(proxied, "Get Admission Locations"); }
		if (!Context.hasPrivilege(PrivilegeConstants.GET_VISITS)) { proxy(proxied, PrivilegeConstants.GET_VISITS); }
		if (!ModulePrivileges.own(PrivilegeConstants.GET_ENCOUNTERS)) { proxyRead(proxied, PrivilegeConstants.GET_ENCOUNTERS); }
	}

	private void authorizeObservationWrite(String name, Object[] args, List<String> proxied) {
		Obs obs = argument(args, Obs.class);
		if (obs == null) { return; }
		Set<String> privileges = ModulePrivileges.current();
		Ownership after = classifier.assessObservation(obs);
		if (name.startsWith("purge")) {
			denyPurge(obs.getObsId() == null ? after : PersistedOwnership.observation(classifier, obs.getObsId()));
			return;
		}
		Ownership before = obs.getObsId() == null ? null : PersistedOwnership.observation(classifier, obs.getObsId());
		if (obs.getObsId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (obs.getOrder() != null) { authorizeNestedOrder(obs.getOrder(), privileges); }
		if (after.module != null) {
			proxyWrite(proxied, obs.getObsId() == null ? PrivilegeConstants.ADD_OBS : PrivilegeConstants.EDIT_OBS);
		}
	}

	private void authorizeOrderWrite(String name, Object[] args, List<String> proxied) {
		Order order = argument(args, Order.class);
		if (order == null) { return; }
		Set<String> privileges = ModulePrivileges.current();
		Ownership after = classifier.assessOrder(order);
		if (name.startsWith("purge")) {
			denyPurge(order.getOrderId() == null ? after : PersistedOwnership.order(classifier, order.getOrderId()));
			return;
		}
		Ownership before = order.getOrderId() == null ? null : PersistedOwnership.order(classifier, order.getOrderId());
		if ("discontinueOrder".equals(name) || "updateOrderFulfillerStatus".equals(name)) {
			require(before == null ? ModuleAccessPolicy.create(after, privileges) : ModuleAccessPolicy.update(before, after, privileges));
		}
		else if (order.getOrderId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (after.module != null || (before != null && before.module != null)) {
			boolean create = order.getOrderId() == null && !"discontinueOrder".equals(name) && !"updateOrderFulfillerStatus".equals(name);
			proxyWrite(proxied, create ? PrivilegeConstants.ADD_ORDERS : PrivilegeConstants.EDIT_ORDERS);
			proxyWrite(proxied, PrivilegeConstants.GET_ORDER_TYPES);
			proxyWrite(proxied, PrivilegeConstants.GET_CARE_SETTINGS);
		}
	}

	/**
	 * saveOrderGroup saves each new order, and each nested group, through the service proxy, where
	 * this advice is already inside. Every order in the group tree is decided here, before the group
	 * row or any order is written; one denied order denies the whole call.
	 */
	private void authorizeOrderGroupWrite(Object[] args, List<String> proxied) {
		OrderGroup group = argument(args, OrderGroup.class);
		if (group == null) { return; }
		Set<String> privileges = ModulePrivileges.current();
		boolean protectedOrder = false;
		for (OrderGroup member : groupTree(group)) {
			if (member.getOrders() == null) { continue; }
			for (Order order : member.getOrders()) { protectedOrder |= authorizeNestedOrder(order, privileges); }
		}
		if (protectedOrder) {
			proxyWrite(proxied, PrivilegeConstants.ADD_ORDERS);
			proxyWrite(proxied, PrivilegeConstants.GET_ORDER_TYPES);
		}
	}

	/** The group and its nested groups. A cycle, or an implausibly deep tree, fails closed. */
	private static List<OrderGroup> groupTree(OrderGroup root) {
		Set<OrderGroup> seen = Collections.newSetFromMap(new IdentityHashMap<OrderGroup, Boolean>());
		List<OrderGroup> tree = new ArrayList<>();
		List<OrderGroup> pending = new ArrayList<>();
		pending.add(root);
		while (!pending.isEmpty()) {
			OrderGroup group = pending.remove(pending.size() - 1);
			if (group == null) { continue; }
			if (!seen.add(group) || seen.size() > 100) { deny(); }
			tree.add(group);
			if (group.getNestedOrderGroups() != null) { pending.addAll(group.getNestedOrderGroups()); }
		}
		return tree;
	}

	private void authorizeNestedObservation(Obs obs, Set<String> privileges) {
		Ownership after = classifier.assessObservation(obs);
		Ownership before = obs.getObsId() == null ? null : PersistedOwnership.observation(classifier, obs.getObsId());
		if (obs.getObsId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (obs.getOrder() != null) { authorizeNestedOrder(obs.getOrder(), privileges); }
	}

	/** Returns true when the order is, or was, in a protected module. */
	private boolean authorizeNestedOrder(Order order, Set<String> privileges) {
		Ownership after = classifier.assessOrder(order);
		Ownership before = order.getOrderId() == null ? null : PersistedOwnership.order(classifier, order.getOrderId());
		if (order.getOrderId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		return after.module != null || (before != null && before.module != null);
	}

	private static void denyPurge(Ownership ownership) {
		if (ownership != null && (ownership.module != null || ownership.ambiguous)) { deny(); }
	}

	private void fhirEncounter(Encounter encounter, List<String> proxied) {
		Set<String> privileges = ModulePrivileges.current();
		Ownership after = classifier.assessStoredEncounter(encounter);
		Ownership before = PersistedOwnership.encounter(classifier, encounter.getEncounterId());
		if (encounter.getEncounterId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (encounter.getAllObs(true) != null) {
			for (Obs obs : encounter.getAllObs(true)) { authorizeNestedObservation(obs, privileges); }
		}
		if (encounter.getOrders() != null) {
			for (Order order : encounter.getOrders()) { authorizeNestedOrder(order, privileges); }
		}
		if (protectedModule(before, after) == null) { return; }
		boolean create = encounter.getEncounterId() == null;
		proxyUnlessAny(proxied, create ? PrivilegeConstants.ADD_ENCOUNTERS : PrivilegeConstants.EDIT_ENCOUNTERS,
		    PrivilegeConstants.ADD_ENCOUNTERS, PrivilegeConstants.EDIT_ENCOUNTERS);
	}

	private void fhirObservation(Obs obs, List<String> proxied) {
		Set<String> privileges = ModulePrivileges.current();
		Ownership after = classifier.assessObservation(obs);
		Ownership before = obs.getObsId() == null ? null : PersistedOwnership.observation(classifier, obs.getObsId());
		if (obs.getObsId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (obs.getOrder() != null) { authorizeNestedOrder(obs.getOrder(), privileges); }
		if (protectedModule(before, after) == null) { return; }
		boolean create = obs.getObsId() == null;
		proxyUnlessAny(proxied, create ? PrivilegeConstants.ADD_OBS : PrivilegeConstants.EDIT_OBS, PrivilegeConstants.ADD_OBS,
		    PrivilegeConstants.EDIT_OBS);
	}

	private void fhirOrder(Order order, List<String> proxied) {
		Set<String> privileges = ModulePrivileges.current();
		Ownership after = orderOwnership(order);
		Ownership before = order.getOrderId() == null ? null : PersistedOwnership.order(classifier, order.getOrderId());
		if (order.getOrderId() == null || before == null) { require(ModuleAccessPolicy.create(after, privileges)); }
		else { require(ModuleAccessPolicy.update(before, after, privileges)); }
		if (protectedModule(before, after) == null) { return; }
		boolean create = order.getOrderId() == null;
		proxyUnlessAny(proxied, create ? PrivilegeConstants.ADD_ORDERS : PrivilegeConstants.EDIT_ORDERS,
		    PrivilegeConstants.ADD_ORDERS, PrivilegeConstants.EDIT_ORDERS);
	}

	/**
	 * MedicationRequestTranslatorImpl allocates a DrugOrder and ServiceRequest's DAO is a TestOrder.
	 * Neither write sets an order type before {@code Session.saveOrUpdate}. A type that is present
	 * is classified as stored, so a conflicting type stays ambiguous.
	 */
	private Ownership orderOwnership(Order order) {
		if (order.getOrderType() != null || (!(order instanceof DrugOrder) && !(order instanceof TestOrder))) {
			return classifier.assessOrder(order);
		}
		OrderType type = new OrderType();
		type.setUuid(order instanceof DrugOrder ? OrderType.DRUG_ORDER_TYPE_UUID : OrderType.TEST_ORDER_TYPE_UUID);
		Order probe = order instanceof DrugOrder ? new DrugOrder() : new TestOrder();
		probe.setOrderType(type);
		return classifier.assessOrder(probe);
	}

	private static ModuleAccess protectedModule(Ownership before, Ownership after) {
		if (before != null && before.module != null) { return before.module; }
		if (after != null && after.module != null) { return after.module; }
		return null;
	}

	private static String deletePrivilege(Class<?> type) {
		if (type != null && Encounter.class.isAssignableFrom(type)) { return PrivilegeConstants.DELETE_ENCOUNTERS; }
		if (type != null && Obs.class.isAssignableFrom(type)) { return PrivilegeConstants.DELETE_OBS; }
		return PrivilegeConstants.DELETE_ORDERS;
	}

	private static void proxyWrite(List<String> proxied, String privilege) {
		if (!Context.hasPrivilege(privilege)) { proxy(proxied, privilege); }
	}

	/** FHIR {@code @Authorized} accepts any listed privilege. Proxy only when the role has none of them. */
	private static void proxyUnlessAny(List<String> proxied, String privilege, String... anyOf) {
		for (String candidate : anyOf) {
			if (Context.hasPrivilege(candidate)) { return; }
		}
		proxy(proxied, privilege);
	}

	/**
	 * A REST filter holds read proxies until the response is rendered. Outside a request they end
	 * with the service call, which is what the service tests assert.
	 */
	private static void proxyRead(List<String> proxied, String privilege) {
		List<String> held = heldReads.get();
		if (held != null) {
			if (!Context.hasPrivilege(privilege) && !held.contains(privilege)) {
				Context.addProxyPrivilege(privilege);
				held.add(privilege);
			}
			return;
		}
		proxy(proxied, privilege);
	}

	private static void proxy(List<String> proxied, String privilege) {
		Context.addProxyPrivilege(privilege);
		proxied.add(privilege);
	}

	private static void release(List<String> proxied) {
		for (int i = proxied.size() - 1; i >= 0; i--) { Context.removeProxyPrivilege(proxied.get(i)); }
	}

	private static void require(Verdict verdict) {
		if (verdict != Verdict.ALLOW) { deny(); }
	}

	private static Object deny() {
		throw new ContextAuthenticationException("Module access denied");
	}

	/** A nested REST read is omitted. A direct service read still throws, which the tests require. */
	private static Object omit() {
		return heldReads.get() != null ? null : deny();
	}

	private static <T> T argument(Object[] args, Class<T> type) {
		if (args == null) { return null; }
		for (Object arg : args) {
			if (type.isInstance(arg)) { return type.cast(arg); }
		}
		return null;
	}

	private static boolean isEncounterRead(String name) {
		return "getEncounter".equals(name) || "getEncounterByUuid".equals(name) || name.startsWith("getEncounters");
	}

	private static boolean isObservationRead(String name) {
		return "getObs".equals(name) || "getObsByUuid".equals(name) || name.startsWith("getObservations")
		        || "getComplexObs".equals(name) || "getRevisionObs".equals(name);
	}

	private static boolean isOrderRead(String name) {
		return "getOrder".equals(name) || "getOrderByUuid".equals(name) || "getOrderByOrderNumber".equals(name)
		        || "getOrders".equals(name) || "getActiveOrders".equals(name) || name.startsWith("getAllOrders")
		        || name.startsWith("getOrderHistory") || "getDiscontinuationOrder".equals(name) || "getRevisionOrder".equals(name)
		        || "getOrderGroup".equals(name) || "getOrderGroupByUuid".equals(name) || "getOrderGroupsByPatient".equals(name)
		        || "getOrderGroupsByEncounter".equals(name);
	}

	/** transferEncounter voids and saves through {@code this}, so those calls never reach this advice. */
	private static boolean isEncounterWrite(String name) {
		return "saveEncounter".equals(name) || "voidEncounter".equals(name) || "unvoidEncounter".equals(name)
		        || "purgeEncounter".equals(name) || "transferEncounter".equals(name);
	}

	private static boolean isObservationWrite(String name) {
		return "saveObs".equals(name) || "voidObs".equals(name) || "unvoidObs".equals(name) || "purgeObs".equals(name);
	}

	/** saveRetrospectiveOrder reaches the private save without passing through saveOrder. */
	private static boolean isOrderWrite(String name) {
		return "saveOrder".equals(name) || "saveRetrospectiveOrder".equals(name) || "voidOrder".equals(name)
		        || "unvoidOrder".equals(name) || "purgeOrder".equals(name) || "discontinueOrder".equals(name)
		        || "updateOrderFulfillerStatus".equals(name);
	}
}
