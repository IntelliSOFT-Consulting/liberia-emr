import { type FhirPatient, type RemoteSearchedPatient } from './import-patient.resource';

const genders: Record<string, string> = { M: 'male', F: 'female', O: 'other' };

/**
 * Maps a central search hit to the FHIR shape OpenMRS's own patient banner renders, so remote
 * results use the same name, gender, age and identifier components (and therefore the same
 * fonts and spacing) as local ones. Identifier types carry their UUID as `coding[0].code`
 * because that is what the banner's identifier filter and primary-identifier styling read.
 */
export function toFhirPatient(patient: RemoteSearchedPatient): FhirPatient {
  const person = patient.person ?? {};
  const preferred = person.preferredName;
  const given = [preferred?.givenName, preferred?.middleName].filter(Boolean) as Array<string>;

  const name =
    given.length || preferred?.familyName
      ? { use: 'usual', given, family: preferred?.familyName }
      : { use: 'usual', text: person.display };

  return {
    resourceType: 'Patient',
    id: patient.uuid,
    name: [name],
    gender: (person.gender && genders[person.gender]) || 'unknown',
    birthDate: person.birthdate?.slice(0, 10),
    deceasedBoolean: Boolean(person.dead),
    identifier: (patient.identifiers ?? []).map((identifier) => ({
      use: identifier.preferred ? 'usual' : 'secondary',
      value: identifier.identifier,
      type: {
        text: identifier.identifierType?.name,
        coding: identifier.identifierType?.uuid ? [{ code: identifier.identifierType.uuid }] : undefined,
      },
    })),
  };
}
