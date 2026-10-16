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

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.openmrs.api.EncounterService;
import org.openmrs.api.ObsService;
import org.openmrs.api.OrderService;
import org.openmrs.api.ProviderService;
import org.openmrs.api.VisitService;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemr.LiberiaEMRActivator;
import org.powermock.api.mockito.PowerMockito;
import org.powermock.core.classloader.annotations.PrepareForTest;
import org.powermock.core.classloader.annotations.PowerMockIgnore;
import org.powermock.modules.junit4.PowerMockRunner;
import org.springframework.aop.framework.Advised;
import org.springframework.aop.framework.ProxyFactory;

@RunWith(PowerMockRunner.class)
@PrepareForTest(Context.class)
@PowerMockIgnore({ "javax.xml.*", "org.xml.*", "org.w3c.*", "org.apache.logging.*", "org.slf4j.*", "javax.management.*" })
public class ModuleAccessLifecycleTest {
	@Test public void eachRefreshedSetOfServiceProxiesReceivesAdviceOnce() {
		PowerMockito.mockStatic(Context.class);
		LiberiaEMRActivator activator = new LiberiaEMRActivator();
		try {
			for (int refresh = 0; refresh < 2; refresh++) {
				activator.willRefreshContext();
				List<Advised> proxies = new ArrayList<>();
				proxies.add(service(EncounterService.class));
				proxies.add(service(ObsService.class));
				proxies.add(service(OrderService.class));
				proxies.add(service(VisitService.class));
				Advised provider = service(ProviderService.class);
				activator.contextRefreshed();
				activator.contextRefreshed();
				ModuleAccessInstaller.install();
				for (Advised proxy : proxies) { assertEquals(1, proxy.getAdvisors().length); }
				assertEquals(2, provider.getAdvisors().length);
			}
		}
		finally { ModuleAccessInstaller.resetForContextRefresh(); }
	}

	private <T> Advised service(Class<T> type) {
		ProxyFactory factory = new ProxyFactory();
		factory.setInterfaces(type);
		factory.setTarget(mock(type));
		Object proxy = factory.getProxy();
		when(Context.getService(type)).thenReturn(type.cast(proxy));
		return (Advised) proxy;
	}
}
