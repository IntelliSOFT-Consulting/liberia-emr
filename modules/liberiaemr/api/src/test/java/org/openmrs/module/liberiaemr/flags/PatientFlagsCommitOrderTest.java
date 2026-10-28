/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.flags;

import static org.junit.Assert.assertEquals;
import java.util.ArrayList;
import java.util.List;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.Test;
import org.openmrs.api.EncounterService;
import org.springframework.aop.Advisor;
import org.springframework.aop.framework.Advised;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.interceptor.TransactionInterceptor;

public class PatientFlagsCommitOrderTest {
	private static final String FLAGS = Flag.class.getName();

	@Test public void flagAdviceMovesJustOutsideTheTransaction() {
		Advised proxy = proxy(new Guard(), new TransactionInterceptor(), new Other(), new Flag());
		PatientFlagsCommitOrder.moveOutsideTransaction(proxy, FLAGS);
		assertEquals(order(Guard.class, Flag.class, TransactionInterceptor.class, Other.class), order(proxy));
	}

	@Test public void movingTwiceKeepsTheSameOrder() {
		Advised proxy = proxy(new Guard(), new TransactionInterceptor(), new Flag());
		PatientFlagsCommitOrder.moveOutsideTransaction(proxy, FLAGS);
		PatientFlagsCommitOrder.moveOutsideTransaction(proxy, FLAGS);
		assertEquals(order(Guard.class, Flag.class, TransactionInterceptor.class), order(proxy));
	}

	@Test public void aProxyWithoutATransactionIsLeftAlone() {
		Advised proxy = proxy(new Guard(), new Flag());
		PatientFlagsCommitOrder.moveOutsideTransaction(proxy, FLAGS);
		assertEquals(order(Guard.class, Flag.class), order(proxy));
	}

	private static Advised proxy(MethodInterceptor... advice) {
		ProxyFactory factory = new ProxyFactory();
		factory.addInterface(EncounterService.class);
		for (MethodInterceptor each : advice) { factory.addAdvice(each); }
		return (Advised) factory.getProxy();
	}

	private static List<Class<?>> order(Advised proxy) {
		List<Class<?>> types = new ArrayList<>();
		for (Advisor advisor : proxy.getAdvisors()) { types.add(advisor.getAdvice().getClass()); }
		return types;
	}

	private static List<Class<?>> order(Class<?>... types) {
		List<Class<?>> list = new ArrayList<>();
		for (Class<?> type : types) { list.add(type); }
		return list;
	}

	static class Pass implements MethodInterceptor {
		@Override
		public Object invoke(MethodInvocation invocation) throws Throwable { return invocation.proceed(); }
	}

	static final class Guard extends Pass { }

	static final class Other extends Pass { }

	static final class Flag extends Pass { }
}
