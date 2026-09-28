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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;

public class MflRunLockTest {

	@Test
	public void start_shouldGiveAConcurrentCallerTheRunIdEvenWhileTheRunIsBeingRecorded() throws Exception {
		final MflRunLock lock = new MflRunLock();
		final CountDownLatch recording = new CountDownLatch(1);
		final CountDownLatch release = new CountDownLatch(1);
		Thread first = new Thread(new Runnable() {

			@Override
			public void run() {
				lock.start(new MflRunLock.Recorder() {

					@Override
					public int record() {
						recording.countDown();
						await(release);
						return 42;
					}
				});
			}
		});
		first.start();
		assertTrue(recording.await(5, TimeUnit.SECONDS));

		final AtomicReference<Integer> busyWith = new AtomicReference<Integer>();
		Thread second = new Thread(new Runnable() {

			@Override
			public void run() {
				try {
					lock.start(new MflRunLock.Recorder() {

						@Override
						public int record() {
							throw new AssertionError("a second run must never be recorded");
						}
					});
				}
				catch (MflRunLock.BusyException e) {
					busyWith.set(e.getRunId());
				}
			}
		});
		second.start();
		Thread.sleep(200);
		release.countDown();
		first.join(5000);
		second.join(5000);
		assertEquals("the 409 names the run, never null", Integer.valueOf(42), busyWith.get());
	}

	@Test
	public void start_shouldStayFreeWhenRecordingFails() {
		MflRunLock lock = new MflRunLock();
		try {
			lock.start(new MflRunLock.Recorder() {

				@Override
				public int record() {
					throw new IllegalStateException("database down");
				}
			});
			fail();
		}
		catch (IllegalStateException expected) {}
		assertEquals(0, lock.current());
	}

	@Test
	public void release_shouldFreeOnlyTheRunThatHoldsTheLock() {
		MflRunLock lock = new MflRunLock();
		lock.start(new MflRunLock.Recorder() {

			@Override
			public int record() {
				return 7;
			}
		});
		lock.release(8);
		assertEquals(7, lock.current());
		lock.release(7);
		assertEquals(0, lock.current());
	}

	private static void await(CountDownLatch latch) {
		try {
			latch.await(5, TimeUnit.SECONDS);
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}
