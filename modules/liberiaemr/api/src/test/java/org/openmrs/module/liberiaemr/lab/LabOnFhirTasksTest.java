/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.liberiaemr.lab;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Arrays;

import org.junit.Test;
import org.openmrs.scheduler.SchedulerException;
import org.openmrs.scheduler.SchedulerService;
import org.openmrs.scheduler.TaskDefinition;

public class LabOnFhirTasksTest {

	private static TaskDefinition task(String taskClass, boolean started, boolean startOnStartup) {
		TaskDefinition task = new TaskDefinition();
		task.setName(taskClass);
		task.setTaskClass(taskClass);
		task.setStarted(started);
		task.setStartOnStartup(startOnStartup);
		return task;
	}

	@Test
	public void stopsEveryLabOnFhirTaskAndKeepsItFromStartingAgain() throws Exception {
		TaskDefinition pull = task("org.openmrs.module.labonfhir.api.scheduler.FetchTaskUpdates", true, true);
		TaskDefinition retry = task("org.openmrs.module.labonfhir.api.scheduler.RetryFailedTasks", true, true);
		SchedulerService scheduler = mock(SchedulerService.class);
		when(scheduler.getRegisteredTasks()).thenReturn(Arrays.asList(pull, retry));

		assertEquals(2, LabOnFhirTasks.disable(scheduler));

		verify(scheduler).shutdownTask(pull);
		verify(scheduler).shutdownTask(retry);
		assertFalse(pull.getStartOnStartup());
		assertFalse(retry.getStartOnStartup());
		verify(scheduler).saveTaskDefinition(pull);
		verify(scheduler).saveTaskDefinition(retry);
	}

	@Test
	public void leavesOtherModulesTasksAlone() throws Exception {
		TaskDefinition mfl = task("org.openmrs.module.liberiaemr.mfl.MflSyncTask", true, true);
		SchedulerService scheduler = mock(SchedulerService.class);
		when(scheduler.getRegisteredTasks()).thenReturn(Arrays.asList(mfl));

		assertEquals(0, LabOnFhirTasks.disable(scheduler));

		verify(scheduler, never()).shutdownTask(any());
		verify(scheduler, never()).saveTaskDefinition(any());
		assertTrue(mfl.getStartOnStartup());
	}

	@Test
	public void oneTaskFailingDoesNotStopTheOthersBeingTurnedOff() throws Exception {
		TaskDefinition pull = task("org.openmrs.module.labonfhir.api.scheduler.FetchTaskUpdates", true, true);
		TaskDefinition retry = task("org.openmrs.module.labonfhir.api.scheduler.RetryFailedTasks", true, true);
		SchedulerService scheduler = mock(SchedulerService.class);
		when(scheduler.getRegisteredTasks()).thenReturn(Arrays.asList(pull, retry));
		doThrow(new SchedulerException("boom")).when(scheduler).shutdownTask(pull);

		assertEquals(1, LabOnFhirTasks.disable(scheduler));

		verify(scheduler).saveTaskDefinition(retry);
		assertFalse(retry.getStartOnStartup());
	}

	@Test
	public void treatsAnUnsetStartedFlagAsNotStarted() throws Exception {
		TaskDefinition pull = task("org.openmrs.module.labonfhir.api.scheduler.FetchTaskUpdates", false, true);
		pull.setStarted(null);
		SchedulerService scheduler = mock(SchedulerService.class);
		when(scheduler.getRegisteredTasks()).thenReturn(Arrays.asList(pull));

		assertEquals(1, LabOnFhirTasks.disable(scheduler));

		assertFalse(pull.getStartOnStartup());
	}

	@Test
	public void doesNothingToATaskThatIsAlreadyOff() throws Exception {
		TaskDefinition pull = task("org.openmrs.module.labonfhir.api.scheduler.FetchTaskUpdates", false, false);
		SchedulerService scheduler = mock(SchedulerService.class);
		when(scheduler.getRegisteredTasks()).thenReturn(Arrays.asList(pull));

		assertEquals(0, LabOnFhirTasks.disable(scheduler));

		verify(scheduler, never()).shutdownTask(any());
		verify(scheduler, never()).saveTaskDefinition(any());
	}
}
