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

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.hibernate.FlushMode;
import org.hibernate.SessionFactory;
import org.openmrs.DrugOrder;
import org.openmrs.Encounter;
import org.openmrs.MedicationDispense;
import org.openmrs.Obs;
import org.openmrs.Order;
import org.openmrs.TestOrder;
import org.openmrs.api.EncounterService;
import org.openmrs.api.ObsService;
import org.openmrs.api.OrderService;
import org.openmrs.api.ProviderService;
import org.openmrs.api.VisitService;
import org.openmrs.module.liberiaemr.moduleaccess.ModuleAccess.Access;
import org.openmrs.util.PrivilegeConstants;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.ContextAuthenticationException;
import org.springframework.aop.framework.Advised;
import org.springframework.aop.support.StaticMethodMatcherPointcutAdvisor;

/** Attaches the module guard to encounter, observation, and order services, and to the FHIR DAOs that skip those services. */
public final class ModuleAccessInstaller {
	private static final Log log = LogFactory.getLog(ModuleAccessInstaller.class);
	static final Class<?>[] SERVICES = { EncounterService.class, ObsService.class, OrderService.class };
	private static boolean installed;

	private ModuleAccessInstaller() { }

	public static synchronized void install() {
		if (installed) { return; }
		ModuleAccessGuard guard = new ModuleAccessGuard();
		for (Class<?> service : SERVICES) { advise(service, guard); }
		adviseBillingVisits();
		adviseBillingProviders();
		adviseOrderProviders();
		adviseCashPointReads();
		adviseDispense();
		adviseFhirWrites();
		advisePharmacyReads();
		installed = true;
	}

	/**
	 * Only the three visit lookups a bill save performs. Listing methods are not advised, and the
	 * advice does nothing unless a bill POST opened {@link BillingVisitAccess}.
	 */
	private static void adviseBillingVisits() {
		Object proxy = Context.getService(VisitService.class);
		if (!(proxy instanceof Advised)) {
			log.warn("Module access could not advise visit lookups for billing");
			return;
		}
		((Advised) proxy).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(new BillingVisitAccess()) {
			@Override
			public boolean matches(Method method, Class<?> targetClass) {
				String name = method.getName();
				return "getVisit".equals(name) || "getVisitByUuid".equals(name) || "getActiveVisitsByPatient".equals(name);
			}
		});
	}

	/**
	 * Bill save resolves the cashier with {@code getProvidersByPerson}. A supplied cashier is
	 * resolved by uuid while the body is bound, which is the same POST. Provider search stays denied.
	 */
	private static void adviseBillingProviders() {
		Object proxy = Context.getService(ProviderService.class);
		if (!(proxy instanceof Advised)) {
			log.warn("Module access could not advise provider lookups for billing");
			return;
		}
		((Advised) proxy).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(new BillingProviderAccess()) {
			@Override
			public boolean matches(Method method, Class<?> targetClass) {
				String name = method.getName();
				return "getProvider".equals(name) || "getProviderByUuid".equals(name) || "getProvidersByPerson".equals(name);
			}
		});
	}

	/** Orderer binding. Provider search is not advised. */
	private static void adviseOrderProviders() {
		Object proxy = Context.getService(ProviderService.class);
		if (!(proxy instanceof Advised)) {
			log.warn("Module access could not advise provider lookups for orders");
			return;
		}
		((Advised) proxy).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(new OrderProviderAccess()) {
			@Override
			public boolean matches(Method method, Class<?> targetClass) {
				String name = method.getName();
				return "getProvider".equals(name) || "getProviderByUuid".equals(name);
			}
		});
	}

	/**
	 * Cashier 2.3.0 authorizes cash-point reads with Manage Cashier Metadata. The approved billing
	 * bundle grants View Cashier Metadata. Only get methods are proxied, and only for that view.
	 */
	@SuppressWarnings({ "unchecked", "rawtypes" })
	private static void adviseCashPointReads() {
		try {
			Class type = Class.forName("org.openmrs.module.billing.api.CashPointService");
			Object proxy = Context.getService(type);
			if (!(proxy instanceof Advised)) {
				log.warn("Module access could not advise cash-point reads for billing");
				return;
			}
			((Advised) proxy).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(new BillingMetadataAccess()) {
				@Override
				public boolean matches(Method method, Class<?> targetClass) {
					String name = method.getName();
					return name.startsWith("get");
				}
			});
		}
		catch (ClassNotFoundException e) {
			log.info("Cash-point reads stay on their own privilege checks; billing is not installed");
		}
		catch (RuntimeException e) {
			log.info("Cash-point reads stay on their own privilege checks");
		}
	}

	/**
	 * MedicationRequest and MedicationDispense reads skip OrderService, so a pharmacy writer who was
	 * not given Get Orders or Get Medication Dispense cannot load the worklist. The privilege lasts
	 * for the read call only, and only after pharmacy read is already allowed. It is not Get Encounters.
	 */
	private static void advisePharmacyReads() {
		try {
			adviseFhirRead("org.openmrs.module.fhir2.api.dao.FhirMedicationRequestDao", PrivilegeConstants.GET_ORDERS);
			adviseFhirRead("org.openmrs.module.fhir2.api.dao.FhirMedicationDispenseDao",
			    PrivilegeConstants.GET_MEDICATION_DISPENSE);
		}
		catch (ClassNotFoundException e) {
			log.info("Pharmacy reads stay on their own privilege checks; FHIR is not installed");
		}
		catch (RuntimeException e) {
			log.info("Pharmacy reads stay on their own privilege checks");
		}
	}

	private static void adviseFhirRead(String daoName, String privilege) throws ClassNotFoundException {
		Class<?> daoType = Class.forName(daoName);
		List<?> beans = Context.getRegisteredComponents(daoType);
		if (beans == null || beans.isEmpty()) { return; }
		PharmacyFhirRead advice = new PharmacyFhirRead(privilege);
		for (Object bean : beans) {
			if (!(bean instanceof Advised)) { continue; }
			((Advised) bean).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(advice) {
				@Override
				public boolean matches(Method method, Class<?> targetClass) {
					String name = method.getName();
					return "get".equals(name) || "getSearchResults".equals(name) || "getSearchResultsCount".equals(name);
				}
			});
		}
	}

	@SuppressWarnings({ "unchecked", "rawtypes" })
	private static void advise(Class service, ModuleAccessGuard guard) {
		Object proxy = Context.getService(service);
		if (!(proxy instanceof Advised)) {
			log.warn("Module access could not advise " + service.getName());
			return;
		}
		((Advised) proxy).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(guard) {
			@Override
			public boolean matches(Method method, Class<?> targetClass) { return true; }
		});
	}

	/** FHIR MedicationDispense is saved by its DAO, after the translator has set the drug order. */
	private static void adviseDispense() {
		try {
			Class<?> daoType = Class.forName("org.openmrs.module.fhir2.api.dao.FhirMedicationDispenseDao");
			List<?> beans = Context.getRegisteredComponents(daoType);
			if (beans == null || beans.isEmpty() || !(beans.get(0) instanceof Advised)) {
				log.info("Medication dispense stays on its own privilege checks; the FHIR DAO is not installed");
				return;
			}
			((Advised) beans.get(0)).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(new DispenseAdvice()) {
				@Override
				public boolean matches(Method method, Class<?> targetClass) {
					return "createOrUpdate".equals(method.getName()) || "delete".equals(method.getName());
				}
			});
		}
		catch (ClassNotFoundException e) {
			log.info("Medication dispense stays on its own privilege checks; FHIR is not installed");
		}
		catch (RuntimeException e) {
			log.info("Medication dispense stays on its own privilege checks");
		}
	}

	/**
	 * FHIR2 4.2.0 saves these four resources with {@code Session.saveOrUpdate}. Observation update
	 * is not among them: {@code FhirObservationServiceImpl.applyUpdate} calls {@code ObsService.saveObs}.
	 * A FHIR encounter that represents a visit is saved by FhirVisitService and is not a module record.
	 */
	private static void adviseFhirWrites() {
		try {
			adviseFhir("org.openmrs.module.fhir2.api.dao.FhirEncounterDao", Encounter.class);
			adviseFhir("org.openmrs.module.fhir2.api.dao.FhirObservationDao", Obs.class);
			adviseFhir("org.openmrs.module.fhir2.api.dao.FhirMedicationRequestDao", DrugOrder.class);
			adviseFhir("org.openmrs.module.fhir2.api.dao.FhirServiceRequestDao", TestOrder.class);
		}
		catch (ClassNotFoundException e) {
			log.info("FHIR clinical writes stay on their service checks; FHIR is not installed");
		}
		catch (RuntimeException e) {
			log.info("FHIR clinical writes stay on their service checks");
		}
	}

	private static void adviseFhir(String daoName, Class<?> recordType) throws ClassNotFoundException {
		Class<?> daoType = Class.forName(daoName);
		List<?> beans = Context.getRegisteredComponents(daoType);
		if (beans == null || beans.isEmpty()) { return; }
		FhirWriteAdvice advice = new FhirWriteAdvice(recordType);
		for (Object bean : beans) {
			if (!(bean instanceof Advised)) { continue; }
			((Advised) bean).addAdvisor(0, new StaticMethodMatcherPointcutAdvisor(advice) {
				@Override
				public boolean matches(Method method, Class<?> targetClass) {
					return "createOrUpdate".equals(method.getName()) || "delete".equals(method.getName());
				}
			});
		}
	}

	static final class FhirWriteAdvice implements MethodInterceptor {
		private final Class<?> recordType;
		private final ModuleAccessGuard guard = new ModuleAccessGuard();

		FhirWriteAdvice(Class<?> recordType) { this.recordType = recordType; }

		public Object invoke(MethodInvocation invocation) throws Throwable {
			if (!ModulePrivileges.matrixRole()) { return invocation.proceed(); }
			boolean delete = "delete".equals(invocation.getMethod().getName());
			List<String> proxied = new ArrayList<>();
			try {
				if (delete) {
					Object id = invocation.getArguments() == null || invocation.getArguments().length == 0 ? null
					        : invocation.getArguments()[0];
					if (!(id instanceof String)) { throw new ContextAuthenticationException("Module access denied"); }
					guard.authorizeFhirDelete(recordType, (String) id, proxied);
				}
				else {
					Object record = argument(invocation.getArguments());
					if (record == null) { throw new ContextAuthenticationException("Module access denied"); }
					guard.authorizeFhir(record, proxied);
				}
				return invocation.proceed();
			}
			finally {
				for (int i = proxied.size() - 1; i >= 0; i--) { Context.removeProxyPrivilege(proxied.get(i)); }
			}
		}

		private static Object argument(Object[] args) {
			if (args == null) { return null; }
			for (Object arg : args) {
				if (arg instanceof Encounter || arg instanceof Obs || arg instanceof Order) { return arg; }
			}
			return null;
		}
	}

	static final class PharmacyFhirRead implements MethodInterceptor {
		private final String privilege;

		PharmacyFhirRead(String privilege) { this.privilege = privilege; }

		public Object invoke(MethodInvocation invocation) throws Throwable {
			if (!ModulePrivileges.matrixRole()
			        || !ModuleAccess.PHARMACY.allows(ModulePrivileges.current(), Access.READ)) {
				return invocation.proceed();
			}
			boolean added = false;
			if (!Context.hasPrivilege(privilege)) {
				Context.addProxyPrivilege(privilege);
				added = true;
			}
			try {
				return invocation.proceed();
			}
			finally {
				if (added) { Context.removeProxyPrivilege(privilege); }
			}
		}
	}

	static final class DispenseAdvice implements MethodInterceptor {
		public Object invoke(MethodInvocation invocation) throws Throwable {
			if (!ModulePrivileges.matrixRole()) { return invocation.proceed(); }
			boolean delete = "delete".equals(invocation.getMethod().getName());
			List<String> proxied = new ArrayList<>();
			try {
				MedicationDispense dispense = delete ? load(invocation.getArguments()) : argument(invocation.getArguments());
				ModuleAccessGuard.authorizeDispense(dispense, delete, proxied);
				return invocation.proceed();
			}
			finally {
				for (int i = proxied.size() - 1; i >= 0; i--) { Context.removeProxyPrivilege(proxied.get(i)); }
			}
		}

		private static MedicationDispense argument(Object[] args) {
			if (args == null) { return null; }
			for (Object arg : args) {
				if (arg instanceof MedicationDispense) { return (MedicationDispense) arg; }
			}
			return null;
		}

		@SuppressWarnings("unchecked")
		private static MedicationDispense load(Object[] args) {
			if (args == null || args.length == 0 || !(args[0] instanceof String)) { return null; }
			SessionFactory factory = Context.getRegisteredComponents(SessionFactory.class).get(0);
			List<MedicationDispense> rows = factory.getCurrentSession()
			        .createQuery("from MedicationDispense where uuid = :uuid")
			        .setParameter("uuid", args[0])
			        .setFlushMode(FlushMode.MANUAL)
			        .list();
			return rows == null || rows.isEmpty() ? null : rows.get(0);
		}
	}
}
