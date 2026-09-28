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

/**
 * Runs never overlap. The lock is taken and the run recorded under one monitor, so a caller that
 * finds the lock taken always learns the id of the run holding it: a 409 never says
 * {@code runId: null}.
 */
final class MflRunLock {
	
	/** Records the run, returning its id. Called with the lock's monitor held. */
	interface Recorder {
		
		int record();
	}
	
	/** Another run holds the lock. */
	static final class BusyException extends RuntimeException {
		
		private final int runId;
		
		BusyException(int runId) {
			super("A run is already in progress");
			this.runId = runId;
		}
		
		int getRunId() {
			return runId;
		}
	}
	
	/** 0 while free, else the id of the run holding the lock. */
	private int running;
	
	/**
	 * @return the id the recorder returned, which now holds the lock
	 * @throws BusyException with the holder's id when another run holds the lock
	 */
	synchronized int start(Recorder recorder) {
		if (running != 0) {
			throw new BusyException(running);
		}
		// If recording throws, the lock stays free.
		running = recorder.record();
		return running;
	}
	
	/** Frees the lock if this run holds it. */
	synchronized void release(int runId) {
		if (running == runId) {
			running = 0;
		}
	}
	
	/** @return the id of the run holding the lock, or 0 */
	synchronized int current() {
		return running;
	}
	
	synchronized void clear() {
		running = 0;
	}
}
