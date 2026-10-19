import { Type } from '@openmrs/esm-framework';
import { recognizedDoseIds, sequenceRules } from './sequence-rules.ts';
import schedule from './routine-schedule.json' with { type: 'json' };

/**
 * Shared runtime identity for routine schedule display and dose sequencing.
 * National values come from content-package frontend configuration as ${var.*}.
 * Defaults stay empty so UUIDs are not copied into the bundle. Object keys can
 * be overridden one dose at a time. Arrays are replaced wholesale.
 * Schedule policy and sequence rules stay in the ESM.
 */
const conceptField = (id: string) => ({
  _type: Type.ConceptUuid,
  _default: '',
  _description: `Vaccine concept UUID for canonical dose ${id}.`,
});

const vaccineConceptUuidFields = Object.fromEntries([
  ...schedule.map((dose) => [dose.id, conceptField(dose.id)]),
  ...sequenceRules.map((dose) => [dose.id, conceptField(dose.id)]),
  ...recognizedDoseIds.map((id) => [id, conceptField(id)]),
]);

const ancTtConceptUuidFields = Object.fromEntries(
  sequenceRules.filter((dose) => dose.series === 'tetanus').map((dose) => [dose.id, {
    _type: Type.ConceptUuid,
    _default: '',
    _description: `ANC Date-of-TT concept that counts as ${dose.id}.`,
  }]),
);

export interface FhirDoseMapping {
  code: string;
  system: string;
  sequenceNumber: number;
  canonicalDoseId: string;
}

export interface RoutineConfig {
  nationalFormUuids: string[];
  vaccineQuestionUuid: string;
  vaccineConceptUuids: Record<string, string>;
  fhirDoseMappings: FhirDoseMapping[];
  ancFormUuids: string[];
  ancTtConceptUuids: Record<string, string>;
}

/** Sequencing and the routine schedule share this one runtime object. */
export type SequenceIdentityConfig = RoutineConfig;

export const routineConfigSchema = {
  nationalFormUuids: {
    _type: Type.Array,
    _elements: { _type: Type.UUID },
    _default: [],
    _description: 'Runtime UUIDs of national Immunization form versions whose encounters count as dose history. A site config replaces this whole list.',
  },
  vaccineQuestionUuid: {
    _type: Type.ConceptUuid,
    _default: '',
    _description: 'Concept UUID of the vaccine-name question on the national Immunization form.',
  },
  vaccineConceptUuids: {
    _type: Type.Object,
    _description: 'Canonical dose ID to vaccine concept UUID. A site can replace one dose key and the other values remain.',
    ...vaccineConceptUuidFields,
  },
  fhirDoseMappings: {
    _type: Type.Array,
    _default: [],
    _description: 'Verified vaccine coding, system, and positive dose number mappings to canonical dose IDs. A coding with a system is not an OpenMRS concept UUID. No inferred OPV0 numbering. Empty until a deployment supplies verified mappings.',
    _elements: {
      _type: Type.Object,
      code: { _type: Type.String },
      system: { _type: Type.String, _default: '' },
      sequenceNumber: { _type: Type.Number },
      canonicalDoseId: { _type: Type.String },
    },
  },
  ancFormUuids: {
    _type: Type.Array,
    _elements: { _type: Type.UUID },
    _default: [],
    _description: 'Runtime UUIDs of ANC forms whose Date-of-TT observations count as tetanus history. A site config replaces this whole list.',
  },
  ancTtConceptUuids: {
    _type: Type.Object,
    _description: 'Canonical TD dose ID to the ANC Date-of-TT concept that counts as that dose. TD1 is the unsuffixed TD concept.',
    ...ancTtConceptUuidFields,
  },
};
