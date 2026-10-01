/*
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemrreports.reports;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;
import org.openmrs.api.context.Context;
import org.openmrs.module.liberiaemrreports.reporting.NullParameterMappingAdvice;
import org.openmrs.module.liberiaemrreports.reporting.ReportParameters;
import org.openmrs.module.liberiaemrreports.uuid.ReportSheet;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.report.ReportRequest;
import org.openmrs.module.reporting.report.definition.ReportDefinition;
import org.openmrs.module.reporting.report.renderer.RenderingMode;
import org.openmrs.module.reporting.report.service.ReportService;

/**
 * A national run leaves {@code location} out; reportingrest 2.0.0 still maps it, to null, and
 * reporting 2.1.0 then fails to queue the request.
 */
public class NullParameterMappingAdviceTest extends IndicatorReportTestBase {

	/** What reportingrest's ReportRequestResource builds for a request with no location. */
	private static ReportRequest nationalRequest(ReportDefinition rd) {
		Map<String, Object> mappings = new HashMap<String, Object>();
		mappings.put(ReportParameters.START_DATE, new java.util.Date());
		mappings.put(ReportParameters.END_DATE, new java.util.Date());
		mappings.put(ReportParameters.LOCATION, null);
		ReportRequest request = new ReportRequest();
		request.setReportDefinition(new Mapped<ReportDefinition>(rd, mappings));
		ReportService rs = Context.getService(ReportService.class);
		RenderingMode csv = null;
		for (RenderingMode mode : rs.getRenderingModes(rd)) {
			if (ReportSheet.MALARIA.getCsvDesignUuid().equals(mode.getArgument())) {
				csv = mode;
			}
		}
		assertNotNull(csv);
		request.setRenderingMode(csv);
		request.setPriority(ReportRequest.Priority.NORMAL);
		return request;
	}

	@Test
	public void withoutTheAdvice_reportingFailsToQueueANationalRequest() {
		ReportRequest request = nationalRequest(registered(ReportSheet.MALARIA));
		ReportService rs = Context.getService(ReportService.class);
		assertThrows(NullPointerException.class, () -> rs.queueReport(request));
	}

	@Test
	public void withTheAdvice_aNationalRequestQueues() throws Exception {
		ReportRequest request = nationalRequest(registered(ReportSheet.MALARIA));
		Method queueReport = ReportService.class.getMethod("queueReport", ReportRequest.class);
		new NullParameterMappingAdvice().before(queueReport, new Object[] { request }, null);

		ReportRequest queued = Context.getService(ReportService.class).queueReport(request);
		assertEquals(ReportRequest.Status.REQUESTED, queued.getStatus());
		Map<String, Object> mappings = queued.getReportDefinition().getParameterMappings();
		assertFalse(mappings.containsKey(ReportParameters.LOCATION));
		assertTrue(mappings.containsKey(ReportParameters.START_DATE));
	}

	@Test
	public void shouldLeaveOtherReportsAndOtherMethodsAlone() throws Exception {
		ReportDefinition other = new ReportDefinition();
		other.setUuid("not-a-liberiaemr-report");
		Map<String, Object> mappings = new HashMap<String, Object>();
		mappings.put(ReportParameters.LOCATION, null);
		ReportRequest theirs = new ReportRequest();
		theirs.setReportDefinition(new Mapped<ReportDefinition>(other, mappings));
		Method queueReport = ReportService.class.getMethod("queueReport", ReportRequest.class);
		new NullParameterMappingAdvice().before(queueReport, new Object[] { theirs }, null);
		assertTrue(theirs.getReportDefinition().getParameterMappings().containsKey(ReportParameters.LOCATION));

		ReportRequest ours = nationalRequest(registered(ReportSheet.MALARIA));
		Method load = ReportService.class.getMethod("loadRenderedOutput", ReportRequest.class);
		new NullParameterMappingAdvice().before(load, new Object[] { ours }, null);
		assertTrue(ours.getReportDefinition().getParameterMappings().containsKey(ReportParameters.LOCATION));
	}
}
