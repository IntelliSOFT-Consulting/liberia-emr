package org.openmrs.module.liberiaemr.api.listener;

import java.util.Date;
import java.util.List;

import javax.jms.MapMessage;
import javax.jms.Message;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.Patient;
import org.openmrs.Visit;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.event.EventListener;
import org.openmrs.module.liberiaemr.LiberiaEMRActivator;
import org.openmrs.module.queue.api.QueueEntryService;
import org.openmrs.module.queue.api.search.QueueEntrySearchCriteria;
import org.openmrs.module.queue.model.QueueEntry;
import org.springframework.stereotype.Component;

/**
 * LE-612: a patient voided at the facility leaves the service queues and has no open visit, so
 * neither the queue list nor its counts keep showing them. Both are ended, not voided.
 */
@Component
public class PatientVoidedEventListener implements EventListener {

	private static final Log log = LogFactory.getLog(PatientVoidedEventListener.class);

	@Override
	public void onMessage(final Message message) {
		Daemon.runInDaemonThread(() -> {
			try {
				if (message instanceof MapMessage) {
					String uuid = ((MapMessage) message).getString("uuid");
					if (uuid != null) {
						endQueueEntriesAndVisits(uuid);
					}
				}
			}
			catch (Exception e) {
				log.error("Error processing event message in PatientVoidedEventListener", e);
			}
		}, LiberiaEMRActivator.getDaemonToken());
	}

	private void endQueueEntriesAndVisits(String patientUuid) {
		Patient patient = Context.getPatientService().getPatientByUuid(patientUuid);
		if (patient == null || !patient.getVoided()) {
			return;
		}
		Date now = new Date();

		QueueEntryService queueEntries = Context.getService(QueueEntryService.class);
		QueueEntrySearchCriteria criteria = new QueueEntrySearchCriteria();
		criteria.setPatient(patient);
		criteria.setIsEnded(false);
		for (QueueEntry entry : queueEntries.getQueueEntries(criteria)) {
			entry.setEndedAt(now);
			queueEntries.saveQueueEntry(entry);
		}

		List<Visit> visits = Context.getVisitService().getActiveVisitsByPatient(patient);
		for (Visit visit : visits) {
			Context.getVisitService().endVisit(visit, now);
		}
		log.info("Ended " + visits.size() + " visit(s) of voided patient " + patientUuid);
	}
}
