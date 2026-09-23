package org.openmrs.module.liberiaemr.api.listener;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.openmrs.Obs;
import org.openmrs.module.appointments.model.AppointmentKind;
import org.openmrs.api.AdministrationService;
import org.openmrs.api.ObsService;
import org.openmrs.api.context.Context;
import org.openmrs.api.context.Daemon;
import org.openmrs.module.appointments.model.Appointment;
import org.openmrs.module.appointments.model.AppointmentServiceDefinition;
import org.openmrs.module.appointments.model.AppointmentStatus;
import org.openmrs.module.appointments.service.AppointmentServiceDefinitionService;
import org.openmrs.module.appointments.service.AppointmentsService;
import org.openmrs.event.EventListener;
import org.openmrs.module.liberiaemr.LiberiaEMRActivator;
import org.springframework.stereotype.Component;

import javax.jms.MapMessage;
import javax.jms.Message;

@Component
public class NextContactDateEventListener implements EventListener {

	private static final Log log = LogFactory.getLog(NextContactDateEventListener.class);

	@Override
	public void onMessage(final Message message) {
		// The Event module calls listeners on a background (daemon) thread with no
		// authenticated OpenMRS session. Use Daemon.runInDaemonThread() — which requires
		// a DaemonToken supplied to the Activator — to open a privileged internal session
		// without any username/password credentials.
		Daemon.runInDaemonThread(() -> {
			try {
				if (message instanceof MapMessage) {
					MapMessage mapMessage = (MapMessage) message;
					String uuid = mapMessage.getString("uuid");
					if (uuid != null) {
						processObservation(uuid);
					}
				}
			}
			catch (Exception e) {
				log.error("Error processing event message in NextContactDateEventListener", e);
			}
		}, LiberiaEMRActivator.getDaemonToken());
	}

	private void processObservation(String obsUuid) {
		ObsService obsService = Context.getObsService();
		Obs obs = obsService.getObsByUuid(obsUuid);

		if (obs == null || obs.getConcept() == null || obs.getValueDatetime() == null || obs.isVoided()) {
			return;
		}

		AdministrationService adminService = Context.getAdministrationService();
		String targetConceptUuid = adminService.getGlobalProperty("liberiaemr.nextContactDateConceptUuid",
		    "5096AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

		if (targetConceptUuid.equals(obs.getConcept().getUuid())) {
			log.info("Intercepted Next Contact Date Observation creation for patient: " + obs.getPerson().getUuid());

			AppointmentsService appointmentsService = Context.getService(AppointmentsService.class);
			AppointmentServiceDefinitionService definitionService = Context
			        .getService(AppointmentServiceDefinitionService.class);

			String defaultAppointmentServiceUuid = adminService.getGlobalProperty(
			    "liberiaemr.defaultAppointmentServiceUuid", "");
			AppointmentServiceDefinition serviceDefinition = null;
			if (!defaultAppointmentServiceUuid.isEmpty()) {
				serviceDefinition = definitionService.getAppointmentServiceByUuid(defaultAppointmentServiceUuid);
				if (serviceDefinition == null) {
					log.warn("liberiaemr.defaultAppointmentServiceUuid is set to '" + defaultAppointmentServiceUuid
					        + "' but no appointment service was found with that UUID. Skipping appointment creation.");
					return;
				}
			} else {
				log.warn("liberiaemr.defaultAppointmentServiceUuid is not configured. Skipping appointment creation.");
				return;
			}

			Appointment appointment = new Appointment();
			appointment.setPatient(obs.getPerson().isPatient()
			        ? Context.getPatientService().getPatient(obs.getPerson().getPersonId())
			        : null);
			if (appointment.getPatient() == null) {
				log.error("Cannot create appointment: Observation person is not a patient.");
				return;
			}

			java.util.Date startDate = obs.getValueDatetime();
			// If time is exactly midnight (common for date-only pickers), move to 8:00 AM
			java.util.Calendar cal = java.util.Calendar.getInstance();
			cal.setTime(startDate);
			if (cal.get(java.util.Calendar.HOUR_OF_DAY) == 0 && cal.get(java.util.Calendar.MINUTE) == 0) {
				cal.set(java.util.Calendar.HOUR_OF_DAY, 8);
				startDate = cal.getTime();
			}
			
			appointment.setStartDateTime(startDate);
			// 30 minute duration
			appointment.setEndDateTime(new java.util.Date(startDate.getTime() + 30 * 60 * 1000));
			
			appointment.setStatus(AppointmentStatus.Scheduled);
			appointment.setAppointmentKind(AppointmentKind.Scheduled);
			
			if (serviceDefinition != null) {
				appointment.setService(serviceDefinition);
			}

			// Inherit location from encounter if available
			if (obs.getEncounter() != null && obs.getEncounter().getLocation() != null) {
				appointment.setLocation(obs.getEncounter().getLocation());
			}

			appointmentsService.validateAndSave(appointment);
			log.info("Successfully created appointment for patient: " + appointment.getPatient().getUuid() + " on "
			        + appointment.getStartDateTime());
		}
	}
}
