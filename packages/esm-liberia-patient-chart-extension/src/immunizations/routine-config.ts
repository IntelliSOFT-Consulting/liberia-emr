import { Type } from '@openmrs/esm-framework';
import { recognizedDoseIds, sequenceRules } from './sequence-rules.ts';

/**
 * Runtime UUID metadata. National values come from content-package frontend
 * configuration as ${var.*}. Defaults stay empty so UUIDs are not copied into
 * the bundle. nationalFormUuids, vaccineQuestionUuid, vaccineConceptUuids, and
 * fhirDoseMappings are the shared routine immunization config. ancFormUuids and
 * ancTtConceptUuids are the ANC TT fields sequencing needs on top of that.
 * Object keys can be overridden one dose at a time. Arrays are replaced wholesale.
 */
const conceptField = (description: string) => ({
  _type: Type.ConceptUuid,
  _default: '',
  _description: description,
});

const vaccineConceptUuidFields = Object.fromEntries(
  [...sequenceRules.map((dose) => dose.id), ...recognizedDoseIds].map((id) => [id, conceptField(
    `Vaccine concept UUID for canonical dose ${id}.`,
  )]),
);

const ancTtConceptUuidFields = Object.fromEntries(
  sequenceRules.filter((dose) => dose.series === 'tetanus').map((dose) => [dose.id, conceptField(
    `ANC Date-of-TT concept that counts as ${dose.id}.`,
  )]),
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
    _description: 'Verified vaccine coding plus positive dose number mappings to canonical dose IDs. Sequencing matches concept UUIDs and does not infer a dose from this list.',
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
