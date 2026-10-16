import { Type } from '@openmrs/esm-framework';
import type { FhirDoseMapping } from './history';

export interface RoutineConfig { fhirDoseMappings: FhirDoseMapping[] }
export const routineConfigSchema = {
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
