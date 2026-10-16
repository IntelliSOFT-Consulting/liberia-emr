import { Type } from '@openmrs/esm-framework';
import type { FhirDoseMapping } from './history';
import schedule from './routine-schedule.json' with { type: 'json' };

/**
 * UUID-bearing metadata is runtime configuration. National values come from
 * content-liberia-national frontend configuration as ${var.*}. Object keys such as
 * one vaccine concept can be overridden alone. nationalFormUuids is an array, and
 * frontend config replaces arrays wholesale. These defaults stay empty so the
 * UUIDs are not copied into the bundle.
 */
const vaccineConceptUuidFields = Object.fromEntries(
  schedule.map((dose) => [dose.id, {
    _type: Type.ConceptUuid,
    _default: '',
    _description: `Vaccine concept UUID for canonical dose ${dose.id}.`,
  }]),
);

export interface RoutineConfig {
  nationalFormUuids: string[];
  vaccineQuestionUuid: string;
  vaccineConceptUuids: Record<string, string>;
  fhirDoseMappings: FhirDoseMapping[];
}

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
  vaccineConceptUuids: vaccineConceptUuidFields,
  fhirDoseMappings: {
    _type: Type.Array,
    _default: [],
    _description: 'Verified vaccine coding + positive dose number mappings to LE-559 canonical dose IDs. No inferred OPV0 numbering.',
    _elements: {
      _type: Type.Object,
      code: { _type: Type.String },
      system: { _type: Type.String, _default: '' },
      sequenceNumber: { _type: Type.Number },
      canonicalDoseId: { _type: Type.String },
    },
  },
};
